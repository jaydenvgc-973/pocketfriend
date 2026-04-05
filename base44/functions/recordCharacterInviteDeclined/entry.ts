import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationId } = await req.json();
    if (!characterId || !locationId) {
      return Response.json({ error: 'Missing characterId or locationId' }, { status: 400 });
    }

    // Get character and location data
    const char = await base44.entities.Character.filter({ id: characterId });
    const loc = await base44.entities.LocationReference.filter({ id: locationId });

    if (char.length === 0 || loc.length === 0) {
      return Response.json({ error: 'Character or location not found' }, { status: 404 });
    }

    const character = char[0];
    const location = loc[0];
    const displayName = (await base44.entities.UserSettings.list())[0]?.fictional_world_name || user.full_name || 'you';

    // Create a memory that the user declined the invite
    const memoryText = `${character.name} invited ${displayName} to ${location.name} but ${displayName} declined`;

    const memory = {
      character_id: characterId,
      memory_type: 'event',
      memory_text: memoryText,
      memory_summary: `Invitation to ${location.name} was declined`,
      related_location_id: locationId,
      importance_score: 5,
      confidence_score: 1,
      permanence: 'long_term',
      validation_status: 'confirmed',
    };

    await base44.entities.CharacterMemory.create(memory);

    return Response.json({ success: true, memory });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});