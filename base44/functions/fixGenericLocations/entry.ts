import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fixes characters at generic locations by moving them to:
 * 1. Their work location (if they have a shift now)
 * 2. Their school location (if they're in class now)
 * 3. Their home location (if no scheduled activities)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterIds } = await req.json().catch(() => ({}));

    // Fetch affected characters
    const query = characterIds?.length > 0
      ? { id: { "$in": characterIds }, status: "active" }
      : { status: "active", is_active_character: true };
    
    const characters = await base44.asServiceRole.entities.Character.filter(query);

    const genericPatterns = /\b(at a bar|at bar|bar|at club|at clubs|club|social|party|pub|tavern|lounge|nightclub)\b/i;
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    let fixed = 0;
    const updates = [];

    for (const char of characters) {
      const currentActivity = char.current_activity || '';
      if (!genericPatterns.test(currentActivity)) continue;

      let newLocationId = null;
      let updateData = {};

      // 1. Check work shift
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours && char.current_work_location_id) {
          newLocationId = char.current_work_location_id;
        }
      }

      // 2. Check school
      if (!newLocationId && char.current_school_location_id && char.student_status === 'enrolled') {
        if (dayOfWeek >= 1 && dayOfWeek <= 5 && currentHour >= 9 && currentHour < 17) {
          newLocationId = char.current_school_location_id;
        }
      }

      // 3. Default to home
      if (!newLocationId && char.current_home_location_id) {
        newLocationId = char.current_home_location_id;
      }

      // Update character
      if (newLocationId) {
        updateData.current_location_id = newLocationId;
        updateData.current_activity = null; // Clear generic activity
        updates.push(base44.asServiceRole.entities.Character.update(char.id, updateData).then(() => {
          fixed++;
        }).catch(err => console.error(`Failed to fix ${char.name}:`, err)));
      }
    }

    await Promise.all(updates);

    return Response.json({
      success: true,
      charactersFixed: fixed,
      totalProcessed: characters.length,
    });
  } catch (error) {
    console.error('Fix error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});