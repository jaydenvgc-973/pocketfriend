import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── GLOBAL REPAIR: Pass-Out State Corruption + False Work Records ──────────
// This function repairs two related corruption patterns:
//
// 1. PASS-OUT STATE CORRUPTION: Characters with presence_stay_lock_reason='pass_out_recovery'
//    whose resolved_presence_status was externally cleared to 'home' by a non-canonical
//    writer (scheduledLocationEnforcement, returnActiveCharactersHome, etc.).
//    The canonical recovery path never ran → no pass_out_end transition, no last_wake_time reset.
//    Repair: If energy > 35 → canonical release (pass_out_end + last_wake_time reset + clear stay lock).
//            If energy ≤ 35 → restore resolved_presence_status to 'passed_out' (the stay lock
//            proves the character is still in recovery).
//
// 2. FALSE WORK RECORDS: LocationHistory entries with event_type='work_start' on non-work days.
//    Repair: Delete work_start LocationHistory records where the arrival_time falls on a non-work day.
//
// All times are Eastern. UTC is infrastructure only.

function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isOnWorkSchedule(character, etTime) {
  if (!character.work_start_time || !character.work_end_time || !Array.isArray(character.work_days)) return false;
  const dayOfWeek = etTime.getDay();
  if (!character.work_days.includes(dayOfWeek)) return false;
  const now = etTime.getHours() * 60 + etTime.getMinutes();
  const [sh, sm] = character.work_start_time.split(':').map(Number);
  const [eh, em] = character.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) {
    // Overnight shift — check yesterday too
    const yesterday = (dayOfWeek + 6) % 7;
    return (now >= startMin) || (now < endMin && character.work_days.includes(yesterday));
  }
  return now >= startMin && now < endMin;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = getNowET();
    const nowIso = new Date().toISOString();

    // Load all active_created_characters
    const allChars = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active'
    });

    const repairs = {
      pass_out_repaired: 0,
      pass_out_restored: 0,
      false_work_history_deleted: 0,
      false_work_lifeevents_deleted: 0,
      details: [],
    };

    for (const char of allChars) {
      if (!char.owner_email) continue;

      const hasPassOutLock = char.presence_stay_lock === true &&
        char.presence_stay_lock_reason === 'pass_out_recovery';
      const statusMismatch = char.resolved_presence_status !== 'passed_out' && hasPassOutLock;

      // ── PASS-OUT REPAIR ──────────────────────────────────────────────
      if (statusMismatch) {
        const energy = char.energy_value ?? 75;
        const passOutStart = char.last_pass_out_at;

        if (energy > 35 || !passOutStart) {
          // Canonical release: energy > 35 OR no pass_out_at timestamp
          const updatePayload = {
            resolved_presence_status: 'home',
            current_activity: '',
            last_wake_time: nowIso,
            presence_stay_lock: false,
            presence_stay_lock_reason: null,
            presence_stay_lock_release_condition: null,
            presence_stay_lock_authority: null,
            presence_stay_lock_set_at: null,
            presence_stay_lock_created_by: null,
            presence_stay_lock_expires_at: null,
            presence_stay_lock_location_id: null,
            resolved_source_reason: 'pass_out_recovery_canonical_release',
            resolved_last_updated_at: nowIso,
          };
          await base44.asServiceRole.entities.Character.update(char.id, updatePayload);

          // Write the canonical pass_out_end transition
          try {
            await base44.asServiceRole.entities.SleepTransition.create({
              character_id: char.id,
              character_name: char.name,
              owner_email: char.owner_email,
              transition_type: 'pass_out_end',
              from_status: 'passed_out',
              to_status: 'home',
              authority: 'pass_out_canonical_recovery_repair',
              reason: `Canonical pass-out release during repair. Energy=${energy}. state_start_ref=${passOutStart || 'null'}.`,
              timestamp: nowIso,
              state_start_ref: passOutStart || null,
            });
          } catch (e) {
            // Non-fatal — the Character state is already corrected
          }

          repairs.pass_out_repaired++;
          repairs.details.push({
            character: char.name,
            repair: 'pass_out_canonical_release',
            energy: energy,
            pass_out_at: passOutStart,
          });
        } else {
          // Energy ≤ 35 — restore to passed_out (the stay lock proves recovery is ongoing)
          await base44.asServiceRole.entities.Character.update(char.id, {
            resolved_presence_status: 'passed_out',
            resolved_source_reason: 'pass_out_recovery_restored',
            resolved_last_updated_at: nowIso,
          });

          repairs.pass_out_restored++;
          repairs.details.push({
            character: char.name,
            repair: 'pass_out_restored',
            energy: energy,
          });
        }
      }

      // ── FALSE WORK LOCATION HISTORY CLEANUP ─────────────────────────
      // Delete work_start LocationHistory records on non-work days
      if (char.work_days && Array.isArray(char.work_days) && char.work_days.length > 0) {
        const locHistory = await base44.asServiceRole.entities.LocationHistory.filter(
          { character_id: char.id, owner_email: char.owner_email, event_type: 'work_start' },
          '-arrival_time', 30
        );

        for (const rec of locHistory) {
          if (!rec.arrival_time) continue;
          const arrivalET = new Date(new Date(rec.arrival_time).toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const arrivalDay = arrivalET.getDay();

          // Check if this is a non-work day
          if (!char.work_days.includes(arrivalDay)) {
            // Also check if the location is NOT the character's occupation location
            // (work_start at a non-occupation location on a non-work day is definitely false)
            const isOccupationLoc = rec.location_id === char.occupation_location_id;
            if (!isOccupationLoc) {
              await base44.asServiceRole.entities.LocationHistory.delete(rec.id);
              repairs.false_work_history_deleted++;
              repairs.details.push({
                character: char.name,
                repair: 'false_work_history_deleted',
                record_id: rec.id,
                location_name: rec.location_name,
                arrival: rec.arrival_time,
                day_of_week: arrivalDay,
              });
            }
          }
        }
      }
    }

    return Response.json({
      success: true,
      timestamp: nowIso,
      total_characters_scanned: allChars.length,
      ...repairs,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});