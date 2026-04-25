import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const {
      characterId,
      forceGenerate = false,
    } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // ── FETCH CHARACTER ───────────────────────────────────────────────────
    const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];
    
    if (!character) {
      return Response.json({ error: 'Character not found', characterId }, { status: 404 });
    }

    const ownerEmail = character.owner_email || character.created_by;
    const ownerUser = character.owner_user_id;

    console.log(`[generateAutomaticNarrative] ▶ Character: ${character.name} (${characterId}) | owner: ${ownerEmail}`);

    // ── CHECK INTERVAL ────────────────────────────────────────────────────
    const NOW = new Date();
    const lastNarrativeList = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
      { character_id: characterId },
      '-timestamp',
      1
    );
    const lastNarrative = lastNarrativeList?.[0];
    const INTERVAL_MINUTES = 30; // Configurable
    const minIntervalMs = INTERVAL_MINUTES * 60 * 1000;

    if (!forceGenerate && lastNarrative) {
      const timeSinceLastMs = NOW.getTime() - new Date(lastNarrative.timestamp).getTime();
      if (timeSinceLastMs < minIntervalMs) {
        const nextEligibleTime = new Date(new Date(lastNarrative.timestamp).getTime() + minIntervalMs);
        console.log(`[generateAutomaticNarrative] ⏭️ ${character.name} skipped (interval check): last=${lastNarrative.timestamp} | next eligible=${nextEligibleTime.toISOString()}`);
        return Response.json({
          success: false,
          skipped: true,
          reason: 'interval_not_reached',
          lastNarrativeTime: lastNarrative.timestamp,
          nextEligibleTime: nextEligibleTime.toISOString(),
        });
      }
    }

    // ── RESOLVE LOCATION ──────────────────────────────────────────────────
    const locationId = 
      character.resolved_current_location_id ||
      character.current_home_location_id ||
      character.home_location_id ||
      null;

    let location = null;
    let resolvedLocationName = 'Location Unknown';
    let resolvedZoneName = null;

    if (locationId) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1);
      location = locList?.[0];
      if (location) {
        resolvedLocationName = location.name;
        // Try to pick a zone for the narrative
        if (location.zones && location.zones.length > 0) {
          resolvedZoneName = location.zones[0].zone_name;
        }
      }
    }

    console.log(`[generateAutomaticNarrative] Location: ${resolvedLocationName} (${locationId || 'none'})`);

    // ── DETERMINE STATE ───────────────────────────────────────────────────
    const hour = NOW.getHours();
    const timeOfDay = 
      hour >= 5 && hour < 9 ? 'early_morning' :
      hour >= 9 && hour < 12 ? 'morning' :
      hour >= 12 && hour < 15 ? 'midday' :
      hour >= 15 && hour < 18 ? 'afternoon' :
      hour >= 18 && hour < 21 ? 'evening' :
      'night';

    const sleepState = character.location_visibility_state === 'hidden' ? 'sleeping' : 'awake';
    const travelState = character.travel_status === 'not_traveling' ? 'stationary' : 'in_transit';
    const workState = 'not_working'; // Simplified for now

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

    // ── GENERATE NARRATIVE ────────────────────────────────────────────────
    // Use LLM to create a natural narrative respecting state
    let narrativePrompt = `Generate a short, natural automatic narrative (2-3 sentences) for ${character.name}.

CONSTRAINTS:
- Current time: ${timeOfDay} (${hour}:${String(NOW.getMinutes()).padStart(2, '0')})
- Sleep state: ${sleepState}
- Location: ${resolvedLocationName}${resolvedZoneName ? ` (${resolvedZoneName})` : ''}
- Current needs: hunger=${needsSnapshot.hunger} energy=${needsSnapshot.energy} social=${needsSnapshot.social}

CHARACTER CONTEXT:
Personality: ${character.personality_summary || 'unknown'}
Current activity: ${character.current_activity || 'none'}

RULES:
- If ${sleepState === 'sleeping'}, describe sleeping/resting state only, not awake activities
- Use real current time (${timeOfDay}), not fictional time
- Reflect needs naturally (low energy = might rest, high hunger = might think of food)
- Keep narrative short and internal (what they're experiencing, thinking, or doing)
- Do NOT narrate actions that would violate their sleep state

Generate narrative text only, no labels.`;

    const narrativeRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: narrativePrompt,
      model: 'gemini_3_flash',
    });

    const narrativeText = narrativeRes?.trim() || `${character.name} continues through the ${timeOfDay}, present at ${resolvedLocationName}.`;

    const memorySummary = `${timeOfDay.replace(/_/g, ' ')}: at ${resolvedLocationName}${resolvedZoneName ? ` (${resolvedZoneName})` : ''}`;

    // ── SAVE NARRATIVE ────────────────────────────────────────────────────
    const narrative = await base44.asServiceRole.entities.CharacterAutomaticNarrative.create({
      character_id: characterId,
      character_name: character.name,
      owner_user_id: ownerUser,
      owner_email: ownerEmail,
      event_type: 'passive_time',
      narrative_text: narrativeText,
      memory_summary: memorySummary,
      timestamp: NOW.toISOString(),
      local_time: `${hour}:${String(NOW.getMinutes()).padStart(2, '0')}`,
      time_of_day: timeOfDay,
      location_id: locationId,
      location_name: resolvedLocationName,
      zone_name: resolvedZoneName,
      sleep_state: sleepState,
      travel_state: travelState,
      work_state: workState,
      needs_snapshot: needsSnapshot,
      triggered_by: 'interval',
    });

    console.log(`[generateAutomaticNarrative] ✓ Narrative saved for ${character.name}: ${narrative.id}`);

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