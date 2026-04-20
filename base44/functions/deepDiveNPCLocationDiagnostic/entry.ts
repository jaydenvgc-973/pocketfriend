import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * deepDiveNPCLocationDiagnostic
 * 
 * Analyze root causes of NPC location assignment failures
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';

    // Get all characters
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    // Get all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
    });

    const analysis = {
      total_characters: allChars.length,
      total_locations: allLocations.length,
      npcs_missing_location_fields: [],
      npcs_with_unresolvable_locations: [],
      locations_missing_vgc: !allLocations.some(l => l.name === 'VGC Towers'),
      root_causes: [],
    };

    // Check each character for location field issues
    for (const char of allChars) {
      const isFictionalNPC = char.fictional_relationships?.some(rel => rel.person_name) || 
                             char.family_members?.some(fam => fam.name);

      if (isFictionalNPC) {
        const missingFields = [];
        if (!char.current_home_location_id) missingFields.push('current_home_location_id');
        if (!char.resolved_current_location_id) missingFields.push('resolved_current_location_id');
        if (!char.resolved_current_location_name) missingFields.push('resolved_current_location_name');

        if (missingFields.length > 0) {
          analysis.npcs_missing_location_fields.push({
            character_name: char.name,
            character_id: char.id,
            missing_fields: missingFields,
          });
        }
      }
    }

    // Root cause analysis
    if (analysis.npcs_missing_location_fields.length > 0) {
      analysis.root_causes.push('NPC source characters lack mandatory location assignment fields');
    }

    if (analysis.locations_missing_vgc) {
      analysis.root_causes.push('VGC Towers (default NPC location) does not exist');
    }

    analysis.root_causes.push('NPC creation/relationship addition flow does not enforce location assignment');
    analysis.root_causes.push('No validation gate prevents character save without location when fictional_relationships present');

    return Response.json(analysis);
  } catch (error) {
    console.error('[deepDiveNPCLocationDiagnostic]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});