/**
 * testKhalilNaturalTravelRepaired
 * 
 * Test Khalil's natural 5-minute travel using VERIFIED same-owner locations only.
 * Ownership validation is now built into createTravelSession.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Khalil
    const allChars = await base44.entities.Character.list('-updated_date', 500);
    const khalil = allChars.find(c =>
      (c.name && c.name.toLowerCase().includes('khalil')) ||
      (c.display_name && c.display_name.toLowerCase().includes('khalil'))
    );

    if (!khalil) return Response.json({ error: 'Khalil not found' }, { status: 404 });

    console.log(`[testKhalilNaturalTravelRepaired] Khalil: ${khalil.name} (${khalil.id}), owner: ${khalil.owner_email}`);

    // Get Khalil's locations (filter by owner_email ONLY)
    const khalilLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: khalil.owner_email },
      null,
      100
    );

    if (khalilLocs.length === 0) {
      return Response.json({ error: 'No locations found for Khalil\'s account' }, { status: 400 });
    }

    const beforeLocation = khalil.resolved_current_location_id;
    const beforeLocationName = khalil.resolved_current_location_name;

    // Find a different same-owner location
    const destination = khalilLocs.find(l =>
      l.id !== beforeLocation &&
      l.name &&
      !l.name.includes('Home') &&
      l.category &&
      ['social', 'food_drink', 'public', 'business', 'restaurant'].includes(l.category)
    );

    if (!destination || destination.id === beforeLocation) {
      return Response.json({
        error: 'No suitable same-owner destination found',
        khalil_owner: khalil.owner_email,
        available_locations_count: khalilLocs.length,
      }, { status: 400 });
    }

    // Verify ownership match
    if (destination.owner_email !== khalil.owner_email) {
      return Response.json({
        error: 'Destination ownership mismatch',
        character_owner: khalil.owner_email,
        destination_owner: destination.owner_email,
      }, { status: 403 });
    }

    console.log(`[testKhalilNaturalTravelRepaired] Destination: ${destination.name}, owner: ${destination.owner_email}`);

    // CREATE TRAVEL SESSION (call via asServiceRole)
    let sessionId, estimatedArrival;
    try {
      const sessionRes = await base44.asServiceRole.functions.invoke('createTravelSession', {
        characterId: khalil.id,
        destinationLocationId: destination.id,
        travelReason: 'natural_test_travel',
        travelSource: 'autonomous_want',
        ownerEmail: khalil.owner_email,
        characterData: khalil,
      });

      if (!sessionRes.data?.success) {
        return Response.json({
          error: 'TravelSession creation failed',
          reason: sessionRes.data?.error || sessionRes.data?.blocker_reason,
        }, { status: 400 });
      }

      sessionId = sessionRes.data.session_id;
      estimatedArrival = new Date(sessionRes.data.estimated_arrival);
    } catch (e) {
      return Response.json({
        error: `createTravelSession failed: ${e.message}`,
      }, { status: 500 });
    }

    console.log(`[testKhalilNaturalTravelRepaired] Session: ${sessionId}, ETA: ${estimatedArrival.toISOString()}`);

    // Wait for progress updates and natural arrival
    let checkCount = 0;
    let arrivedNaturally = false;
    let finalSession = null;

    // Check every 30 seconds for 10 minutes max
    while (checkCount < 20) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 sec
      checkCount++;

      const [currentSession] = await base44.asServiceRole.entities.TravelSession.filter(
        { id: sessionId },
        null,
        1
      );

      const [currentKhalil] = await base44.entities.Character.filter({ id: khalil.id }, null, 1);

      console.log(`[testKhalilNaturalTravelRepaired] Check #${checkCount}: status=${currentSession?.route_status}, progress=${currentSession?.progress_percent}%, khalil_at=${currentKhalil?.resolved_current_location_name}`);

      if (currentSession?.route_status === 'arrived') {
        arrivedNaturally = true;
        finalSession = currentSession;
        console.log(`[testKhalilNaturalTravelRepaired] ✅ ARRIVED NATURALLY after ${checkCount * 0.5} minutes`);
        break;
      }
    }

    // Final state
    const [khalilFinal] = await base44.entities.Character.filter({ id: khalil.id }, null, 1);

    const success =
      arrivedNaturally &&
      finalSession?.route_status === 'arrived' &&
      khalilFinal?.resolved_current_location_id === destination.id &&
      khalilFinal?.travel_status === 'not_traveling';

    return Response.json({
      success,
      result: success ? 'PASSED ✅' : 'FAILED ❌',
      CHARACTER: {
        id: khalil.id,
        name: khalil.name,
        owner_email: khalil.owner_email,
      },
      BEFORE: {
        location: beforeLocationName,
        location_id: beforeLocation,
        travel_status: khalil.travel_status,
      },
      ORIGIN: {
        id: khalilLocs.find(l => l.id === beforeLocation)?.id,
        name: beforeLocationName,
        owner_email: khalilLocs.find(l => l.id === beforeLocation)?.owner_email,
      },
      DESTINATION: {
        id: destination.id,
        name: destination.name,
        owner_email: destination.owner_email,
        category: destination.category,
      },
      SESSION: {
        id: sessionId,
        created: new Date().toISOString(),
        estimated_arrival: estimatedArrival.toISOString(),
        final_status: finalSession?.route_status,
        actual_arrival: finalSession?.actual_arrival_time,
      },
      AFTER: {
        location: khalilFinal?.resolved_current_location_name,
        location_id: khalilFinal?.resolved_current_location_id,
        travel_status: khalilFinal?.travel_status,
      },
      natural_arrival: arrivedNaturally,
      checks_performed: checkCount,
      total_check_time_minutes: checkCount * 0.5,
      ownership_validated: khalil.owner_email === destination.owner_email,
    });

  } catch (error) {
    console.error('[testKhalilNaturalTravelRepaired]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});