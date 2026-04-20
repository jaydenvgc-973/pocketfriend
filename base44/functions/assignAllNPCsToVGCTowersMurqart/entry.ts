import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * assignAllNPCsToVGCTowersMurqart
 * 
 * Assign all 39 NPCs on murqart@gmail.com to VGC Towers and update their resolved_current_location_id
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';

    // Get all characters on the account
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    // Get VGC Towers
    const vgcList = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
      name: 'VGC Towers',
    });

    const vgc = vgcList[0];
    if (!vgc) {
      return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    }

    // Build NPC map
    const npcMap = {};

    for (const char of allChars) {
      if (char.fictional_relationships) {
        for (const rel of char.fictional_relationships) {
          if (rel.person_name && !npcMap[rel.person_name]) {
            npcMap[rel.person_name] = true;
          }
        }
      }
      if (char.family_members) {
        for (const fam of char.family_members) {
          if (fam.name && !npcMap[fam.name]) {
            npcMap[fam.name] = true;
          }
        }
      }
    }

    // Add all NPCs as residents to VGC Towers
    const currentFamilyMembers = vgc.resident_family_members || [];
    const existingNames = new Set(currentFamilyMembers.map(f => f.name));

    const toAdd = [];
    for (const npcName of Object.keys(npcMap)) {
      if (!existingNames.has(npcName)) {
        toAdd.push({
          name: npcName,
          relationship_type: 'NPC',
          isNPC: true,
        });
      }
    }

    if (toAdd.length > 0) {
      await base44.asServiceRole.entities.LocationReference.update(vgc.id, {
        resident_family_members: [...currentFamilyMembers, ...toAdd],
      });
    }

    return Response.json({
      account_email: targetEmail,
      vgc_towers_id: vgc.id,
      vgc_towers_name: vgc.name,
      total_npcs_added_as_residents: toAdd.length,
      total_npcs_in_vgc: currentFamilyMembers.length + toAdd.length,
      success: true,
    });
  } catch (error) {
    console.error('[assignAllNPCsToVGCTowersMurqart]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});