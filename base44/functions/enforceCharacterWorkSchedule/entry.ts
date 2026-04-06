import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Enforces work schedule: moves character to work location if they're scheduled now,
 * or returns them home if their shift ended.
 *
 * Input: { characterId }
 * Output: { updated, oldLocation, newLocation, reason }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    const char = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (!char || char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const character = char[0];
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    let shouldUpdate = false;
    let newLocationId = null;
    let reason = '';

    // Check if they have a scheduled work shift NOW
    if (character.work_start_time && character.work_end_time && character.work_days) {
      const [workStart] = character.work_start_time.split(':').map(Number);
      const [workEnd] = character.work_end_time.split(':').map(Number);
      const isWorkDay = character.work_days.includes(dayOfWeek);
      const isWorkHours = currentHour >= workStart && currentHour < workEnd;

      if (isWorkDay && isWorkHours) {
        // They should be at work
        if (character.current_work_location_id) {
          newLocationId = character.current_work_location_id;
          shouldUpdate = true;
          reason = 'On shift now — moved to workplace';
        }
      }
    }

    // If not at work, return home (default safe location)
    if (!shouldUpdate && character.current_home_location_id) {
      newLocationId = character.current_home_location_id;
      reason = 'Not scheduled now — moved home';
      shouldUpdate = true;
    }

    if (shouldUpdate && newLocationId) {
      const oldLocation = character.current_location_id;
      await base44.asServiceRole.entities.Character.update(characterId, {
        current_location_id: newLocationId
      });

      return Response.json({
        updated: true,
        oldLocation,
        newLocation: newLocationId,
        reason
      });
    }

    return Response.json({
      updated: false,
      reason: 'No schedule change needed'
    });
  } catch (error) {
    console.error('Enforcement error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});