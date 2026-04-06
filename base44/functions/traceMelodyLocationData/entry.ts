import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * DIAGNOSTIC: Trace Melody's exact location data to identify why the UI is showing "at gym" instead of "at VGC Gym"
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find Melody
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const melody = characters.find(c => c.name === 'Melody Jackson Perry' || c.name === 'Melody');

    if (!melody) {
      return Response.json({
        error: 'Melody not found',
        charactersInDb: characters.map(c => ({ id: c.id, name: c.name }))
      });
    }

    // Trace Melody's location data
    const locationTrace = {
      characterId: melody.id,
      characterName: melody.name,
      emotionalState: melody.emotional_state,
      currentActivity: melody.current_activity,
      currentLocationId: melody.current_location_id,
      currentHomeLoc: melody.current_home_location_id,
      occupationLocationId: melody.occupation_location_id
    };

    // If she has a current_location_id, fetch that location
    if (melody.current_location_id) {
      const locations = await base44.entities.LocationReference.list();
      const currentLoc = locations.find(l => l.id === melody.current_location_id);
      
      if (!currentLoc) {
        locationTrace.currentLocationError = `Location ID ${melody.current_location_id} NOT FOUND in database`;
        locationTrace.allLocationIds = locations.map(l => l.id);
      } else {
        locationTrace.currentLocation = {
          id: currentLoc.id,
          name: currentLoc.name,
          category: currentLoc.category,
          type: currentLoc.location_type
        };
      }
    }

    // Also fetch all locations to verify data
    const allLocs = await base44.entities.LocationReference.list();
    const vgcGym = allLocs.find(l => l.name === 'VGC Gym');

    locationTrace.vgcGymLookup = vgcGym ? {
      id: vgcGym.id,
      name: vgcGym.name,
      category: vgcGym.category,
      type: vgcGym.location_type
    } : 'NOT FOUND';

    locationTrace.totalLocationsInDb = allLocs.length;

    return Response.json(locationTrace);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});