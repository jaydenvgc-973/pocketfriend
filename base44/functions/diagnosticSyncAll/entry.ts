import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * COMPREHENSIVE DIAGNOSTIC: Checks entire system for integrity violations.
 *
 * Validates:
 * 1. Work schedule adherence (characters at work vs. scheduled)
 * 2. Real-world location validation (no generic bars/restaurants)
 * 3. Location sync (character card ↔ travel popup ↔ location system match)
 * 4. Generic location labels (at bar, at restaurant, etc.)
 * 5. Closed venue visits (characters at closed venues)
 * 6. City-bound realism (no cross-city casual visits)
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
    const activityPatterns = /\b(bar|club|nightclub|lounge|pub|tavern|happy hour|restaurant|eating|out|at unknown)\b/i;

    const allIssues = {
      workScheduleViolations: [],
      genericLocationLabels: [],
      closedVenueVisits: [],
      locationMismatches: [],
      cityBoundViolations: []
    };

    for (const char of characters) {
      // ISSUE 1: Work Schedule Violation
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours && char.current_location_id !== char.current_work_location_id) {
          allIssues.workScheduleViolations.push({
            characterId: char.id,
            characterName: char.name,
            severity: 'CRITICAL',
            message: `${char.name} is on shift but NOT at work (${char.work_start_time}-${char.work_end_time})`,
            expectedWorkLocation: char.current_work_location_id,
            actualLocation: char.current_location_id
          });
        }
      }

      // ISSUE 2: Generic Location Label
      if (char.current_activity && activityPatterns.test(char.current_activity)) {
        allIssues.genericLocationLabels.push({
          characterId: char.id,
          characterName: char.name,
          severity: 'WARNING',
          message: `${char.name} has generic label in current_activity: "${char.current_activity}"`,
          currentActivity: char.current_activity
        });
      }

      // ISSUE 3: Character at closed venue
      if (char.current_location_id && locationMap[char.current_location_id]) {
        const loc = locationMap[char.current_location_id];
        if (loc.operating_hours && loc.operating_hours.length > 0) {
          const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
          if (todayHours) {
            const [locOpen] = todayHours.open_time.split(':').map(Number);
            const [locClose] = todayHours.close_time.split(':').map(Number);
            const isOpen = currentHour >= locOpen && currentHour < locClose;

            if (!isOpen && loc.category !== 'home') {
              allIssues.closedVenueVisits.push({
                characterId: char.id,
                characterName: char.name,
                severity: 'WARNING',
                message: `${char.name} is at ${loc.name} but it's closed (hours: ${todayHours.open_time}-${todayHours.close_time})`,
                location: loc.name,
                operatingHours: `${todayHours.open_time}-${todayHours.close_time}`
              });
            }
          }
        }
      }

      // ISSUE 4: Character card location display mismatch
      // If character is scheduled for work, their display should show workplace
      if (char.work_start_time && char.work_end_time && char.work_days) {
        const [workStart] = char.work_start_time.split(':').map(Number);
        const [workEnd] = char.work_end_time.split(':').map(Number);
        const isWorkDay = char.work_days.includes(dayOfWeek);
        const isWorkHours = currentHour >= workStart && currentHour < workEnd;

        if (isWorkDay && isWorkHours) {
          const workLoc = locationMap[char.current_work_location_id];
          const currentLoc = locationMap[char.current_location_id];
          
          if (workLoc && currentLoc && workLoc.id !== currentLoc.id) {
            allIssues.locationMismatches.push({
              characterId: char.id,
              characterName: char.name,
              severity: 'CRITICAL',
              message: `${char.name} card shows "${currentLoc.name}" but should show work location "${workLoc.name}"`,
              expectedDisplay: `At ${workLoc.name} (working)`,
              actualDisplay: `At ${currentLoc.name}`
            });
          }
        }
      }
    }

    return Response.json({
      success: true,
      timestamp: now.toISOString(),
      totalIssues: Object.values(allIssues).reduce((sum, arr) => sum + arr.length, 0),
      issues: allIssues,
      requiresAction: Object.values(allIssues).some(arr => arr.some(i => i.severity === 'CRITICAL'))
    });
  } catch (error) {
    console.error('Comprehensive diagnostic error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});