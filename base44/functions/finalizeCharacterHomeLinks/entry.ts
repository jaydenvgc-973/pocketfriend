import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * finalizeCharacterHomeLinks
 * 
 * Final step: directly update all characters to link to their restored homes.
 * Explicitly updates the home_location_id field for each character.
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

    // Fetch all home locations
    const allHomes = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: user.email,
      category: 'home'
    });

    const updated = [];
    const targetNames = ['Ethan Nathan Thompson', 'Nathan Parker', 'James Anderson', 'Jonathan', 'Lila Green', 'Brian Anderson', 'Andre Rivera', 'Melody Jackson Perry', 'Matt'];

    // For each character, find and link their home
    for (const character of allCharacters) {
      if (!targetNames.some(n => n.toLowerCase() === character.name?.toLowerCase())) continue;
      if (character.home_location_id) continue; // Already has home

      // Find matching home
      const home = allHomes.find(h => 
        h.character_id === character.id ||
        h.character_name?.toLowerCase() === character.name?.toLowerCase() ||
        h.resident_character_ids?.includes(character.id)
      );

      if (home) {
        // Update character with home_location_id
        await base44.asServiceRole.entities.Character.update(character.id, {
          home_location_id: home.id
        });
        
        updated.push({
          character: character.name,
          homeId: home.id,
          homeName: home.name,
        });
      }
    }

    // Verify all updates took effect
    const verifyChars = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    const withHomes = verifyChars.filter(c => c.home_location_id).map(c => ({
      character: c.name,
      homeId: c.home_location_id,
    }));

    return Response.json({
      success: true,
      updated: updated.length,
      totalWithHomes: withHomes.length,
      details: updated,
      verified: withHomes,
      summary: `Updated ${updated.length} characters with home links. Total characters with homes: ${withHomes.length}`,
    });
  } catch (error) {
    console.error('[finalizeCharacterHomeLinks]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});