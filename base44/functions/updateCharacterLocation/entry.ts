import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationId, locationName } = await req.json();
    if (!characterId || !locationId) {
      return Response.json({ error: 'Missing characterId or locationId' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId });
    if (char.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Update character's current location
    await base44.entities.Character.update(characterId, {
      current_location_id: locationId,
      current_location_name: locationName || 'Unknown Location',
    });

    return Response.json({
      success: true,
      characterId,
      locationId,
      locationName,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});