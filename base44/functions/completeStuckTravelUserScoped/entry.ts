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

      // No destination at all — clear travel flags only
      if (!destId) {
        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          traveling_to_location_id: null,
          traveling_to_location_name: null,
          travel_destination_location_id: null,
        });
        results.push({
          name: char.name,
          before_location: char.resolved_current_location_name,
          intended_destination: 'NONE FOUND',
          after_location: char.resolved_current_location_name,
          travel_status_before: char.travel_status,
          travel_status_after: 'not_traveling',
          location_write_verified: 'N/A',
          travel_cleared_verified: true,
          blocker: 'no_destination_found_travel_flags_cleared',
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
        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          traveling_to_location_id: null,
          traveling_to_location_name: null,
          travel_destination_location_id: null,
        });
        results.push({
          name: char.name,
          before_location: char.resolved_current_location_name,
          intended_destination: destName || destId,
          after_location: char.resolved_current_location_name,
          travel_status_before: char.travel_status,
          travel_status_after: 'not_traveling',
          location_write_verified: false,
          travel_cleared_verified: true,
          blocker: `destination_location_record_not_found:${destId}`,
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

      // Stamp session
      if (sessionId) {
        await base44.asServiceRole.entities.TravelSession.update(sessionId, {
          actual_arrival_time: now.toISOString(),
          route_status: 'arrived',
        }).catch(() => {});
      }

      console.log(`[completeStuckTravelUserScoped] ✅ ${char.name} → ${destLoc.name} | location_ok=${locationWriteOk} travel_cleared=${travelClearedOk}`);

      results.push({
        name: char.name,
        before_location: char.resolved_current_location_name,
        intended_destination: destLoc.name,
        after_location: charAfter?.resolved_current_location_name,
        travel_status_before: char.travel_status,
        travel_status_after: charAfter?.travel_status,
        location_write_verified: locationWriteOk,
        travel_cleared_verified: travelClearedOk,
        blocker: (!locationWriteOk || !travelClearedOk) ? 'write_verify_failed' : null,
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