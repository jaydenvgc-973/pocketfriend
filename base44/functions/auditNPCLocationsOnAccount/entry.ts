import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditNPCLocationsOnAccount
 * 
 * Audit all NPCs on murqart@gmail.com and identify those with unknown/missing locations
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

    // Separate NPCs from active characters
    const npcsWithIssues = [];
    const npcsSafe = [];

    for (const char of allChars) {
      // NPCs are identified by not being "active" type or by being in fictional_relationships
      const isActiveCreativeChar = char.character_type === 'active' || char.status === 'active';
      
      if (!isActiveCreativeChar) {
        // This is an NPC - check location status
        const hasHomeLocation = !!char.current_home_location_id;
        const hasResolvedLocation = !!char.resolved_current_location_id;
        const hasCurrentLocation = !!char.current_activity;

        if (!hasHomeLocation && !hasResolvedLocation && !hasCurrentLocation) {
          npcsWithIssues.push({
            npc_name: char.name,
            npc_id: char.id,
            character_type: char.character_type,
            status: char.status,
            current_home_location_id: char.current_home_location_id || null,
            resolved_current_location_id: char.resolved_current_location_id || null,
            current_activity: char.current_activity || null,
            issue: 'NO_LOCATION_ASSIGNED',
          });
        } else {
          npcsSafe.push({
            npc_name: char.name,
            npc_id: char.id,
            current_home_location_id: char.current_home_location_id,
            resolved_current_location_id: char.resolved_current_location_id,
          });
        }
      }
    }

    return Response.json({
      account_email: targetEmail,
      total_characters: allChars.length,
      npcs_with_location_issues: npcsWithIssues.length,
      npcs_with_valid_locations: npcsSafe.length,
      npcs_affected: npcsWithIssues,
      npcs_safe: npcsSafe,
    });
  } catch (error) {
    console.error('[auditNPCLocationsOnAccount]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});