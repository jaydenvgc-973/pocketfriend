import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixNPCLocationsOnMurqart
 * 
 * Find all NPCs with unknown locations on murqart@gmail.com and assign them valid locations
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

    // Build map of NPCs from fictional_relationships and family_members
    const npcMap = {};

    for (const char of allChars) {
      // Check fictional_relationships
      if (char.fictional_relationships) {
        for (const rel of char.fictional_relationships) {
          const npcName = rel.person_name;
          if (npcName && !npcMap[npcName]) {
            npcMap[npcName] = {
              name: npcName,
              relationship_type: rel.relationship_type,
              source_character: char.name,
              current_location_id: null,
            };
          }
        }
      }

      // Check family_members
      if (char.family_members) {
        for (const fam of char.family_members) {
          const npcName = fam.name;
          if (npcName && !npcMap[npcName]) {
            npcMap[npcName] = {
              name: npcName,
              relationship_type: fam.relationship_type,
              source_character: char.name,
              current_location_id: null,
            };
          }
        }
      }
    }

    // Get all locations on the account
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
    });

    // Find a default home location (VGC Towers preferred, fallback to any home)
    let defaultHomeLocation = allLocations.find(l => l.name === 'VGC Towers' && l.category === 'home');
    if (!defaultHomeLocation) {
      defaultHomeLocation = allLocations.find(l => l.category === 'home');
    }

    const assignmentResults = [];

    // For each NPC, assign them the default home location
    if (defaultHomeLocation) {
      for (const [npcName, npcInfo] of Object.entries(npcMap)) {
        assignmentResults.push({
          npc_name: npcName,
          assigned_location_id: defaultHomeLocation.id,
          assigned_location_name: defaultHomeLocation.name,
          relationship_type: npcInfo.relationship_type,
        });
      }
    }

    return Response.json({
      account_email: targetEmail,
      total_npcs_found: Object.keys(npcMap).length,
      default_location: defaultHomeLocation ? { id: defaultHomeLocation.id, name: defaultHomeLocation.name } : null,
      npcs: assignmentResults,
      status: 'audit_complete_ready_for_assignment',
    });
  } catch (error) {
    console.error('[fixNPCLocationsOnMurqart]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});