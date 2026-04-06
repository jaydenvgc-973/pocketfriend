import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find all characters named "Jayden" created by the user (any type, including those created by AI)
    const allCharacters = await base44.entities.Character.filter({ created_by: user.email });
    const jaydenCharacters = allCharacters.filter(c => 
      c.name && c.name.toLowerCase() === 'jayden' && c.id !== user.id
    );

    if (jaydenCharacters.length === 0) {
      return Response.json({ message: 'No Jayden NPCs found', updated: 0, deleted: 0 });
    }

    const jaydenIds = new Set(jaydenCharacters.map(c => c.id));
    let updateCount = 0;
    let deleteCount = 0;

    // 1. Update all CharacterRelationship records that reference Jayden
    const allRelationships = await base44.asServiceRole.entities.CharacterRelationship.list();
    for (const rel of allRelationships) {
      if (jaydenIds.has(rel.source_character_id)) {
        // Replace source_character_id with user ID
        await base44.asServiceRole.entities.CharacterRelationship.update(rel.id, {
          source_character_id: user.id,
        });
        updateCount++;
      }
      if (jaydenIds.has(rel.target_character_id)) {
        // Replace target_character_id with user ID
        await base44.asServiceRole.entities.CharacterRelationship.update(rel.id, {
          target_character_id: user.id,
        });
        updateCount++;
      }
    }

    // 2. Update all LocationReference resident_family_members that mention Jayden
    const allLocations = await base44.asServiceRole.entities.LocationReference.list();
    for (const loc of allLocations) {
      const residents = loc.resident_family_members || [];
      let changed = false;
      const updatedResidents = residents.map(r => {
        if (r.name && r.name.toLowerCase() === 'jayden') {
          changed = true;
          return { ...r, source_character_id: user.id };
        }
        return r;
      });
      
      if (changed) {
        await base44.asServiceRole.entities.LocationReference.update(loc.id, {
          resident_family_members: updatedResidents,
        });
        updateCount++;
      }
    }

    // 3. Delete all Jayden NPC character records
    for (const jaydenChar of jaydenCharacters) {
      await base44.asServiceRole.entities.Character.delete(jaydenChar.id);
      deleteCount++;
    }

    return Response.json({
      success: true,
      message: `Consolidated ${deleteCount} Jayden NPCs into user profile`,
      relationshipsUpdated: updateCount,
      charactersDeleted: deleteCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});