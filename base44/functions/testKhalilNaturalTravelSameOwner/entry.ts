/**
 * testKhalilNaturalTravelSameOwner
 * 
 * Test Khalil's natural 5-minute trip using VERIFIED SAME-OWNER locations only.
 * This time, ownership validation will REJECT the cross-owner destination before session creation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Khalil
    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 500);
    const khalil = allChars.find(c =>
      (c.name && c.name.toLowerCase().includes('khalil')) ||
      (c.display_name && c.display_name.toLowerCase().includes('khalil'))
    );

    if (!khalil) {
      return Response.json({ error: 'Khalil not found in user account' }, { status: 404 });
    }

    console.log(`[testKhalilNaturalTravelSameOwner] Found Khalil: ${khalil.name} (${khalil.id}), owner: ${khalil.owner_email}`);

    // Get ONLY same-owner locations
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({}, null, 500);
    const khalilLocs = allLocs.filter(l => l.owner_email === khalil.owner_email);

    if (khalilLocs.length === 0) {
      return Response.json({
        error: 'No same-owner locations found for Khalil',
        khalil_owner: khalil.owner_email,
        total_locations_in_system: allLocs.length,
      }, { status: 400 });
    }

    console.log(`[testKhalilNaturalTravelSameOwner] Same-owner locations: ${khalilLocs.length}`);

    const beforeLocation = khalil.resolved_current_location_id;
    const beforeLocationName = khalil.resolved_current_location_name;

    // Find a destination (same owner, different location, suitable category)
    const destination = khalilLocs.find(l =>
      l.id !== beforeLocation &&
      l.name &&
      !l.name.toLowerCase().includes('home') &&
      l.category &&
      ['social', 'food_drink', 'public', 'business', 'restaurant', 'bar'].includes(l.category)
    );

    if (!destination) {
      return Response.json({
        error: 'No suitable same-owner destination found',
        khalil_owner: khalil.owner_email,
        khalil_same_owner_locations: khalilLocs.map(l => ({ id: l.id, name: l.name, category: l.category })),
      }, { status: 400 });
    }

    // VERIFY ownership
    if (destination.owner_email !== khalil.owner_email) {
      return Response.json({
        error: 'INTERNAL ERROR: Destination ownership mismatch',
        char_owner: khalil.owner_email,
        dest_owner: destination.owner_email,
      }, { status: 500 });
    }

    console.log(`[testKhalilNaturalTravelSameOwner] ✅ Origin: ${beforeLocationName}, Destination: ${destination.name}, owner: ${destination.owner_email}`);

    // CREATE SESSION (now with ownership guardrail in place)
    const sessionRes = await base44.asServiceRole.functions.invoke('createTravelSession', {
      characterId: khalil.id,
      destinationLocationId: destination.id,
      travelReason: 'natural_same_owner_test',
      travelSource: 'autonomous_want',
      ownerEmail: khalil.owner_email,
      characterData: khalil,
    });

    if (!sessionRes.data?.success) {
      return Response.json({
        error: 'Travel session creation failed',
        reason: sessionRes.data?.error || sessionRes.data?.blocker_reason,
        blocker: sessionRes.data?.blocker,
        details: sessionRes.data,
      }, { status: 400 });
    }

    const sessionId = sessionRes.data.session_id;
    const eta = new Date(sessionRes.data.estimated_arrival);

    console.log(`[testKhalilNaturalTravelSameOwner] Session created: ${sessionId}, ETA: ${eta.toISOString()}`);

    // PROOF BEFORE
    const proofBefore = {
      khalil: { id: khalil.id, name: khalil.name, owner_email: khalil.owner_email },
      origin: { id: beforeLocation, name: beforeLocationName, owner_email: khalilLocs.find(l => l.id === beforeLocation)?.owner_email },
      destination: { id: destination.id, name: destination.name, owner_email: destination.owner_email },
      session: { id: sessionId, eta: eta.toISOString(), duration_minutes: sessionRes.data.duration_minutes },
      ownership_match: khalil.owner_email === destination.owner_email,
    };

    // Wait for natural arrival
    let checkCount = 0;
    let arrivedNaturally = false;
    let finalSession = null;
    let finalKhalil = null;

    while (checkCount < 12 && !arrivedNaturally) {
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 sec
      checkCount++;

      const [currentSession] = await base44.asServiceRole.entities.TravelSession.filter(
        { id: sessionId },
        null,
        1
      );

      const [currentKhalil] = await base44.entities.Character.filter({ id: khalil.id }, null, 1);

      console.log(`[testKhalilNaturalTravelSameOwner] Check #${checkCount}: status=${currentSession?.route_status}, progress=${currentSession?.progress_percent}%, khalil_location=${currentKhalil?.resolved_current_location_name}`);

      if (currentSession?.route_status === 'arrived') {
        arrivedNaturally = true;
        finalSession = currentSession;
        finalKhalil = currentKhalil;
        break;
      }
    }

    // VERIFICATION
    const success =
      arrivedNaturally &&
      finalSession?.route_status === 'arrived' &&
      finalKhalil?.resolved_current_location_id === destination.id &&
      finalKhalil?.travel_status === 'not_traveling' &&
      !finalKhalil?.traveling_to_location_id;

    return Response.json({
      success,
      result: success ? 'PASSED ✅' : 'FAILED ❌',
      BEFORE: proofBefore,
      AFTER: {
        khalil_location: finalKhalil?.resolved_current_location_name,
        khalil_location_id: finalKhalil?.resolved_current_location_id,
        khalil_travel_status: finalKhalil?.travel_status,
        khalil_traveling_to: finalKhalil?.traveling_to_location_id,
        session_status: finalSession?.route_status,
        session_actual_arrival: finalSession?.actual_arrival_time,
      },
      NATURAL_ARRIVAL: {
        arrived: arrivedNaturally,
        checks_performed: checkCount,
        total_check_time_seconds: checkCount * 30,
      },
      OWNERSHIP_VERIFIED: {
        character_owner: khalil.owner_email,
        origin_owner: khalilLocs.find(l => l.id === beforeLocation)?.owner_email,
        destination_owner: destination.owner_email,
        all_same: khalil.owner_email === destination.owner_email,
      },
    });

  } catch (error) {
    console.error('[testKhalilNaturalTravelSameOwner]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});