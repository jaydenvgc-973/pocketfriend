/**
 * testKhalilNaturalTravelDirect
 * 
 * Create and test Khalil's natural travel directly.
 * Uses user-scoped operations since we have auth.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Khalil in user's account
    const allChars = await base44.entities.Character.list('-updated_date', 500);
    const khalil = allChars.find(c =>
      (c.name && c.name.toLowerCase().includes('khalil')) ||
      (c.display_name && c.display_name.toLowerCase().includes('khalil'))
    );

    if (!khalil) {
      return Response.json({
        error: 'Khalil not found',
        checked_characters: allChars.length,
      }, { status: 404 });
    }

    // Get all locations (no filter yet)
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({}, null, 500);

    // Find Khalil's locations by owner match
    const khalilLocs = allLocs.filter(l => l.owner_email === khalil.owner_email);

    if (khalilLocs.length === 0) {
      return Response.json({
        error: 'No locations found matching Khalil\'s owner_email',
        khalil_owner: khalil.owner_email,
        total_locations: allLocs.length,
      }, { status: 400 });
    }

    const beforeLocation = khalil.resolved_current_location_id;
    const beforeLocationName = khalil.resolved_current_location_name;

    // Find destination (different location, same owner)
    const destination = khalilLocs.find(l =>
      l.id !== beforeLocation &&
      l.name &&
      !l.name.toLowerCase().includes('home') &&
      l.category &&
      ['social', 'food_drink', 'public', 'business', 'restaurant', 'bar'].includes(l.category)
    );

    if (!destination) {
      return Response.json({
        error: 'No suitable destination found',
        khalil_owner: khalil.owner_email,
        khalil_locations_count: khalilLocs.length,
        khalil_locations: khalilLocs.slice(0, 5).map(l => ({ id: l.id, name: l.name, owner: l.owner_email })),
      }, { status: 400 });
    }

    // Verify ownership
    if (destination.owner_email !== khalil.owner_email) {
      return Response.json({
        error: 'Destination ownership mismatch',
        char_owner: khalil.owner_email,
        dest_owner: destination.owner_email,
      }, { status: 403 });
    }

    console.log(`[testKhalilNaturalTravelDirect] Khalil: ${khalil.name}, owner: ${khalil.owner_email}`);
    console.log(`[testKhalilNaturalTravelDirect] Origin: ${beforeLocationName}, Dest: ${destination.name}`);

    // CREATE SESSION
    const now = new Date();
    const eta = new Date(now.getTime() + 5 * 60 * 1000);

    const session = await base44.entities.TravelSession.create({
      character_id: khalil.id,
      character_name: khalil.name,
      owner_email: khalil.owner_email,
      origin_location_id: beforeLocation,
      origin_location_name: beforeLocationName,
      destination_location_id: destination.id,
      destination_location_name: destination.name,
      travel_reason: 'natural_test_travel',
      travel_source: 'autonomous_want',
      travel_mode: 'walking',
      estimated_departure_time: now.toISOString(),
      estimated_arrival_time: eta.toISOString(),
      duration_minutes: 5,
      progress_percent: 0,
      route_status: 'in_transit',
      last_progress_update: now.toISOString(),
    });

    console.log(`[testKhalilNaturalTravelDirect] Session created: ${session.id}`);

    // UPDATE CHARACTER
    await base44.entities.Character.update(khalil.id, {
      travel_status: 'traveling',
      traveling_to_location_id: destination.id,
      traveling_to_location_name: destination.name,
      travel_destination_location_id: destination.id,
    });

    console.log(`[testKhalilNaturalTravelDirect] Character marked traveling`);

    // Wait for natural arrival
    let checkCount = 0;
    let arrivedNaturally = false;
    let finalSession = null;

    while (checkCount < 12) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 sec
      checkCount++;

      const [currentSession] = await base44.asServiceRole.entities.TravelSession.filter(
        { id: session.id },
        null,
        1
      );

      const [currentKhalil] = await base44.entities.Character.filter({ id: khalil.id }, null, 1);

      console.log(`[testKhalilNaturalTravelDirect] Check #${checkCount}: status=${currentSession?.route_status}, progress=${currentSession?.progress_percent}%`);

      if (currentSession?.route_status === 'arrived') {
        arrivedNaturally = true;
        finalSession = currentSession;
        break;
      }
    }

    const [khalilFinal] = await base44.entities.Character.filter({ id: khalil.id }, null, 1);

    const success =
      arrivedNaturally &&
      khalilFinal?.resolved_current_location_id === destination.id &&
      khalilFinal?.travel_status === 'not_traveling';

    return Response.json({
      success,
      result: success ? 'PASSED ✅' : 'FAILED ❌',
      CHARACTER: { id: khalil.id, name: khalil.name, owner_email: khalil.owner_email },
      BEFORE: { location: beforeLocationName, travel_status: khalil.travel_status },
      DESTINATION: { id: destination.id, name: destination.name, owner_email: destination.owner_email },
      SESSION: { id: session.id, final_status: finalSession?.route_status },
      AFTER: { location: khalilFinal?.resolved_current_location_name, travel_status: khalilFinal?.travel_status },
      natural_arrival: arrivedNaturally,
      checks: checkCount,
      ownership_match: khalil.owner_email === destination.owner_email,
    });

  } catch (error) {
    console.error('[testKhalilNaturalTravelDirect]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});