import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fix: Assign these 6 characters to VGC Towers as their actual home
 * Carlos Mendez, Demi Rivers, Jordan Li, Leah Park, Mace, Mia Chen
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get all locations
    const locations = await base44.asServiceRole.entities.LocationReference.list();
    const vgcTowers = locations.find(l => l.name === 'VGC Towers');
    
    if (!vgcTowers) {
      return Response.json({ error: 'VGC Towers location not found' }, { status: 404 });
    }

    const targetNames = ['Carlos Mendez', 'Demi Rivers', 'Jordan Li', 'Leah Park', 'Mace', 'Mia Chen'];
    
    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const fixed = [];

    for (const char of characters) {
      if (targetNames.includes(char.name)) {
        // Update their home to VGC Towers
        await base44.asServiceRole.entities.Character.update(char.id, {
          current_home_location_id: vgcTowers.id,
          resolved_current_location_id: vgcTowers.id,
          resolved_current_location_name: vgcTowers.name,
          resolved_location_type: 'home',
          resolved_presence_status: 'home',
          resolved_source_reason: 'corrected_to_actual_home_vgc_towers',
          resolved_last_updated_at: new Date().toISOString()
        });

        fixed.push({
          character_id: char.id,
          character_name: char.name,
          new_home: vgcTowers.name,
          home_id: vgcTowers.id
        });
      }
    }

    return Response.json({
      status: 'FIXED_TO_VGC_TOWERS',
      vgc_towers_id: vgcTowers.id,
      fixed_count: fixed.length,
      fixed
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});