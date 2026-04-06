import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Diagnoses characters at generic/non-existent locations like "at a bar"
 * and determines where they should actually be based on their schedule.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Fetch all active characters
    const characters = await base44.asServiceRole.entities.Character.filter({ 
      status: "active",
      is_active_character: true 
    });

    // Generic location patterns to detect
    const genericPatterns = /\b(at a bar|at bar|bar|at club|at clubs|club|social|party|pub|tavern|lounge|nightclub)\b/i;

    const affectedCharacters = [];
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    for (const char of characters) {
      // Check if current_location_id or description matches generic patterns
      const currentActivity = char.current_activity || '';
      const hasGenericLocation = genericPatterns.test(currentActivity);

      if (!hasGenericLocation) continue;

      // Determine where they should actually be
      let proposedLocation = null;
      let proposedReason = '';

      // 1. Check if they have a work shift right now
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours && char.current_work_location_id) {
          proposedLocation = char.current_work_location_id;
          proposedReason = 'Has a work shift right now';
        }
      }

      // 2. Check if they have school/education right now
      if (!proposedLocation && char.current_school_location_id) {
        // If they're enrolled as a student, assume they should be at school during typical hours (9am-5pm on school days)
        if (char.student_status === 'enrolled') {
          if (dayOfWeek >= 1 && dayOfWeek <= 5 && currentHour >= 9 && currentHour < 17) {
            proposedLocation = char.current_school_location_id;
            proposedReason = 'Enrolled student during school hours';
          }
        }
      }

      // 3. If no work/school shift, send them home
      if (!proposedLocation && char.current_home_location_id) {
        proposedLocation = char.current_home_location_id;
        proposedReason = 'No scheduled activities, should be home';
      }

      // 4. If no home set, find an open venue
      if (!proposedLocation) {
        proposedReason = 'No home location set, needs manual reassignment';
      }

      affectedCharacters.push({
        id: char.id,
        name: char.name,
        currentActivity,
        hasWorkLocation: !!char.current_work_location_id,
        hasSchoolLocation: !!char.current_school_location_id,
        hasHomeLocation: !!char.current_home_location_id,
        proposedLocationId: proposedLocation,
        proposedReason,
        workHours: char.work_start_time && char.work_end_time ? `${char.work_start_time}-${char.work_end_time}` : null,
        workDays: char.work_days,
      });
    }

    return Response.json({
      success: true,
      totalAffected: affectedCharacters.length,
      characters: affectedCharacters,
    });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});