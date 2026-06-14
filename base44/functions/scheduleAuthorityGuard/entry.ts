import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * scheduleAuthorityGuard — HARD AUTHORITY RULE
 *
 * This function enforces the separation of concerns between temporary state
 * (presence, travel, events) and authoritative data (employment, enrollment).
 * It audits for and repairs any instance where a transient state conflict
 * has incorrectly cleared a character's job or school assignment.
 *
 * A character being somewhere else does NOT mean they are unemployed or unenrolled.
 */

const PROTECTED_WORK_FIELDS = [
  'occupation_location_id', 'current_work_location_id', 'additional_occupation_locations',
  'occupation', 'job_title', 'work_start_time', 'work_end_time', 'work_days'
];

const PROTECTED_SCHOOL_FIELDS = [
  'education_location_id', 'school_status', 'student_status', 'education_enrollments'
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = true, owner_email = user.email } = await req.json().catch(() => ({}));

    const report = {
      timestamp: new Date().toISOString(),
      owner_email,
      dry_run,
      violations: [],
      repairs: [],
    };

    // ── LOAD DATA ──────────────────────────────────────────────────────────
    const characters = await base44.asServiceRole.entities.Character.filter({ owner_email, status: 'active' }, null, 300);
    const locations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email }, null, 500);
    const locationMap = new Map(locations.map(l => [l.id, l]));

    // ── AUDIT LOOP ─────────────────────────────────────────────────────────
    for (const char of characters) {
      // WORK-ROSTER MISMATCH
      if (!char.occupation_location_id) {
        for (const loc of locations) {
          if ((loc.worker_character_ids || []).includes(char.id)) {
            report.violations.push({
              type: 'WORK_ROSTER_MISMATCH',
              character_id: char.id, character_name: char.name,
              detail: `On roster for ${loc.name} but has no occupation_location_id.`,
            });
            if (!dry_run) {
              await base44.asServiceRole.entities.Character.update(char.id, { occupation_location_id: loc.id });
              report.repairs.push({ character_name: char.name, action: 'RESTORE_WORK_LINK', workplace: loc.name });
            }
          }
        }
      }

      // SCHOOL-ROSTER MISMATCH
      if (char.student_status === 'enrolled' && !char.education_location_id) {
        for (const loc of locations) {
          if ((loc.enrolled_students || []).some(s => s.character_id === char.id)) {
            report.violations.push({
              type: 'SCHOOL_ROSTER_MISMATCH',
              character_id: char.id, character_name: char.name,
              detail: `Enrolled at ${loc.name} but has no education_location_id.`,
            });
            if (!dry_run) {
              await base44.asServiceRole.entities.Character.update(char.id, { education_location_id: loc.id });
              report.repairs.push({ character_name: char.name, action: 'RESTORE_SCHOOL_LINK', school: loc.name });
            }
          }
        }
      }
      
      // INVALID PRESENCE LOCK
      if (char.presence_stay_lock && (char.occupation_location_id || char.education_location_id)) {
          report.violations.push({
              type: 'INVALID_PRESENCE_LOCK',
              character_id: char.id, character_name: char.name,
              detail: 'presence_stay_lock=true while having active employment/enrollment.'
          });
          if(!dry_run) {
              await base44.asServiceRole.entities.Character.update(char.id, { presence_stay_lock: false, presence_stay_lock_location_id: null, presence_stay_lock_set_at: null });
              report.repairs.push({ character_name: char.name, action: 'CLEARED_INVALID_STAY_LOCK' });
          }
      }
    }

    return Response.json(report);

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});