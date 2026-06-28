import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── PARTICIPANT NAME REFERENCE KEY ────────────────────────────────────────────
//
// ARCHITECTURE NOTE — ENFORCED DUPLICATION (not abandoned scaffolding):
// Deno backend functions are deployed as isolated sandboxes. They cannot import
// from local lib/ files — only from npm: or jsr: URLs. This is a verified platform
// constraint: any `import` from a relative path throws "Module not found" at runtime.
//
// Therefore, this function MUST be inlined in generateImageAsync.js,
// regenerateImageWithReason.js, AND generateStoryEvent.js. The three copies
// are the enforced strategy, not a maintenance oversight.
//
// ANTI-DRIFT RULE: The function body below is the canonical source.
// Any change here MUST be applied identically to generateImageAsync.js
// and regenerateImageWithReason.js.
// verifyParticipantNameReferenceKeyDrift now covers all three files.
//
// The required format is:
//   "PromptName" = Canonical Display Name (Character ID: ...) — use their visual identity references
//   "PromptName" = User Display Name (User ID: <runtime_authenticated_user_id>) — use their visual identity references
//
// USER ID RULE: user_id = user.id from base44.auth.me() — the authenticated user's
// platform entity ID. NOT email. email is used only for owner_email scoping.
function buildParticipantNameReferenceKeyBlock(participants) {
  if (!participants || participants.length === 0) return '';
  const lines = [];
  lines.push(`[NAME REFERENCE KEY — SELECTED PARTICIPANTS]`);
  lines.push(`Every name in the scene prompt maps to exactly one visual identity bundle below.`);
  lines.push(`Do NOT infer any appearance, gender, outfit, or body from a name alone.`);
  lines.push(`Do NOT assign any subject's attributes to a different subject.`);
  lines.push(``);
  for (const p of participants) {
    const displayName = p.display_name || 'Unknown';
    const promptName = p.matched_prompt_name || displayName.split(/\s+/)[0];
    if (p.participant_type === 'user') {
      const userIdValue = p.user_id || 'authenticated_user';
      lines.push(`"${promptName}" = ${displayName} (User ID: ${userIdValue}) — use their visual identity references`);
    } else {
      const charIdValue = p.character_id || 'character';
      lines.push(`"${promptName}" = ${displayName} (Character ID: ${charIdValue}) — use their visual identity references`);
    }
  }
  lines.push(`[END NAME REFERENCE KEY]`);
  return `\n════════════════════════════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════════════════════════════\n`;
}

// ── URL UTILITIES ─────────────────────────────────────────────────────────────

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

