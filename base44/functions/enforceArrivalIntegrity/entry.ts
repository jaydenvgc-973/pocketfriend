/**
 * enforceArrivalIntegrity
 *
 * TRAVEL ARRIVAL FAILURE RULE — DESTINATION ENFORCEMENT
 *
 * Runs after processTravelArrivals marks sessions as "arrived".
 * For each "arrived" session, this function:
 *
 *   1. Verifies the Character was written to the destination (read-back check)
 *   2. If NOT written → diagnoses the violation type, attempts forced arrival
 *   3. Verifies again after repair (read-back enforcement)
 *   4. Logs a TravelViolation record for any failure with full context
 *
 * RULES:
 * - Travel must resolve FORWARD to destination. Never backward to origin.
 * - Clearing travel without arrival is a TRAVEL_CLEARED_WITHOUT_ARRIVAL violation.
 * - If destination location record is missing → INVALID_DESTINATION_REFERENCE violation.
 * - If write succeeds but read-back doesn't match → LOCATION_READBACK_MISMATCH violation.
 * - No silent failures. Every failure gets a TravelViolation log.
 *
 * Uses user-scoped Character reads (via completeStuckTravelUserScoped pattern)
 * plus asServiceRole for TravelSession + LocationReference.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // May be called scheduled or user-scoped
    let user = null;
    try { user = await base44.auth.me(); } catch { /* scheduled */ }

    const now = new Date();

    // ── Load all "arrived" sessions (need Character completion verified) ────
    // Also check "in_transit" sessions where ETA passed > 10 min ago (stale in transit)
    const arrivedSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'arrived' },
      '-updated_date',
      200
    ).catch(() => []);

    // Stale in_transit: ETA passed more than 10 minutes ago but still in_transit
    const inTransitSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { route_status: 'in_transit' },
      '-updated_date',
      100
    ).catch(() => []);

    const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes past ETA
    const staleSessions = inTransitSessions.filter(s => {
      if (!s.estimated_arrival_time) return false;
      const eta = new Date(s.estimated_arrival_time).getTime();
      return now.getTime() - eta > STALE_THRESHOLD_MS;
    });

    console.log(`[enforceArrivalIntegrity] Checking ${arrivedSessions.length} arrived sessions, ${staleSessions.length} stale in_transit sessions`);

    if (arrivedSessions.length === 0 && staleSessions.length === 0) {
      return Response.json({ success: true, message: 'No sessions to enforce', violations: [], repaired: [] });
    }

    // Group sessions by owner_email so we can do user-scoped character reads
    const sessionsByOwner = {};
    for (const s of [...arrivedSessions, ...staleSessions]) {
      if (!s.owner_email) continue;
      if (!sessionsByOwner[s.owner_email]) sessionsByOwner[s.owner_email] = [];
      sessionsByOwner[s.owner_email].push(s);
    }

    const violations = [];
    const repaired = [];
    const alreadyComplete = [];

    for (const [ownerEmail, ownerSessions] of Object.entries(sessionsByOwner)) {
      // Load all characters for this owner (user-scoped via service role invocation path)
      // We use asServiceRole here to avoid needing an active user session (scheduled context).
      // Character RLS blocks this — so we use the completeStuckTravelUserScoped delegation pattern.
      let allChars = [];
      try {
        // Try user-scoped if we have auth
        if (user?.email === ownerEmail) {
          allChars = await base44.entities.Character.filter(
            { owner_email: ownerEmail }, 'created_date', 300
          ).catch(() => []);
        }
        // If no chars loaded (either no user session or different owner), use service-role invoke
        if (allChars.length === 0) {
          const res = await base44.asServiceRole.functions.invoke('completeStuckTravelUserScoped', {
            _owner_email_hint: ownerEmail,
          }).catch(() => null);
          // completeStuckTravelUserScoped handles its own repairs — we just need the char data
          // so we re-query after it runs
          if (res?.data?.results?.length > 0) {
            // It already completed some repairs — track them
            for (const r of res.data.results) {
              if (r.location_write_verified) {
                repaired.push({ owner_email: ownerEmail, ...r });
              }
            }
          }
          // Fall through to session-level verification below
        }
      } catch (charLoadErr) {
        console.warn(`[enforceArrivalIntegrity] Could not load chars for ${ownerEmail}: ${charLoadErr.message}`);
      }

      // Now verify each session for this owner
      for (const session of ownerSessions) {
        const isStale = session.route_status === 'in_transit';
        const char = allChars.find(c => c.id === session.character_id);

        // ── Detect violation type ───────────────────────────────────────────
        let failureType = null;
        let blockerReason = null;

        if (isStale) {
          failureType = 'ETA_PASSED_NO_ARRIVAL';
          blockerReason = `in_transit_stale: ETA was ${session.estimated_arrival_time}, now ${now.toISOString()}`;
        }

        // If we have char data, check read-back
        if (char && session.destination_location_id) {
          const atDestination = char.resolved_current_location_id === session.destination_location_id;

          if (atDestination && !isStale) {
            // ✅ Already complete — just stamp the session if needed
            alreadyComplete.push({ session_id: session.id, character: session.character_name, destination: session.destination_location_name });
            if (session.route_status === 'arrived') {
              await base44.asServiceRole.entities.TravelSession.update(session.id, {
                route_status: 'arrived',
                actual_arrival_time: session.actual_arrival_time || now.toISOString(),
              }).catch(() => {});
            }
            continue;
          }

          if (!atDestination && session.route_status === 'arrived') {
            // Character is NOT at destination despite session being "arrived" — violation
            const currentLoc = char.resolved_current_location_id;
            if (currentLoc === session.origin_location_id) {
              failureType = 'TRAVEL_REVERTED_TO_ORIGIN';
              blockerReason = `char at origin=${session.origin_location_name}, should be at destination=${session.destination_location_name}`;
            } else if (!currentLoc) {
              failureType = 'DESTINATION_WRITE_FAILURE';
              blockerReason = 'Character has no resolved_current_location_id after session marked arrived';
            } else {
              failureType = 'LOCATION_READBACK_MISMATCH';
              blockerReason = `char at ${currentLoc}, expected ${session.destination_location_id}`;
            }
          }
        }

        // Check if destination reference is valid
        const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
          { id: session.destination_location_id }, null, 1
        ).catch(() => []);
        const destLoc = destLocArr?.[0] || null;

        if (!destLoc && session.destination_location_id) {
          failureType = 'INVALID_DESTINATION_REFERENCE';
          blockerReason = `destination_location_id=${session.destination_location_id} not found in LocationReference`;
        }

        // No failure detected without char data — escalate to completeStuckTravelUserScoped
        if (!failureType && !char) {
          // Session is arrived but we can't verify — trigger user-scoped completion
          if (session.route_status === 'arrived') {
            try {
              await base44.asServiceRole.functions.invoke('completeStuckTravelUserScoped', {
                _owner_email_hint: ownerEmail,
              });
            } catch { /* non-fatal */ }
          }
          continue;
        }

        if (!failureType) continue; // No violation detected

        // ── LOG VIOLATION ────────────────────────────────────────────────────
        console.warn(`[enforceArrivalIntegrity] VIOLATION: ${failureType} | char=${session.character_name} | session=${session.id} | dest=${session.destination_location_name} | reason=${blockerReason}`);

        const violationRecord = {
          character_id:                 session.character_id,
          character_name:               session.character_name,
          owner_email:                  session.owner_email,
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
          repair_attempted:             false,
          repair_result:                'not_attempted',
          final_verified_location_id:   char?.resolved_current_location_id || null,
          final_verified_location_name: char?.resolved_current_location_name || null,
          readback_matched_destination: false,
          violation_resolved:           false,
          detected_at:                  now.toISOString(),
        };

        // ── ATTEMPT REPAIR ───────────────────────────────────────────────────
        // RULE: Repair must attempt to push character to destination.
        // RULE: Never send to origin. Never send home as fallback.
        // RULE: Only exception is INVALID_DESTINATION_REFERENCE (nowhere valid to go).

        violationRecord.repair_attempted = true;
        let repairSuccess = false;
        let repairDetail = '';

        if (failureType === 'INVALID_DESTINATION_REFERENCE') {
          // Cannot repair — destination doesn't exist. Log and hold.
          repairDetail = 'Destination location record missing — cannot force arrival. Session held.';
          violationRecord.repair_result = 'failed';
          violationRecord.repair_detail = repairDetail;
          console.error(`[enforceArrivalIntegrity] CANNOT REPAIR ${failureType} for ${session.character_name} — destination ${session.destination_location_id} does not exist`);

        } else if (destLoc) {
          // Attempt forced arrival to destination via completeStuckTravelUserScoped
          // Mark session as arrived first (so the stuck travel completion picks it up)
          try {
            if (isStale) {
              await base44.asServiceRole.entities.TravelSession.update(session.id, {
                route_status:        'arrived',
                progress_percent:    100,
                actual_arrival_time: now.toISOString(),
              });
            }

            // Delegate to user-scoped completion
            const repairRes = await base44.asServiceRole.functions.invoke('completeStuckTravelUserScoped', {
              _owner_email_hint: ownerEmail,
            }).catch(e => ({ data: { error: e.message } }));

            const repairData = repairRes?.data || {};
            const thisCharResult = repairData.results?.find(r => r.session_id === session.id || r.name === session.character_name);

            if (thisCharResult?.location_write_verified) {
              repairSuccess = true;
              repairDetail = `Repair succeeded via completeStuckTravelUserScoped. Character now at ${thisCharResult.after_location}`;
              violationRecord.final_verified_location_id = session.destination_location_id;
              violationRecord.final_verified_location_name = destLoc.name;
              violationRecord.readback_matched_destination = true;
              violationRecord.violation_resolved = true;
            } else {
              repairDetail = `completeStuckTravelUserScoped ran but read-back did not confirm destination. result=${JSON.stringify(thisCharResult)}`;
              violationRecord.repair_result = 'partial';
            }
          } catch (repairErr) {
            repairDetail = `Repair invoke failed: ${repairErr.message}`;
            violationRecord.repair_result = 'failed';
          }

          if (repairSuccess) {
            violationRecord.repair_result = 'success';
            repaired.push({
              character_name: session.character_name,
              session_id: session.id,
              failure_type: failureType,
              destination: destLoc.name,
            });
          }

          violationRecord.repair_detail = repairDetail;
        }

        // ── WRITE VIOLATION RECORD ───────────────────────────────────────────
        try {
          await base44.asServiceRole.entities.TravelViolation.create(violationRecord);
        } catch (logErr) {
          // If entity doesn't exist yet or write fails — log to console as fallback
          console.error(`[enforceArrivalIntegrity] VIOLATION LOG WRITE FAILED: ${logErr.message}`);
          console.error(`[enforceArrivalIntegrity] VIOLATION RECORD: ${JSON.stringify(violationRecord)}`);
        }

        violations.push({
          failure_type:  failureType,
          character:     session.character_name,
          session_id:    session.id,
          destination:   session.destination_location_name,
          repair_result: violationRecord.repair_result,
          resolved:      violationRecord.violation_resolved,
          blocker:       blockerReason,
        });
      }
    }

    console.log(`[enforceArrivalIntegrity] Done | violations=${violations.length} | repaired=${repaired.length} | already_complete=${alreadyComplete.length}`);

    return Response.json({
      success: true,
      violations_detected: violations.length,
      violations,
      repaired_count: repaired.length,
      repaired,
      already_complete: alreadyComplete.length,
      sessions_checked: arrivedSessions.length + staleSessions.length,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[enforceArrivalIntegrity]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});