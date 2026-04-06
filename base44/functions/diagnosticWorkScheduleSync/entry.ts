import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Diagnostic: Finds characters with work schedule violations.
 *
 * Issues detected:
 * - Character is scheduled for work but NOT at their workplace
 * - Character's location doesn't match their schedule
 * - Generic activity labels (bar, club, restaurant) instead of real business names
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const characters = await base44.asServiceRole.entities.Character.filter({ 
      status: "active"
    });

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();

    const issues = [];
    const activityPatterns = /\b(bar|club|nightclub|lounge|pub|tavern|happy hour|restaurant|eating|out)\b/i;

    for (const char of characters) {
      // Check 1: Scheduled for work but not at workplace
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours) {
          if (char.current_location_id !== char.current_work_location_id) {
            issues.push({
              characterId: char.id,
              characterName: char.name,
              severity: 'CRITICAL',
              type: 'WORK_SCHEDULE_VIOLATION',
              message: `${char.name} is scheduled for work (${char.work_start_time}-${char.work_end_time}) but NOT at workplace`,
              expectedLocation: char.current_work_location_id,
              actualLocation: char.current_location_id,
              fix: 'Move to work location'
            });
          }
        }
      }

      // Check 2: Generic activity label (no real business name)
      if (char.current_activity && activityPatterns.test(char.current_activity)) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          severity: 'WARNING',
          type: 'GENERIC_LOCATION_LABEL',
          message: `${char.name} has generic activity: "${char.current_activity}" — should be a real business name`,
          currentActivity: char.current_activity,
          fix: 'Validate and replace with real business name'
        });
      }
    }

    return Response.json({
      success: true,
      totalIssues: issues.length,
      issues,
      summary: {
        workScheduleViolations: issues.filter(i => i.type === 'WORK_SCHEDULE_VIOLATION').length,
        genericLocationLabels: issues.filter(i => i.type === 'GENERIC_LOCATION_LABEL').length
      }
    });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});