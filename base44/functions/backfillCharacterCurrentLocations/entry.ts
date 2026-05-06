import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ owner_email: user.email });
    const locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    
    const backfilled = [];
    const skipped = [];

    for (const char of characters) {
      // Skip if already has current_location_id
      if (char.current_location_id) {
        skipped.push({ characterId: char.id, name: char.name, reason: 'Already has current_location_id' });
        continue;
      }

      // Assign home location as default current location
      const homeLocationId = char.current_home_location_id;
      if (homeLocationId && locations.some(l => l.id === homeLocationId)) {
        const homeLocation = locations.find(l => l.id === homeLocationId);
        await base44.entities.Character.update(char.id, {
          current_location_id: homeLocationId,
        });
        backfilled.push({
          characterId: char.id,
          name: char.name,
          assignedLocation: homeLocation.name,
          locationId: homeLocationId,
        });
      } else {
        skipped.push({ characterId: char.id, name: char.name, reason: 'No current_home_location_id set' });
      }
    }

    return Response.json({
      backfilled,
      skipped,
      total: characters.length,
      backfilledCount: backfilled.length,
      skippedCount: skipped.length,
      recommendation: backfilled.length > 0 
        ? `Backfilled ${backfilled.length} characters. Current location now synced with home location.`
        : 'No characters needed backfilling.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});