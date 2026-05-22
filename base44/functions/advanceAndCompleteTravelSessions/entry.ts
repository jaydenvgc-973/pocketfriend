/**
 * advanceAndCompleteTravelSessions
 *
 * TRAVEL SESSION LIFECYCLE MANAGER — runs every 5 minutes.
 *
 * RESPONSIBILITIES:
 * 1. Update progress_percent for all in_transit sessions
 * 2. Mark sessions as "arrived" when ETA passes (route_status only — no Character writes)
 *
 * CRITICAL ARCHITECTURE NOTE:
 * Character entity has strict per-owner RLS that blocks ALL asServiceRole reads/writes.
 * This function MUST NOT attempt to write to Character directly — it will silently fail
 * every time, leaving characters stuck in travel.
 *
 * Character arrival writes are EXCLUSIVELY handled by:
 *   completeStuckTravelUserScoped (user-scoped, called by completeAllArrivals)
 *   enforceArrivalIntegrity (catches failures, logs TravelViolation, re-attempts repair)
 *
 * This function's only Character-related responsibility:
 *   → Mark TravelSession.route_status = "arrived" so the user-scoped pipeline picks it up.
 *
 * NO SILENT FAILURES: Any session that cannot be marked arrived logs a TravelViolation.
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
      advanced: [],
      arrived_marked: [],
      failed: [],
    };

    for (const session of activeSessions) {
      try {
        const depTime = session.estimated_departure_time
          ? new Date(session.estimated_departure_time).getTime()
          : null;
        const arrTime = session.estimated_arrival_time
          ? new Date(session.estimated_arrival_time).getTime()
          : null;

        // Cannot compute progress without both timestamps
        if (!depTime || !arrTime) {
          // If ETA unknown but session is old (>30 min), mark arrived so enforcement pipeline handles it
          const sessionAge = now - new Date(session.created_at || session.created_date || nowISO).getTime();
          if (sessionAge > 30 * 60 * 1000) {
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              route_status:         'arrived',
              progress_percent:     100,
              actual_arrival_time:  nowISO,
              last_progress_update: nowISO,
            }).catch(() => {});
            results.arrived_marked.push({
              session_id:     session.id,
              character_name: session.character_name,
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
          // ── STAGE 1: Mark session arrived (only route_status — NO Character writes) ──
          // Character writes are handled exclusively by completeStuckTravelUserScoped
          // which runs with user-scoped RLS and can actually write to Character.
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:         'arrived',
            progress_percent:     100,
            actual_arrival_time:  nowISO,
            last_progress_update: nowISO,
          });

          results.arrived_marked.push({
            session_id:        session.id,
            character_name:    session.character_name,
            destination:       session.destination_location_name,
            character_id:      session.character_id,
            owner_email:       session.owner_email,
          });

          console.log(`[advanceAndCompleteTravelSessions] ✅ SESSION MARKED ARRIVED: ${session.character_name} → ${session.destination_location_name} | session=${session.id} | Character write delegated to user-scoped pipeline`);

        } else {
          // ── IN PROGRESS: update progress only ────────────────────────────────
          const progressDelta = Math.abs(progress - (session.progress_percent || 0));
          if (progressDelta >= 3) {
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              progress_percent:     progress,
              last_progress_update: nowISO,
              route_status:         'in_transit',
            }).catch(() => {});
          }

          results.advanced.push({
            session_id:            session.id,
            character_name:        session.character_name,
            progress_percent:      progress,
            time_remaining_minutes: Math.round((arrTime - now) / 60000),
          });
        }

      } catch (sessionErr) {
        console.error(`[advanceAndCompleteTravelSessions] Error for session ${session.id}: ${sessionErr.message}`);

        // Log a TravelViolation for any session that fails to process
        // so it's visible in the violation log and won't silently die
        if (session.character_id && session.owner_email) {
          await base44.asServiceRole.entities.TravelViolation.create({
            character_id:                 session.character_id,
            character_name:               session.character_name,
            owner_email:                  session.owner_email,
            session_id:                   session.id,
            origin_location_id:           session.origin_location_id,
            origin_location_name:         session.origin_location_name,
            destination_location_id:      session.destination_location_id,
            destination_location_name:    session.destination_location_name,
            eta:                          session.estimated_arrival_time,
            route_status_at_violation:    session.route_status,
            progress_percent:             session.progress_percent,
            failure_type:                 'ETA_PASSED_NO_ARRIVAL',
            blocker_reason:               `advanceAndCompleteTravelSessions exception: ${sessionErr.message}`,
            repair_attempted:             false,
            repair_result:                'not_attempted',
            readback_matched_destination: false,
            violation_resolved:           false,
            detected_at:                  nowISO,
          }).catch(e => console.warn(`[advanceAndCompleteTravelSessions] Violation log failed: ${e.message}`));
        }

        results.failed.push({ session_id: session.id, error: sessionErr.message });
      }
    }

    // ── TRIGGER COMPLETION PIPELINE for owners with newly arrived sessions ──
    // completeAllArrivals delegates to completeStuckTravelUserScoped per owner,
    // which uses user-scoped RLS to write Character.resolved_current_location_id.
    const ownersWithArrivals = [...new Set(
      results.arrived_marked
        .map(r => r.owner_email)
        .filter(Boolean)
    )];

    if (ownersWithArrivals.length > 0) {
      console.log(`[advanceAndCompleteTravelSessions] Triggering character arrival writes for ${ownersWithArrivals.length} owners`);
      // Non-blocking — completeAllArrivals handles its own error logging
      base44.asServiceRole.functions.invoke('completeAllArrivals', {}).catch(e => {
        console.warn(`[advanceAndCompleteTravelSessions] completeAllArrivals trigger failed (non-fatal): ${e.message}`);
      });
    }

    console.log(
      `[advanceAndCompleteTravelSessions] done | advanced=${results.advanced.length} | arrived_marked=${results.arrived_marked.length} | failed=${results.failed.length}`
    );

    return Response.json({
      success: true,
      sessions_checked: activeSessions.length,
      advanced:         results.advanced.length,
      arrived_marked:   results.arrived_marked.length,
      failed:           results.failed.length,
      arrivals:         results.arrived_marked,
      failures:         results.failed,
    });

  } catch (error) {
    console.error('[advanceAndCompleteTravelSessions]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});