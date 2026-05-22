/**
 * advanceAndCompleteTravelSessions
 *
 * TRAVEL SESSION LIFECYCLE MANAGER — runs every 5 minutes.
 *
 * TRAVEL ARRIVAL FAILURE RULE — DESTINATION ENFORCEMENT
 *
 * ETA passed is NOT arrival. ETA passed means ARRIVAL_DUE.
 * This function NEVER sets route_status: "arrived".
 *
 * RESPONSIBILITIES:
 * 1. Update progress_percent for all in_transit sessions
 * 2. Set route_status: "arrival_due" (NOT "arrived") when ETA passes
 * 3. Trigger completeTravelArrivalVerified for owners with arrival_due sessions
 *
 * CRITICAL ARCHITECTURE:
 * Character entity has per-owner RLS that blocks ALL asServiceRole reads/writes.
 * This function MUST NOT attempt to write to Character — it will fail silently.
 *
 * Character arrival writes are EXCLUSIVELY handled by:
 *   completeTravelArrivalVerified — the ONLY function that may set route_status: "arrived"
 *
 * NO SILENT FAILURES: Any session that cannot be processed logs a TravelViolation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = Date.now();
    const nowISO = new Date(now).toISOString();

    // Load all active sessions (preparing + in_transit)
    const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: { $in: ['preparing', 'in_transit'] } },
      '-created_at',
      500
    ).catch(() => []);

    const results = {
      advanced:      [],
      arrival_due:   [],
      failed:        [],
    };

    for (const session of activeSessions) {
      try {
        const depTime = session.estimated_departure_time
          ? new Date(session.estimated_departure_time).getTime()
          : null;
        const arrTime = session.estimated_arrival_time
          ? new Date(session.estimated_arrival_time).getTime()
          : null;

        // No timestamps — if session is old (>30 min), mark arrival_due for pickup
        if (!depTime || !arrTime) {
          const sessionAge = now - new Date(session.created_at || session.created_date || nowISO).getTime();
          if (sessionAge > 30 * 60 * 1000) {
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              route_status:               'arrival_due',
              progress_percent:           100,
              arrival_due:                true,
              arrival_pending_character_write: true,
              arrival_due_at:             nowISO,
              last_progress_update:       nowISO,
            }).catch(() => {});
            results.arrival_due.push({
              session_id:     session.id,
              character_name: session.character_name,
              owner_email:    session.owner_email,
              reason:         'missing_timestamps_session_age_30min',
            });
          }
          continue;
        }

        const totalMs   = arrTime - depTime;
        const elapsedMs = now - depTime;
        const progress  = totalMs > 0
          ? Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)))
          : 100;

        const etaPassed = now >= arrTime;

        if (etaPassed) {
          // ── SET arrival_due (NEVER "arrived") ────────────────────────────
          // Character write happens exclusively in completeTravelArrivalVerified
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:               'arrival_due',
            progress_percent:           100,
            arrival_due:                true,
            arrival_pending_character_write: true,
            arrival_due_at:             nowISO,
            last_progress_update:       nowISO,
          });

          results.arrival_due.push({
            session_id:     session.id,
            character_name: session.character_name,
            destination:    session.destination_location_name,
            character_id:   session.character_id,
            owner_email:    session.owner_email,
          });

          console.log(`[advanceAndCompleteTravelSessions] ⏰ ARRIVAL_DUE: ${session.character_name} → ${session.destination_location_name} | session=${session.id}`);

        } else {
          // ── IN PROGRESS: update progress_percent only ─────────────────────
          const progressDelta = Math.abs(progress - (session.progress_percent || 0));
          if (progressDelta >= 3) {
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              progress_percent:     progress,
              last_progress_update: nowISO,
              route_status:         'in_transit',
            }).catch(() => {});
          }

          results.advanced.push({
            session_id:             session.id,
            character_name:         session.character_name,
            progress_percent:       progress,
            time_remaining_minutes: Math.round((arrTime - now) / 60000),
          });
        }

      } catch (sessionErr) {
        console.error(`[advanceAndCompleteTravelSessions] Error for session ${session.id}: ${sessionErr.message}`);

        // Log a TravelViolation for any session that throws
        if (session.character_id && session.owner_email) {
          await base44.asServiceRole.entities.TravelViolation.create({
            character_id:              session.character_id,
            character_name:            session.character_name,
            owner_email:               session.owner_email,
            session_id:                session.id,
            origin_location_id:        session.origin_location_id,
            origin_location_name:      session.origin_location_name,
            destination_location_id:   session.destination_location_id,
            destination_location_name: session.destination_location_name,
            eta:                       session.estimated_arrival_time,
            route_status_at_violation: session.route_status,
            progress_percent:          session.progress_percent,
            failure_type:              'ETA_PASSED_NO_ARRIVAL',
            blocker_reason:            `advanceAndCompleteTravelSessions exception: ${sessionErr.message}`,
            repair_attempted:          false,
            repair_result:             'not_attempted',
            readback_matched_destination: false,
            violation_resolved:        false,
            detected_at:               nowISO,
          }).catch(e => console.warn(`[advanceAndCompleteTravelSessions] Violation log failed: ${e.message}`));
        }

        results.failed.push({ session_id: session.id, error: sessionErr.message });
      }
    }

    // ── TRIGGER completeTravelArrivalVerified for owners with arrival_due ──
    const ownersWithDue = [...new Set(
      results.arrival_due.map(r => r.owner_email).filter(Boolean)
    )];
    if (ownersWithDue.length > 0) {
      console.log(`[advanceAndCompleteTravelSessions] Triggering completeTravelArrivalVerified for ${ownersWithDue.length} owners`);
      base44.asServiceRole.functions.invoke('completeTravelArrivalVerified', {}).catch(e => {
        console.warn(`[advanceAndCompleteTravelSessions] completeTravelArrivalVerified trigger failed (non-fatal): ${e.message}`);
      });
    }

    console.log(
      `[advanceAndCompleteTravelSessions] done | advanced=${results.advanced.length} | arrival_due=${results.arrival_due.length} | failed=${results.failed.length}`
    );

    return Response.json({
      success: true,
      sessions_checked: activeSessions.length,
      advanced:         results.advanced.length,
      arrival_due:      results.arrival_due.length,
      failed:           results.failed.length,
      arrival_due_sessions: results.arrival_due,
      failures:         results.failed,
    });

  } catch (error) {
    console.error('[advanceAndCompleteTravelSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});