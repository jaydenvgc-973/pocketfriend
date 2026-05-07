import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── INLINE SOAP OPERA LIFE CONTEXT BUILDER ───────────────────────────────────
function buildSoapOperaLifeContextInline(character, recentMemories = []) {
  const lines = [];
  const threads = [];
  const relationships = character.fictional_relationships || [];
  const romanticRels = relationships.filter(r =>
    r.romantic_level > 40 || r.attraction_level > 50 ||
    ['lover','partner','ex','situationship','complicated','crush'].some(k =>
      (r.relationship_type||'').toLowerCase().includes(k)||(r.description||'').toLowerCase().includes(k))
  );
  if (romanticRels.length > 0) {
    const r = romanticRels[0];
    const name = r.person_name || r.display_name || 'someone';
    const status = r.current_status || r.relationship_type || 'complicated';
    const tension = r.relational_jealousy > 50 ? ' — jealousy is active' : r.romantic_level > 75 ? ' — deeply invested' : '';
    threads.push(`ROMANCE THREAD: ${name} (${status})${tension}. ${r.last_interaction_summary || ''}`);
  }
  const fam = (character.family_members||[]).slice(0,3).map(f=>f.name||f.relationship).filter(Boolean);
  if (fam.length > 0) threads.push(`FAMILY THREAD: Active family ties — ${fam.join(', ')}.`);
  if (character.is_homeless) threads.push(`HOUSING THREAD: Without stable housing — affects daily planning, emotional security, and social interactions.`);
  else if (character.housing_context === 'temporary_shelter') threads.push(`HOUSING THREAD: Temporary shelter. Stability is not guaranteed.`);
  if (character.health_status?.length > 5) threads.push(`HEALTH THREAD: ${character.health_status.substring(0,150)}.`);
  if (character.occupation) threads.push(`WORK THREAD: ${character.occupation}. Workplace dynamics, pressures, and career concerns are present.`);
  if ((character.financial_need_value??60) < 40) threads.push(`FINANCIAL THREAD: Under real financial pressure — affects decisions and mood.`);
  const religion = (character.religion||'').trim();
  if (religion && religion !== 'None' && religion.toLowerCase() !== 'none') {
    const devout = character.belief_level === 'devout' ? ' — devout' : character.belief_level === 'moderate' ? ' — moderately practicing' : '';
    threads.push(`FAITH THREAD: ${religion}${devout}. Community, ritual, guilt, comfort, and identity surface through this.`);
  }
  if (character.criminal_record?.length > 3 && character.criminal_record.toLowerCase() !== 'none') {
    threads.push(`LEGAL HISTORY: ${character.criminal_record.substring(0,120)}.`);
  }
  if (character.current_situation?.length > 10) threads.push(`CURRENT SITUATION: ${character.current_situation.substring(0,200)}`);
  if (character.current_life_event?.length > 5) threads.push(`ACTIVE LIFE EVENT: ${character.current_life_event.substring(0,200)}`);
  const biz = (character.businesses||[])[0];
  if (biz) threads.push(`BUSINESS THREAD: Owns or runs "${biz.name||'a business'}" — ongoing concerns around staff, finances, reputation.`);

  if (threads.length > 0) {
    lines.push(`ACTIVE LIFE THREADS (soap opera context — these color behavior and tone):\n${threads.join('\n')}`);
  }
  const privateLines = [];
  if (character.emotional_baggage?.length > 5) privateLines.push(`EMOTIONAL BAGGAGE: ${character.emotional_baggage.substring(0,200)}`);
  if (character.loyalty_view?.length > 5) privateLines.push(`LOYALTY/TRUST: ${character.loyalty_view.substring(0,120)}`);
  if (character.upset_reaction?.length > 5) privateLines.push(`WHEN UPSET: ${character.upset_reaction.substring(0,120)}`);
  if (privateLines.length > 0) lines.push(`PRIVATE EMOTIONAL INTERIOR:\n${privateLines.join('\n')}`);
  const traitFlags = [
    character.trait_oversharer && 'tends to overshare',
    character.trait_dry_humor && 'uses dry humor as deflection',
    character.trait_night_owl && 'naturally alert at night',
    character.trait_hot_and_cold && 'runs hot and cold emotionally',
    character.trait_flirty && 'naturally flirtatious',
    character.trait_overcorrects && 'overcorrects after conflict',
    character.trait_blunt && 'says what they think without filtering',
    character.trait_romanticizes && 'romanticizes situations',
    character.trait_hard_to_read && 'intentionally hard to read',
    character.trait_competitive && 'has a competitive streak',
  ].filter(Boolean);
  const quirks = (character.quirks||[]).filter(q=>q.description||q.name).slice(0,3).map(q=>q.description||q.name);
  const allTexture = [...traitFlags, ...quirks];
  if (allTexture.length > 0) {
    lines.push(`BEHAVIORAL TEXTURE:\n${allTexture.map(t=>`• ${t}`).join('\n')}`);
  }
  const mems = recentMemories.filter(m=>m.importance_score>=5).slice(0,3);
  if (mems.length > 0) {
    lines.push(`OFF-SCREEN LIFE (recent memories — let these color the moment):\n${mems.map(m=>`• ${m.memory_text.substring(0,160)}`).join('\n')}`);
  }
  const goals = (character.future_life_goals||[]).slice(0,2).map(g=>g.goal||g.description||g.title).filter(Boolean);
  if (goals.length > 0) lines.push(`WHAT THEY'RE WORKING TOWARD:\n${goals.map(g=>`• ${g.substring(0,130)}`).join('\n')}`);
  lines.push(`WORLD TONE: Soap opera / telenovela depth. Balance is required. Not every moment is dramatic. Characters carry joy AND pain. Off-screen life shapes what they bring to this moment. Romance (when established): mature implication, never explicit.`);
  return lines.length > 0 ? '\n\n' + lines.join('\n\n') : '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      characterId,
      forceGenerate = false,
      trigger = 'interval',
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── DETECT CALLER CONTEXT ─────────────────────────────────────────────
    // This function is called two ways:
    //   1. User-triggered (Chat page "Right Now", Narrative Builder) — has user auth token
    //   2. Scheduled orchestrator (runAutomaticNarrativesForAllCharacters) — no user token
    // We detect which path we're on and use the appropriate write scope.
    let callerUser = null;
    try { callerUser = await base44.auth.me(); } catch { /* scheduled — no token */ }
    const isUserTriggered = !!callerUser;

    // ── FETCH CHARACTER ───────────────────────────────────────────────────
    // User-triggered: use user-scoped filter (correct RLS path, same as Chat page).
    // Scheduled: no user token available, use asServiceRole.
    let charList;
    if (isUserTriggered) {
      charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    } else {
      charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    }
    const character = charList?.[0];

    if (!character) {
      return Response.json({ error: 'Character not found', characterId }, { status: 404 });
    }

    // owner_email is the sole source of truth — created_by is permanently forbidden
    const ownerEmail = character.owner_email;
    const ownerUser = character.owner_user_id;

    if (!ownerEmail) {
      console.error(`[generateAutomaticNarrative] BLOCKED: Character id=${characterId} name="${character.name}" has no owner_email — cannot write narrative. Ownership cannot be verified.`);
      return Response.json({
        success: false,
        error: `Character "${character.name}" (id=${characterId}) is missing owner_email. Narrative generation stopped. Fix ownership data before retrying.`,
        reason: 'missing_owner_email',
      }, { status: 422 });
    }

    console.log(`[generateAutomaticNarrative] ▶ Character: ${character.name} (${characterId}) | trigger: ${trigger}`);

    // ── CHECK INTERVAL (skip for manual triggers) ─────────────────────────
    const NOW = new Date();
    const isManual = trigger === 'manual_right_now';

    if (!forceGenerate && !isManual) {
      const lastNarrativeList = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
        { character_id: characterId },
        '-timestamp',
        1
      );
      const lastNarrative = lastNarrativeList?.[0];
      const INTERVAL_MINUTES = 30;
      const minIntervalMs = INTERVAL_MINUTES * 60 * 1000;

      if (lastNarrative) {
        const timeSinceLastMs = NOW.getTime() - new Date(lastNarrative.timestamp).getTime();
        if (timeSinceLastMs < minIntervalMs) {
          const nextEligibleTime = new Date(new Date(lastNarrative.timestamp).getTime() + minIntervalMs);
          console.log(`[generateAutomaticNarrative] ⏭️ Skipped (interval): next=${nextEligibleTime.toISOString()}`);
          return Response.json({
            success: false, skipped: true, reason: 'interval_not_reached',
            lastNarrativeTime: lastNarrative.timestamp,
            nextEligibleTime: nextEligibleTime.toISOString(),
          });
        }
      }
    }

    // ── RESOLVE LOCATION — single source of truth ─────────────────────────
    const locationId =
      character.resolved_current_location_id ||
      character.current_home_location_id ||
      null;

    let location = null;
    let resolvedLocationName = 'home';
    let resolvedZoneName = null;
    let locationCategory = 'home';
    let locationDescription = '';

    if (locationId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1);
      location = locList?.[0];
      if (location) {
        resolvedLocationName = location.name;
        locationCategory = location.category || 'generic';
        locationDescription = location.description || '';
        if (location.zones && location.zones.length > 0) {
          resolvedZoneName = location.zones[0].zone_name;
        }
      }
    }

    console.log(`[generateAutomaticNarrative] Location: ${resolvedLocationName} (${locationId || 'none'})`);

    // ── DETERMINE STATE — precise and enforced ────────────────────────────
    const nowET = new Date(NOW.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const currentMinutes = hour * 60 + minute;

    const timeOfDay =
      hour >= 5 && hour < 7 ? 'early_morning' :
      hour >= 7 && hour < 10 ? 'morning' :
      hour >= 10 && hour < 12 ? 'late_morning' :
      hour >= 12 && hour < 14 ? 'midday' :
      hour >= 14 && hour < 17 ? 'afternoon' :
      hour >= 17 && hour < 20 ? 'evening' :
      hour >= 20 && hour < 23 ? 'night' :
      'late_night';

    // Sleep state — use schedule fields
    const wakeHour = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
    const sleepHour = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
    const isAsleep = hour >= sleepHour || hour < wakeHour;
    const sleepState = isAsleep ? 'asleep' : 'awake';

    // Work state — check schedule fields
    let workState = 'off_work';
    let isAtWork = false;
    if (character.work_days && character.work_start_time && character.work_end_time) {
      const dayOfWeek = nowET.getDay();
      const [wsh, wsm] = character.work_start_time.split(':').map(Number);
      const [weh, wem] = character.work_end_time.split(':').map(Number);
      const workStart = wsh * 60 + wsm;
      const workEnd = weh * 60 + wem;
      if (character.work_days.includes(dayOfWeek) && currentMinutes >= workStart && currentMinutes < workEnd) {
        workState = 'at_work';
        isAtWork = true;
      }
    }
    if (character.resolved_presence_status === 'at_work') {
      workState = 'at_work';
      isAtWork = true;
    }

    // Travel state
    const travelState =
      character.travel_status && character.travel_status !== 'not_traveling' ? 'traveling' :
      character.resolved_presence_status === 'traveling' ? 'traveling' :
      'at_location';

    const isTraveling = travelState === 'traveling';
    const travelDestination = character.traveling_to_location_name || character.travel_destination_location_id || null;

    // Presence
    const presenceStatus = character.resolved_presence_status || 'home';

    // ── NEEDS SNAPSHOT ────────────────────────────────────────────────────
    const needsSnapshot = {
      hunger: character.hunger_value ?? 70,
      energy: character.energy_value ?? 75,
      social: character.social_value ?? 65,
      health: character.health_value ?? 80,
      mental: character.mental_value ?? 70,
      financial_need: character.financial_need_value ?? 60,
      hygiene: character.hygiene_value ?? 75,
      comfort: character.comfort_value ?? 70,
    };

    // ── FETCH RECENT MEMORIES FOR SOAP OPERA CONTEXT ─────────────────────────
    let soapMemories = [];
    try {
      const memsFetched = await base44.asServiceRole.entities.CharacterMemory.filter(
        { character_id: characterId }, '-created_date', 8
      ).catch(() => []);
      soapMemories = memsFetched.filter(m => m.importance_score >= 5);
    } catch { /* non-blocking */ }

    // ── TIME RECONCILIATION: Check for expired actions ──────────────────────
    // Resolve any actions completed since last narrative
    let reconciliationUpdates = {};
    try {
      const { enforceTimeReconciliation } = await import('https://cdn.jsdelivr.net/gh/base44/app@latest/lib/actionExpirationEngine.js');
      const reconciliation = enforceTimeReconciliation(character, character.updated_date);
      if (reconciliation.expired && Object.keys(reconciliation.updates).length > 0) {
        console.log(`[generateAutomaticNarrative] ✓ Resolved expired action | Updates:`, reconciliation.updates);
        Object.assign(character, reconciliation.updates);
        reconciliationUpdates = reconciliation.updates;
      }
    } catch (recErr) {
      console.log(`[generateAutomaticNarrative] Reconciliation skipped (non-blocking):`, recErr.message);
    }

    // ── CANONICAL CONTEXT: inject identity/hard facts from shared truth service ──
    // This ensures automatic narratives use the same character truth as Chat/Text/Scene.
    // Failure is non-blocking — narratives continue with inline character data if unavailable.
    let canonicalIdentityBlock = '';
    try {
      const ctxRes = await base44.asServiceRole.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'automatic_narrative',
        topKMemories: 6,
      });
      const ctxData = ctxRes?.data || ctxRes;
      if (ctxData?.hardFacts) {
        canonicalIdentityBlock = `\n${ctxData.hardFacts}\n`;
        console.log(`[generateAutomaticNarrative] ✓ Canonical hard facts injected for ${character.name}`);
      }
    } catch (ctxErr) {
      console.warn(`[generateAutomaticNarrative] Canonical context unavailable (non-blocking): ${ctxErr.message}`);
    }

    // ── BUILD STATE-ACCURATE PROMPT ───────────────────────────────────────
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const dayName = nowET.toLocaleDateString('en-US', { weekday: 'long' });

    // Derive the dominant constraint
    let situationBlock = '';
    if (isAsleep) {
      situationBlock = `SITUATION: ${character.name} is ASLEEP right now.
- Do NOT depict them awake, moving, speaking, or doing anything active.
- Narrative must reflect sleep: physical rest, breathing, stillness, possible dreams, subconscious.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}`;
    } else if (isTraveling) {
      situationBlock = `SITUATION: ${character.name} is TRAVELING right now.
- They are in transit${travelDestination ? ` to ${travelDestination}` : ''}.
- Narrative must reflect movement, transition, anticipation, or the journey.
- Do NOT depict them already arrived or stationary at a destination.`;
    } else if (isAtWork) {
      situationBlock = `SITUATION: ${character.name} is AT WORK right now.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
- Occupation: ${character.occupation || 'their job'}
- Narrative must reflect work tasks, work environment, coworkers, or professional mindset.
- Do NOT depict them at home, relaxing, or away from work.`;
    } else {
      situationBlock = `SITUATION: ${character.name} is AWAKE and ${presenceStatus === 'home' ? 'at home' : `at ${resolvedLocationName}`}.
- Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
- Category: ${locationCategory}
${locationDescription ? `- Environment: ${locationDescription}` : ''}
- Narrative must reflect what they'd realistically be doing here at this time.`;
    }

    // Needs color
    const needsHints = [];
    if (needsSnapshot.hunger < 40) needsHints.push('they are noticeably hungry');
    if (needsSnapshot.energy < 35) needsHints.push('they feel exhausted');
    if (needsSnapshot.social < 30) needsHints.push('they feel isolated or lonely');
    if (needsSnapshot.hygiene < 35) needsHints.push('they feel like they need to clean up');
    if (needsSnapshot.mental < 30) needsHints.push('they are mentally stressed or overwhelmed');
    const needsLine = needsHints.length > 0
      ? `\nCURRENT PHYSICAL/EMOTIONAL STATE: ${needsHints.join(', ')}.`
      : '';

    // Resolve pronouns from character profile — never infer from name or appearance
    const charGender = character.gender || '';
    const charPronouns = charGender === 'male' ? 'he/him' : charGender === 'female' ? 'she/her' : 'they/them';
    const subjectPronoun = charGender === 'male' ? 'he' : charGender === 'female' ? 'she' : 'they';
    const objectPronoun = charGender === 'male' ? 'him' : charGender === 'female' ? 'her' : 'them';
    const possessivePronoun = charGender === 'male' ? 'his' : charGender === 'female' ? 'her' : 'their';

    const narrativePrompt = `Generate a vivid, present-moment narrative (2-4 sentences) describing exactly what ${character.name} is experiencing RIGHT NOW.

TIME: ${timeStr} on ${dayName} (${timeOfDay.replace(/_/g, ' ')})

${canonicalIdentityBlock}${situationBlock}

CHARACTER:
- Name: ${character.name}
- Personality: ${character.personality_summary || 'not defined'}
- Emotional state: ${character.emotional_state || 'calm'}
- Current activity context: ${character.current_activity || 'none noted'}
${needsLine}

════════════════════════════════════
IDENTITY AND PRONOUN LOCK — ABSOLUTE
════════════════════════════════════
Character gender: ${charGender || 'unknown — use they/them'}
Pronouns: ${charPronouns}
Subject: ${subjectPronoun} | Object: ${objectPronoun} | Possessive: ${possessivePronoun}

RULES — NON-NEGOTIABLE:
• Use ONLY the pronouns above throughout the entire narrative
• No pronoun switching mid-narrative under any condition
• Do NOT infer gender from the character's name or appearance
• If gender is unknown: use they/them exclusively
• No heteronormative defaults — do NOT assume opposite-gender attraction
• All interaction patterns (flirtatious, comfortable, romantic) apply equally regardless of gender combination
════════════════════════════════════

MANDATORY NARRATIVE ENGINE — EXECUTE BEFORE WRITING:
Before generating any text, complete these steps in order:

STEP 1 — IDENTIFY INTERACTION TYPE: FLIRT | COMFORT | REASSURE | REDIRECT | ENCOURAGE | DISTANCE | REVEAL | NEUTRAL
STEP 2 — SELECT ONE BEHAVIOR PATTERN from the matching library:
  FLIRT patterns: close without touching / playful challenge / accidental contact / low voice moment / testing the line / shared recognition / inside language / confidence shift / energy matching / subtle claim
  COMFORT patterns: quiet presence / soft redirect / protective energy / validation without fixing / physical reassurance / seen without explaining / identity affirmation / after a long day / protective check-in / rebuilding after hurt
  REASSURE: emotional validation + physical grounding + reframing fear + slow pacing + safety through presence
  ENCOURAGE: affirm capability + reference past strengths + future-oriented language + small push + no pressure
  DISTANCE: controlled withdrawal + calm boundary + reduced closeness + shortened responses + no escalation
  REVEAL: personal truth + tone shift + emotional risk + backstory drop + relationship dynamic change
  NEUTRAL: environment interaction + micro-behaviors + time awareness + silent actions
STEP 3 — APPLY AT LEAST ONE VARIATION HOOK (required — scene is invalid without one):
  For FLIRT: interruption / hesitation / uneven awareness / escalation then pullback / misread signal / external pressure / timing mismatch
  For COMFORT: resistance before accepting / delayed opening / silence held / mid-scene shift / humor deflection / unexpected vulnerability
  For any type: timing mismatch / emotional misread / expectation vs reality / memory callback / environment pressure
STEP 4 — EMBED AT LEAST ONE ROOT THEME (weave naturally — never state directly):
  unspoken tension / timing mismatch / power shift / memory callback / environment pressure / internal vs external conflict / expectation vs reality / control vs vulnerability / attachment vs independence / safety vs expression / guardedness giving way / micro-validation / chosen family energy / public vs private identity
STEP 5 — GENERATE. Only after steps 1–4 are resolved.

LGBTQ+ MANDATORY: All patterns apply identically across all gender/identity combinations. No simplification. No heteronormative defaults. Attraction is never assumed.

${buildSoapOperaLifeContextInline(character, soapMemories)}

CRITICAL RULES:
1. NEVER contradict the situation block above — it is the ground truth.
2. Write in present tense, third-person using the LOCKED pronouns above.
3. Make it immersive and specific to the location and time.
4. Let the LIFE THREADS above color tone and behavior naturally — not every thread needs to surface, but they should shape the moment.
5. No dialogue. No speculation about the future. Just this exact moment.
6. 2-4 sentences only. No preamble, no labels.
7. Vary sentence structure, tone, and pacing — do not repeat patterns from prior outputs.

RESPOND WITH JSON:
Return a JSON object with:
{
  "narrative_text": "the vivid 2-4 sentence narrative",
  "action_effects": [
    {
      "type": "needs",
      "need": "hunger|energy|hygiene|social|health|mental|comfort|financial_need",
      "change": <number between -50 and +50>,
      "reason": "why this need changed"
    }
  ]
}

Only include action_effects if the narrative describes concrete actions (eating, sleeping, showering, socializing, etc.).
If no actions occur, return empty action_effects array.`;

    const narrativeRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: narrativePrompt,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          narrative_text: { type: 'string' },
          action_effects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['needs', 'presence'] },
                need: { type: 'string' },
                change: { type: 'number' },
                reason: { type: 'string' },
                location_id: { type: 'string' },
                location_name: { type: 'string' },
              },
              required: ['type', 'reason'],
            },
          },
        },
        required: ['narrative_text', 'action_effects'],
      },
    });

    const narrativeText = narrativeRes?.narrative_text?.trim() ||
      `${character.name} is ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} during the ${timeOfDay.replace(/_/g, ' ')}.`;
    
    const actionEffects = narrativeRes?.action_effects || [];

    const memorySummary = `[Right Now] ${timeStr} ${dayName}: ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} — ${narrativeText.substring(0, 80)}...`;

    // ── APPLY ACTION EFFECTS TO CHARACTER ──────────────────────────────────
    let characterUpdatePayload = {};
    const updatedNeeds = { ...needsSnapshot };

    if (actionEffects && actionEffects.length > 0) {
      console.log(`[generateAutomaticNarrative] Applying ${actionEffects.length} action effects...`);
      
      for (const effect of actionEffects) {
        if (effect.type === 'needs' && effect.need) {
          const needFieldMap = {
            'hunger': 'hunger_value',
            'energy': 'energy_value',
            'social': 'social_value',
            'health': 'health_value',
            'mental': 'mental_value',
            'financial_need': 'financial_need_value',
            'hygiene': 'hygiene_value',
            'comfort': 'comfort_value',
          };
          
          const fieldName = needFieldMap[effect.need];
          if (fieldName && character[fieldName] !== undefined) {
            const oldValue = updatedNeeds[effect.need] ?? character[fieldName] ?? 0;
            const newValue = Math.max(0, Math.min(100, oldValue + effect.change));
            updatedNeeds[effect.need] = newValue;
            characterUpdatePayload[fieldName] = newValue;
            console.log(`  [${effect.need}] ${oldValue} → ${newValue} (${effect.change > 0 ? '+' : ''}${effect.change}) — ${effect.reason}`);
          } else {
            console.warn(`[generateAutomaticNarrative] Unknown need field: ${effect.need}`);
          }
        }
      }

      // Save character updates if any changes were made.
      // ROUTING RULE:
      //   User-triggered: use user-scoped client (satisfies Character RLS via owner_email).
      //   Scheduled (no token): use asServiceRole — no user token available to satisfy RLS,
      //   and asServiceRole is required. The owner_email on the character record was already
      //   verified above, so this is safe.
      if (Object.keys(characterUpdatePayload).length > 0) {
        try {
          if (isUserTriggered) {
            await base44.entities.Character.update(characterId, characterUpdatePayload);
          } else {
            await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);
          }
          console.log(`[generateAutomaticNarrative] ✓ Character needs updated (${isUserTriggered ? 'user-scoped' : 'service-role'}).`);
        } catch (updateErr) {
          console.warn(`[generateAutomaticNarrative] Character needs update skipped (non-blocking):`, updateErr.message);
        }
      }
    }

    // Persist reconciliation updates if any — same routing rule as above.
    if (Object.keys(reconciliationUpdates).length > 0) {
      try {
        if (isUserTriggered) {
          await base44.entities.Character.update(characterId, reconciliationUpdates);
        } else {
          await base44.asServiceRole.entities.Character.update(characterId, reconciliationUpdates);
        }
        console.log(`[generateAutomaticNarrative] ✓ Persisted reconciliation updates.`);
      } catch (updateErr) {
        console.warn(`[generateAutomaticNarrative] Failed to persist reconciliation:`, updateErr.message);
      }
    }

    // ── SAVE TO CharacterAutomaticNarrative (same table as automatic system) ──
    const narrative = await base44.asServiceRole.entities.CharacterAutomaticNarrative.create({
      character_id: characterId,
      character_name: character.name,
      owner_user_id: ownerUser,
      owner_email: ownerEmail,
      event_type: 'passive_time',
      narrative_text: narrativeText,
      memory_summary: memorySummary,
      timestamp: NOW.toISOString(),
      local_time: timeStr,
      time_of_day: timeOfDay,
      location_id: locationId,
      location_name: resolvedLocationName,
      zone_name: resolvedZoneName,
      sleep_state: isAsleep ? 'asleep' : 'awake',
      travel_state: isTraveling ? 'traveling' : 'at_location',
      work_state: workState,
      needs_snapshot: updatedNeeds,
      emotional_state: character.emotional_state || 'calm',
      triggered_by: isManual ? 'manual' : 'scheduled',
      visibility: isManual ? 'visible_in_chat' : 'visible_in_chat',
    });

    console.log(`[generateAutomaticNarrative] ✓ Saved for ${character.name}: ${narrative.id} | trigger=${trigger}`);

    // Save to Memory so character remembers it
    try {
      await base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `[Right Now] ${timeStr} ${dayName}`,
        description: narrativeText,
        memory_type: 'event',
        importance_score: 3,
        confidence_score: 0.9,
        permanence: 'long_term',
        timestamp: NOW.toISOString(),
      });
    } catch (memErr) {
      console.warn(`[generateAutomaticNarrative] Memory save failed (non-blocking):`, memErr.message);
    }

    return Response.json({
      success: true,
      narrativeId: narrative.id,
      characterName: character.name,
      narrativeText,
      memorySummary,
      timestamp: NOW.toISOString(),
    });

  } catch (error) {
    console.error('[generateAutomaticNarrative] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});