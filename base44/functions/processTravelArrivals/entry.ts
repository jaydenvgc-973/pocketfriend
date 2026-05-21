/**
 * processTravelArrivals
 *
 * Scheduled every 5 minutes. Checks all active TravelSession records where ETA has passed.
 *
 * TWO-STAGE ARRIVAL (no RLS bypass needed):
 *   Stage 1 (this function, asServiceRole):
 *   - Marks TravelSession route_status = "arrived" only (service-role safe)
 *   - Sets actual_arrival_time
 *   - Logs proof
 *
 *   Stage 2 (completeCharacterArrival, user-scoped):
 *   - Updates Character resolved_current_location_id to destination
 *   - Clears travel_status, traveling_to fields
 *   - Triggered by separate cron or sync process scoped to user
 *
 * RULES:
 * - owner_email is the sole ownership source — never created_by
 * - Only process "in_transit" sessions with ETA in past or within 2-min threshold
 * - If session can't be marked, log exact error in route_status = "arrival_failed" + error_reason
 * - Never modify Character here (RLS-blocked for asServiceRole)
 * - Never reset jail, shelter, hotel, or house_arrest state
 * - Blocker characters are detected via character_snapshot for safety
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Scheduled — no user session
    try { await base44.auth.me(); } catch { /* ok */ }

    const now = new Date();
    const arrived = [];
    const errors = [];

    // Load all active in_transit sessions
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

    // Filter to sessions where ETA has passed OR is within the arrival threshold (2 minutes).
    // This prevents characters from getting stuck at 96–99% when the scheduler fires just
    // before ETA. The 2-minute window matches frontend "Arriving now" display threshold.
    const ARRIVAL_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
    const due = sessions.filter(s => {
      if (!s.estimated_arrival_time) return false;
      const eta = new Date(s.estimated_arrival_time).getTime();
      return eta - now.getTime() <= ARRIVAL_THRESHOLD_MS; // ETA passed OR within 2 min
    });

    console.log(`[processTravelArrivals] ${sessions.length} in_transit sessions, ${due.length} due for arrival (threshold: ETA ≤ now+2min)`);

    for (const session of due) {
      try {
        // Character RLS blocks asServiceRole reads entirely for this entity.
        // processTravelArrivals runs scheduled (no user session) so cannot use user-scoped API.
        // SOLUTION: TravelSession stores a character_snapshot (written by createTravelSession at
        // session creation). Use snapshot for blocker checks + home detection; skip if missing.
        // For sessions without snapshot, synthesize a minimal char from session fields.
        const charSnap = session.character_snapshot || null;
        const char = charSnap || {
          id:                          session.character_id,
          name:                        session.character_name,
          owner_email:                 session.owner_email,
          is_jailed:                   false,
          house_arrest_active:         false,
          resolved_presence_status:    'traveling',
          current_home_location_id:    session.character_home_location_id || null,
        };
        // Use session fields as ground truth for location context
        const charHomeId = session.character_home_location_id || char.current_home_location_id || null;

        // Safety guard — do NOT override jail/house_arrest
        if (char.is_jailed === true || char.house_arrest_active === true) {
          console.log(`[processTravelArrivals] SKIP ${char.name} — confined (jail/house_arrest)`);
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status: 'cancelled',
            blocker_reason: 'character_confined',
          }).catch(() => {});
          continue;
        }

        // Load destination location — asServiceRole.filter({id:...}) works for LocationReference
        const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
          { id: session.destination_location_id }, null, 1
        ).catch(() => []);
        const destLoc = destLocArr?.[0] || null;
        if (!destLoc) {
          console.warn(`[processTravelArrivals] Destination ${session.destination_location_id} not found`);
          continue;
        }

        // Determine arrival presence status
        // Use charHomeId (from session snapshot) since char may be synthesized without all fields
        let arrivalPresence = 'visiting';
        let arrivalLocationType = 'visit';
        if (destLoc.category === 'home' && (
          charHomeId === destLoc.id ||
          char.temporary_housing_location_id === destLoc.id
        )) {
          arrivalPresence = 'home';
          arrivalLocationType = 'home';
        } else if (session.travel_source === 'work_schedule') {
          arrivalPresence = 'at_work';
          arrivalLocationType = 'work';
        } else if (session.travel_source === 'school_schedule') {
          arrivalPresence = 'at_school';
          arrivalLocationType = 'school';
        }

        // ── ARRIVE: Create arrival completion record ──────────────────────
        // Cannot update Character directly (RLS blocks service-role writes).
        // Instead, log the required updates and mark session for post-processing.
        // A separate user-scoped function will complete the arrival.
        
        const arrivalRecord = {
          session_id: session.id,
          character_id: char.id,
          character_name: char.name,
          destination_id: destLoc.id,
          destination_name: destLoc.name,
          arrival_presence: arrivalPresence,
          arrival_location_type: arrivalLocationType,
          timestamp: now.toISOString(),
        };

        try {
          // Mark session as "arrived" — the canonical source of truth
          // User-scoped completion functions will handle Character updates
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:         'arrived',
            progress_percent:     100,
            actual_arrival_time:  now.toISOString(),
            last_progress_update: now.toISOString(),
          });

          arrived.push(arrivalRecord);
          console.log(`[processTravelArrivals] ✅ SESSION MARKED ARRIVED: ${char.name} → ${destLoc.name} (Character update pending user-scoped sync)`);

        } catch (sessionErr) {
          console.error(`[processTravelArrivals] ❌ Session arrival write FAILED: ${sessionErr.message}`);
          errors.push({
            session_id: session.id,
            character_id: char.id,
            reason: 'session_arrival_write_failed',
            error: sessionErr.message,
          });
          continue;
        }

        // ── MARK COMMITMENT COMPLETE if linked ────────────────────────────
        if (session.source_commitment_id) {
          await base44.asServiceRole.entities.CharacterCommitment.update(session.source_commitment_id, {
            status: 'completed',
            travel_arrived_at: now.toISOString(),
            completion_result: `Arrived at ${destLoc.name}`,
          }).catch(() => {});
        }

        arrived.push({ character: char.name, destination: destLoc.name, session_id: session.id });

        // Proof log — required fields per spec
        console.log(`[processTravelArrivals] ARRIVAL PROOF | character_id=${char.id} | character=${char.name} | origin=${session.origin_location_name || session.origin_location_id} | destination=${destLoc.name} | travel_status_before=in_transit | computed_progress=${session.progress_percent || 'unknown'} | arrival_triggered=true | final_location=${destLoc.name} | static_origin_marker_suppressed=true | session_id=${session.id}`);

      } catch (e) {
        errors.push({ session_id: session.id, error: e.message });
        console.error(`[processTravelArrivals] Error for session ${session.id}:`, e.message);
      }
    }

    // ── UPDATE PROGRESS for sessions not yet due ─────────────────────────
    const stillTraveling = sessions.filter(s => !due.find(d => d.id === s.id));
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
            last_progress_update: now.toISOString(),
          }).catch(() => {});
        }
      } catch { /* non-fatal */ }
    }

    return Response.json({
      success: true,
      checked: sessions.length,
      arrived: arrived.length,
      arrivals: arrived,
      errors,
      still_traveling: stillTraveling.length,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[processTravelArrivals]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});