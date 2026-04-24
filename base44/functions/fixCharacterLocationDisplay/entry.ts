import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CRITICAL: Fix Locations Button Logic
 * 
 * Aligns character card display location with current shared truth.
 * Does NOT teleport characters.
 * Does NOT force outdated location logic.
 * 
 * Scoped to active_created_characters only.
 * No cross-account contamination.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all active created characters owned by this user
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      character_type: 'active_created_character',
      status: 'active'
    });

    // Fetch locations for the account
    const allLocations = await base44.entities.LocationReference.filter({
      owner_email: user.email
    });

    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const corrections = [];

    for (const char of characters) {
      try {
        // ════════════════════════════════════════════════════════════════
        // STEP 1: Determine the current RESOLVED location truth
        // ════════════════════════════════════════════════════════════════

        let resolvedTruth = {
          location_id: null,
          location_name: null,
          status: 'unknown',
          reason: null
        };

        // Check if character is in scene
        if (char.location_visibility_state === 'in_scene') {
          resolvedTruth.location_id = char.resolved_current_location_id;
          resolvedTruth.location_name = char.resolved_current_location_name;
          resolvedTruth.status = 'in_scene';
          resolvedTruth.reason = 'Scene state active';
        }
        // Check if character is traveling
        else if (char.is_traveling === true && char.travel_destination_location_id) {
          resolvedTruth.location_id = char.travel_destination_location_id;
          resolvedTruth.location_name = char.traveling_to_location_name;
          resolvedTruth.status = 'traveling';
          resolvedTruth.reason = 'Character is traveling';
        }
        // Check if character is sleeping
        else if (char.last_sleep_start) {
          const sleepStart = new Date(char.last_sleep_start);
          const now = new Date();
          const hoursSinceSleep = (now - sleepStart) / (1000 * 60 * 60);
          if (hoursSinceSleep < 8) {
            resolvedTruth.location_id = char.current_home_location_id;
            resolvedTruth.location_name = locationMap[char.current_home_location_id]?.name || 'Home';
            resolvedTruth.status = 'sleeping_home';
            resolvedTruth.reason = 'Character is sleeping';
          }
        }
        // Check if character is at work (current time matches shift)
        else if (char.occupation_location_id) {
          const workLoc = locationMap[char.occupation_location_id];
          if (workLoc && isCharacterOnShift(char, workLoc)) {
            resolvedTruth.location_id = char.occupation_location_id;
            resolvedTruth.location_name = char.occupation_location_name || workLoc.name;
            resolvedTruth.status = 'at_work';
            resolvedTruth.reason = 'Work shift active';
          }
        }
        // Default: home
        if (!resolvedTruth.location_id && char.current_home_location_id) {
          resolvedTruth.location_id = char.current_home_location_id;
          resolvedTruth.location_name = locationMap[char.current_home_location_id]?.name || 'Home';
          resolvedTruth.status = 'home';
          resolvedTruth.reason = 'Default home location';
        }

        // ════════════════════════════════════════════════════════════════
        // STEP 2: Check what the character card CURRENTLY DISPLAYS
        // ════════════════════════════════════════════════════════════════

        const cardDisplay = {
          location_id: char.resolved_current_location_id,
          location_name: char.resolved_current_location_name,
          presence_status: char.resolved_presence_status
        };

        // ════════════════════════════════════════════════════════════════
        // STEP 3: Compare and Correct
        // ════════════════════════════════════════════════════════════════

        const needsCorrection = 
          cardDisplay.location_id !== resolvedTruth.location_id ||
          cardDisplay.location_name !== resolvedTruth.location_name ||
          cardDisplay.presence_status !== resolvedTruth.status;

        if (needsCorrection && resolvedTruth.location_id) {
          // Update character card display ONLY
          await base44.entities.Character.update(char.id, {
            resolved_current_location_id: resolvedTruth.location_id,
            resolved_current_location_name: resolvedTruth.location_name,
            resolved_presence_status: resolvedTruth.status,
            resolved_source_reason: resolvedTruth.reason,
            resolved_last_updated_at: new Date().toISOString()
          });

          corrections.push({
            character_id: char.id,
            character_name: char.name,
            old_display: `${cardDisplay.location_name || 'Unknown'} (${cardDisplay.presence_status})`,
            new_display: `${resolvedTruth.location_name} (${resolvedTruth.status})`,
            reason: resolvedTruth.reason
          });
        }
      } catch (charErr) {
        console.error(`[FIX_LOCATIONS] Error processing character ${char.id}:`, charErr.message);
      }
    }

    return Response.json({
      success: true,
      corrected_count: corrections.length,
      corrections: corrections.slice(0, 10) // Log first 10
    });
  } catch (error) {
    console.error('[FIX_LOCATIONS] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Check if character is currently on a work shift
 */
function isCharacterOnShift(character, workLocation) {
  if (!workLocation.worker_shifts || !workLocation.worker_shifts[character.id]) {
    return false;
  }

  const shift = workLocation.worker_shifts[character.id];
  if (!shift.start || !shift.end || !shift.days) {
    return false;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Check if today is a work day
  if (!shift.days.includes(currentDay)) {
    return false;
  }

  // Check if current time is within shift hours
  const [startH, startM] = shift.start.split(':').map(Number);
  const [endH, endM] = shift.end.split(':').map(Number);

  const startTotalMins = startH * 60 + startM;
  const endTotalMins = endH * 60 + endM;
  const nowTotalMins = currentHour * 60 + currentMinute;

  return nowTotalMins >= startTotalMins && nowTotalMins < endTotalMins;
}