import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, fromLocationId, toLocationId } = await req.json();

    if (!characterId || !toLocationId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Fetch the character to get current home
    const characters = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    const character = characters[0];

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Fetch both locations
    const locations = await base44.asServiceRole.entities.LocationReference.filter({
      id: { $in: [toLocationId, ...(fromLocationId ? [fromLocationId] : [])] }
    });

    const toLocation = locations.find(l => l.id === toLocationId);
    if (!toLocation) {
      return Response.json({ error: 'Destination location not found' }, { status: 404 });
    }

    // Determine the old home location
    const oldHomeId = fromLocationId || character.current_home_location_id;
    const oldLocation = oldHomeId ? locations.find(l => l.id === oldHomeId) : null;

    // ── ATOMIC UPDATE ──
    // 1. Update character's home location
    await base44.asServiceRole.entities.Character.update(characterId, {
      current_home_location_id: toLocationId,
      resolved_current_location_id: toLocationId,
      resolved_current_location_name: toLocation.name,
    });

    // 2. Remove from old location's resident list
    if (oldLocation) {
      const oldResidents = (oldLocation.resident_character_ids || []).filter(id => id !== characterId);
      await base44.asServiceRole.entities.LocationReference.update(oldHomeId, {
        resident_character_ids: oldResidents,
      });
    }

    // 3. Add to new location's resident list
    const newResidents = [...(toLocation.resident_character_ids || []), characterId];
    await base44.asServiceRole.entities.LocationReference.update(toLocationId, {
      resident_character_ids: newResidents,
    });

    return Response.json({
      success: true,
      character: {
        id: characterId,
        name: character.name,
      },
      fromLocation: oldLocation ? { id: oldHomeId, name: oldLocation.name } : null,
      toLocation: { id: toLocationId, name: toLocation.name },
    });
  } catch (error) {
    console.error('moveCharacterToNewHome error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});