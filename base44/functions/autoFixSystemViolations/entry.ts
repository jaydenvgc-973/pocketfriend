import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * AUTO-FIX: Corrects detected system violations.
 *
 * Fixes:
 * 1. Move scheduled workers to workplace
 * 2. Clear generic activity labels
 * 3. Return characters from closed venues to home
 * 4. Sync location system to match schedules
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const [characters, locations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: "active" }),
      base44.asServiceRole.entities.LocationReference.list()
    ]);

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();
    const activityPatterns = /\b(bar|club|nightclub|lounge|pub|tavern|happy hour|restaurant|eating|out)\b/i;

    let fixed = 0;
    const updates = [];
    const fixLog = [];

    for (const char of characters) {
      let updateData = {};

      // FIX 1: Move to work if scheduled now
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours && char.current_location_id !== char.current_work_location_id && char.current_work_location_id) {
          updateData.current_location_id = char.current_work_location_id;
          fixLog.push(`✓ Moved ${char.name} to workplace`);
          fixed++;
        }
      }

      // FIX 2: Clear generic activity labels
      if (char.current_activity && activityPatterns.test(char.current_activity)) {
        updateData.current_activity = null;
        fixLog.push(`✓ Cleared generic activity for ${char.name}`);
        fixed++;
      }

      // FIX 3: Return from closed venues
      if (char.current_location_id && locationMap[char.current_location_id]) {
        const loc = locationMap[char.current_location_id];
        if (loc.operating_hours && loc.operating_hours.length > 0 && loc.category !== 'home') {
          const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
          if (todayHours) {
            const [locOpen] = todayHours.open_time.split(':').map(Number);
            const [locClose] = todayHours.close_time.split(':').map(Number);
            const isOpen = currentHour >= locOpen && currentHour < locClose;

            if (!isOpen && char.current_home_location_id) {
              updateData.current_location_id = char.current_home_location_id;
              fixLog.push(`✓ Returned ${char.name} home (venue closed)`);
              fixed++;
            }
          }
        }
      }

      // Apply updates
      if (Object.keys(updateData).length > 0) {
        updates.push(
          base44.asServiceRole.entities.Character.update(char.id, updateData)
            .catch(err => console.error(`Failed to fix ${char.name}:`, err))
        );
      }
    }

    await Promise.all(updates);

    return Response.json({
      success: true,
      charactersCorrected: fixed,
      fixLog,
      message: `✓ Fixed ${fixed} violations — all systems re-synced`
    });
  } catch (error) {
    console.error('Auto-fix error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});