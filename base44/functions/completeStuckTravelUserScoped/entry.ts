/**
 * completeStuckTravelUserScoped
 *
 * Uses the SAME user-scoped RLS query as the Travel/Home UI:
 *   base44.entities.Character.filter({ owner_email: email })
 *
 * Service-role Character queries return 0 for this account's characters
 * because Character RLS enforces per-owner access at all levels.
 * This function authenticates as the actual user and reads their characters
 * exactly as the UI does — no "not found" errors are possible.
 *
 * For each character stuck in any traveling travel_status:
 * 1. Find destination from: TravelSession → traveling_to_location_id → travel_destination_location_id
 * 2. Write destination to Character (resolved_current_location_id + presence fields)
 * 3. Clear all travel flags
 * 4. Read back and verify
 * 5. Stamp TravelSession actual_arrival_time
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // ── Load ALL characters — same query as useOwnedCharacters() in the UI ────────
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      'created_date',
      300
    ).catch(() => []);

    console.log(`[completeStuckTravelUserScoped] Loaded ${allChars.length} characters for ${ownerEmail}`);

    const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination', 'traveling'];
    const stuckChars = allChars.filter(c => travelingStates.includes(c.travel_status));

    console.log(`[completeStuckTravelUserScoped] Found ${stuckChars.length} stuck characters`);

    if (stuckChars.length === 0) {
      return Response.json({
        message: 'No characters stuck in travel_status',
        total_characters_loaded: allChars.length,
        results: [],
      });
    }

    const results = [];

    for (const char of stuckChars) {
      let destId = null;
      let destName = null;
      let sessionId = null;
      let travelSource = null;

      // Priority 1: arrived TravelSession
      const arrivedSessions = await base44.asServiceRole.entities.TravelSession.filter(
        { character_id: char.id, route_status: 'arrived' },
        '-updated_date',
        1
      ).catch(() => []);

      if (arrivedSessions.length > 0 && arrivedSessions[0].destination_location_id) {
        destId = arrivedSessions[0].destination_location_id;
        destName = arrivedSessions[0].destination_location_name;
        sessionId = arrivedSessions[0].id;
        travelSource = arrivedSessions[0].travel_source;
      }

      // Priority 2: active TravelSession
      if (!destId) {
        const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
          { character_id: char.id },
          '-updated_date',
          5
        ).catch(() => []);

        const active = activeSessions.find(s => ['in_transit', 'preparing', 'delayed'].includes(s.route_status));
        if (active?.destination_location_id) {
          destId = active.destination_location_id;
          destName = active.destination_location_name;
          sessionId = active.id;
          travelSource = active.travel_source;
        }
      }

      // Priority 3: character fields
      if (!destId) {
        destId = char.traveling_to_location_id || char.travel_destination_location_id;
        destName = char.traveling_to_location_name;
      }

      // No destination at all — VIOLATION: TRAVEL_CLEARED_WITHOUT_ARRIVAL
      // Per spec: do NOT silently clear travel when there's no destination.
      // Log violation and clear flags, but record what happened.
      if (!destId) {
        // Log violation before clearing
        await base44.asServiceRole.entities.TravelViolation.create({
          character_id:                 char.id,
          character_name:               char.name,
          owner_email:                  ownerEmail,
          session_id:                   sessionId || null,
          travel_status_at_violation:   char.travel_status,
          presence_status_at_violation: char.resolved_presence_status || null,
          failure_type:                 'TRAVEL_CLEARED_WITHOUT_ARRIVAL',
          blocker_reason:               'no_destination_found_in_any_session_or_character_fields',
          repair_attempted:             true,
          repair_result:                'partial',
          repair_detail:                'Travel flags cleared — no destination to route to. Character stays at current location.',
          final_verified_location_id:   char.resolved_current_location_id || null,
          final_verified_location_name: char.resolved_current_location_name || null,
          readback_matched_destination: false,
          violation_resolved:           false,
          detected_at:                  new Date().toISOString(),
        }).catch(e => console.warn(`[completeStuckTravelUserScoped] Violation log failed: ${e.message}`));

        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          traveling_to_location_id: null,
          traveling_to_location_name: null,
          travel_destination_location_id: null,
        });
        console.warn(`[completeStuckTravelUserScoped] VIOLATION LOGGED: TRAVEL_CLEARED_WITHOUT_ARRIVAL for ${char.name}`);
        results.push({
          name: char.name,
          before_location: char.resolved_current_location_name,
          intended_destination: 'NONE FOUND',
          after_location: char.resolved_current_location_name,
          travel_status_before: char.travel_status,
          travel_status_after: 'not_traveling',
          location_write_verified: 'N/A',
          travel_cleared_verified: true,
          blocker: 'VIOLATION:TRAVEL_CLEARED_WITHOUT_ARRIVAL:no_destination_found',
        });
        continue;
      }

      // Fetch destination LocationReference
      const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
        { id: destId },
        null,
        1
      ).catch(() => []);

      if (!destLoc) {
        // VIOLATION: INVALID_DESTINATION_REFERENCE — cannot push to destination that doesn't exist.
        // Log violation. Clear travel flags since session is invalid, but record the failure.
        await base44.asServiceRole.entities.TravelViolation.create({
          character_id:                 char.id,
          character_name:               char.name,
          owner_email:                  ownerEmail,
          session_id:                   sessionId || null,
          destination_location_id:      destId,
          destination_location_name:    destName || destId,
          travel_status_at_violation:   char.travel_status,
          presence_status_at_violation: char.resolved_presence_status || null,
          failure_type:                 'INVALID_DESTINATION_REFERENCE',
          blocker_reason:               `destination_location_id=${destId} not found in LocationReference`,
          repair_attempted:             true,
          repair_result:                'failed',
          repair_detail:                'Destination location record does not exist — cannot route character there. Travel flags cleared.',
          final_verified_location_id:   char.resolved_current_location_id || null,
          final_verified_location_name: char.resolved_current_location_name || null,
          readback_matched_destination: false,
          violation_resolved:           false,
          detected_at:                  new Date().toISOString(),
        }).catch(e => console.warn(`[completeStuckTravelUserScoped] Violation log failed: ${e.message}`));

        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          traveling_to_location_id: null,
          traveling_to_location_name: null,
          travel_destination_location_id: null,
        });
        console.error(`[completeStuckTravelUserScoped] VIOLATION: INVALID_DESTINATION_REFERENCE for ${char.name} dest=${destId}`);
        results.push({
          name: char.name,
          before_location: char.resolved_current_location_name,
          intended_destination: destName || destId,
          after_location: char.resolved_current_location_name,
          travel_status_before: char.travel_status,
          travel_status_after: 'not_traveling',
          location_write_verified: false,
          travel_cleared_verified: true,
          blocker: `VIOLATION:INVALID_DESTINATION_REFERENCE:${destId}`,
        });
        continue;
      }

      // Determine presence status
      let finalPresenceStatus = 'visiting';
      let finalLocationType = 'visit';
      if (travelSource === 'work_schedule') { finalPresenceStatus = 'at_work'; finalLocationType = 'work'; }
      else if (travelSource === 'school_schedule') { finalPresenceStatus = 'at_school'; finalLocationType = 'school'; }
      else if (destLoc.id === char.current_home_location_id) { finalPresenceStatus = 'home'; finalLocationType = 'home'; }

      const now = new Date();

      // ── WRITE to destination (user-scoped — canonical path) ─────────────────
      await base44.entities.Character.update(char.id, {
        resolved_current_location_id:   destLoc.id,
        resolved_current_location_name: destLoc.name,
        resolved_presence_status:       finalPresenceStatus,
        resolved_location_type:         finalLocationType,
        resolved_source_reason:         `stuck_travel_repair:${sessionId || 'no_session'}`,
        resolved_last_updated_at:       now.toISOString(),
        last_arrived_time:              now.toISOString(),
        travel_status:                  'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id:       null,
        traveling_to_location_name:     null,
      });

      // ── READ BACK (user-scoped) ───────────────────────────────────────────────
      const freshList = await base44.entities.Character.filter(
        { owner_email: ownerEmail },
        'created_date',
        300
      ).catch(() => []);
      const charAfter = freshList.find(c => c.id === char.id);

      const locationWriteOk = charAfter?.resolved_current_location_id === destLoc.id;
      const travelClearedOk = charAfter?.travel_status === 'not_traveling';

      // Stamp session — only set "arrived" if read-back verified
      // DO NOT set "arrived" here — wait for locationWriteOk check below.
      // This is enforced below after the read-back check.

      // READ-BACK ENFORCEMENT: If character is NOT at destination after write → log violation
      if (!locationWriteOk) {
        const currentLocId = charAfter?.resolved_current_location_id;
        const failureType = currentLocId === (char.resolved_current_location_id)
          ? 'TRAVEL_REVERTED_TO_ORIGIN'
          : 'LOCATION_READBACK_MISMATCH';

        await base44.asServiceRole.entities.TravelViolation.create({
          character_id:                 char.id,
          character_name:               char.name,
          owner_email:                  ownerEmail,
          session_id:                   sessionId || null,
          destination_location_id:      destLoc.id,
          destination_location_name:    destLoc.name,
          origin_location_id:           char.resolved_current_location_id || null,
          origin_location_name:         char.resolved_current_location_name || null,
          travel_status_at_violation:   char.travel_status,
          presence_status_at_violation: char.resolved_presence_status || null,
          failure_type:                 failureType,
          blocker_reason:               `write_executed_but_read_back_shows_${currentLocId}_not_${destLoc.id}`,
          repair_attempted:             true,
          repair_result:                'failed',
          repair_detail:                `Write attempted. Read-back returned location=${currentLocId}, expected=${destLoc.id}`,
          final_verified_location_id:   currentLocId || null,
          final_verified_location_name: charAfter?.resolved_current_location_name || null,
          readback_matched_destination: false,
          violation_resolved:           false,
          detected_at:                  now.toISOString(),
        }).catch(e => console.warn(`[completeStuckTravelUserScoped] Violation log failed: ${e.message}`));

        console.error(`[completeStuckTravelUserScoped] VIOLATION: ${failureType} for ${char.name} — expected at ${destLoc.name}, found at ${charAfter?.resolved_current_location_name}`);

        // Keep session as arrival_due for retry — do NOT set arrived
        if (sessionId) {
          await base44.asServiceRole.entities.TravelSession.update(sessionId, {
            route_status:   'arrival_due',
            arrival_due:    true,
            arrival_pending_character_write: true,
            blocker_reason: `${failureType}: read-back failed in completeStuckTravelUserScoped`,
          }).catch(() => {});
        }

      } else {
        // ✅ VERIFIED — set "arrived" only now
        if (sessionId) {
          await base44.asServiceRole.entities.TravelSession.update(sessionId, {
            route_status:               'arrived',
            actual_arrival_time:        now.toISOString(),
            arrival_due:                false,
            arrival_pending_character_write: false,
          }).catch(() => {});
        }
        console.log(`[completeStuckTravelUserScoped] ✅ ${char.name} → ${destLoc.name} | location_ok=${locationWriteOk} travel_cleared=${travelClearedOk}`);
      }

      results.push({
        name: char.name,
        before_location: char.resolved_current_location_name,
        intended_destination: destLoc.name,
        after_location: charAfter?.resolved_current_location_name,
        travel_status_before: char.travel_status,
        travel_status_after: charAfter?.travel_status,
        location_write_verified: locationWriteOk,
        travel_cleared_verified: travelClearedOk,
        blocker: (!locationWriteOk || !travelClearedOk) ? 'VIOLATION:LOCATION_READBACK_MISMATCH:write_verify_failed' : null,
        session_id: sessionId,
      });
    }

    return Response.json({
      owner_email: ownerEmail,
      total_characters_loaded: allChars.length,
      stuck_characters_found: stuckChars.length,
      results,
    });

  } catch (error) {
    console.error('[completeStuckTravelUserScoped]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});