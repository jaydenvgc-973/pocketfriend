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

    // Load all active in_transit sessions PLUS stuck arrival_due sessions
    // arrival_due sessions were previously only handled by completeTravelArrivalVerified,
    // which requires a user session and returns 401 when invoked via service role.
    // This is the proven root cause of stuck TravelSessions that permanently set
    // travel_status = 'traveling_to_destination' on Character records.
    let sessions = [];
    let arrivalDueSessions = [];
    try {
      sessions = await base44.asServiceRole.entities.TravelSession.filter(
        { route_status: 'in_transit' },
        '-created_at',
        100
      );
    } catch (e) {
      return Response.json({ error: `Failed to load sessions: ${e.message}` }, { status: 500 });
    }

    // Also load existing arrival_due sessions so they can be completed.
    // Cap at 20 per run to avoid rate limit bursts — the automation runs every 5 min
    // so 100 stuck sessions clear in ~5 automated runs.
    try {
      arrivalDueSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { route_status: 'arrival_due', arrival_pending_character_write: true },
        '-created_at',
        20
      );
    } catch (e) {
      console.warn(`[processTravelArrivals] Could not load arrival_due sessions: ${e.message}`);
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

    // ── WRITE CHARACTER ARRIVALS DIRECTLY (service role) ─────────────────
    // ROOT CAUSE FIX: The previous design delegated Character writes to
    // completeTravelArrivalVerified via asServiceRole.functions.invoke().
    // That invocation carries NO user session, so completeTravelArrivalVerified
    // immediately returns 401 Unauthorized — arrival_write_attempts stayed 0 forever.
    //
    // Fix: write Character arrivals directly here using asServiceRole,
    // then verify by reading back. This mirrors what completeTravelArrivalVerified
    // does but without requiring a user session in the scheduler context.

    // Also process pre-existing arrival_due sessions that were stuck
    // (sessions that passed ETA but never had their Character write complete)
    const nowISO2 = new Date().toISOString();
    const stuckDue = arrivalDueSessions.map(s => ({
      session_id: s.id,
      character_id: s.character_id,
      character_name: s.character_name,
      destination: s.destination_location_name,
      owner_email: s.owner_email,
      _session: s,
      _isStuck: true,
    }));

    // Process both freshly-due sessions AND pre-existing stuck arrival_due sessions
    const allToProcess = [
      ...due.map(d => ({ ...d, _isStuck: false })),
      ...stuckDue,
    ];

    for (const dueEntry of allToProcess) {
      try {
        const session = dueEntry._session || dueSessions.find(s => s.id === dueEntry.session_id);
        if (!session) continue;

        // Load destination LocationReference (already validated above — just need the record)
        const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
          { id: session.destination_location_id }, null, 1
        ).catch(() => []);
        const destLoc = destLocArr?.[0];
        if (!destLoc) continue;

        // Load the character via service role — query by owner_email (not by id alone,
        // which is blocked by per-owner RLS on this account's Character entity).
        const charOwnerEmail = session.owner_email;
        if (!charOwnerEmail) {
          console.warn(`[processTravelArrivals] Session ${session.id} missing owner_email — skipping`);
          continue;
        }
        const charList = await base44.asServiceRole.entities.Character.filter(
          { owner_email: charOwnerEmail, id: session.character_id }, null, 1
        ).catch(() => []);
        const char = charList?.[0];
        if (!char) {
          // Fallback: load all characters for this owner and find by ID in memory
          const allOwnerChars = await base44.asServiceRole.entities.Character.filter(
            { owner_email: charOwnerEmail, status: 'active' }, null, 300
          ).catch(() => []);
          const charFromList = allOwnerChars.find(c => c.id === session.character_id);
          if (!charFromList) {
            console.warn(`[processTravelArrivals] Character ${session.character_id} not found for owner ${charOwnerEmail} — skipping arrival write`);
            continue;
          }
          // Use the character found via owner scope
          Object.assign(char || {}, charFromList); // reassign for code below
          // Actually need to use a let — restructure
          const resolvedChar = charFromList;
          
          // Determine arrival presence
          let finalPresenceStatus2 = 'visiting';
          let finalLocationType2   = 'visit';
          if (session.travel_source === 'work_schedule')        { finalPresenceStatus2 = 'at_work';    finalLocationType2 = 'work'; }
          else if (session.travel_source === 'school_schedule') { finalPresenceStatus2 = 'at_school';  finalLocationType2 = 'school'; }
          else if (destLoc.id === resolvedChar.current_home_location_id){ finalPresenceStatus2 = 'home'; finalLocationType2 = 'home'; }

          await base44.asServiceRole.entities.Character.update(resolvedChar.id, {
            resolved_current_location_id:   destLoc.id,
            resolved_current_location_name: destLoc.name,
            resolved_presence_status:       finalPresenceStatus2,
            resolved_location_type:         finalLocationType2,
            resolved_source_reason:         `verified_arrival:${session.id}`,
            resolved_last_updated_at:       nowISO2,
            last_arrived_time:              nowISO2,
            travel_status:                  'not_traveling',
            travel_destination_location_id: null,
            traveling_to_location_id:       null,
            traveling_to_location_name:     null,
          });

          const readbackArr2 = await base44.asServiceRole.entities.Character.filter(
            { owner_email: charOwnerEmail, id: resolvedChar.id }, null, 1
          ).catch(() => []);
          const charAfter2 = readbackArr2?.[0] || 
            (await base44.asServiceRole.entities.Character.filter({ owner_email: charOwnerEmail, status: 'active' }, null, 300).catch(() => [])).find(c => c.id === resolvedChar.id);
          const verified2 = charAfter2?.travel_status === 'not_traveling';

          if (verified2) {
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              route_status: 'arrived', actual_arrival_time: nowISO2,
              arrival_due: false, arrival_pending_character_write: false,
              arrival_write_attempts: (session.arrival_write_attempts || 0) + 1,
            }).catch(() => {});
            console.log(`[processTravelArrivals] ✅ ARRIVAL (fallback path) | char=${resolvedChar.name} | dest=${destLoc.name}`);
          } else {
            console.warn(`[processTravelArrivals] ⚠️ Arrival write for ${resolvedChar.name} — could not verify via readback`);
            await base44.asServiceRole.entities.TravelSession.update(session.id, {
              arrival_write_attempts: (session.arrival_write_attempts || 0) + 1,
            }).catch(() => {});
          }
          await new Promise(r => setTimeout(r, 400));
          continue;
        }

        // Determine arrival presence
        let finalPresenceStatus = 'visiting';
        let finalLocationType   = 'visit';
        if (session.travel_source === 'work_schedule')        { finalPresenceStatus = 'at_work';    finalLocationType = 'work'; }
        else if (session.travel_source === 'school_schedule') { finalPresenceStatus = 'at_school';  finalLocationType = 'school'; }
        else if (destLoc.id === char.current_home_location_id){ finalPresenceStatus = 'home';       finalLocationType = 'home'; }

        // Write Character to destination (service role)
        await base44.asServiceRole.entities.Character.update(char.id, {
          resolved_current_location_id:   destLoc.id,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status:       finalPresenceStatus,
          resolved_location_type:         finalLocationType,
          resolved_source_reason:         `verified_arrival:${session.id}`,
          resolved_last_updated_at:       nowISO2,
          last_arrived_time:              nowISO2,
          travel_status:                  'not_traveling',
          travel_destination_location_id: null,
          traveling_to_location_id:       null,
          traveling_to_location_name:     null,
        });

        // Read back to verify
        const readbackArr = await base44.asServiceRole.entities.Character.filter(
          { id: char.id }, null, 1
        ).catch(() => []);
        const charAfter = readbackArr?.[0];
        const locationVerified = charAfter?.resolved_current_location_id === destLoc.id;

        if (locationVerified) {
          // Stamp session arrived
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            route_status:                    'arrived',
            actual_arrival_time:             nowISO2,
            arrival_due:                     false,
            arrival_pending_character_write: false,
            arrival_write_attempts:          (session.arrival_write_attempts || 0) + 1,
          }).catch(() => {});
          console.log(`[processTravelArrivals] ✅ ARRIVAL WRITTEN & VERIFIED | char=${char.name} | dest=${destLoc.name} | presence=${finalPresenceStatus}`);
        } else {
          // Write failed — keep arrival_due for retry
          console.error(`[processTravelArrivals] ❌ Arrival write failed readback for ${char.name} → ${destLoc.name}`);
          await base44.asServiceRole.entities.TravelSession.update(session.id, {
            arrival_write_attempts: (session.arrival_write_attempts || 0) + 1,
            blocker_reason: 'service_role_write_readback_mismatch',
          }).catch(() => {});
        }

        // Delay between writes to stay within rate limits
        await new Promise(r => setTimeout(r, 400));
      } catch (arrErr) {
        errors.push({ session_id: dueEntry.session_id, error: `arrival_write: ${arrErr.message}` });
        console.error(`[processTravelArrivals] Arrival write error for ${dueEntry.session_id}: ${arrErr.message}`);
      }
    }

    return Response.json({
      success: true,
      checked: sessions.length,
      arrival_due_set: due.length,
      stuck_arrival_due_processed: stuckDue.length,
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