// ── ADD HOURS TO HH:MM TIME STRING ───────────────────────────────────────────
function addHoursToTime(timeStr, hours) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const totalMins = h * 60 + m + hours * 60;
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// ── RESOLVE PARTICIPANT REFERENCE IMAGES ──────────────────────────────────────
// Resolves canonical reference images for a character record.
// Priority: reference_image_urls (no generated) → CDN avatar → empty.
function resolveCharacterRefImages(charRecord) {
  if (!charRecord) return [];
  const allRefs = cdnFilter(charRecord.reference_image_urls || []);
  const validRefs = allRefs.filter(url => !url.includes('generated_image'));
  if (validRefs.length > 0) return validRefs.slice(0, 3);
  // CDN avatar fallback — only if it is a canonical portrait, not a generated scene image
  if (charRecord.avatar_url) {
    const avatarPublic = toPublicCDN(charRecord.avatar_url);
    const isCDN = avatarPublic.startsWith('https://media.base44.com/');
    if (isAccessible(avatarPublic) && (isCDN || !avatarPublic.includes('generated_image'))) {
      return [avatarPublic];
    }
  }
  if (charRecord.image_avatar_url) {
    const imgAvatar = toPublicCDN(charRecord.image_avatar_url);
    if (isAccessible(imgAvatar)) return [imgAvatar];
  }
  return [];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventId = body.event_id || (body.data ? body.data.id : null);
    if (!eventId) {
      return Response.json({ error: 'No story event id found' }, { status: 400 });
    }

    // Fetch the full StoryEvent record
    const records = await base44.asServiceRole.entities.StoryEvent.filter({ id: eventId }, null, 1);
    const event = records[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    if (event.status !== 'generating') {
      return Response.json({ success: true, skipped: true, reason: `status is ${event.status}` });
    }

    const ownerEmail = event.owner_email;
    const plot = event.plot || '';
    const additionalNotes = event.additional_notes || '';
    const title = event.title || 'Untitled Event';
    const eventDate = event.event_date;
    const venueName = event.venue_name || 'an undisclosed location';
    const isRabbitHole = event.is_rabbit_hole;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const focusNames = event.focus_character_names || [];
    const participantNames = event.participant_character_names || [];
    const allDay = event.all_day;
    const startTime = event.start_time;
    const endTime = event.end_time;

    // Load character data for all participants
    const allIds = [...new Set([...focusIds, ...participantIds])];
    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // ── CANONICAL PARTICIPANT BUNDLE RESOLUTION ───────────────────────────────
    // Each participant is resolved into a canonical bundle with:
    //   - character_id (DB-sourced, authoritative)
    //   - display_name
    //   - matched_prompt_name (first name from display_name)
    //   - reference images (CDN-filtered, no generated images first)
    //   - participant_type: 'character'
    //
    // The authenticated User is resolved separately below when included.
    // Characters are NEVER resolved by name matching alone — always by ID.

    const participantBundles = []; // { participant_type, character_id, user_id, display_name, matched_prompt_name, ref_images, appearance_notes }

    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;

      const displayName = c.name || c.display_name || cid;
      const firstName = displayName.split(/\s+/)[0];
      const refImages = resolveCharacterRefImages(c);

      // Build appearance notes for the narrative prompt (NOT used as ID — structural only)
      const appearanceParts = [];
      if (c.appearance_notes) appearanceParts.push(c.appearance_notes);
      if (c.avatar_description_text) appearanceParts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        const lockParts = [];
        if (al.skin_tone) lockParts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) lockParts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) lockParts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) lockParts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) lockParts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) lockParts.push(`aesthetic: ${al.overall_aesthetic}`);
        if (lockParts.length > 0) appearanceParts.push(lockParts.join(', '));
      }
      if (c.style_identity && !appearanceParts.some(p => p.includes(c.style_identity))) {
        appearanceParts.push(`style: ${c.style_identity}`);
      }

      participantBundles.push({
        participant_type: 'character',
        character_id: c.id,
        user_id: null,
        display_name: displayName,
        matched_prompt_name: firstName,
        ref_images: refImages,
        appearance_notes: appearanceParts.join(' | ') || null,
        is_focus: focusIds.includes(cid),
        char_record: c,
      });

      console.log(`[generateStoryEvent] ✅ Bundle resolved: "${displayName}" (id=${c.id}) refs=${refImages.length} focus=${focusIds.includes(cid)}`);
    }

    // ── USER BUNDLE RESOLUTION ────────────────────────────────────────────────
    // GATE: The authenticated user is included ONLY when the Story Event payload
    // explicitly identifies the user as a selected participant via include_user=true.
    // World-name existence alone is NOT sufficient — the user must be intentionally
    // selected by the Story Event creator.
    //
    // The StoryEventCreator UI does not currently expose a "include me" toggle,
    // so include_user will be false/absent for all existing events. This gate
    // ensures the user is never injected based on account state alone.
    const includeUser = !!(body.include_user || event.include_user);
    let userBundle = null;

    if (includeUser) {
      try {
        const userEntityList = await base44.asServiceRole.entities.User.filter({ email: ownerEmail }, null, 1).catch(() => []);
        const userEntityRecord = userEntityList?.[0] || null;
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
        const settingsRecord = settingsList?.[0] || null;

        if (userEntityRecord || settingsRecord) {
          const userEntityRefs = cdnFilter(userEntityRecord?.reference_image_urls || []);
          const userEntityAvatars = cdnFilter(userEntityRecord?.generated_avatar_urls || []);
          const userRefImages = [...userEntityRefs.slice(0, 3), ...userEntityAvatars.slice(0, 2)].filter(Boolean);

          const worldName = userEntityRecord?.world_name || settingsRecord?.fictional_world_name || null;
          const platformUserId = userEntityRecord?.id || ownerEmail; // user.id from User entity — NOT email

          userBundle = {
            participant_type: 'user',
            character_id: null,
            user_id: platformUserId,
            display_name: worldName || 'User / My Persona',
            matched_prompt_name: (worldName || 'User').split(/\s+/)[0],
            ref_images: userRefImages,
            appearance_lock: settingsRecord?.appearance_lock || null,
            world_name: worldName,
          };
          console.log(`[generateStoryEvent] ✅ User bundle resolved (include_user=true): worldName="${worldName}" userId="${platformUserId}" refs=${userRefImages.length}`);
        }
      } catch (userBundleErr) {
        console.warn(`[generateStoryEvent] User bundle resolution failed (non-blocking): ${userBundleErr?.message}`);
      }
    } else {
      console.log(`[generateStoryEvent] ℹ️ User not included — include_user not set in Story Event payload (correct default)`);
    }

    // Build the full participant list for the Name Reference Key
    // User is included in the key only when they have a resolved world name (visual subject)
    const allBundles = [...participantBundles, ...(userBundle ? [userBundle] : [])];

    // Build the unified Name Reference Key using the canonical builder
    const nameReferenceKeyBlock = buildParticipantNameReferenceKeyBlock(
      allBundles.map(b => ({
        participant_type: b.participant_type,
        character_id: b.character_id,
        user_id: b.user_id,
        display_name: b.display_name,
        matched_prompt_name: b.matched_prompt_name,
      }))
    );

    console.log(`[generateStoryEvent] NAME REFERENCE KEY built: ${allBundles.length} participant(s) — ${allBundles.map(b => `${b.participant_type}:${b.display_name}`).join(', ')}`);
    console.log(`[generateStoryEvent] Key contains header: ${nameReferenceKeyBlock.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]')}`);

    // Build focus character ref images ordered list (focus first, then all)
    const focusRefImages = participantBundles.filter(b => b.is_focus).flatMap(b => b.ref_images);
    const allCharacterRefImages = participantBundles.flatMap(b => b.ref_images);
    const userRefImagesForPayload = userBundle?.ref_images || [];

    // Build character context for the LLM narrative prompt
    const characterContexts = participantBundles.map(b => {
      const c = b.char_record;
      const marker = b.is_focus ? '★ FOCUS' : '';
      const charType = c.character_type || '';
      const typeNote = charType === 'npc_family_member' ? ' [Family member]'
        : charType === 'npc_fictitious' ? ' [Fictional/NPC character]'
        : charType === 'npc_world_service' ? ' [World service character]'
        : '';
      const appearanceBlock = b.appearance_notes
        ? `  APPEARANCE (USE THIS FOR IMAGE GENERATION — DO NOT INVENT GENERIC STRANGERS): ${b.appearance_notes}`
        : '';
      return [
        `- ${b.display_name} ${marker}${typeNote}`,
        `  Character ID: ${b.character_id}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.occupation ? `  Occupation: ${c.occupation}` : '',
        c.age ? `  Age: ${c.age}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        appearanceBlock,
        c.communication_style ? `  Communication style: ${c.communication_style}` : '',
        c.current_situation ? `  Current situation: ${c.current_situation}` : '',
        c.profile_summary ? `  Summary: ${c.profile_summary}` : '',
        (c.memories || []).slice(0, 3).map(m => `  Memory: ${m.title || ''}`).filter(Boolean).join('\n'),
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    // Resolve relationships between participants
    const relationshipContexts = [];
    for (const b of participantBundles) {
      const c = b.char_record;
      const rels = (c.fictional_relationships || []).filter(r =>
        r.related_character_id && allIds.includes(r.related_character_id) && r.related_character_id !== b.character_id
      );
      for (const r of rels) {
        const target = charById[r.related_character_id];
        if (!target) continue;
        relationshipContexts.push(
          `${b.display_name} → ${target.name}: ${r.relationship_type}` +
          (r.friendship_level != null ? ` (friendship ${r.friendship_level})` : '') +
          (r.trust_level != null ? ` (trust ${r.trust_level})` : '') +
          (r.description ? ` — ${r.description}` : '')
        );
      }
    }

    const timeInfo = allDay
      ? 'All-day event'
      : `${startTime || 'TBD'}${endTime ? ` to ${endTime}` : ''}`;

    // Build venue appearance context from LocationReference if available
    let venueContext = '';
    if (!isRabbitHole && event.venue_id) {
      try {
        const venueRecs = await base44.asServiceRole.entities.LocationReference.filter({ id: event.venue_id }, null, 1);
        const venue = venueRecs[0];
        if (venue) {
          venueContext = [
            `Venue: ${venue.name}`,
            venue.description ? `Description: ${venue.description}` : '',
            venue.category ? `Category: ${venue.category}` : '',
          ].filter(Boolean).join('\n');
        }
      } catch (_) {}
    }

    // ── STEP 1: GENERATE NARRATIVE ──────────────────────────────────────────────
    const narrativePrompt = [
      `You are a narrative writer creating a meaningful story for a character-driven world.`,
      ``,
      `EVENT TITLE: ${title}`,
      `DATE: ${eventDate || 'a specific date'}`,
      `TIME: ${timeInfo}`,
      `VENUE: ${venueName}${isRabbitHole ? ' (custom venue)' : ''}`,
      ``,
      venueContext ? `VENUE DETAILS:` : '',
      venueContext ? venueContext : '',
      venueContext ? `` : '',
      `USER'S PLOT (THIS IS THE FOUNDATION — DO NOT REPLACE IT):`,
      `${plot}`,
      ``,
      additionalNotes ? `ADDITIONAL NOTES FROM USER:` : '',
      additionalNotes ? `${additionalNotes}` : '',
      additionalNotes ? `` : '',
      `FOCUS CHARACTERS (give these characters the most narrative attention):`,
      focusNames.length > 0 ? focusNames.join(', ') : 'None specified',
      ``,
      `PARTICIPATING CHARACTERS (ALL of these are present at the event):`,
      participantNames.join(', '),
      ``,
      `CHARACTER DETAILS:`,
      characterContexts,
      ``,
      `RELATIONSHIPS BETWEEN PARTICIPANTS:`,
      relationshipContexts.length > 0 ? relationshipContexts.join('\n') : 'No known relationships',
      ``,
      `════════════════════════════════════`,
      `LEXICAL DISCIPLINE AND MEANING PRESERVATION — MANDATORY`,
      `════════════════════════════════════`,
      `The generated narrative, memory_text, memory_summary, and emotional_outcomes will be stored permanently as StoryEventMemory, Memory, CharacterMemory, LifeEvent, and Character memory records. All characters will read and learn from this text in future interactions.`,
      ``,
      `1. BANNED TERMS — Never use "chaos" or "chaotic" in narrative, memory_text, memory_summary, emotional_impact, or any output field.`,
      `   Do not describe busy, crowded, celebratory, emotional, energetic, or multi-person scenes with these terms.`,
      `   Instead describe the actual mechanics: lively, bustling, fast-moving, layered, warm, emotional, high-energy, noisy, complex.`,
      ``,
      `2. RESTRICTED TERM — Do not use "heavy" as vague emotional shorthand for important, emotional, stressful, meaningful, or serious.`,
      `   Literal physical weight is the only permitted use. For emotional weight, describe the specific reality instead.`,
      ``,
      `3. VALENCE ACCURACY — Classify from event facts and outcome, not dramatic wording.`,
      `   Joyful, loving, celebratory, healing, successful events → positive or mixed valence. Never negative.`,
      `   Painful, harmful, genuinely unresolved events → negative valence when supported.`,
      `   Do not balance a positive event by injecting negative language.`,
      ``,
      `4. IDENTITY PROTECTION — Do not promote situational descriptors into identity labels.`,
      `   A busy event does not mean the character creates disorder. A difficult moment is not a character flaw.`,
      ``,
      `5. REINFORCEMENT FAIRNESS — Memory text is learned from. Positive events must preserve positive reinforcement.`,
      `   Negative events must preserve accurate negative reinforcement. Complex events preserve their actual complexity.`,
      `════════════════════════════════════`,
      ``,
      `INSTRUCTIONS:`,
      `1. Write a narrative story about this event. The story MUST follow the user's plot above. Expand details, interactions, observations, and emotional moments — but DO NOT replace the user's intended event with a different storyline.`,
      `2. Focus characters should receive greater narrative attention, more detailed emotional moments, and more internal perspective. Supporting participants (including family members, NPCs, and service characters) should still be included where appropriate.`,
      `3. Include light dialogue where it supports the event. Dialogue should enhance the story, not dominate it.`,
      `4. Family members should behave according to their family role. Service characters should behave professionally.`,
      ``,
      `OUTPUT FORMAT — Return a JSON object with these fields:`,
      `{`,
      `  "narrative": "The full narrative story text, well-written and immersive, approximately 400-800 words.",`,
      `  "narrative_preview": "A short 1-2 sentence preview/summary of the event.",`,
      `  "emotional_outcomes": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "emotion": "happy|proud|relieved|excited|comfortable|calm|trusting|anxious|sad|disappointed|frustrated|embarrassed|reflective|grateful|hopeful|tense|hurt|content", "intensity": "mild|moderate|strong", "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "relationship_changes": [`,
      `    { "source_character_id": "the_exact_id", "target_character_id": "the_exact_id", "source_name": "Name", "target_name": "Name", "dimension": "friendship|trust|familiarity|attraction|respect|tension", "change": "increased|decreased", "amount": 1-10, "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "memories": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "memory_text": "What this character remembers about the event — personal, specific, from their perspective. Include: the event title, venue, who they saw there, what they did, interactions they had, and how they felt. A few sentences.", "memory_summary": "Short summary for retrieval (one sentence)", "importance_score": 1-10, "emotional_tone": "positive|negative|neutral|mixed" }`,
      `  ],`,
      `  "image_prompts": [`,
      `    { "moment": "opening", "prompt": "Image generation prompt for the opening moment at ${venueName}. CRITICAL: Describe each visible character using ONLY their APPEARANCE data from the character details above — skin tone, hair, hairstyle, facial hair, clothing style, overall aesthetic. DO NOT invent generic people. DO NOT describe strangers. Every person in this image must match their character's documented appearance. Include venue ambiance, lighting, and mood.", "description": "What the image shows." },`,
      `    { "moment": "key_moment", "prompt": "Image generation prompt for the peak moment. Focus characters must be prominent and described using their documented appearance. Supporting characters who appear must also use their documented appearance. DO NOT generate stand-ins.", "description": "What the image shows." },`,
      `    { "moment": "closing", "prompt": "Image generation prompt for the closing moment. Describe each visible character using their documented appearance. No generic faces.", "description": "What the image shows." }`,
      `  ]`,
      `}`,
      ``,
      `RULES:`,
      `- The narrative MUST follow the user's plot. Do not invent a different storyline.`,
      `- Emotional outcomes must be supported by what happens in the narrative. No random emotions.`,
      `- Relationship changes must have a meaningful reason in the narrative. No unsupported changes.`,
      `- Focus characters get richer memories with higher importance scores.`,
      `- EVERY participant (family members, NPCs, service characters, AND active characters) gets at least one memory. No character who attended is left without a memory.`,
      `- Image prompts must reference the venue: ${venueName}.`,
      `- IMAGE IDENTITY RULE (CRITICAL): For every character visible in an image, copy their APPEARANCE data verbatim from the character details above. Use their actual skin tone, hair, hairstyle, clothing, aesthetic. DO NOT describe generic strangers. DO NOT invent replacement faces. The people shown must match the selected characters.`,
      `- Only include relationship changes for character pairs that actually interact meaningfully.`,
    ].join('\n');

    let generated;
    try {
      const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: narrativePrompt,
        response_json_schema: {
          type: 'object',
          properties: {
            narrative: { type: 'string' },
            narrative_preview: { type: 'string' },
            emotional_outcomes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  character_id: { type: 'string' },
                  character_name: { type: 'string' },
                  emotion: { type: 'string' },
                  intensity: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
            },
            relationship_changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source_character_id: { type: 'string' },
                  target_character_id: { type: 'string' },
                  source_name: { type: 'string' },
                  target_name: { type: 'string' },
                  dimension: { type: 'string' },
                  change: { type: 'string' },
                  amount: { type: 'number' },
                  reason: { type: 'string' },
                },
              },
            },
            memories: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  character_id: { type: 'string' },
                  character_name: { type: 'string' },
                  memory_text: { type: 'string' },
                  memory_summary: { type: 'string' },
                  importance_score: { type: 'number' },
                  emotional_tone: { type: 'string' },
                },
              },
            },
            image_prompts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  moment: { type: 'string' },
                  prompt: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        model: 'gemini_3_1_pro',
      });
      generated = llmRes;
    } catch (e) {
      await base44.asServiceRole.entities.StoryEvent.update(eventId, {
        status: 'failed',
        generation_error: `LLM error: ${e.message}`,
      });
      return Response.json({ error: e.message }, { status: 500 });
    }

    // ── STEP 2: CREATE STORY EVENT MEMORIES ──────────────────────────────────────
    const memories = generated.memories || [];
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        await base44.asServiceRole.entities.StoryEventMemory.create({
          story_event_id: eventId,
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          memory_text: mem.memory_text,
          memory_summary: mem.memory_summary || mem.memory_text.substring(0, 80),
          memory_type: 'event',
          importance_score: mem.importance_score || 5,
          emotional_tone: mem.emotional_tone || 'neutral',
          owner_email: ownerEmail,
        });
      } catch (_) {}
    }

    // ── STEP 2b: WRITE TO CHARACTER.MEMORIES ARRAY ────────────────────────────
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: mem.character_id }, null, 1);
        const freshChar = freshChars[0];
        if (!freshChar) continue;
        const existingMemories = freshChar.memories || [];
        const newMemoryEntry = {
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          date: eventDate,
          emotion_state: mem.emotional_tone || 'neutral',
          created_date: new Date().toISOString(),
        };
        await base44.asServiceRole.entities.Character.update(mem.character_id, {
          memories: [...existingMemories, newMemoryEntry],
        });
      } catch (_) {}
    }

    // ── STEP 2c: WRITE TO MEMORY ENTITY ──────────────────────────────────────
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const eventContext = `[Story Event: ${title} — ${eventDate} at ${venueName}]`;
        await base44.asServiceRole.entities.Memory.create({
          character_id: mem.character_id,
          title: `Attended: ${title}`,
          description: `${eventContext} ${mem.memory_text}`,
          emotional_impact: mem.emotional_tone || 'neutral',
          source_context: `story_event_${eventId}`,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}
    }

    // ── STEP 2d: CREATE CHARACTER MEMORY RECORDS ──────────────────────────────
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: mem.character_id,
          memory_type: 'event',
          memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${mem.memory_text}`,
          memory_summary: mem.memory_summary || `Attended "${title}" at ${venueName} on ${eventDate}`,
          importance_score: mem.importance_score || 5,
          confidence_score: 0.95,
          permanence: (mem.importance_score || 5) >= 7 ? 'protected' : 'long_term',
          validation_status: 'confirmed',
        });
      } catch (_) {}
    }

    // ── STEP 3: UPDATE RELATIONSHIP SCORES ────────────────────────────────────
    const relChanges = generated.relationship_changes || [];
    for (const rc of relChanges) {
      if (!rc.source_character_id || !rc.target_character_id || !rc.dimension) continue;
      const sourceChar = charById[rc.source_character_id];
      if (!sourceChar) continue;

      try {
        const existingRels = sourceChar.fictional_relationships || [];
        const relIdx = existingRels.findIndex(r => r.related_character_id === rc.target_character_id);
        const amount = Math.min(10, Math.max(1, rc.amount || 3));

        const dimensionFieldMap = {
          friendship: 'friendship_level',
          trust: 'trust_level',
          familiarity: 'familiarity_level',
          attraction: 'attraction_level',
          respect: 'user_respect_level',
          tension: 'tension_level',
        };

        const field = dimensionFieldMap[rc.dimension];
        if (!field) continue;

        if (relIdx >= 0) {
          const currentVal = existingRels[relIdx][field] ?? 50;
          const newVal = rc.change === 'increased'
            ? Math.min(100, currentVal + amount)
            : Math.max(0, currentVal - amount);
          existingRels[relIdx] = { ...existingRels[relIdx], [field]: newVal };
          await base44.asServiceRole.entities.Character.update(rc.source_character_id, {
            fictional_relationships: existingRels,
          });
        }
      } catch (_) {}
    }

    // ── STEP 4: UPDATE EMOTIONAL STATES ──────────────────────────────────────
    const emotionalOutcomes = generated.emotional_outcomes || [];
    for (const eo of emotionalOutcomes) {
      if (!eo.character_id || !eo.emotion) continue;
      try {
        await base44.asServiceRole.entities.Character.update(eo.character_id, {
          emotional_state: eo.emotion,
        });
      } catch (_) {}
    }

    // ── STEP 5: GENERATE IMAGES WITH UNIFIED IDENTITY GROUNDING ──────────────
    // Every image prompt now:
    //   1. Prepends the Name Reference Key (ID-anchored, canonical format)
    //   2. Receives participant reference images in existing_image_urls
    //   3. Stores resolved participant metadata in generation_context
    const imagePrompts = generated.image_prompts || [];
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };

    for (const img of imagePrompts) {
      if (!img.moment || !img.prompt) continue;
      try {
        // Determine which character bundles are visible for this moment
        const visibleCharIds = img.moment === 'opening'
          ? participantIds.slice(0, 3)
          : img.moment === 'key_moment'
          ? (focusIds.length > 0 ? focusIds : participantIds.slice(0, 2))
          : participantIds.slice(0, 2);

        const visibleBundles = participantBundles.filter(b => visibleCharIds.includes(b.character_id));
        const visibleCharNames = visibleBundles.map(b => b.display_name).filter(Boolean);
        const visibleCharTypes = visibleBundles.map(b => b.char_record?.character_type || 'active_created_character');

        // Build the Name Reference Key for this specific image's visible participants
        // Include user bundle only if they have a world name (visual identity anchor)
        const imageKeyParticipants = [
          ...visibleBundles.map(b => ({
            participant_type: 'character',
            character_id: b.character_id,
            user_id: null,
            display_name: b.display_name,
            matched_prompt_name: b.matched_prompt_name,
          })),
          ...(userBundle ? [{
            participant_type: 'user',
            character_id: null,
            user_id: userBundle.user_id,
            display_name: userBundle.display_name,
            matched_prompt_name: userBundle.matched_prompt_name,
          }] : []),
        ];

        const imageNameRefKey = buildParticipantNameReferenceKeyBlock(imageKeyParticipants);

        // ── FINAL IMAGE PROMPT: Name Reference Key + scene description ──────────
        const finalImagePrompt = [
          `════════════════════════════════════════════════════════════`,
          `⚠️ CRITICAL: FICTIONAL CHARACTER NOTICE`,
          `════════════════════════════════════════════════════════════`,
          `ALL subjects are 100% FICTIONAL CHARACTERS for a storytelling app. Not real people.`,
          `Treat as characters in a novel or video game. Render from descriptions and reference photos only.`,
          `════════════════════════════════════════════════════════════`,
          ``,
          imageNameRefKey,
          ``,
          `════════════════════════════════════════════════════════════`,
          `STORY EVENT: "${title}"`,
          `MOMENT: ${img.moment.replace('_', ' ')}`,
          `VENUE: ${venueName}`,
          `EVENT DATE: ${eventDate || 'unspecified'}`,
          `════════════════════════════════════════════════════════════`,
          ``,
          img.prompt,
          ``,
          `Photorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.`,
          ``,
          `IDENTITY ENFORCEMENT:`,
          `- Every person in this image must match a participant listed in the Name Reference Key above.`,
          `- Do NOT generate generic strangers, stand-ins, or placeholder people.`,
          `- Do NOT infer any appearance from names alone — use ONLY the visual identity references provided.`,
          `- Character IDs in the key are the sole identity anchors. Reference images define face/hair/body.`,
        ].join('\n');

        // ── REFERENCE IMAGE PAYLOAD ────────────────────────────────────────────
        // Focus character refs first, then visible character refs, then user refs.
        // Deduplication and CDN-filtering applied.
        const visibleCharRefImages = visibleBundles.flatMap(b => b.ref_images);
        const refImages = [
          ...focusRefImages,
          ...visibleCharRefImages,
          ...userRefImagesForPayload,
        ]
          .filter((url, i, arr) => arr.indexOf(url) === i) // deduplicate
          .filter(Boolean)
          .slice(0, 10); // cap to avoid oversized payloads

        console.log(`[generateStoryEvent] IMAGE DISPATCH: moment="${img.moment}" participants=${imageKeyParticipants.length} ref_images=${refImages.length}`);
        console.log(`[generateStoryEvent]   key_header_present: ${finalImagePrompt.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]')}`);
        console.log(`[generateStoryEvent]   existing_image_urls_count: ${refImages.length}`);

        const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: finalImagePrompt,
          existing_image_urls: refImages.length > 0 ? refImages : undefined,
        });

        if (imageRes?.url) {
          // Metadata: resolved participant IDs, types, ref status
          const resolvedParticipantMetadata = imageKeyParticipants.map(p => ({
            participant_type: p.participant_type,
            id: p.character_id || p.user_id,
            display_name: p.display_name,
            ref_images_attached: p.participant_type === 'user'
              ? userRefImagesForPayload.length > 0
              : (visibleBundles.find(b => b.character_id === p.character_id)?.ref_images.length || 0) > 0,
          }));

          // Create StoryEventImage — canonical event-image link
          const storyImage = await base44.asServiceRole.entities.StoryEventImage.create({
            story_event_id: eventId,
            moment_type: img.moment,
            image_url: imageRes.url,
            description: img.description || '',
            prompt: finalImagePrompt,
            order: momentOrder[img.moment] ?? 0,
            visible_character_ids: visibleCharIds,
            visible_character_names: visibleCharNames,
            visible_character_types: visibleCharTypes,
            reference_image_urls: refImages.slice(0, 5),
            reference_lookup_status_by_character: Object.fromEntries(
              visibleBundles.map(b => [b.character_id, b.ref_images.length > 0 ? 'resolved' : 'reference_lookup_failed'])
            ),
          });

          // Create Message record for Media Gallery visibility
          await base44.asServiceRole.entities.Message.create({
            conversation_id: `story_event_${eventId}`,
            sender_type: 'user',
            content: '',
            image_url: imageRes.url,
            image_description: img.description || img.prompt,
            image_analysis_status: 'complete',
            generation_context: {
              // Identity grounding metadata
              generation_context_version: 2,
              context_origin: 'story_event',
              name_reference_key_injected: true,
              name_reference_key_header_verified: finalImagePrompt.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]'),
              resolved_participant_ids: imageKeyParticipants.map(p => p.character_id || p.user_id),
              resolved_participant_metadata: resolvedParticipantMetadata,
              user_included: !!userBundle,
              user_id: userBundle?.user_id || null,
              user_world_name: userBundle?.display_name || null,
              reference_images_attached: refImages.length > 0,
              reference_image_count: refImages.length,
              // Standard story event fields
              source: 'story_event',
              story_event_id: eventId,
              story_event_image_id: storyImage?.id || null,
              event_title: title,
              event_date: eventDate,
              moment_type: img.moment,
              participant_character_ids: participantIds,
              focus_character_ids: focusIds,
              visible_character_ids: visibleCharIds,
              visible_character_names: visibleCharNames,
              venue_id: event.venue_id || null,
              venue_name: venueName,
              scene_prompt: finalImagePrompt,
              original_raw_prompt: img.prompt,
              character_reference_images: refImages.slice(0, 5),
              subjects: visibleCharIds.map(cid => {
                const bundle = participantBundles.find(b => b.character_id === cid);
                return {
                  subject_type: 'character',
                  subject_id: cid,
                  subject_name: bundle?.display_name || charById[cid]?.name || cid,
                  reference_images: bundle?.ref_images || [],
                  reference_image_count: bundle?.ref_images.length || 0,
                };
              }),
            },
            timestamp: new Date().toISOString(),
            owner_email: ownerEmail,
          });
        }
      } catch (imgErr) {
        console.warn(`[generateStoryEvent] Image generation failed for moment="${img.moment}": ${imgErr?.message}`);
      }
    }

    // ── STEP 5b: CREATE LIFEEVENT RECORDS ─────────────────────────────────────
    const isMajorEvent = (generated.narrative || '').length > 600 || (focusIds.length >= 2);
    const defaultEventType = isMajorEvent ? 'life_milestone_event' : 'bonding_event';

    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      const tone = mem.emotional_tone || 'neutral';
      const valence = tone === 'positive' || tone === 'mixed' ? 'positive'
        : tone === 'negative' ? 'negative' : 'neutral';
      const eventTypeForChar = tone === 'positive'
        ? (isMajorEvent ? 'celebration_event' : 'bonding_event')
        : tone === 'negative'
        ? 'setback_event'
        : defaultEventType;

      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          event_type: eventTypeForChar,
          severity: isMajorEvent ? 'major' : 'significant',
          valence,
          emotional_impact: `${mem.emotional_tone || 'neutral'} — ${eventTypeForChar.replace(/_/g, ' ')}`,
          timestamp: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          triggered_by: 'story_event',
          systems_updated: ['memories', 'relationships', 'emotional_state'],
          context_tags: ['story_event', eventId, `participant_${mem.character_id}`],
        });
      } catch (_) {}
    }

    // ── STEP 5c: CREATE COMMUNITYEVENT ────────────────────────────────────────
    try {
      await base44.asServiceRole.entities.CommunityEvent.create({
        name: title,
        event_type: 'celebration',
        source: 'user_calendar',
        show_on_community_strip: true,
        location_id: event.venue_id || null,
        location_name: venueName || null,
        start_date: `${eventDate || ''}T${startTime || '00:00'}:00.000`,
        end_date: endTime ? `${eventDate}T${endTime}:00.000` : null,
        is_active: true,
        owner_email: ownerEmail,
        description: generated.narrative_preview || '',
        vibe: 'social',
        participations_count: participantIds.length,
      });
    } catch (_) {}

    // ── STEP 5e: WRITE LOCATION HISTORY RECORDS ───────────────────────────────
    const eventArrivalTime = `${eventDate || ''}T${startTime || '12:00'}:00.000`;
    const eventDepartureTime = endTime
      ? `${eventDate}T${endTime}:00.000`
      : `${eventDate}T${startTime ? addHoursToTime(startTime, 2) : '14:00'}:00.000`;
    let eventDurationMinutes = null;
    if (eventArrivalTime && eventDepartureTime) {
      const arrD = new Date(eventArrivalTime);
      const depD = new Date(eventDepartureTime);
      eventDurationMinutes = Math.round((depD.getTime() - arrD.getTime()) / 60000);
      if (eventDurationMinutes < 0) eventDurationMinutes = 120;
    }

    for (const cid of allIds) {
      const c = charById[cid];
      const cname = c?.name || c?.display_name || cid;
      if (!c) continue;
      try {
        let priorLocId = c.current_home_location_id;
        let priorLocName = c.resolved_current_location_name || 'home';
        let priorCategory = 'home';
        const resolvedType = c.resolved_location_type || 'home';
        const presenceStatus = c.resolved_presence_status || 'home';
        const isConfined = presenceStatus === 'incarcerated' || presenceStatus === 'house_arrest' || presenceStatus === 'confined';
        const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';
        const isTraveling = presenceStatus === 'traveling';

        if (isConfined) continue;

        if (isAsleep && c.current_home_location_id) {
          priorLocId = c.current_home_location_id;
          priorLocName = c.resolved_current_location_name || 'home';
          priorCategory = 'home';
        } else if (isTraveling && c.traveling_to_location_id) {
          priorLocId = c.traveling_to_location_id;
          priorLocName = c.traveling_to_location_name || 'destination';
          priorCategory = 'travel';
        } else if (resolvedType === 'work' && c.current_work_location_id) {
          priorLocId = c.current_work_location_id;
          priorLocName = c.resolved_current_location_name || 'work';
          priorCategory = 'workplace';
        } else if (resolvedType === 'school' && c.current_school_location_id) {
          priorLocId = c.current_school_location_id;
          priorLocName = c.resolved_current_location_name || 'school';
          priorCategory = 'education';
        } else if (resolvedType === 'temporary_housing' && c.temporary_housing_location_id) {
          priorLocId = c.temporary_housing_location_id;
          priorLocName = c.resolved_current_location_name || 'temporary housing';
          priorCategory = 'home';
        } else if (c.resolved_current_location_id) {
          priorLocId = c.resolved_current_location_id;
          priorLocName = c.resolved_current_location_name || 'previous location';
          priorCategory = resolvedType === 'work' ? 'workplace'
            : resolvedType === 'school' ? 'education'
            : 'home';
        }

        if (!priorLocId) priorLocId = `unknown_prior_${cid}`;

        await base44.asServiceRole.entities.LocationHistory.create({
          character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: priorLocId, location_name: priorLocName,
          location_category: priorCategory,
          event_type: 'departure',
          arrival_time: `${eventDate}T00:00:00.000`,
          departure_time: eventArrivalTime,
          travel_source: 'event',
          travel_reason: `Left to attend "${title}" Story Event`,
          is_current: false,
          notes: `Departed from ${priorLocName} for Story Event: ${title}`,
        });

        await base44.asServiceRole.entities.LocationHistory.create({
          character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: event.venue_id || null, location_name: venueName,
          location_category: 'social', event_type: 'social_visit',
          arrival_time: eventArrivalTime, departure_time: eventDepartureTime,
          duration_minutes: eventDurationMinutes, travel_source: 'event',
          travel_reason: `Story Event: ${title}`,
          is_current: false,
          notes: `Attended "${title}" Story Event at ${venueName}.`,
        });

        await base44.asServiceRole.entities.LocationHistory.create({
          character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: event.venue_id || null, location_name: venueName,
          location_category: 'social', event_type: 'departure',
          arrival_time: eventArrivalTime, departure_time: eventDepartureTime,
          travel_source: 'event',
          travel_reason: `Left "${title}" Story Event`,
          is_current: false,
          notes: `Departed from Story Event: ${title}`,
        });

        await base44.asServiceRole.entities.LocationHistory.create({
          character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: priorLocId || null, location_name: priorLocName,
          location_category: priorCategory,
          event_type: 'return_home',
          arrival_time: eventDepartureTime, departure_time: null,
          travel_source: 'event',
          travel_reason: `Returned after "${title}" Story Event`,
          is_current: false,
          notes: `Returned to ${priorLocName} after Story Event: ${title}`,
        });
      } catch (_) {}
    }

    // ── STEP 5d: CREATE EVENTPARTICIPATION ────────────────────────────────────
    for (const mem of memories) {
      if (!mem.character_id) continue;
      try {
        await base44.asServiceRole.entities.EventParticipation.create({
          event_id: eventId,
          event_name: title,
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          owner_email: ownerEmail,
          participation_type: 'attended',
          emotional_tone: mem.emotional_tone || 'neutral',
          participation_date: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          memory_strength: (mem.importance_score || 5) >= 7 ? 'strong' : 'moderate',
          notes: mem.memory_summary || mem.memory_text?.substring(0, 120) || '',
          saw_character_ids: participantIds.filter(id => id !== mem.character_id),
        });
      } catch (_) {}
    }

    // ── STEP 6: PARTICIPANT COVERAGE GUARANTEE ────────────────────────────────
    const memoryCoveredIds = new Set(memories.map(m => m.character_id));
    const uncoveredIds = allIds.filter(id => !memoryCoveredIds.has(id));

    for (const cid of uncoveredIds) {
      const c = charById[cid];
      const cname = c?.name || c?.display_name || cid;
      const fallbackText = `${cname} attended the story event "${title}" on ${eventDate} at ${venueName}.`;
      const fallbackSummary = `Attended "${title}" at ${venueName} on ${eventDate}`;
      const fallbackTone = 'neutral';

      try {
        await base44.asServiceRole.entities.StoryEventMemory.create({
          story_event_id: eventId, character_id: cid, character_name: cname,
          memory_text: fallbackText, memory_summary: fallbackSummary,
          memory_type: 'event', importance_score: 3, emotional_tone: fallbackTone,
          owner_email: ownerEmail,
        });
      } catch (_) {}

      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        const freshChar = freshChars[0];
        if (freshChar) {
          await base44.asServiceRole.entities.Character.update(cid, {
            memories: [...(freshChar.memories || []), {
              title: `Story Event: ${title}`, description: fallbackText,
              date: eventDate, emotion_state: fallbackTone,
              created_date: new Date().toISOString(),
            }],
          });
        }
      } catch (_) {}

      try {
        await base44.asServiceRole.entities.Memory.create({
          character_id: cid, title: `Attended: ${title}`,
          description: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${fallbackText}`,
          emotional_impact: fallbackTone, source_context: `story_event_${eventId}`,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}

      try {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: cid, memory_type: 'event',
          memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${fallbackText}`,
          memory_summary: fallbackSummary, importance_score: 3,
          confidence_score: 0.8, permanence: 'long_term', validation_status: 'confirmed',
        });
      } catch (_) {}

      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: cid, character_name: cname,
          title: `Story Event: ${title}`, description: fallbackText,
          event_type: 'bonding_event', severity: 'significant', valence: 'neutral',
          emotional_impact: `neutral — bonding event`,
          timestamp: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          triggered_by: 'story_event',
          systems_updated: ['memories'],
          context_tags: ['story_event', eventId, `participant_${cid}`],
        });
      } catch (_) {}

      try {
        await base44.asServiceRole.entities.EventParticipation.create({
          event_id: eventId, event_name: title,
          character_id: cid, character_name: cname,
          owner_email: ownerEmail, participation_type: 'attended',
          emotional_tone: fallbackTone,
          participation_date: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          memory_strength: 'moderate', notes: fallbackSummary,
          saw_character_ids: participantIds.filter(id => id !== cid),
        });
      } catch (_) {}

      try {
        await base44.asServiceRole.entities.LocationHistory.create({
          character_id: cid,
          character_name: cname,
          owner_email: ownerEmail,
          location_id: event.venue_id || `story_event_venue_${eventId}`,
          location_name: venueName,
          location_category: 'social',
          event_type: 'social_visit',
          arrival_time: eventArrivalTime,
          departure_time: eventDepartureTime,
          duration_minutes: eventDurationMinutes,
          travel_source: 'event',
          travel_reason: `Story Event: ${title}`,
          is_current: false,
          notes: `Attended "${title}" Story Event at ${venueName}. (Fallback coverage)`,
        });
      } catch (_) {}
    }

    // ── STEP 7: UPDATE STORY EVENT STATUS ────────────────────────────────────
    await base44.asServiceRole.entities.StoryEvent.update(eventId, {
      status: 'complete',
      generated_narrative: generated.narrative || '',
      narrative_preview: generated.narrative_preview || (generated.narrative || '').substring(0, 150),
      emotional_outcomes: emotionalOutcomes,
      relationship_changes: relChanges,
    });

    return Response.json({
      success: true,
      eventId,
      memoriesCreated: memories.length,
      uncoveredFilled: uncoveredIds.length,
      totalParticipants: allIds.length,
      imagesGenerated: imagePrompts.length,
      relationshipChanges: relChanges.length,
      participantTypes: allIds.map(id => charById[id]?.character_type || 'unknown'),
      // Identity grounding proof
      identity_grounding: {
        name_reference_key_injected: true,
        participant_bundles_resolved: participantBundles.length,
        user_bundle_resolved: !!userBundle,
        user_id: userBundle?.user_id || null,
        participant_ids: participantBundles.map(b => b.character_id),
        participants_with_ref_images: participantBundles.filter(b => b.ref_images.length > 0).length,
        participants_without_ref_images: participantBundles.filter(b => b.ref_images.length === 0).map(b => b.display_name),
      },
    });
  } catch (error) {
    console.error('[generateStoryEvent]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});