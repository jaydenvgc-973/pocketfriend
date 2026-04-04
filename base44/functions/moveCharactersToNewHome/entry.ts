import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      sourceHomeId,
      destinationHomeId,
      moversToMove = [],
      newHomeName,
    } = await req.json();

    if (!sourceHomeId || !destinationHomeId || !Array.isArray(moversToMove) || moversToMove.length === 0) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Fetch both homes
    const sourceHome = await base44.entities.LocationReference.filter({ id: sourceHomeId });
    const destHome = await base44.entities.LocationReference.filter({ id: destinationHomeId });

    if (sourceHome.length === 0 || destHome.length === 0) {
      return Response.json({ error: 'Home not found' }, { status: 404 });
    }

    const source = sourceHome[0];
    const dest = destHome[0];

    // Update destination home
    const destResidents = new Set(dest.resident_character_ids || []);
    const destNames = new Set(dest.resident_character_names || []);

    const movedCharacters = [];
    for (const moverId of moversToMove) {
      const char = await base44.entities.Character.filter({ id: moverId });
      if (char.length > 0) {
        destResidents.add(moverId);
        destNames.add(char[0].name);
        movedCharacters.push(char[0]);
      }
    }

    await base44.entities.LocationReference.update(destinationHomeId, {
      name: newHomeName || dest.name,
      resident_character_ids: Array.from(destResidents),
      resident_character_names: Array.from(destNames),
    });

    // Update source home (remove movers)
    const sourceResidents = (source.resident_character_ids || []).filter(
      id => !moversToMove.includes(id)
    );
    const sourceNames = source.resident_character_names ? 
      source.resident_character_names.filter(name =>
        !movedCharacters.some(c => c.name === name)
      ) : [];

    await base44.entities.LocationReference.update(sourceHomeId, {
      resident_character_ids: sourceResidents,
      resident_character_names: sourceNames,
    });

    // Update each character's home reference
    for (const moverId of moversToMove) {
      const char = await base44.entities.Character.filter({ id: moverId });
      if (char.length > 0) {
        await base44.entities.Character.update(moverId, {
          current_home_location_id: destinationHomeId,
        });
      }
    }

    // Create memory of the move
    for (const movedChar of movedCharacters) {
      const memory = await base44.entities.CharacterMemory.create({
        character_id: movedChar.id,
        memory_type: 'event',
        memory_text: `Moved into ${newHomeName || dest.name}`,
        memory_summary: `Moved to a new home`,
        importance_score: 8,
      });
    }

    return Response.json({
      success: true,
      movedCount: moversToMove.length,
      destinationName: newHomeName || dest.name,
      sourceRemainingCount: sourceResidents.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});