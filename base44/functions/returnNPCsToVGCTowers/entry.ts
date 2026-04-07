import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all locations
    const allLocations = await base44.entities.LocationReference.list();
    const vgcTowers = allLocations.find(loc => loc.name === 'VGC Towers');
    
    if (!vgcTowers) {
      return Response.json({ error: 'VGC Towers location not found' }, { status: 400 });
    }

    // Get all active characters
    const characters = await base44.entities.Character.filter({ 
      created_by: user.email, 
      status: 'active' 
    });

    const npcUpdateMap = {};
    let returnedCount = 0;

    // Return all NPCs to VGC Towers
    characters.forEach(char => {
      if (!char.fictional_relationships) return;
      
      char.fictional_relationships.forEach((rel, idx) => {
        if (!rel.related_character_id && rel.person_name) {
          if (!npcUpdateMap[char.id]) {
            npcUpdateMap[char.id] = [];
          }
          npcUpdateMap[char.id].push({
            relationshipIdx: idx,
            newLocationId: vgcTowers.id,
          });
          returnedCount++;
        }
      });
    });

    if (returnedCount === 0) {
      return Response.json({ message: 'No NPCs to return' }, { status: 200 });
    }

    // Update characters
    let updatedCount = 0;
    for (const [charId, updates] of Object.entries(npcUpdateMap)) {
      const char = characters.find(c => c.id === charId);
      if (!char || !char.fictional_relationships) continue;

      updates.forEach(upd => {
        if (char.fictional_relationships[upd.relationshipIdx]) {
          char.fictional_relationships[upd.relationshipIdx].current_location_id = upd.newLocationId;
        }
      });

      await base44.entities.Character.update(charId, {
        fictional_relationships: char.fictional_relationships,
      });
      updatedCount++;
    }

    return Response.json({ 
      success: true, 
      message: `Returned ${returnedCount} NPCs to VGC Towers`,
      charactersUpdated: updatedCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});