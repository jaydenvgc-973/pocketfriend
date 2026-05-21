/**
 * repairStuckTravelState
 *
 * Repair a character's stuck travel by:
 * 1. Finding their most recent TravelSession
 * 2. Verifying destination location ownership (same account)
 * 3. Moving character to destination only after verification
 * 4. Clearing all travel flags
 * 5. Marking session arrived only after read-back verification
 * 6. Returns before/after proof
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id } = await req.json();
    if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

    // BEFORE STATE
    const [charBefore] = await base44.entities.Character.filter({ id: character_id }, null, 1);
    if (!charBefore) return Response.json({ error: 'Character not found' }, { status: 404 });

    const beforeState = {
      id: charBefore.id,
      name: charBefore.name,
      owner_email: charBefore.owner_email,
      resolved_current_location_id: charBefore.resolved_current_location_id,
      resolved_current_location_name: charBefore.resolved_current_location_name,
      travel_status: charBefore.travel_status,
      traveling_to_location_id: charBefore.traveling_to_location_id,
    };

    // GET MOST RECENT SESSION
    const sessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id },
      '-created_date',
      1
    );
    const mostRecentSession = sessions?.[0];

    if (!mostRecentSession) {
      // No session — just clear stuck flags
      await base44.entities.Character.update(character_id, {
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      });
      const [charAfter] = await base44.entities.Character.filter({ id: character_id }, null, 1);
      return Response.json({
        status: 'repaired_no_session',
        before: beforeState,
        after: {
          id: charAfter.id,
          name: charAfter.name,
          resolved_current_location_id: charAfter.resolved_current_location_id,
          resolved_current_location_name: charAfter.resolved_current_location_name,
          travel_status: charAfter.travel_status,
          traveling_to_location_id: charAfter.traveling_to_location_id,
        },
      });
    }

    // VERIFY DESTINATION LOCATION OWNERSHIP
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: mostRecentSession.destination_location_id },
      null, 1
    );
    if (!destLoc) {
      return Response.json({
        error: `Destination location not found: ${mostRecentSession.destination_location_id}`,
        session_id: mostRecentSession.id,
      }, { status: 400 });
    }

    // Check ownership scope: must be same owner_email OR public/global
    const sameOwner = destLoc.owner_email === charBefore.owner_email;
    const isPublic = destLoc.is_global || destLoc.scope === 'shared';

    if (!sameOwner && !isPublic) {
      return Response.json({
        error: 'Destination location belongs to different account',
        destination_owner: destLoc.owner_email,
        character_owner: charBefore.owner_email,
        session_id: mostRecentSession.id,
      }, { status: 403 });
    }

    // CHECK WHERE CHARACTER IS NOW
    const charAtOrigin = charBefore.resolved_current_location_id === mostRecentSession.origin_location_id;
    const charAtDestination = charBefore.resolved_current_location_id === mostRecentSession.destination_location_id;

    // REPAIR LOGIC
    const now = new Date();

    if (charAtDestination) {
      // Already at destination — just clear travel flags and mark session arrived
      await base44.asServiceRole.entities.TravelSession.update(mostRecentSession.id, {
        route_status: 'arrived',
        progress_percent: 100,
        actual_arrival_time: now.toISOString(),
      });

      await base44.asServiceRole.entities.Character.update(character_id, {
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
      });

      console.log(`[repairStuckTravelState] ${charBefore.name} already at destination. Marked session arrived and cleared flags.`);
    } else {
      // Not at destination — move character there, verify, then mark arrived
      await base44.asServiceRole.entities.Character.update(character_id, {
        resolved_current_location_id: destLoc.id,
        resolved_current_location_name: destLoc.name,
        resolved_presence_status: 'visiting',
        resolved_location_type: 'visit',
        travel_status: 'not_traveling',
        traveling_to_location_id: null,
        traveling_to_location_name: null,
        last_arrived_time: now.toISOString(),
      });

      // Verify by reading back
      const [charVerify] = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1);
      if (charVerify.resolved_current_location_id !== destLoc.id) {
        throw new Error(`Verification failed: character not at destination after update`);
      }

      // Mark session arrived only after verified
      await base44.asServiceRole.entities.TravelSession.update(mostRecentSession.id, {
        route_status: 'arrived',
        progress_percent: 100,
        actual_arrival_time: now.toISOString(),
      });

      console.log(`[repairStuckTravelState] ${charBefore.name} repaired: moved to ${destLoc.name}, cleared flags, marked arrived.`);
    }

    // AFTER STATE
    const [charAfter] = await base44.entities.Character.filter({ id: character_id }, null, 1);
    const [sessionAfter] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: mostRecentSession.id }, null, 1
    );

    return Response.json({
      status: 'repaired',
      character: {
        name: charBefore.name,
        before: beforeState,
        after: {
          id: charAfter.id,
          name: charAfter.name,
          resolved_current_location_id: charAfter.resolved_current_location_id,
          resolved_current_location_name: charAfter.resolved_current_location_name,
          travel_status: charAfter.travel_status,
          traveling_to_location_id: charAfter.traveling_to_location_id,
        },
      },
      session: {
        id: mostRecentSession.id,
        destination_name: mostRecentSession.destination_location_name,
        route_status_after: sessionAfter.route_status,
        actual_arrival_time: sessionAfter.actual_arrival_time,
      },
    });

  } catch (error) {
    console.error('[repairStuckTravelState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});