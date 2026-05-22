/**
 * completeTravelArrivalVerified
 *
 * THE ONLY FUNCTION THAT MAY SET route_status: "arrived"
 *
 * TRAVEL ARRIVAL FAILURE RULE — DESTINATION ENFORCEMENT
 *
 * ETA passed is NOT arrival. ETA passed means arrival_due.
 * Arrival is ONLY complete when:
 *   Character.resolved_current_location_id === TravelSession.destination_location_id
 *   confirmed by read-back AFTER the Character write.
 *
 * This function:
 *   1. Accepts a session in route_status: "arrival_due"
 *   2. Loads destination LocationReference
 *   3. Loads Character via user-scoped RLS (the ONLY valid path)
 *   4. Writes Character to destination (resolved_current_location_id + presence)
 *   5. Clears travel flags ONLY after successful write
 *   6. Reads Character back
 *   7. Verifies resolved_current_location_id === destination_location_id
 *   8. ONLY THEN sets route_status: "arrived" and actual_arrival_time
 *
 * If verification fails:
 *   - Does NOT set "arrived"
 *   - Does NOT clear travel overlay
 *   - Does NOT send character home
 *   - Sets route_status: "arrival_failed"
 *   - Writes blocker_reason
 *   - Logs TravelViolation with AI ACCOUNTABILITY VIOLATION header
 *
 * Called by:
 *   - completeAllArrivals (for arrival_due sessions)
 *   - completeStuckTravelUserScoped (user-scoped repair path)
 *   - enforceArrivalIntegrity (enforcement pass)
 *   - InTransitPanel (frontend overdue detection)
 *
 * NO OTHER CODE PATH MAY DIRECTLY SET route_status: "arrived"
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized — user-scoped auth required' }, { status: 401 });
    }

    const ownerEmail = user.email;
    const body = await req.json().catch(() => ({}));
    const { session_id } = body;

    const now = new Date();
    const nowISO = now.toISOString();

    // ── Load sessions to process ────────────────────────────────────────────
    // If session_id provided: process that one. Otherwise: process all arrival_due for this owner.
    let sessionsToProcess = [];

    if (session_id) {
      const arr = await base44.asServiceRole.entities.TravelSession.filter(
        { id: session_id }, null, 1
      ).catch(() => []);
      sessionsToProcess = arr.filter(Boolean);
    } else {
      // Load all arrival_due sessions for this owner
      const dueSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { owner_email: ownerEmail, route_status: 'arrival_due' },
        '-updated_date',
        50
      ).catch(() => []);
      sessionsToProcess = dueSessions;

      // Also pick up any lingering "arrived" sessions where Character write may not have happened
      const oldArrived = await base44.asServiceRole.entities.TravelSession.filter(
        { owner_email: ownerEmail, route_status: 'arrived' },
        '-updated_date',
        50
      ).catch(() => []);
      // Only re-process arrived sessions that are missing actual_arrival_time or are recent
      const recentArrived = oldArrived.filter(s => {
        if (!s.actual_arrival_time) return true; // never had arrival confirmed
        const age = now.getTime() - new Date(s.actual_arrival_time).getTime();
        return age < 5 * 60 * 1000; // within last 5 minutes — may still need Character write
      });
      sessionsToProcess = [...sessionsToProcess, ...recentArrived];
    }

    console.log(`[completeTravelArrivalVerified] Processing ${sessionsToProcess.length} sessions for ${ownerEmail}`);

    if (sessionsToProcess.length === 0) {
      return Response.json({
        success: true,
        message: 'No arrival_due sessions to process',
        results: [],
        owner_email: ownerEmail,
      });
    }

    // ── Load all characters for this owner (user-scoped — the only valid path) ──
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);

    console.log(`[completeTravelArrivalVerified] Loaded ${allChars.length} characters`);

    const results = [];

    for (const session of sessionsToProcess) {
      const char = allChars.find(c => c.id === session.character_id);

      // Track write attempt count
      const attemptCount = (session.arrival_write_attempts || 0) + 1;

      // ── GUARD: already at destination? ────────────────────────────────────
      if (char && char.resolved_current_location_id === session.destination_location_id && char.travel_status === 'not_traveling') {
        // Character is already at destination and travel is cleared — just stamp session
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status:               'arrived',
          actual_arrival_time:        session.actual_arrival_time || nowISO,
          arrival_due:                false,
          arrival_pending_character_write: false,
          arrival_write_attempts:     attemptCount,
        }).catch(() => {});
        results.push({
          session_id:         session.id,
          character_name:     session.character_name,
          destination:        session.destination_location_name,
          outcome:            'already_at_destination',
          arrived_set:        true,
          readback_verified:  true,
        });
        console.log(`[completeTravelArrivalVerified] ✅ ${session.character_name} already at ${session.destination_location_name} — stamped arrived`);
        continue;
      }

      // ── Load destination LocationReference ────────────────────────────────
      const destArr = await base44.asServiceRole.entities.LocationReference.filter(
        { id: session.destination_location_id }, null, 1
      ).catch(() => []);
      const destLoc = destArr?.[0];

      if (!destLoc) {
        // VIOLATION: INVALID_DESTINATION_REFERENCE
        await _logViolation(base44, {
          session,
          char,
          ownerEmail,
          failureType: 'INVALID_DESTINATION_REFERENCE',
          blockerReason: `destination_location_id=${session.destination_location_id} not found in LocationReference`,
          repairResult: 'failed',
          repairDetail: 'Destination location record does not exist — cannot complete arrival',
          finalLocationId: char?.resolved_current_location_id || null,
          finalLocationName: char?.resolved_current_location_name || null,
          readbackMatched: false,
          resolved: false,
          nowISO,
        });

        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status:   'arrival_failed',
          blocker_reason: `INVALID_DESTINATION_REFERENCE: dest_id=${session.destination_location_id} not found`,
          arrival_due:    false,
          arrival_write_attempts: attemptCount,
        }).catch(() => {});

        results.push({
          session_id: session.id, character_name: session.character_name,
          outcome: 'INVALID_DESTINATION_REFERENCE', arrived_set: false, readback_verified: false,
        });
        continue;
      }

      // ── Character not found via user-scoped query ─────────────────────────
      if (!char) {
        console.warn(`[completeTravelArrivalVerified] Character ${session.character_id} not found for owner ${ownerEmail}`);
        // May be a different owner's session — skip, don't fail
        results.push({
          session_id: session.id, character_name: session.character_name,
          outcome: 'character_not_found_for_owner', arrived_set: false, readback_verified: false,
        });
        continue;
      }

      // ── Determine arrival presence ────────────────────────────────────────
      let finalPresenceStatus = 'visiting';
      let finalLocationType   = 'visit';
      if (session.travel_source === 'work_schedule')   { finalPresenceStatus = 'at_work';    finalLocationType = 'work'; }
      else if (session.travel_source === 'school_schedule') { finalPresenceStatus = 'at_school'; finalLocationType = 'school'; }
      else if (destLoc.id === char.current_home_location_id) { finalPresenceStatus = 'home'; finalLocationType = 'home'; }

      // ── WRITE Character to destination ────────────────────────────────────
      // RULE: Clear travel fields ONLY in the same atomic write as destination
      // RULE: Do NOT clear travel if write fails
      await base44.entities.Character.update(char.id, {
        resolved_current_location_id:   destLoc.id,
        resolved_current_location_name: destLoc.name,
        resolved_presence_status:       finalPresenceStatus,
        resolved_location_type:         finalLocationType,
        resolved_source_reason:         `verified_arrival:${session.id}`,
        resolved_last_updated_at:       nowISO,
        last_arrived_time:              nowISO,
        travel_status:                  'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id:       null,
        traveling_to_location_name:     null,
      });

      // ── READ BACK (user-scoped — only valid verification path) ────────────
      const freshList = await base44.entities.Character.filter(
        { owner_email: ownerEmail }, 'created_date', 300
      ).catch(() => []);
      const charAfter = freshList.find(c => c.id === char.id);

      const locationVerified = charAfter?.resolved_current_location_id === destLoc.id;
      const travelCleared    = charAfter?.travel_status === 'not_traveling';

      if (locationVerified) {
        // ✅ VERIFIED — NOW and only now set route_status: "arrived"
        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status:               'arrived',
          actual_arrival_time:        nowISO,
          arrival_due:                false,
          arrival_pending_character_write: false,
          arrival_write_attempts:     attemptCount,
        });

        // Mark linked commitment complete
        if (session.source_commitment_id) {
          await base44.asServiceRole.entities.CharacterCommitment.update(session.source_commitment_id, {
            status: 'arrived',
            completed_at: nowISO,
          }).catch(() => {});
        }

        console.log(`[completeTravelArrivalVerified] ✅ VERIFIED ARRIVAL | char=${char.name} | dest=${destLoc.name} | session=${session.id} | readback=PASS | travel_cleared=${travelCleared}`);

        results.push({
          session_id:        session.id,
          character_name:    char.name,
          destination:       destLoc.name,
          outcome:           'verified_arrival',
          arrived_set:       true,
          readback_verified: true,
          travel_cleared:    travelCleared,
          after_location:    charAfter?.resolved_current_location_name,
        });

      } else {
        // ❌ WRITE FAILED — DO NOT SET "arrived"
        // Determine failure type
        const currentLocId = charAfter?.resolved_current_location_id;
        const failureType = (!currentLocId)
          ? 'DESTINATION_WRITE_FAILURE'
          : (currentLocId === session.origin_location_id)
            ? 'TRAVEL_REVERTED_TO_ORIGIN'
            : 'LOCATION_READBACK_MISMATCH';

        const violationMsg = [
          '============================================================',
          'TRAVEL ARRIVAL FAILURE — AI ACCOUNTABILITY VIOLATION',
          '============================================================',
          `Character:          ${char.name}`,
          `Intended dest:      ${destLoc.name} (${destLoc.id})`,
          `Actual location:    ${charAfter?.resolved_current_location_name || 'unknown'} (${currentLocId || 'null'})`,
          `Session ID:         ${session.id}`,
          `Failed code path:   completeTravelArrivalVerified → Character.update → read-back`,
          `Failure type:       ${failureType}`,
          `Repair attempted:   YES`,
          `Repair result:      FAILED — read-back did not confirm destination`,
          `Read-back passed:   NO`,
          `Character stuck:    ${char.travel_status !== 'not_traveling' ? 'YES — still in travel_status' : 'NO — travel_status cleared but location wrong'}`,
          `UI false travel:    ${char.travel_status !== 'not_traveling' ? 'YES' : 'NO'}`,
          `Attempt #:          ${attemptCount}`,
          '============================================================',
        ].join('\n');

        console.error(violationMsg);

        // Log TravelViolation record
        await _logViolation(base44, {
          session,
          char,
          ownerEmail,
          failureType,
          blockerReason: `write_executed_read_back_shows_${currentLocId}_not_${destLoc.id}. Attempt #${attemptCount}`,
          repairResult: 'failed',
          repairDetail: `Write attempted. Read-back: location=${charAfter?.resolved_current_location_name}, expected=${destLoc.name}. Attempt #${attemptCount}`,
          finalLocationId: currentLocId || null,
          finalLocationName: charAfter?.resolved_current_location_name || null,
          readbackMatched: false,
          resolved: false,
          nowISO,
        });

        // DO NOT set "arrived" — keep as arrival_due so next cycle retries
        // After MAX_ATTEMPTS, escalate to arrival_failed
        const MAX_ATTEMPTS = 3;
        const nextStatus = attemptCount >= MAX_ATTEMPTS ? 'arrival_failed' : 'arrival_due';

        await base44.asServiceRole.entities.TravelSession.update(session.id, {
          route_status:               nextStatus,
          blocker_reason:             `${failureType}: read-back failed. Attempt #${attemptCount}`,
          arrival_due:                nextStatus === 'arrival_due',
          arrival_pending_character_write: nextStatus === 'arrival_due',
          arrival_write_attempts:     attemptCount,
        }).catch(() => {});

        results.push({
          session_id:       session.id,
          character_name:   char.name,
          destination:      destLoc.name,
          outcome:          failureType,
          arrived_set:      false,
          readback_verified: false,
          next_status:      nextStatus,
          attempt_count:    attemptCount,
        });
      }
    }

    const verified = results.filter(r => r.arrived_set).length;
    const failed   = results.filter(r => !r.arrived_set).length;

    console.log(`[completeTravelArrivalVerified] Done | verified=${verified} | failed=${failed} | total=${results.length}`);

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      sessions_processed: results.length,
      verified_arrivals: verified,
      failed_arrivals: failed,
      results,
    });

  } catch (error) {
    console.error('[completeTravelArrivalVerified]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── Shared violation logger ───────────────────────────────────────────────
async function _logViolation(base44, {
  session, char, ownerEmail, failureType, blockerReason,
  repairResult, repairDetail, finalLocationId, finalLocationName,
  readbackMatched, resolved, nowISO,
}) {
  await base44.asServiceRole.entities.TravelViolation.create({
    character_id:                 session.character_id,
    character_name:               session.character_name,
    owner_email:                  ownerEmail,
    session_id:                   session.id,
    origin_location_id:           session.origin_location_id,
    origin_location_name:         session.origin_location_name,
    destination_location_id:      session.destination_location_id,
    destination_location_name:    session.destination_location_name,
    eta:                          session.estimated_arrival_time,
    travel_status_at_violation:   char?.travel_status || 'unknown',
    route_status_at_violation:    session.route_status,
    presence_status_at_violation: char?.resolved_presence_status || 'unknown',
    progress_percent:             session.progress_percent || null,
    failure_type:                 failureType,
    blocker_reason:               blockerReason,
    repair_attempted:             true,
    repair_result:                repairResult,
    repair_detail:                repairDetail,
    final_verified_location_id:   finalLocationId,
    final_verified_location_name: finalLocationName,
    readback_matched_destination: readbackMatched,
    violation_resolved:           resolved,
    detected_at:                  nowISO,
  }).catch(e => console.warn(`[completeTravelArrivalVerified] Violation log failed: ${e.message}`));
}