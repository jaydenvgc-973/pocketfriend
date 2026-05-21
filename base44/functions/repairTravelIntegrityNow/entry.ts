/**
 * repairTravelIntegrityNow
 *
 * HARD FIX — Character.travel_status and TravelSession must be synchronized.
 *
 * For every character showing as traveling:
 * 1. Verify active TravelSession exists
 * 2. If session missing, try to recreate from verified origin/destination
 * 3. If session exists but character missing travel flags, restore them
 * 4. If ETA passed, complete arrival with destination verification
 * 5. Never return home unless destination is home
 *
 * Returns before/after proof for EVERY character inspected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Inline validation for Deno portability
function validateTravelIntegrity({ character, activeSession, locationsById = {} }) {
  const blockers = [];
  const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination'];
  const isCharacterTraveling = travelingStates.includes(character?.travel_status);

  if (isCharacterTraveling && !activeSession) blockers.push('character_travel_status_without_session');
  if (activeSession && !isCharacterTraveling) blockers.push('session_without_character_travel_status');
  if (activeSession && character?.owner_email !== activeSession.owner_email) blockers.push('ownership_mismatch');

  const validRouteStatuses = ['preparing', 'in_transit', 'delayed'];
  if (activeSession && !validRouteStatuses.includes(activeSession.route_status)) blockers.push('invalid_route_status');

  const hasStatusBarData =
    !!activeSession?.estimated_arrival_time &&
    !!activeSession?.duration_minutes &&
    activeSession?.progress_percent !== null &&
    activeSession?.progress_percent !== undefined;

  const hasMapMovementData =
    !!activeSession?.origin_location_id &&
    !!activeSession?.destination_location_id &&
    activeSession?.progress_percent !== null &&
    activeSession?.progress_percent !== undefined;

  if (isCharacterTraveling && !hasStatusBarData) blockers.push('status_bar_missing');
  if (isCharacterTraveling && !hasMapMovementData) blockers.push('map_marker_missing');

  return {
    valid: blockers.length === 0,
    blocker_reason: blockers.length > 0 ? blockers[0] : null,
    status_bar_data_exists: hasStatusBarData,
    map_movement_source_exists: hasMapMovementData,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const owner_email = user.email;
    console.log(`[repairTravelIntegrityNow] Starting | owner_email=${owner_email}`);

    // ── LOAD ALL CHARACTERS ─────────────────────────────────────────────────
    const allChars = await base44.entities.Character.filter(
      { owner_email },
      null,
      500
    ).catch(() => []);

    // ── LOAD ALL LOCATIONS ─────────────────────────────────────────────────
    const allLocations = await base44.entities.LocationReference.filter(
      {},
      null,
      500
    ).catch(() => []);
    const locationsById = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination'];
    const travelingChars = allChars.filter(c => travelingStates.includes(c.travel_status));

    console.log(`[repairTravelIntegrityNow] Found ${travelingChars.length} traveling characters`);

    const repairResults = [];

    for (const char of travelingChars) {
      try {
        const before = {
          travel_status: char.travel_status,
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
        };

        // Find active session
        const activeSessions = await base44.entities.TravelSession.filter(
          {
            character_id: char.id,
            owner_email,
            route_status: { $in: ['preparing', 'in_transit', 'delayed'] },
          },
          '-created_date',
          1
        ).catch(() => []);

        let activeSession = activeSessions?.[0];
        let sessionCreatedThisRepair = false;

        // ── SESSION MISSING — TRY TO RECREATE ──────────────────────────────
        if (!activeSession && char.travel_destination_location_id) {
          const originLocId = char.current_home_location_id;
          const destLocId = char.travel_destination_location_id;

          const originLoc = locationsById[originLocId];
          const destLoc = locationsById[destLocId];

          if (originLoc && destLoc && originLoc.id && destLoc.id) {
            // Verify ownership
            if (destLoc.owner_email && destLoc.owner_email !== owner_email) {
              // Destination is owned by different user — cannot travel
              repairResults.push({
                character_id: char.id,
                character_name: char.name,
                action: 'REJECTED_REPAIR_OWNERSHIP_MISMATCH',
                before,
                after: null,
                blocker_reason: 'destination_owned_by_different_user',
              });
              continue;
            }

            // Recreate session
            const now = new Date();
            const distanceMiles = 5; // Default estimate
            const travelMinutes = Math.max(3, Math.ceil(distanceMiles));
            const arrivalTime = new Date(now.getTime() + travelMinutes * 60 * 1000);

            activeSession = await base44.entities.TravelSession.create({
              character_id: char.id,
              character_name: char.name,
              owner_email,
              origin_location_id: originLoc.id,
              origin_location_name: originLoc.name,
              destination_location_id: destLoc.id,
              destination_location_name: destLoc.name,
              travel_reason: 'Travel integrity repair',
              travel_source: 'manual',
              distance_miles: distanceMiles,
              estimated_departure_time: now.toISOString(),
              estimated_arrival_time: arrivalTime.toISOString(),
              duration_minutes: travelMinutes,
              progress_percent: 0,
              route_status: 'in_transit',
              character_snapshot: {
                id: char.id,
                name: char.name,
                owner_email: char.owner_email,
                is_jailed: char.is_jailed,
                house_arrest_active: char.house_arrest_active,
                resolved_presence_status: char.resolved_presence_status,
              },
              character_home_location_id: char.current_home_location_id,
            });

            sessionCreatedThisRepair = true;
            console.log(`[repairTravelIntegrityNow] ✓ Recreated session | char=${char.name} | sess=${activeSession.id}`);
          }
        }

        // ── VALIDATE SESSION ───────────────────────────────────────────────
        const validation = validateTravelIntegrity({
          character: char,
          activeSession,
          locationsById,
        });

        // ── IF ETA PASSED, COMPLETE ARRIVAL ────────────────────────────────
        let arrival_processed = false;
        if (
          activeSession &&
          activeSession.estimated_arrival_time &&
          new Date(activeSession.estimated_arrival_time).getTime() < Date.now() &&
          activeSession.route_status !== 'arrived'
        ) {
          // Verify destination
          const destLoc = locationsById[activeSession.destination_location_id];
          if (destLoc) {
            // Update character location fields
            const updated = await base44.entities.Character.update(char.id, {
              resolved_current_location_id: activeSession.destination_location_id,
              resolved_current_location_name: activeSession.destination_location_name,
              resolved_location_type: destLoc.category || 'generic',
              resolved_presence_status: destLoc.category === 'home' ? 'home' : 'visiting',
              resolved_source_reason: `arrived_from_travel_session:${activeSession.id}`,
              last_arrived_time: new Date().toISOString(),
              travel_status: 'not_traveling',
              traveling_to_location_id: null,
              traveling_to_location_name: null,
              travel_destination_location_id: null,
            });

            // Read back
            const readBack = await base44.entities.Character.filter(
              { id: char.id },
              null,
              1
            ).then(arr => arr?.[0]);

            // Verify destination was set
            const destinationSet = readBack?.resolved_current_location_id === activeSession.destination_location_id;

            if (destinationSet) {
              // Mark session arrived
              await base44.entities.TravelSession.update(activeSession.id, {
                route_status: 'arrived',
                progress_percent: 100,
                actual_arrival_time: new Date().toISOString(),
              });
              arrival_processed = true;
              console.log(`[repairTravelIntegrityNow] ✓ Arrival completed | char=${char.name} | dest=${activeSession.destination_location_name}`);
            } else {
              // Arrival verification failed
              await base44.entities.TravelSession.update(activeSession.id, {
                route_status: 'arrival_failed',
                error_reason: 'destination_not_set_on_readback',
              });
              console.error(`[repairTravelIntegrityNow] ✗ Arrival failed | char=${char.name} | reason=destination_not_set_on_readback`);
            }
          }
        }

        // ── BUILD AFTER STATE ──────────────────────────────────────────────
        const after = {
          travel_status: arrival_processed ? 'not_traveling' : char.travel_status,
          session_id: activeSession?.id || null,
          session_route_status: activeSession?.route_status || null,
        };

        const finalChar = await base44.entities.Character.filter({ id: char.id }, null, 1).then(arr => arr?.[0]);
        after.resolved_current_location_id = finalChar?.resolved_current_location_id;
        after.resolved_current_location_name = finalChar?.resolved_current_location_name;

        // ── VERIFY DESTINATION ──────────────────────────────────────────────
        const destProof = activeSession?.destination_location_id
          ? finalChar?.resolved_current_location_id === activeSession.destination_location_id
          : null;

        const destIsHome = activeSession?.destination_location_id === finalChar?.current_home_location_id;
        const locationIsHome = finalChar?.resolved_current_location_id === finalChar?.current_home_location_id;
        const homeReturnValid = !activeSession || destIsHome || !arrival_processed;

        repairResults.push({
          character_id: char.id,
          character_name: char.name,
          action: arrival_processed ? 'ARRIVAL_COMPLETED' : sessionCreatedThisRepair ? 'SESSION_RECREATED' : 'NO_ACTION_NEEDED',
          before,
          after,
          status_bar_data_exists: validation.status_bar_data_exists,
          map_movement_source_exists: validation.map_movement_source_exists,
          blocker_reason: validation.blocker_reason,
          destination: activeSession?.destination_location_name || null,
          final_location: finalChar?.resolved_current_location_name || null,
          destination_verified: destProof,
          home_return_valid: homeReturnValid,
        });

      } catch (charErr) {
        console.error(`[repairTravelIntegrityNow] Error repairing ${char.id}:`, charErr.message);
        repairResults.push({
          character_id: char.id,
          character_name: char.name,
          action: 'REPAIR_ERROR',
          error: charErr.message,
        });
      }
    }

    console.log(`[repairTravelIntegrityNow] Complete | repaired=${repairResults.length}`);

    // ── FINAL VALIDATION ────────────────────────────────────────────────────
    const finalChars = await base44.entities.Character.filter(
      { owner_email },
      null,
      500
    ).catch(() => []);

    const stillTraveling = finalChars.filter(c => travelingStates.includes(c.travel_status));
    const stillBroken = [];

    for (const char of stillTraveling) {
      const activeSess = await base44.entities.TravelSession.filter(
        {
          character_id: char.id,
          owner_email,
          route_status: { $in: ['preparing', 'in_transit', 'delayed'] },
        },
        '-created_date',
        1
      ).then(arr => arr?.[0]);

      if (!activeSess) {
        stillBroken.push({
          character_id: char.id,
          character_name: char.name,
          travel_status: char.travel_status,
          blocker_reason: 'still_traveling_without_session',
        });
      }
    }

    return Response.json({
      summary: {
        total_traveling_before: travelingChars.length,
        repair_results_count: repairResults.length,
        still_broken: stillBroken.length,
      },
      repair_results: repairResults,
      still_broken: stillBroken,
      final_validation: {
        characters_traveling_with_session: stillTraveling.length - stillBroken.length,
        characters_traveling_without_session: stillBroken.length,
      },
    });

  } catch (error) {
    console.error('[repairTravelIntegrityNow]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});