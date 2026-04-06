import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterName, homeName } = await req.json();
    
    if (!characterName || !homeName) {
      return Response.json({ error: 'characterName and homeName required' }, { status: 400 });
    }

    // Get the character
    const characters = await base44.entities.Character.filter(
      { name: characterName, created_by: user.email }
    );
    
    if (characters.length === 0) {
      return Response.json({ error: `Character ${characterName} not found` }, { status: 404 });
    }

    const character = characters[0];

    // Get the location
    const locations = await base44.entities.LocationReference.filter(
      { name: homeName, created_by: user.email }
    );
    
    if (locations.length === 0) {
      return Response.json({ error: `Location ${homeName} not found` }, { status: 404 });
    }

    const location = locations[0];

    // Add character as resident
    const currentResidents = location.resident_character_ids || [];
    const currentNames = location.resident_character_names || [];
    
    if (!currentResidents.includes(character.id)) {
      currentResidents.push(character.id);
      currentNames.push(character.name);
      
      await base44.entities.LocationReference.update(location.id, {
        resident_character_ids: currentResidents,
        resident_character_names: currentNames
      });
    }

    // Update character's home location
    await base44.entities.Character.update(character.id, {
      current_home_location_id: location.id,
      current_location_id: location.id
    });

    return Response.json({
      success: true,
      message: `${characterName} assigned to ${homeName}`,
      characterId: character.id,
      locationId: location.id
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});