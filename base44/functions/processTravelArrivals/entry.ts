/**
 * processTravelArrivals
 *
 * Scheduled every 5 minutes. Checks all active in_transit TravelSession records where ETA has passed.
 *
 * TRAVEL ARRIVAL FAILURE RULE — DESTINATION ENFORCEMENT
 *
 * ETA passed is NOT arrival. ETA passed means ARRIVAL_DUE.
 *
 * This function ONLY sets route_status: "arrival_due" when ETA passes.
 * It NEVER sets route_status: "arrived".
 * "arrived" may only be set by completeTravelArrivalVerified after Character write + read-back proof.
 *
 * PIPELINE:
 *   Stage 1 (this function, asServiceRole):
 *   - Marks route_status = "arrival_due" (NOT "arrived") when ETA passes
 *   - Sets arrival_due = true, arrival_pending_character_write = true, arrival_due_at = now
 *   - Updates progress_percent to 100
 *
 *   Stage 2 (completeTravelArrivalVerified, user-scoped):
 *   - Loads Character via user-scoped RLS
 *   - Writes Character.resolved_current_location_id = destination
 *   - Reads back and verifies
 *   - ONLY THEN sets route_status = "arrived"
 *
 * RULES:
 * - Never modify Character (RLS-blocked for asServiceRole)
 * - Never set route_status: "arrived" directly
 * - Never send character home as fallback
 * - Confined characters (jail/house_arrest) get session cancelled
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled — no user session */ }

    const now = new Date();
    const nowISO = now.toISOString();
    const due = [];
    const errors = [];

    let sessions = [];
    try {
      sessions = await base44.asServiceRole.entities.TravelSession.filter(
        { route_status: 'in_transit' },
        '-created_at',
        100
      );
    } catch (e) {
      return Response.json({ error: `Failed to load sessions: ${e.message}` }, { status: 500 });
    }

    // 2-minute arrival threshold — prevents characters stuck at 96-99% just before ETA
    const ARRIVAL_THRESHOLD_MS = 2 * 60 * 1000;
    const dueSessions = sessions.filter(s => {
      if (!s.estimated_arrival_time) return false;
      const eta = new Date(s.estimated_arrival_time).getTime();
      return eta - now.getTime() <= ARRIVAL_THRESHOLD_MS;
    });

    console.log(`[processTravelArrivals] ${sessions.length} in_transit | ${dueSessions.length} due for arrival_due (threshold: ETA ≤ now+2min)`);

    for (const session of dueSessions) {
      try {
        const charSnap = session.character_snapshot || null;
        const char = charSnap || {
          id:                       session.character_id,
          name:                     session.character_name,
          owner_email:              session.owner_email,
          is_jailed:                false,
          house_arrest_active:      false,
          resolved_presence_status: 'traveling',
          current_home_location_id: session.character_home_location_id || null,
        };

        // Safety guard — do NOT arrive jailed/house_arrest characters
        if (char.is_jailed === true || char.house_arrest_active === true) {
          console.log(`[processTravelArrivals] SKIP ${char.name} — confined (jail/house_arrest)`);
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:   'cancelled',
            blocker_reason: 'character_confined',
          }).catch(() => {});
          continue;
        }

        // Verify destination reference exists before marking arrival_due
        const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
          { id: session.destination_location_id }, null, 1
        ).catch(() => []);
        const destLoc = destLocArr?.[0];

        if (!destLoc) {
          console.warn(`[processTravelArrivals] Destination ${session.destination_location_id} not found — marking arrival_failed`);
          // Log violation immediately — destination reference invalid
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
            route_status_at_violation: 'in_transit',
            failure_type:              'INVALID_DESTINATION_REFERENCE',
            blocker_reason:            `destination_id=${session.destination_location_id} not found in LocationReference`,
            repair_attempted:          false,
            repair_result:             'not_attempted',
            readback_matched_destination: false,
            violation_resolved:        false,
            detected_at:               nowISO,
          }).catch(() => {});

          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:   'arrival_failed',
            blocker_reason: 'INVALID_DESTINATION_REFERENCE',
          }).catch(() => {});
          continue;
        }

        // ── SET arrival_due (NOT "arrived") ─────────────────────────────────
        // Character write will happen in completeTravelArrivalVerified (user-scoped)
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status:               'arrival_due',
          progress_percent:           100,
          arrival_due:                true,
          arrival_pending_character_write: true,
          arrival_due_at:             nowISO,
          last_progress_update:       nowISO,
        });

        due.push({
          session_id:     session.id,
          character_id:   char.id,
          character_name: char.name,
          destination:    destLoc.name,
          owner_email:    session.owner_email,
        });

        console.log(`[processTravelArrivals] ⏰ ARRIVAL_DUE: ${char.name} → ${destLoc.name} | session=${session.id} | Character write delegated to completeTravelArrivalVerified`);

      } catch (e) {
        errors.push({ session_id: session.id, error: e.message });
        console.error(`[processTravelArrivals] Error for session ${session.id}:`, e.message);
      }
    }

    // ── UPDATE PROGRESS for sessions not yet due ──────────────────────────
    const stillTraveling = sessions.filter(s => !dueSessions.find(d => d.id === s.id));
    for (const session of stillTraveling) {
      try {
        if (!session.estimated_departure_time || !session.estimated_arrival_time) continue;
        const start = new Date(session.estimated_departure_time).getTime();
        const end   = new Date(session.estimated_arrival_time).getTime();
        const total = end - start;
        if (total <= 0) continue;
        const elapsed  = now.getTime() - start;
        const progress = Math.min(99, Math.round((elapsed / total) * 100));
        if (Math.abs(progress - (session.progress_percent || 0)) >= 5) {
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            progress_percent:     progress,
            last_progress_update: nowISO,
          }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    return Response.json({
      success: true,
      checked: sessions.length,
      arrival_due_set: due.length,
      arrivals_due: due,
      errors,
      still_traveling: stillTraveling.length,
      timestamp: nowISO,
    });

  } catch (error) {
    console.error('[processTravelArrivals]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});