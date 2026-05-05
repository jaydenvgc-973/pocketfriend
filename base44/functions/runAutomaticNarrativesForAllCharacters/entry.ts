import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * runAutomaticNarrativesForAllCharacters
 *
 * Scheduled orchestrator. No user token is available.
 * Generates automatic narratives for all active_created_character records
 * across all user accounts using asServiceRole throughout.
 *
 * OWNERSHIP RULES:
 * - owner_email is the ONLY ownership field used.
 * - created_by is permanently forbidden.
 * - Characters without owner_email are skipped and logged.
 * - No cross-account data access occurs.
 *
 * ROUTING:
 * - All reads and writes use asServiceRole (no user token in scheduled context).
 * - Narrative and Memory entities have create: true RLS — service role writes are valid.
 * - Character updates (needs) use asServiceRole — acceptable for system-driven need drift.
 */

function getTimeOfDay(hour) {
  if (hour >= 5 && hour < 7) return 'early_morning';
  if (hour >= 7 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 12) return 'late_morning';
  if (hour >= 12 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 23) return 'night';
  return 'late_night';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    console.log(`[runAutomaticNarrativesForAllCharacters] ▶ Starting scheduled narrative run`);

    // ── FETCH ALL CHARACTERS (service role — no user token in scheduled context) ──
    // CRITICAL: asServiceRole.filter({ character_type }) has a platform-level visibility gap
    // that returns 0 active_created_character records. Must list all then filter in-memory.
    const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 300);
    const characters = allChars.filter(c =>
      c.status === 'active' &&
      c.character_type === 'active_created_character' &&
      c.owner_email // REQUIRED — skip any record missing owner_email
    );

    console.log(`[runAutomaticNarrativesForAllCharacters] Found ${characters.length} active_created_character records (from ${allChars.length} total)`);

    const NOW = new Date();
    const nowET = new Date(NOW.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const dayName = nowET.toLocaleDateString('en-US', { weekday: 'long' });
    const timeOfDay = getTimeOfDay(hour);
    const currentMinutes = hour * 60 + minute;

    const INTERVAL_MINUTES = 30;
    const minIntervalMs = INTERVAL_MINUTES * 60 * 1000;

    const results = {
      total: characters.length,
      generated: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    for (const character of characters) {
      const characterId = character.id;
      const ownerEmail = character.owner_email; // verified above in filter

      try {
        // ── INTERVAL CHECK ──────────────────────────────────────────────────
        const lastNarrativeList = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
          { character_id: characterId },
          '-timestamp',
          1
        );
        const lastNarrative = lastNarrativeList?.[0];
        if (lastNarrative) {
          const timeSinceLastMs = NOW.getTime() - new Date(lastNarrative.timestamp).getTime();
          if (timeSinceLastMs < minIntervalMs) {
            results.skipped++;
            results.details.push({ characterId, characterName: character.name, status: 'skipped', reason: 'interval_not_reached' });
            continue;
          }
        }

        // ── RESOLVE LOCATION ────────────────────────────────────────────────
        const locationId = character.resolved_current_location_id || character.current_home_location_id || null;
        let resolvedLocationName = 'home';
        let resolvedZoneName = null;
        let locationCategory = 'home';
        let locationDescription = '';

        if (locationId) {
          const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
          const loc = locList?.[0];
          if (loc) {
            resolvedLocationName = loc.name || resolvedLocationName;
            locationCategory = loc.category || 'generic';
            locationDescription = loc.description || '';
            if (loc.zones?.length > 0) resolvedZoneName = loc.zones[0].zone_name;
          }
        }

        // ── DETERMINE STATE ─────────────────────────────────────────────────
        const wakeHour = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;
        const sleepHour = character.sleep_start_time ? parseInt(character.sleep_start_time.split(':')[0]) : 23;
        const isAsleep = hour >= sleepHour || hour < wakeHour;

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
        if (character.resolved_presence_status === 'at_work') { workState = 'at_work'; isAtWork = true; }

        const isTraveling = (character.travel_status && character.travel_status !== 'not_traveling') ||
          character.resolved_presence_status === 'traveling';
        const travelDestination = character.traveling_to_location_name || null;
        const presenceStatus = character.resolved_presence_status || 'home';

        // ── NEEDS SNAPSHOT ──────────────────────────────────────────────────
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

        // ── BUILD SITUATION BLOCK ───────────────────────────────────────────
        let situationBlock = '';
        if (isAsleep) {
          situationBlock = `SITUATION: ${character.name} is ASLEEP. Do not depict movement, speech, or activity. Describe only rest, stillness, or subconscious state.
Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}`;
        } else if (isTraveling) {
          situationBlock = `SITUATION: ${character.name} is TRAVELING${travelDestination ? ` to ${travelDestination}` : ''}. Describe movement and transition only.`;
        } else if (isAtWork) {
          situationBlock = `SITUATION: ${character.name} is AT WORK.
Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
Occupation: ${character.occupation || 'their job'}
Describe work tasks, environment, or professional mindset only.`;
        } else {
          situationBlock = `SITUATION: ${character.name} is AWAKE and ${presenceStatus === 'home' ? 'at home' : `at ${resolvedLocationName}`}.
Location: ${resolvedLocationName}${resolvedZoneName ? ` — ${resolvedZoneName}` : ''}
Category: ${locationCategory}${locationDescription ? `\nEnvironment: ${locationDescription}` : ''}`;
        }

        const needsHints = [];
        if (needsSnapshot.hunger < 40) needsHints.push('noticeably hungry');
        if (needsSnapshot.energy < 35) needsHints.push('exhausted');
        if (needsSnapshot.social < 30) needsHints.push('isolated or lonely');
        if (needsSnapshot.mental < 30) needsHints.push('mentally stressed');
        const needsLine = needsHints.length > 0 ? `\nCurrent state: ${needsHints.join(', ')}.` : '';

        const charGender = character.gender || '';
        const charPronouns = charGender === 'male' ? 'he/him' : charGender === 'female' ? 'she/her' : 'they/them';
        const subPronoun = charGender === 'male' ? 'he' : charGender === 'female' ? 'she' : 'they';
        const posPronoun = charGender === 'male' ? 'his' : charGender === 'female' ? 'her' : 'their';

        const narrativePrompt = `Generate a vivid, present-moment narrative (2-4 sentences) for ${character.name} RIGHT NOW.

TIME: ${timeStr} on ${dayName} (${timeOfDay.replace(/_/g, ' ')})

${situationBlock}
${needsLine}

Pronouns: ${charPronouns} (${subPronoun}/${posPronoun}) — use ONLY these, never switch.
Personality: ${character.personality_summary || 'not defined'}
Emotional state: ${character.emotional_state || 'calm'}

RULES:
1. Match the SITUATION block exactly — do not contradict it.
2. Present tense, third-person, immersive and specific.
3. No dialogue. No future speculation. Just this exact moment.
4. 2-4 sentences only.

RESPOND WITH JSON:
{
  "narrative_text": "the vivid 2-4 sentence narrative",
  "action_effects": [
    {
      "type": "needs",
      "need": "hunger|energy|hygiene|social|health|mental|comfort|financial_need",
      "change": <number -50 to +50>,
      "reason": "brief reason"
    }
  ]
}
Only include action_effects if the narrative describes concrete actions (eating, sleeping, socializing, etc.).`;

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
                    type: { type: 'string', enum: ['needs'] },
                    need: { type: 'string' },
                    change: { type: 'number' },
                    reason: { type: 'string' },
                  },
                  required: ['type', 'need', 'change', 'reason'],
                },
              },
            },
            required: ['narrative_text', 'action_effects'],
          },
        });

        const narrativeText = narrativeRes?.narrative_text?.trim() ||
          `${character.name} is ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} during the ${timeOfDay.replace(/_/g, ' ')}.`;
        const actionEffects = narrativeRes?.action_effects || [];
        const memorySummary = `[Auto] ${timeStr} ${dayName}: ${isAsleep ? 'asleep' : `at ${resolvedLocationName}`} — ${narrativeText.substring(0, 80)}...`;

        // ── APPLY NEEDS EFFECTS ─────────────────────────────────────────────
        const needFieldMap = {
          hunger: 'hunger_value', energy: 'energy_value', social: 'social_value',
          health: 'health_value', mental: 'mental_value', financial_need: 'financial_need_value',
          hygiene: 'hygiene_value', comfort: 'comfort_value',
        };
        const characterUpdatePayload = {};
        const updatedNeeds = { ...needsSnapshot };

        for (const effect of actionEffects) {
          if (effect.type === 'needs' && effect.need && needFieldMap[effect.need]) {
            const fieldName = needFieldMap[effect.need];
            const oldVal = updatedNeeds[effect.need] ?? 0;
            const newVal = Math.max(0, Math.min(100, oldVal + effect.change));
            updatedNeeds[effect.need] = newVal;
            characterUpdatePayload[fieldName] = newVal;
          }
        }

        if (Object.keys(characterUpdatePayload).length > 0) {
          await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload)
            .catch(e => console.warn(`[runAutomaticNarrativesForAllCharacters] Character needs update failed for ${character.name}: ${e.message}`));
        }

        // ── SAVE NARRATIVE ──────────────────────────────────────────────────
        const narrative = await base44.asServiceRole.entities.CharacterAutomaticNarrative.create({
          character_id: characterId,
          character_name: character.name,
          owner_user_id: character.owner_user_id || null,
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
          triggered_by: 'scheduled',
          visibility: 'visible_in_chat',
        });

        // ── SAVE MEMORY ─────────────────────────────────────────────────────
        await base44.asServiceRole.entities.Memory.create({
          character_id: characterId,
          title: `[Auto] ${timeStr} ${dayName}`,
          description: narrativeText,
          memory_type: 'event',
          importance_score: 3,
          confidence_score: 0.9,
          permanence: 'long_term',
          timestamp: NOW.toISOString(),
        }).catch(e => console.warn(`[runAutomaticNarrativesForAllCharacters] Memory save failed (non-blocking): ${e.message}`));

        console.log(`[runAutomaticNarrativesForAllCharacters] ✓ ${character.name} (owner: ${ownerEmail}): ${narrative.id}`);
        results.generated++;
        results.details.push({ characterId, characterName: character.name, status: 'generated', narrativeId: narrative.id });

      } catch (err) {
        results.errors++;
        results.details.push({ characterId, characterName: character.name, status: 'error', error: err.message });
        console.error(`[runAutomaticNarrativesForAllCharacters] Error for ${character.name} (${characterId}): ${err.message}`);
      }
    }

    console.log(`[runAutomaticNarrativesForAllCharacters] ✓ Complete: ${results.generated} generated, ${results.skipped} skipped, ${results.errors} errors`);

    return Response.json({ success: true, results });

  } catch (error) {
    console.error('[runAutomaticNarrativesForAllCharacters] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});