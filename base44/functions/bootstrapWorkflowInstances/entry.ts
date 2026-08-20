import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ONE-TIME WORKFLOW BOOTSTRAP
 *
 * After configuring the Dashboard Workflows, existing characters/sessions whose
 * authoritative schedule/alarm/sleep/session data was already in place before the
 * Workflows were enabled will never fire an entity trigger merely because migration
 * occurred. This function performs a one-time initialization: it evaluates every
 * existing authoritative record and makes a minimal no-op update to the entity field
 * each Workflow watches, so the platform fires the entity trigger and starts the
 * initial Workflow instance.
 *
 * This is NOT an ongoing system. It runs once after Workflow configuration and then
 * the normal entity triggers maintain all future instances.
 *
 * It does NOT execute transitions, invent new state, or create polling. It only
 * touches existing fields with their current values to fire triggers.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const results = { work: 0, school: 0, sleep: 0, alarm: 0, gathering_room: 0, errors: [] };

    // ── 1. WORK: touch work schedule fields for every active character with a job ──
    const allChars = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active'
    }, null, 500);

    for (const char of allChars) {
      const hasWork = (char.occupation_location_id || char.current_work_location_id ||
        char.work_details?.is_rabbit_hole ||
        (Array.isArray(char.additional_occupation_locations) && char.additional_occupation_locations.length > 0)) &&
        char.work_start_time && char.work_end_time;

      if (hasWork) {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, {
            work_details: char.work_details || {},
          });
          results.work++;
        } catch (e) {
          results.errors.push(`work:${char.name}: ${e.message}`);
        }
      }

      // ── 2. SCHOOL: touch enrollment fields for enrolled students ──
      if (char.student_status === 'enrolled' && (char.education_location_id || char.current_school_location_id)) {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, {
            education_enrollments: char.education_enrollments || [],
          });
          results.school++;
        } catch (e) {
          results.errors.push(`school:${char.name}: ${e.message}`);
        }
      }

      // ── 3. SLEEP: touch presence status for currently sleeping characters ──
      if (char.resolved_presence_status === 'sleeping') {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_presence_status: 'sleeping',
          });
          results.sleep++;
        } catch (e) {
          results.errors.push(`sleep:${char.name}: ${e.message}`);
        }
      }

      // ── 4. ALARM: touch pending_alarm_time for characters with a pending alarm ──
      if (char.pending_alarm_time) {
        try {
          await base44.asServiceRole.entities.Character.update(char.id, {
            pending_alarm_time: char.pending_alarm_time,
          });
          results.alarm++;
        } catch (e) {
          results.errors.push(`alarm:${char.name}: ${e.message}`);
        }
      }
    }

    // ── 5. GATHERING ROOM: touch expires_at for active sessions ──
    const activeSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter({
      status: 'active'
    }, null, 100);

    for (const sess of activeSessions) {
      try {
        await base44.asServiceRole.entities.GatheringRoomSession.update(sess.id, {
          expires_at: sess.expires_at,
        });
        results.gathering_room++;
      } catch (e) {
        results.errors.push(`gathering_room:${sess.id}: ${e.message}`);
      }
    }

    return Response.json({
      success: true,
      bootstrap_complete: true,
      ...results,
      note: 'One-time initialization. Entity triggers fired for existing records. Normal triggers now maintain future instances.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});