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
    
    // Filter for valid NPC travel locations (non-residential)
    const validNPCLocations = allLocations.filter(loc => {
      const isResidential = loc.category === 'home';
      const isValidCategory = ['food_drink', 'gym', 'social', 'outdoor', 'business'].includes(loc.category);
      return !isResidential && isValidCategory;
    });

    if (validNPCLocations.length === 0) {
      return Response.json({ error: 'No valid NPC travel locations found' }, { status: 400 });
    }

    // Get all active characters
    const characters = await base44.entities.Character.filter({ 
      created_by: user.email, 
      status: 'active' 
    });

    // Collect all NPCs from fictional_relationships
    const allNPCs = [];
    const npcUpdateMap = {}; // { characterId: { relationshipIndex: idx, npcName: name, newLocationId: id } }

    characters.forEach(char => {
      if (!char.fictional_relationships) return;
      char.fictional_relationships.forEach((rel, idx) => {
        if (!rel.related_character_id && rel.person_name) {
          allNPCs.push({ characterId: char.id, relationshipIdx: idx, npcName: rel.person_name });
        }
      });
    });

    if (allNPCs.length === 0) {
      return Response.json({ message: 'No NPCs to rotate' }, { status: 200 });
    }

    // Distribute NPCs evenly across valid locations
    allNPCs.forEach((npc, i) => {
      const locationIdx = i % validNPCLocations.length;
      const newLocation = validNPCLocations[locationIdx];
      
      if (!npcUpdateMap[npc.characterId]) {
        npcUpdateMap[npc.characterId] = [];
      }
      npcUpdateMap[npc.characterId].push({
        relationshipIdx: npc.relationshipIdx,
        newLocationId: newLocation.id,
      });
    });

    // Update characters with new NPC locations
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
      message: `Rotated ${allNPCs.length} NPCs across ${validNPCLocations.length} locations`,
      charactersUpdated: updatedCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});