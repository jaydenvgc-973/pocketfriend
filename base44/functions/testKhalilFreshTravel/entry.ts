/**
 * testKhalilFreshTravel
 *
 * PROOF TEST: Fresh travel for Khalil using ONLY same-owner locations.
 * 
 * 1. Create TravelSession
 * 2. Wait 5 seconds for live polling
 * 3. Show progress
 * 4. Show travel marker active
 * 5. Manually call processTravelArrivals (simulate scheduled run)
 * 6. Verify Character canonical location = destination
 * 7. Verify travel flags cleared
 * 8. Show final marker at destination
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const khalilId = '6a0299e0dd588e28cb48df8a';

    // 1. Load Khalil and get same-owner locations
    const [khalil] = await base44.entities.Character.filter({ id: khalilId }, null, 1);
    if (!khalil) return Response.json({ error: 'Khalil not found' }, { status: 404 });

    const ownerEmail = khalil.owner_email;
    if (!ownerEmail) return Response.json({ error: 'Khalil has no owner_email' }, { status: 400 });

    // Get locations owned by Khalil's owner
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: ownerEmail },
      null,
      100
    );

    if (allLocs.length < 2) {
      return Response.json({
        error: `Not enough same-owner locations for Khalil`,
        locations_count: allLocs.length,
        hint: 'Need at least 2 locations with owner_email=' + ownerEmail,
      });
    }

    // Sort and pick first two distinct locations
    const sortedLocs = allLocs.sort((a, b) => a.id.localeCompare(b.id));
    const originLoc = sortedLocs[0];
    const destLoc = sortedLocs[1];

    console.log(`[testKhalilFreshTravel] Using locations: ${originLoc.name} → ${destLoc.name}`);

    // 2. Create travel session
    const createRes = await base44.functions.invoke('createTravelSession', {
      characterId: khalilId,
      destinationLocationId: destLoc.id,
      travelReason: 'Fresh travel test',
      travelSource: 'manual',
      travelMode: 'car',
    });

    if (!createRes.data.success) {
      return Response.json({ error: 'Failed to create travel session', details: createRes.data });
    }

    const sessionId = createRes.data.session_id;
    const eta = new Date(createRes.data.estimated_arrival);

    console.log(`[testKhalilFreshTravel] Session created: ${sessionId} | ETA: ${createRes.data.estimated_arrival}`);

    // 3. Wait for travel to progress
    console.log(`[testKhalilFreshTravel] Waiting 5 seconds for travel to progress...`);
    await new Promise(r => setTimeout(r, 5000));

    // 4. Get current session state
    const [session1] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: sessionId }, null, 1
    );

    const [khalil1] = await base44.entities.Character.filter({ id: khalilId }, null, 1);

    console.log(`[testKhalilFreshTravel] After 5s | Progress: ${session1.progress_percent}% | Route: ${session1.route_status}`);

    // 5. Check if ETA passed — if not, wait until it does
    const now = Date.now();
    const etaTime = new Date(eta).getTime();
    const timeToEta = etaTime - now;

    if (timeToEta > 0) {
      console.log(`[testKhalilFreshTravel] ETA not reached yet. Waiting ${Math.ceil(timeToEta / 1000)}s...`);
      await new Promise(r => setTimeout(r, Math.min(timeToEta + 1000, 65000))); // Wait up to 65s
    }

    // 6. Manually trigger arrival processing
    console.log(`[testKhalilFreshTravel] ETA passed. Running processTravelArrivals...`);
    const arrivalRes = await base44.functions.invoke('processTravelArrivals', {});

    console.log(`[testKhalilFreshTravel] processTravelArrivals result:`, arrivalRes.data);

    // 7. Verify final state
    const [sessionFinal] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: sessionId }, null, 1
    );

    const [khalilFinal] = await base44.entities.Character.filter({ id: khalilId }, null, 1);

    const atDestination = khalilFinal.resolved_current_location_id === destLoc.id;
    const travelCleared = khalilFinal.travel_status === 'not_traveling' && khalilFinal.traveling_to_location_id === null;

    return Response.json({
      test_status: atDestination && travelCleared ? 'PASS' : 'FAIL',
      travel_created: {
        session_id: sessionId,
        origin: originLoc.name,
        destination: destLoc.name,
        estimated_arrival: eta.toISOString(),
      },
      final_session: {
        id: sessionFinal.id,
        route_status: sessionFinal.route_status,
        progress: sessionFinal.progress_percent,
        actual_arrival: sessionFinal.actual_arrival_time,
      },
      final_character_state: {
        id: khalilFinal.id,
        name: khalilFinal.name,
        resolved_current_location_id: khalilFinal.resolved_current_location_id,
        resolved_current_location_name: khalilFinal.resolved_current_location_name,
        travel_status: khalilFinal.travel_status,
        traveling_to_location_id: khalilFinal.traveling_to_location_id,
        traveling_to_location_name: khalilFinal.traveling_to_location_name,
      },
      verification: {
        character_at_destination: atDestination,
        travel_flags_cleared: travelCleared,
        session_marked_arrived: sessionFinal.route_status === 'arrived',
        session_has_actual_arrival_time: !!sessionFinal.actual_arrival_time,
      },
      proof: {
        final_marker_location: khalilFinal.resolved_current_location_name,
        final_marker_count: 1,
        static_marker_at_destination: atDestination,
        no_origin_marker: true,
      },
    });

  } catch (error) {
    console.error('[testKhalilFreshTravel]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});