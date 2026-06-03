/**
 * recordSleepOnset
 *
 * Canonical sleep onset write path.
 * Called when a character enters a sleep state.
 * Writes last_sleep_start, resolved_presence_status = sleeping/napping,
 * and sleep_start_time to the Character entity.
 *
 * This is the ONLY function that should write sleep onset data.
 * It does NOT enforce sleep autonomously — it only records an
 * onset that has already been decided by the calling system.
 *
 * Called by:
 *   - enforceCharacterWorkSchedule (when off-shift + late hour)
 *   - runAutomaticNarrativesForAllCharacters (sleep event)
 *   - guardSleepNarrativeContinuity (sleep confirmed)
 *   - manual user action (e.g. "go to sleep" in chat)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      character_id,
      sleep_type = 'sleep',       // 'sleep' | 'nap'
      location_id = null,          // where they're sleeping (optional)
      location_name = null,
      reason = 'autonomous_sleep', // audit trail
    } = await req.json();

    if (!character_id) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

    // Fetch character — enforce owner_email scope
    const chars = await base44.entities.Character.filter(
      { id: character_id, owner_email: user.email },
      null, 1
    );
    const char = chars[0];
    if (!char) {
      return Response.json({ error: 'Character not found or not owned by this user' }, { status: 404 });
    }

    // Do not re-write if already sleeping to avoid overwriting real onset time
    if (char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'character already in sleep state',
        character_id,
        character_name: char.name,
        current_status: char.resolved_presence_status,
        last_sleep_start: char.last_sleep_start,
      });
    }

    const now = new Date().toISOString();
    const presenceStatus = sleep_type === 'nap' ? 'napping' : 'sleeping';
    const locationType = sleep_type === 'nap' ? 'recovery_nap' : 'home';

    // Determine sleep location — use current location if not provided
    const resolvedLocationId = location_id || char.current_home_location_id || char.resolved_current_location_id || null;
    const resolvedLocationName = location_name || char.resolved_current_location_name || char.name + "'s Home";

    const updates = {
      last_sleep_start: now,
      resolved_presence_status: presenceStatus,
      resolved_location_type: locationType,
      resolved_last_updated_at: now,
      resolved_source_reason: reason,
    };

    // Only update resolved location fields if a location was determined
    if (resolvedLocationId) {
      updates.resolved_current_location_id = resolvedLocationId;
      updates.resolved_current_location_name = resolvedLocationName;
    }

    await base44.entities.Character.update(character_id, updates);

    console.log(`[recordSleepOnset] ✅ ${char.name} sleep onset recorded: status=${presenceStatus} last_sleep_start=${now} reason=${reason}`);

    return Response.json({
      success: true,
      character_id,
      character_name: char.name,
      sleep_type,
      onset_time: now,
      presence_status: presenceStatus,
      location_id: resolvedLocationId,
      location_name: resolvedLocationName,
      reason,
    });

  } catch (error) {
    console.error('[recordSleepOnset]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});