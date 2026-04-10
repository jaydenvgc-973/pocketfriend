import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters
    const characters = await base44.asServiceRole.entities.Character.list('-created_date', 100);
    
    // Get all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 200);

    // Analyze ownership
    const analysis = {
      totalCharacters: characters.length,
      totalLocations: allLocations.length,
      charactersWithOwnership: [],
      locationsWithOwner: [],
      locationsWithoutOwner: [],
      issues: []
    };

    // Find locations with owner_character_id set
    allLocations.forEach(loc => {
      if (loc.owner_character_id) {
        analysis.locationsWithOwner.push({
          id: loc.id,
          name: loc.name,
          owner_character_id: loc.owner_character_id,
          owner_character_name: loc.owner_character_name
        });
      } else {
        analysis.locationsWithoutOwner.push({
          id: loc.id,
          name: loc.name,
          note: 'No owner_character_id set'
        });
      }
    });

    // Find characters and their work locations
    characters.forEach(char => {
      const worksAt = allLocations.filter(loc => 
        loc.worker_character_ids?.includes(char.id)
      );
      const livesAt = allLocations.filter(loc =>
        loc.resident_character_ids?.includes(char.id)
      );
      const owns = allLocations.filter(loc =>
        loc.owner_character_id === char.id
      );

      if (owns.length > 0 || worksAt.length > 0 || livesAt.length > 0) {
        analysis.charactersWithOwnership.push({
          character_id: char.id,
          character_name: char.name,
          owns: owns.map(l => ({ id: l.id, name: l.name })),
          worksAt: worksAt.map(l => ({ id: l.id, name: l.name })),
          livesAt: livesAt.map(l => ({ id: l.id, name: l.name }))
        });
      }
    });

    // Identify issues
    if (analysis.locationsWithOwner.length === 0) {
      analysis.issues.push('NO LOCATIONS HAVE OWNER_CHARACTER_ID SET - This is the problem!');
    }
    if (analysis.locationsWithoutOwner.length > analysis.locationsWithOwner.length) {
      analysis.issues.push('Most locations have no owner assigned');
    }

    return Response.json(analysis);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});