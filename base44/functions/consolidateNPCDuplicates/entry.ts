import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Map of NPC names to delete (active character duplicates)
    const npcDuplicatesToDelete = ['Ethan', 'Nathan', 'Nate', 'James', 'James Anderson ', 'Matt'];

    // Map of pure NPC merges (keep first, delete others)
    const npcMergePairs = [
      { keep: 'Leo Parker', delete: ['Leo'] },
      { keep: 'little guy', delete: ['him', 'Unnamed baby'] },
      { keep: 'Carlos Mendez', delete: ['Carlos'] },
      { keep: 'Thomas Anderson', delete: ['Thomas'] },
      { keep: 'Vanessa', delete: ['Vanessa '] },
      { keep: 'Jordan Li', delete: ['Jordan'] },
      { keep: 'Jayden Jackson', delete: ['Jayden'] },
    ];

    // Get all characters
    const allChars = await base44.asServiceRole.entities.Character.list();
    
    // Get NPC Hub location
    const locations = await base44.asServiceRole.entities.LocationReference.list();
    const npcHub = locations.find(l => l.name === 'NPC Hub');

    if (!npcHub) {
      return Response.json({ error: 'NPC Hub not found' }, { status: 404 });
    }

    let npcHubUpdated = { ...npcHub };
    let deletedCount = 0;
    let mergedCount = 0;

    // Delete active character duplicates
    for (const npcName of npcDuplicatesToDelete) {
      const npcChar = allChars.find(c => c.name === npcName && c.status === 'active');
      if (npcChar) {
        await base44.asServiceRole.entities.Character.delete(npcChar.id);
        // Remove from NPC Hub
        npcHubUpdated.resident_character_ids = npcHubUpdated.resident_character_ids.filter(id => id !== npcChar.id);
        npcHubUpdated.resident_character_names = npcHubUpdated.resident_character_names.filter(n => n !== npcName);
        deletedCount++;
      }
    }

    // Merge pure NPC duplicates
    for (const pair of npcMergePairs) {
      for (const delName of pair.delete) {
        const npcChar = allChars.find(c => c.name === delName && c.status === 'active');
        if (npcChar) {
          await base44.asServiceRole.entities.Character.delete(npcChar.id);
          // Remove from NPC Hub
          npcHubUpdated.resident_character_ids = npcHubUpdated.resident_character_ids.filter(id => id !== npcChar.id);
          npcHubUpdated.resident_character_names = npcHubUpdated.resident_character_names.filter(n => n !== delName);
          mergedCount++;
        }
      }
    }

    // Update NPC Hub
    if (npcHub.id) {
      await base44.asServiceRole.entities.LocationReference.update(npcHub.id, {
        resident_character_ids: npcHubUpdated.resident_character_ids,
        resident_character_names: npcHubUpdated.resident_character_names,
      });
    }

    return Response.json({
      success: true,
      deleted_active_char_duplicates: deletedCount,
      merged_npc_duplicates: mergedCount,
      total_removed: deletedCount + mergedCount,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});