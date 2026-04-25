import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

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

    // ── FETCH CHARACTER ───────────────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];

    if (!character) {
      return Response.json({ error: 'Character not found', characterId }, { status: 404 });
    }

    const ownerEmail = character.owner_email || character.created_by;
    const ownerUser = character.owner_user_id;

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

    const narrativePrompt = `Generate a vivid, present-moment narrative (2-4 sentences) describing exactly what ${character.name} is experiencing RIGHT NOW.

TIME: ${timeStr} on ${dayName} (${timeOfDay.replace(/_/g, ' ')})

${situationBlock}

CHARACTER:
- Name: ${character.name}
- Personality: ${character.personality_summary || 'not defined'}
- Emotional state: ${character.emotional_state || 'calm'}
- Current activity context: ${character.current_activity || 'none noted'}
${needsLine}

CRITICAL RULES:
1. NEVER contradict the situation block above — it is the ground truth.
2. Write in present tense, third-person (${character.name} is..., they are...).
3. Make it immersive and specific to the location and time.
4. Reflect needs subtly if relevant — don't over-explain.
5. No dialogue. No speculation about the future. Just this exact moment.
6. 2-4 sentences only. No preamble, no labels.

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

      // Save character updates if any changes were made
      if (Object.keys(characterUpdatePayload).length > 0) {
        await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);
        console.log(`[generateAutomaticNarrative] ✓ Character needs updated.`);
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