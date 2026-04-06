import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * AUDIT: Schedule vs Home Forcing
 * 
 * Detects if characters are being forced home while active work/school schedules exist.
 * Reports location precedence violations and sources of bad home-forcing logic.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );

    const locations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const audit = {
      totalCharacters: characters.length,
      violations: [],
      compliant: []
    };

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    for (const char of characters) {
      // Check work schedule
      const hasWorkSchedule = char.work_start_time && char.work_end_time && char.work_days;
      const isWorkDay = hasWorkSchedule && char.work_days.includes(dayOfWeek);
      const workStart = hasWorkSchedule ? parseInt(char.work_start_time.split(':')[0]) : null;
      const workEnd = hasWorkSchedule ? parseInt(char.work_end_time.split(':')[0]) : null;
      const isWorkHours = hasWorkSchedule && isWorkDay && (currentHour >= workStart && currentHour < workEnd);

      // Check school enrollment
      const isEnrolled = char.student_status === 'enrolled';

      // Check if currently at home
      const atHome = char.current_location_id === char.current_home_location_id;

      // VIOLATION: at home while scheduled for work
      if (isWorkHours && atHome) {
        const workLoc = locationMap[char.occupation_location_id];
        audit.violations.push({
          characterId: char.id,
          characterName: char.name,
          violationType: 'FORCED_HOME_DURING_WORK_SCHEDULE',
          currentLocationId: char.current_location_id,
          workLocationId: char.occupation_location_id,
          workLocationName: workLoc?.name || 'Unknown',
          workSchedule: `${char.work_start_time}-${char.work_end_time}`,
          dayOfWeek,
          currentHour,
          homeLocationId: char.current_home_location_id,
          message: `Character is at home but scheduled for work at "${workLoc?.name}" until ${char.work_end_time}`
        });
        continue;
      }

      // VIOLATION: at home while enrolled in school (if no schedule, this is OK)
      // Only flag if they have explicit school schedule enforcement
      // (For now we don't enforce school schedule, so skip this check)

      audit.compliant.push({
        characterId: char.id,
        characterName: char.name,
        currentLocationId: char.current_location_id,
        currentLocationName: locationMap[char.current_location_id]?.name || 'Unknown',
        isWorkScheduleActive: isWorkHours,
        isEnrolledInSchool: isEnrolled,
        status: 'OK'
      });
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      audit,
      summary: {
        totalCharacters: audit.totalCharacters,
        violations: audit.violations.length,
        compliant: audit.compliant.length,
        complianceRate: `${Math.round((audit.compliant.length / audit.totalCharacters) * 100)}%`
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});