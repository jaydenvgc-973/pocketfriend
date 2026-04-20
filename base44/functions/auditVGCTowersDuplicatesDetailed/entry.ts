import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditVGCTowersDuplicatesDetailed
 * 
 * Returns detailed info on ALL VGC Towers instances across ALL users,
 * showing which accounts have duplicates
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const allUsers = await base44.asServiceRole.entities.User.list('', 1000);
    
    const results = {
      total_users: allUsers.length,
      users_with_duplicate_vgc: [],
      users_with_single_vgc: [],
      users_with_no_vgc: [],
      total_duplicate_vgc_instances: 0,
    };

    for (const u of allUsers) {
      const [byCreated, byOwner] = await Promise.all([
        base44.asServiceRole.entities.LocationReference.filter({
          created_by: u.email,
          name: 'VGC Towers',
          scope: { $ne: 'shared' }
        }),
        base44.asServiceRole.entities.LocationReference.filter({
          owner_email: u.email,
          name: 'VGC Towers',
          scope: { $ne: 'shared' }
        }),
      ]);

      const seen = new Set();
      const instances = [...byCreated, ...byOwner].filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });

      if (instances.length === 0) {
        results.users_with_no_vgc.push(u.email);
      } else if (instances.length === 1) {
        results.users_with_single_vgc.push({
          user_email: u.email,
          vgc_id: instances[0].id,
          has_residents: instances[0].residents?.length > 0 || instances[0].resident_character_ids?.length > 0,
          resident_count: (instances[0].residents?.length || 0) + (instances[0].resident_character_ids?.length || 0),
        });
      } else {
        results.users_with_duplicate_vgc.push({
          user_email: u.email,
          total_instances: instances.length,
          instances: instances.map(inst => ({
            id: inst.id,
            has_residents: inst.residents?.length > 0 || inst.resident_character_ids?.length > 0,
            resident_count: (inst.residents?.length || 0) + (inst.resident_character_ids?.length || 0),
            resident_names: inst.residents?.map(r => r.character_name) || [],
          })),
        });
        results.total_duplicate_vgc_instances += instances.length;
      }
    }

    return Response.json(results);
  } catch (error) {
    console.error('[auditVGCTowersDuplicatesDetailed]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});