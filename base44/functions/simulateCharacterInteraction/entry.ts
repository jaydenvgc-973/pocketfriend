import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Determines attraction speed multiplier based on orientation + gender compatibility
function getAttractionMultiplier(characterOrientation, characterGender, targetGender) {
  const orientation = (characterOrientation || 'not specified').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const tgtGender = (targetGender || '').toLowerCase();

  const isSameGender = charGender && tgtGender && charGender === tgtGender;
  const isOppositeGender =
    (charGender === 'male' && tgtGender === 'female') ||
    (charGender === 'female' && tgtGender === 'male');
  const isNonBinary =
    tgtGender === 'non-binary' || tgtGender === 'other' || tgtGender === 'non_binary';

  if (orientation === 'straight') {
    if (isNonBinary) return 0.15;
    if (isSameGender) return 0.1; // 90% slower
    return 1.0;
  }
  if (orientation === 'gay' || orientation === 'lesbian') {
    if (isOppositeGender) return 0.1; // 90% slower
    if (isNonBinary) return 0.5;
    return 1.0;
  }
  // bisexual, pansexual, queer, prefer not to say — full speed
  return 1.0;
}

// Returns a new orientation if the 30% attraction threshold triggers a shift
function checkOrientationShift(currentOrientation, attractionLevel, characterGender, targetGender) {
  const orientation = (currentOrientation || '').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const tgtGender = (targetGender || '').toLowerCase();

  if (attractionLevel < 30) return null;

  const isSameGender = charGender && tgtGender && charGender === tgtGender;
  const isNonBinary = tgtGender === 'non-binary' || tgtGender === 'other' || tgtGender === 'non_binary';
  const isOppositeGender =
    (charGender === 'male' && tgtGender === 'female') ||
    (charGender === 'female' && tgtGender === 'male');

  if (orientation === 'straight') {
    if (isNonBinary) return 'pansexual';
    if (isSameGender) return Math.random() > 0.5 ? 'bisexual' : 'prefer not to say';
  }
  if (orientation === 'gay' || orientation === 'lesbian') {
    if (isOppositeGender) return 'bisexual';
  }
  return null;
}

