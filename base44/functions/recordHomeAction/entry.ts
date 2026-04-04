import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      characterId,
      homeLocationId,
      actionType,
      actionDetails = {},
    } = await req.json();

    if (!characterId || !homeLocationId || !actionType) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    // Fetch character and home
    const chars = await base44.entities.Character.filter({ id: characterId });
    const homes = await base44.entities.LocationReference.filter({ id: homeLocationId });

    if (chars.length === 0 || homes.length === 0) {
      return Response.json({ error: 'Character or home not found' }, { status: 404 });
    }

    const character = chars[0];
    const home = homes[0];

    // Handle different action types
    const actionMap = {
      clean: `Cleaned up ${home.name}`,
      air_out: `Aired out rooms in ${home.name}`,
      throw_out: `Threw out trash at ${home.name}`,
      inspect: `Inspected damage at ${home.name}`,
      organize: `Organized ${home.name}`,
      cook: `Cooked at ${home.name}`,
      decorate: `Decorated ${home.name}`,
      paint: `Painted a room at ${home.name}`,
      unpack: `Unpacked at ${home.name}`,
      help_clean: `Helped clean at ${home.name}`,
      relax: `Relaxed at ${home.name}`,
      use_fridge: `Used the fridge at ${home.name}`,
    };

    const memoryText = actionMap[actionType] || `Did something at ${home.name}`;

    // Create memory
    const memory = await base44.entities.CharacterMemory.create({
      character_id: characterId,
      memory_type: 'event',
      memory_text: memoryText,
      memory_summary: memoryText,
      related_location_id: homeLocationId,
      importance_score: 3,
    });

    // If action involves changing home description, update it
    if (['clean', 'decorate', 'paint', 'air_out'].includes(actionType)) {
      const currentDesc = home.description || '';
      const actionDescriptions = {
        clean: 'freshly cleaned',
        air_out: 'well-aired',
        paint: 'newly painted',
        decorate: 'decorated',
      };

      const newDesc = currentDesc.includes(actionDescriptions[actionType])
        ? currentDesc
        : `${currentDesc} ${actionDescriptions[actionType]}`.trim();

      await base44.entities.LocationReference.update(homeLocationId, {
        description: newDesc,
      });
    }

    return Response.json({
      success: true,
      memoryId: memory.id,
      action: actionType,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});