import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all locations with ownership
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 200);
    const allCharacters = await base44.asServiceRole.entities.Character.list('-created_date', 100);

    // Find locations with "Anderson" in name or owned by someone
    const andersonBars = allLocations.filter(loc => 
      loc.name?.toLowerCase().includes('anderson') || 
      (loc.owner_character_id && loc.name?.includes('Anderson'))
    );

    const analysis = {
      barsNamedAnderson: andersonBars,
      charactersWhoOwnBars: [],
      missingMemories: []
    };

    // Find characters who own bars
    allLocations.forEach(loc => {
      if (loc.owner_character_id && (loc.category === 'food_drink' || loc.name?.toLowerCase().includes('bar'))) {
        const owner = allCharacters.find(c => c.id === loc.owner_character_id);
        if (owner) {
          // Check if they have a memory about becoming owner
          const hasOwnershipMemory = (owner.fictional_relationships || []).some(r => 
            r.person_name?.toLowerCase().includes('miller') || 
            r.description?.toLowerCase().includes('inherit') ||
            r.description?.toLowerCase().includes('owner')
          );

          analysis.charactersWhoOwnBars.push({
            character_id: owner.id,
            character_name: owner.name,
            owns_location: loc.name,
            location_id: loc.id,
            hasOwnershipMemory: hasOwnershipMemory,
            memories: (owner.fictional_relationships || []).length,
            worksAt: (owner.work_details ? owner.occupation_location_name : 'not set')
          });

          if (!hasOwnershipMemory) {
            analysis.missingMemories.push({
              character: owner.name,
              missing: `Memory of inheriting/becoming owner of ${loc.name}`
            });
          }
        }
      }
    });

    return Response.json(analysis);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});