// Milestone definitions
const MILESTONES = [
  { field: 'friendship_level', threshold: 25, label: 'budding friendship' },
  { field: 'friendship_level', threshold: 50, label: 'genuine friendship' },
  { field: 'friendship_level', threshold: 75, label: 'deep friendship' },
  { field: 'romantic_level', threshold: 25, label: 'romantic spark' },
  { field: 'romantic_level', threshold: 50, label: 'romantic feelings' },
  { field: 'romantic_level', threshold: 75, label: 'deep romantic bond' },
  { field: 'attraction_level', threshold: 30, label: 'noticeable attraction' },
  { field: 'attraction_level', threshold: 60, label: 'strong attraction' },
];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Trace object — records each completed step for diagnostics on failure
  const trace = {
    auth_loaded: false,
    payload_received: false,
    character_ids_received: [],
    character_lookup_started: false,
    character_lookup_results: [],
    ownership_verified: false,
    type_verified: false,
    prompt_built: false,
    ai_response_started: false,
    ai_response_completed: false,
    character_write_started: false,
    character_write_completed: false,
    memory_write_started: false,
    memory_write_completed: false,
  };

  // ── STAGE: auth ────────────────────────────────────────────────────────────
  let user;
  try {
    user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized', stage: 'auth', trace }, { status: 401 });
    trace.auth_loaded = true;
  } catch (authErr) {
    return Response.json({ error: authErr?.message || String(authErr), stage: 'auth', trace }, { status: 500 });
  }

  // ── STAGE: payload ─────────────────────────────────────────────────────────
  let character_ids, userPrompt;
  try {
    const body = await req.json();
    character_ids = body.character_ids;
    userPrompt = body.userPrompt;
    if (!character_ids || character_ids.length < 2) {
      return Response.json({ error: 'At least 2 character IDs required', stage: 'payload', trace }, { status: 400 });
    }
    trace.payload_received = true;
    trace.character_ids_received = character_ids;
  } catch (payloadErr) {
    return Response.json({ error: payloadErr?.message || String(payloadErr), stage: 'payload', trace }, { status: 400 });
  }

  const SUPPORTED_TYPES = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular'];

  // ── STAGE: character_lookup ────────────────────────────────────────────────
  // Root cause of prior 404s: Character.get(id) via asServiceRole fails for valid characters
  // owned by a user — the method does not reliably bypass RLS for all record types.
  //
  // The proven working pattern used by Home, Chat, fetchNPCsForUser, and every other
  // character resolver in the app is: filter({ owner_email }) then look up by id in-memory.
  // This is the same source-of-truth query. We fetch all owned characters once, then
  // resolve each requested id from that set. No ID transformation occurs.
  trace.character_lookup_started = true;

  // CRITICAL: asServiceRole.entities.Character.filter({ owner_email }) only returns NPC types
  // on this account — it does NOT return active_created_character records via service role.
  // This is the same split that exists on the Home page, which fetches two separate lists:
  //   1. User-scoped (RLS) query → active_created_character records
  //   2. Service-role backend (fetchNPCsForUser) → NPC types
  //
  // We must replicate the same dual-fetch here. The user-scoped base44.entities path (NOT
  // asServiceRole) returns all character types the authenticated user owns via RLS.
  let allOwnedChars = [];
  try {
    // Sequential to avoid rate-limit (429) from simultaneous queries on the same account
    // Path 1: user-scoped RLS — returns active_created_character records
    const activeChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      300
    );
    await new Promise(r => setTimeout(r, 200));
    // Path 2: service-role — returns NPC types (npc_fictitious, npc_family_member, npc_regular)
    const npcChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      300
    );

    // Merge and deduplicate by id — same pattern as Home's allCharacters merge
    const seen = new Set();
    for (const c of [...activeChars, ...npcChars]) {
      if (!seen.has(c.id) && c.status !== 'deleted' && c.status !== 'soft_deleted') {
        seen.add(c.id);
        allOwnedChars.push(c);
      }
    }

    trace.character_lookup_results.push({
      stage: 'owner_fetch',
      total_owned: allOwnedChars.length,
      active_chars_count: activeChars.length,
      npc_chars_count: npcChars.length,
      owner_email_used: user.email,
    });
  } catch (fetchErr) {
    return Response.json({
      error: `Failed to fetch owned characters for user ${user.email}: ${fetchErr?.message || String(fetchErr)}`,
      stage: 'character_fetch_all_owned',
      current_user_email: user.email,
      trace
    }, { status: 500 });
  }

  // Build a lookup map from the fetched set — O(1) per requested id
  const ownedById = {};
  for (const c of allOwnedChars) {
    ownedById[c.id] = c;
  }

  const characters = [];
  for (const id of character_ids) {
    const char = ownedById[id] || null;

    trace.character_lookup_results.push({
      id,
      found: !!char,
      name: char?.name || null,
      owner_email: char?.owner_email || null,
      character_type: char?.character_type || null,
      in_owned_set: !!char,
    });

    if (!char) {
      // Character id submitted by the frontend was not found in the owner's character set.
      // This means either: stale frontend cache, wrong id, or the character was deleted.
      // Report all owned ids so the caller can cross-check.
      return Response.json({
        error: `Character id "${id}" was not found among ${allOwnedChars.length} characters owned by ${user.email}. The selected card may be showing a stale id. Reload the Home page and try again.`,
        stage: 'character_fetch',
        character_id: id,
        total_owned_characters: allOwnedChars.length,
        owned_character_ids: allOwnedChars.map(c => ({ id: c.id, name: c.name, type: c.character_type })),
        current_user_email: user.email,
        trace
      }, { status: 404 });
    }

    // owner_email is guaranteed equal because we fetched by owner_email — but verify explicitly
    if (char.owner_email !== user.email) {
      return Response.json({
        error: `Ownership mismatch for "${char.name}" (id=${id}): owner_email=${char.owner_email}, expected=${user.email}`,
        stage: 'ownership_verification',
        character_id: id,
        expected_owner: user.email,
        trace
      }, { status: 403 });
    }
    trace.ownership_verified = true;

    if (!SUPPORTED_TYPES.includes(char.character_type)) {
      return Response.json({
        error: `Unsupported character type for "${char.name}" (${char.character_type}). Supported: ${SUPPORTED_TYPES.join(', ')}`,
        stage: 'type_eligibility',
        character_id: id,
        trace
      }, { status: 400 });
    }
    trace.type_verified = true;

    characters.push(char);
  }

  const getRelationshipContext = (fromChar, toChar) => {
    const rel = (fromChar.fictional_relationships || []).find(r => r.related_character_id === toChar.id);
    if (rel) {
      const levels = `Friendship: ${rel.friendship_level ?? 'unknown'}, Attraction: ${rel.attraction_level ?? 'unknown'}, Romantic: ${rel.romantic_level ?? 'unknown'}`;
      return `${fromChar.name} views ${toChar.name} as a ${rel.relationship_type}. ${rel.description || ''} Current status: ${rel.current_status || 'unknown'}. Levels — ${levels}.`;
    }
    return `${fromChar.name} and ${toChar.name} haven't established a formal relationship yet.`;
  };

  const characterProfiles = characters.map(char => ({
    id: char.id,
    name: char.name,
    gender: char.gender || 'unknown',
    sexual_orientation: char.sexual_orientation || 'not specified',
    personality: char.personality_summary || '',
    traits: (char.personality_traits || []).join(', '),
    emotionalState: char.emotional_state || 'calm',
    currentSituation: char.current_life_event || char.current_situation || '',
    archetype: char.archetype || 'unknown',
    emotional_baggage: char.emotional_baggage || '',
    emotional_triggers_deep: (char.emotional_triggers_deep || []).join(', '),
  }));

  const interactionContext = characters.length === 2
    ? `${getRelationshipContext(characters[0], characters[1])}\n${getRelationshipContext(characters[1], characters[0])}`
    : characters.map((char, i) => {
        const others = characters.filter((_, j) => j !== i);
        return others.map(other => getRelationshipContext(char, other)).join('\n');
      }).join('\n');

  const nowISO = new Date().toISOString();
  const nowDisplay = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });

  const userDirection = userPrompt
    ? `\n\nCURRENT SITUATION — THIS IS ALREADY HAPPENING RIGHT NOW:\n"${userPrompt}"\nThis is not a suggestion or a direction — it is an established fact. This event is actively occurring or has just occurred. The characters are in the middle of this situation. They are aware of it, affected by it, and must react to it directly. The entire scene, dialogue, and outcome must flow FROM this event. Do not introduce a separate scenario — build entirely on top of this one.\n`
    : '';

  const TIME_CONTEXT = `CURRENT DATE & TIME: ${nowDisplay} (${nowISO})\nWhen the user's prompt or the scene references a specific time (e.g. "1:00 PM", "tonight at 8", "tomorrow morning"), resolve that to an exact ISO 8601 UTC datetime and include it in the scheduled_events output array.\n`;

  const WORLD_CONTEXT = `WORLD CONTEXT (the real world these characters live in):
The average American sleeps ~9 hours, spends ~5 hours on leisure (TV, socializing, gaming), works 3.5–8 hours, and checks their phone ~58 times/day. About 24% work remotely. ~1 in 5 Americans has an STI at any given time; ages 15–24 account for half of new STIs. The U.S. incarcerates over 2 million people; racial disparities are significant; innocent Black people are 7x more likely to be wrongly convicted. Religion often serves as a coping mechanism under systemic stress. Youth join gangs due to poverty, instability, and the pull of belonging and protection. The homelessness-jail cycle deepens instability. 74% of high school seniors aspire to college but only ~61% enroll — cost is the #1 barrier.`.trim();

  const aiPrompt = `Simulate a realistic interaction between these characters. Pay close attention to their sexual orientations and genders when determining how attraction develops.

${TIME_CONTEXT}
${WORLD_CONTEXT}


${characterProfiles.map(p => `
NAME: ${p.name}
Gender: ${p.gender}
Sexual Orientation: ${p.sexual_orientation}
Personality: ${p.personality}
Core traits: ${p.traits}
Emotional state: ${p.emotionalState}
Current life: ${p.currentSituation}
Archetype: ${p.archetype}
Emotional baggage: ${p.emotional_baggage}
Deep emotional triggers: ${p.emotional_triggers_deep}
`).join('\n')}

RELATIONSHIP CONTEXT:
${interactionContext}${userDirection}

Generate a natural conversation/interaction scene that:
 1. Begins DIRECTLY inside the current situation described above (if provided) — do not re-introduce or recap it, just start in it
 2. Reflects their actual personalities and relationship dynamic
 3. Includes realistic dialogue with distinct voices for each character
 4. Shows their emotional state and how they currently feel about each other
 5. References something specific from their current situations or past history if known
 6. Results in some outcome — does the interaction bring them closer, create tension, resolve something?
 7. The scene_summary must describe the current situation as the backdrop, not as a future or hypothetical event

NON-PHYSICAL ATTRACTION TRAIT DETECTION — for each character, detect if the OTHER character demonstrated:
- KINDNESS: genuine warmth, empathy, or unprompted care
- HUMOR: wit, playful banter, making the other laugh
- INTEGRITY: honesty, moral backbone, standing by values under pressure
- VULNERABILITY: emotional openness, admitting something difficult, sharing fear/insecurity
- INTELLECTUAL GROWTH: sharing learned insights, engaging with meaningful ideas, stimulating the other intellectually

Use detected traits to update attraction_level_change for each character. Apply more weight to traits that align with that character's specific archetype and personality. Apply ZERO or minimal weight to traits that don't match the character's attraction profile.

SEXUAL ORIENTATION ATTRACTION RULES — CRITICAL:
- "straight" characters attract at 90% SLOWER rate to same-gender characters (multiply positive attraction delta by 0.1). For non-binary targets: multiply by 0.15.
- "gay" or "lesbian" characters attract at 90% SLOWER rate to opposite-gender characters (multiply by 0.1). For non-binary: multiply by 0.5.
- "bisexual", "pansexual", "queer", "prefer not to say" — full normal attraction speed for all genders.
- These multipliers apply to positive attraction changes only. Negative changes are unaffected.

For each character, provide their updated relationship levels toward EACH other character (the changes should reflect the above rules).

Return a JSON object with:
{
  "scene_summary": "brief description of what happened and the setting",
  "dialogue": [
    { "speaker": "character_name", "text": "dialogue" }
  ],
  "outcome": "what changed or was revealed",
  "emotional_shifts": { "character_name": "how their emotional state changed" },
  "emotional_milestone": "<brief description if a significant emotional moment occurred, or null>",
  "shared_secret": "<brief description if a secret was revealed, or null>",
  "relationship_updates": {
    "character_name": {
      "other_character_id": "other_character_id",
      "last_interaction_summary": "specific summary",
      "updated_status": "current status after interaction",
      "emotional_impact": "how this interaction affected them",
      "friendship_level_change": <number -10 to +10>,
      "attraction_level_change": <number -10 to +10, BEFORE orientation multiplier — the system will apply it>,
      "romantic_level_change": <number -10 to +10>,
      "detected_traits": ["kindness"|"humor"|"integrity"|"vulnerability"|"intellectual_growth"]
    }
  },
  "scheduled_events": [
    {
      "description": "Natural language description of what will happen, e.g. 'Tiffany picks up Tamara at her apartment'",
      "trigger_time": "<ISO 8601 UTC datetime when this event should occur>",
      "character_names": ["name1", "name2"]
    }
  ]
}`;

  trace.prompt_built = true;

  // ── STAGE: ai_response ─────────────────────────────────────────────────────
  let response;
  try {
    trace.ai_response_started = true;
    response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: aiPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          scene_summary: { type: 'string' },
          dialogue: {
            type: 'array',
            items: { type: 'object', properties: { speaker: { type: 'string' }, text: { type: 'string' } } }
          },
          outcome: { type: 'string' },
          emotional_shifts: { type: 'object' },
          emotional_milestone: {},
          shared_secret: {},
          relationship_updates: { type: 'object' },
          scheduled_events: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                trigger_time: { type: 'string' },
                character_names: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      },
      model: 'gemini_3_flash'
    });
    trace.ai_response_completed = true;
  } catch (aiErr) {
    return Response.json({
      error: aiErr?.message || String(aiErr),
      stage: 'ai_response',
      character_ids,
      character_names: characters.map(c => c.name),
      trace
    }, { status: 500 });
  }

  // ── STAGE: character_write + memory_write ──────────────────────────────────
  try {
    trace.character_write_started = true;
    for (const character of characters) {
      const updates = response.relationship_updates?.[character.name];
      if (!updates) continue;

      const otherCharId = updates.other_character_id;
      const otherChar = characters.find(c => c.id === otherCharId);
      if (!otherChar) continue;

      const multiplier = getAttractionMultiplier(
        character.sexual_orientation,
        character.gender,
        otherChar.gender
      );

      const rawAttractionDelta = updates.attraction_level_change || 0;
      const adjustedAttractionDelta = rawAttractionDelta > 0
        ? rawAttractionDelta * multiplier
        : rawAttractionDelta;

      const updatedRelationships = (character.fictional_relationships || []).map(rel => {
        if (rel.related_character_id === otherCharId) {
          const currentFriendship = rel.friendship_level ?? 50;
          const currentAttraction = rel.attraction_level ?? 0;
          const currentRomantic = rel.romantic_level ?? 0;
          return {
            ...rel,
            last_interaction_summary: updates.last_interaction_summary,
            current_status: updates.updated_status,
            emotional_impact: updates.emotional_impact,
            friendship_level: Math.min(100, Math.max(0, currentFriendship + (updates.friendship_level_change || 0))),
            attraction_level: Math.min(100, Math.max(0, Math.round(currentAttraction + adjustedAttractionDelta))),
            romantic_level: Math.min(100, Math.max(0, currentRomantic + (updates.romantic_level_change || 0))),
          };
        }
        return rel;
      });

      if (!updatedRelationships.some(r => r.related_character_id === otherCharId)) {
        const newAttraction = Math.min(100, Math.max(0, Math.round(adjustedAttractionDelta)));
        updatedRelationships.push({
          person_name: otherChar.name,
          related_character_id: otherCharId,
          relationship_type: 'acquaintance',
          description: response.scene_summary,
          current_status: updates.updated_status,
          emotional_impact: updates.emotional_impact,
          last_interaction_summary: updates.last_interaction_summary,
          history_summary: 'Recently had their first significant interaction',
          friendship_level: Math.max(0, updates.friendship_level_change || 0),
          attraction_level: Math.max(0, newAttraction),
          romantic_level: Math.max(0, updates.romantic_level_change || 0),
        });
      }

      const thisRel = updatedRelationships.find(r => r.related_character_id === otherCharId);
      const orientationShift = checkOrientationShift(
        character.sexual_orientation,
        thisRel?.attraction_level ?? 0,
        character.gender,
        otherChar.gender
      );

      const characterUpdatePayload = {
        transient_encounters: [...(character.transient_encounters || []), {
          description: `Interaction with ${otherChar.name}: ${response.scene_summary}`,
          context: 'character interaction simulation',
          emotional_reaction: response.emotional_shifts?.[character.name] || 'neutral',
          date: new Date().toISOString()
        }],
        fictional_relationships: updatedRelationships,
        emotional_state: response.emotional_shifts?.[character.name]?.split(' ')[0] || character.emotional_state,
      };
      if (orientationShift) characterUpdatePayload.sexual_orientation = orientationShift;

      await base44.entities.Character.update(character.id, characterUpdatePayload);
    }
    trace.character_write_completed = true;
  } catch (writeErr) {
    return Response.json({
      error: writeErr?.message || String(writeErr),
      stage: 'character_write',
      character_ids,
      character_names: characters.map(c => c.name),
      trace
    }, { status: 500 });
  }

  // ── STAGE: memory_write ────────────────────────────────────────────────────
  try {
    trace.memory_write_started = true;
    for (const character of characters) {
      const updates = response.relationship_updates?.[character.name];
      if (!updates) continue;
      const otherChar = characters.find(c => c.id === updates.other_character_id);
      if (!otherChar) continue;

      const dialogueText = (response.dialogue || []).map(d => `${d.speaker}: ${d.text}`).join('\n');
      const situationPrefix = userPrompt ? `Situation: ${userPrompt}\n\n` : '';
      const memoryPromises = [
        base44.entities.Memory.create({
          character_id: character.id,
          title: `Interaction with ${otherChar.name}`,
          description: `${situationPrefix}Scene: ${response.scene_summary}\n\nDialogue:\n${dialogueText}\n\nOutcome: ${response.outcome}`,
          emotional_impact: response.emotional_shifts?.[character.name] || 'neutral',
          timestamp: new Date().toISOString(),
          source_context: 'character interaction simulation'
        })
      ];
      if (response.emotional_milestone) {
        memoryPromises.push(base44.entities.Memory.create({
          character_id: character.id,
          title: `Emotional milestone with ${otherChar.name}`,
          description: response.emotional_milestone,
          emotional_impact: 'meaningful',
          timestamp: new Date().toISOString(),
          source_context: 'inter-character interaction',
        }));
      }
      if (response.shared_secret) {
        memoryPromises.push(base44.entities.Memory.create({
          character_id: character.id,
          title: `Secret revealed involving ${otherChar.name}`,
          description: response.shared_secret,
          emotional_impact: 'significant',
          timestamp: new Date().toISOString(),
          source_context: 'inter-character interaction - confidential',
        }));
      }
      await Promise.all(memoryPromises);
    }
    trace.memory_write_completed = true;
  } catch (memErr) {
    // Memory write failure is non-fatal — simulation already succeeded; log and continue
    console.error('[simulateCharacterInteraction] memory_write failed:', memErr?.message);
  }

  // ── STAGE: scheduled_events ────────────────────────────────────────────────
  const scheduledEventRecords = [];
  if (response.scheduled_events?.length > 0) {
    for (const ev of response.scheduled_events) {
      if (!ev.trigger_time || !ev.description) continue;
      const involvedIds = characters.filter(c => (ev.character_names || []).includes(c.name)).map(c => c.id);
      const involvedNames = characters.filter(c => (ev.character_names || []).includes(c.name)).map(c => c.name);
      if (involvedIds.length === 0) continue;
      try {
        const record = await base44.entities.ScheduledEvent.create({
          character_ids: involvedIds,
          character_names: involvedNames,
          description: ev.description,
          trigger_time: ev.trigger_time,
          status: 'pending',
          type: 'narrative',
          source: 'simulation',
          primary_character_id: involvedIds[0]
        });
        scheduledEventRecords.push(record);
      } catch (evErr) {
        console.error('[simulateCharacterInteraction] scheduled_event create failed:', evErr?.message);
      }
    }
  }

  return Response.json({
    success: true,
    interaction: {
      characters: characterProfiles.map(p => p.name),
      scene_summary: response.scene_summary,
      dialogue: response.dialogue,
      outcome: response.outcome,
      timestamp: new Date().toISOString(),
      scheduled_events: scheduledEventRecords
    }
  });
});