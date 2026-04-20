import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnosisUnknownNPCLocations
 * 
 * Diagnose why NPCs on murqart@gmail.com are showing as "Unknown" location
 * Check their current location fields and available locations
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';
    const unknownNPCs = [
      'Rick Taylor',
      'Demi Rivers',
      'Jordan Li',
      'Leah Park',
      'Mia Chen',
      'Carlos Mendez',
      'Jasmine Rodriguez',
      'Nick Decker',
      'Amelia Johnson',
      'Briar Kieran',
      'Terrance Gibbons',
    ];

    // Get all characters on the account
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    // Find the NPCs
    const npcDetails = [];
    for (const npcName of unknownNPCs) {
      const npc = allChars.find(c => c.name === npcName);
      if (npc) {
        npcDetails.push({
          name: npc.name,
          id: npc.id,
          character_type: npc.character_type,
          current_home_location_id: npc.current_home_location_id || null,
          resolved_current_location_id: npc.resolved_current_location_id || null,
          resolved_current_location_name: npc.resolved_current_location_name || null,
          resolved_presence_status: npc.resolved_presence_status || null,
          current_activity: npc.current_activity || null,
          location_visibility_state: npc.location_visibility_state || null,
        });
      }
    }

    // Get all locations on the account
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
    });

    // Categorize locations
    const validLocations = allLocations.filter(l =>
      l.name && l.name !== 'Unknown' && l.scope !== 'shared'
    );

    return Response.json({
      account_email: targetEmail,
      npcs_with_unknown_locations: npcDetails,
      total_valid_locations: validLocations.length,
      available_locations: validLocations.map(l => ({
        id: l.id,
        name: l.name,
        category: l.category,
        scope: l.scope,
      })),
    });
  } catch (error) {
    console.error('[diagnosisUnknownNPCLocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});