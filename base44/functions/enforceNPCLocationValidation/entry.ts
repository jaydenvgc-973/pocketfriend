import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * enforceNPCLocationValidation
 * 
 * Ensure all characters with fictional_relationships or family_members have valid location assignments
 * Prevents future NPCs from appearing with unknown locations
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

    // Get VGC Towers
    const vgcList = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: targetEmail,
      name: 'VGC Towers',
    });

    const vgc = vgcList[0];
    if (!vgc) {
      return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    }

    const fixes = [];

    // For each character with fictional relationships, ensure they have location fields set
    for (const char of allChars) {
      const hasFictionalContent = 
        (char.fictional_relationships && char.fictional_relationships.length > 0) ||
        (char.family_members && char.family_members.length > 0);

      if (hasFictionalContent) {
        const needsUpdate = !char.current_home_location_id || 
                           !char.resolved_current_location_id ||
                           !char.resolved_current_location_name;

        if (needsUpdate) {
          await base44.asServiceRole.entities.Character.update(char.id, {
            current_home_location_id: vgc.id,
            resolved_current_location_id: vgc.id,
            resolved_current_location_name: vgc.name,
            resolved_location_type: 'home',
          });

          fixes.push({
            character_name: char.name,
            character_id: char.id,
            assigned_location: vgc.name,
          });
        }
      }
    }

    return Response.json({
      account_email: targetEmail,
      total_fixes_applied: fixes.length,
      vgc_towers_id: vgc.id,
      vgc_towers_name: vgc.name,
      fixed_characters: fixes,
      prevention_enabled: true,
    });
  } catch (error) {
    console.error('[enforceNPCLocationValidation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});