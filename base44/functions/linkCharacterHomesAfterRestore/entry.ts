import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * linkCharacterHomesAfterRestore
 * 
 * Links the restored home locations back to characters.
 * Ensures each character's home_location_id points to their home.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all characters
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    // Fetch all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: user.email
    });

    const linked = [];

    // For each character, find their home location and link it
    for (const character of allCharacters) {
      // Skip if already has home
      if (character.home_location_id) continue;

      // Find home for this character
      const home = allLocations.find(loc => 
        (loc.category === 'home' && 
         (loc.character_id === character.id || 
          loc.resident_character_ids?.includes(character.id) ||
          loc.owner_character_id === character.id)) ||
        (loc.category === 'home' && 
         loc.character_name?.toLowerCase() === character.name.toLowerCase())
      );

      if (home) {
        await base44.asServiceRole.entities.Character.update(character.id, {
          home_location_id: home.id
        });
        
        linked.push({
          character: character.name,
          characterId: character.id,
          homeId: home.id,
          homeName: home.name,
        });
      }
    }

    // Verify
    const verifiedChars = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    const verified = verifiedChars
      .filter(c => c.home_location_id)
      .map(c => ({
        character: c.name,
        homeId: c.home_location_id,
      }));

    return Response.json({
      success: true,
      linked: linked.length,
      totalWithHomes: verified.length,
      linkedDetails: linked,
      verified,
      summary: `Linked ${linked.length} characters to their homes. Total characters with homes: ${verified.length}`,
    });
  } catch (error) {
    console.error('[linkCharacterHomesAfterRestore]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});