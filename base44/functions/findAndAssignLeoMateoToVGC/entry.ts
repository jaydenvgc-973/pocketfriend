import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * findAndAssignLeoMateoToVGC
 * 
 * Find Leo and Mateo NPCs on adobevgc@gmail.com and assign them to VGC Towers as residents
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'adobevgc@gmail.com';

    // Get all characters on adobevgc@gmail.com
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    // Search for Leo and Mateo in fictional_relationships and family_members
    const npcMap = {};

    for (const char of allChars) {
      // Check fictional_relationships
      if (char.fictional_relationships) {
        for (const rel of char.fictional_relationships) {
          if (rel.person_name === 'Leo' || rel.person_name === 'leo') {
            npcMap['Leo'] = {
              name: 'Leo',
              type: 'fictional_relationship',
              relationship_type: rel.relationship_type,
              source_character_id: char.id,
            };
          }
          if (rel.person_name === 'Mateo' || rel.person_name === 'mateo') {
            npcMap['Mateo'] = {
              name: 'Mateo',
              type: 'fictional_relationship',
              relationship_type: rel.relationship_type,
              source_character_id: char.id,
            };
          }
        }
      }

      // Check family_members
      if (char.family_members) {
        for (const fam of char.family_members) {
          if (fam.name === 'Leo' || fam.name === 'leo') {
            npcMap['Leo'] = {
              name: 'Leo',
              type: 'family_member',
              relationship_type: fam.relationship_type,
              source_character_id: char.id,
            };
          }
          if (fam.name === 'Mateo' || fam.name === 'mateo') {
            npcMap['Mateo'] = {
              name: 'Mateo',
              type: 'family_member',
              relationship_type: fam.relationship_type,
              source_character_id: char.id,
            };
          }
        }
      }
    }

    // Get VGC Towers for this account
    const [vgcByCreated, vgcByOwner] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({
        created_by: targetEmail,
        name: 'VGC Towers',
      }),
      base44.asServiceRole.entities.LocationReference.filter({
        owner_email: targetEmail,
        name: 'VGC Towers',
      }),
    ]);

    const vgc = vgcByCreated[0] || vgcByOwner[0];

    if (!vgc) {
      return Response.json({ error: 'VGC Towers not found on account' }, { status: 400 });
    }

    // Assign Leo and Mateo to VGC Towers as resident_family_members
    const currentFamilyMembers = vgc.resident_family_members || [];

    const toAssign = [];
    for (const [name, npcInfo] of Object.entries(npcMap)) {
      const alreadyResident = currentFamilyMembers.some(f => f.name === name);
      if (!alreadyResident) {
        toAssign.push({
          name: name,
          relationship_type: npcInfo.relationship_type || 'NPC',
          isNPC: true,
        });
      }
    }

    if (toAssign.length > 0) {
      await base44.asServiceRole.entities.LocationReference.update(vgc.id, {
        resident_family_members: [...currentFamilyMembers, ...toAssign],
      });
    }

    return Response.json({
      account_email: targetEmail,
      vgc_towers_id: vgc.id,
      npcs_found: Object.keys(npcMap),
      npcs_assigned: toAssign.map(t => t.name),
      success: true,
    });
  } catch (error) {
    console.error('[findAndAssignLeoMateoToVGC]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});