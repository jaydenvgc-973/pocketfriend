/**
 * diagnoseEmploymentRouting
 *
 * Finds characters being incorrectly routed to work/school:
 * - Characters fired or quit (not in location.worker_character_ids) still being sent to work
 * - Characters showing 'at_work' with no valid shift active
 * - Characters whose work_days/work_start_time/occupation_location_id is stale
 * - Characters with work routing but employment_status = fired/quit
 *
 * Does NOT write anything. Returns full diagnostic chain per character.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dowNow = nowET.getDay();

    // Load all active characters + all locations for this owner
    const [characters, locations] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email, status: 'active' }, null, 200),
      base44.entities.LocationReference.filter({ owner_email: user.email }, null, 200),
    ]);

    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    const issues = [];
    const clean = [];

    for (const char of characters) {
      if (!char.occupation_location_id && !char.work_start_time) continue;

      const workLoc = char.occupation_location_id ? locationMap[char.occupation_location_id] : null;
      const isOnWorkRoster = workLoc
        ? (workLoc.worker_character_ids || []).includes(char.id)
        : null; // null = location not found

      const hasWorkSchedule = Array.isArray(char.work_days) && char.work_days.length > 0 &&
        char.work_start_time && char.work_end_time;

      const isWorkDayToday = hasWorkSchedule && char.work_days.includes(dowNow);
      const shiftStartMin = toMin(char.work_start_time);
      const shiftEndMin = toMin(char.work_end_time);
      const shiftActiveNow = isWorkDayToday && shiftStartMin !== null && shiftEndMin !== null &&
        (shiftEndMin < shiftStartMin
          ? (nowMin >= shiftStartMin || nowMin < shiftEndMin)
          : (nowMin >= shiftStartMin && nowMin < shiftEndMin));

      const isAtWork = char.resolved_presence_status === 'at_work' || char.resolved_source_reason === 'work_schedule';
      const employment_status = char.employment_status || null;
      const isFiredOrQuit = employment_status === 'fired' || employment_status === 'quit';

      const charReport = {
        character_id: char.id,
        name: char.name,
        occupation_location_id: char.occupation_location_id || null,
        occupation_location_name: workLoc?.name || null,
        work_days: char.work_days || [],
        work_start_time: char.work_start_time || null,
        work_end_time: char.work_end_time || null,
        employment_status,
        is_on_work_roster: isOnWorkRoster,
        has_work_schedule: hasWorkSchedule,
        is_work_day_today: isWorkDayToday,
        shift_active_now: shiftActiveNow,
        is_at_work_in_db: isAtWork,
        resolved_presence: char.resolved_presence_status,
        issues_found: [],
      };

      // ── CHECKS ──────────────────────────────────────────────────────────
      if (isFiredOrQuit && hasWorkSchedule) {
        charReport.issues_found.push({
          type: 'FIRED_STILL_HAS_SCHEDULE',
          severity: 'high',
          detail: `employment_status=${employment_status} but work_days/work_start_time still set. Will keep being routed to work.`,
          fix: 'Clear work_days, work_start_time, work_end_time, occupation_location_id from character.',
        });
      }

      if (isFiredOrQuit && isAtWork) {
        charReport.issues_found.push({
          type: 'FIRED_SHOWING_AT_WORK',
          severity: 'critical',
          detail: `employment_status=${employment_status} but resolved_presence_status=${char.resolved_presence_status}. Character should not be at work.`,
          fix: 'Clear resolved_presence_status to home, update resolved_source_reason.',
        });
      }

      if (char.occupation_location_id && isOnWorkRoster === false) {
        charReport.issues_found.push({
          type: 'NOT_ON_WORK_ROSTER',
          severity: 'medium',
          detail: `Character has occupation_location_id=${char.occupation_location_id} (${workLoc?.name || 'not found'}) but is NOT in location.worker_character_ids. Schedule routing will still fire but no roster proof.`,
          fix: 'Add character to location worker roster or clear occupation_location_id if no longer employed.',
        });
      }

      if (isOnWorkRoster === null && char.occupation_location_id) {
        charReport.issues_found.push({
          type: 'WORK_LOCATION_NOT_FOUND',
          severity: 'medium',
          detail: `occupation_location_id=${char.occupation_location_id} not found in user scope. Character may be routed to a deleted location.`,
          fix: 'Clear or update occupation_location_id.',
        });
      }

      if (isAtWork && !shiftActiveNow && !isFiredOrQuit) {
        charReport.issues_found.push({
          type: 'AT_WORK_OUTSIDE_SHIFT',
          severity: 'medium',
          detail: `Character showing at_work but shift is not active now (work_days=${char.work_days}, shift=${char.work_start_time}–${char.work_end_time}, now=${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2,'0')} ET).`,
          fix: 'Run enforceCharacterLocationPresence to correct presence.',
        });
      }

      if (charReport.issues_found.length > 0) {
        issues.push(charReport);
      } else {
        clean.push({ name: char.name, status: isAtWork ? 'at_work_valid' : 'routing_correct' });
      }
    }

    return Response.json({
      owner_email: user.email,
      et_time: nowET.toISOString(),
      characters_with_work: characters.filter(c => c.occupation_location_id || c.work_start_time).length,
      issues_found: issues.length,
      clean_count: clean.length,
      summary: issues.length > 0
        ? `${issues.length} character(s) have employment routing issues.`
        : 'All employment routing looks correct.',
      problematic_characters: issues,
      clean_characters: clean,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});