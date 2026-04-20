import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Fetch all users
    const allUsers = await base44.asServiceRole.entities.User.list('', 1000);
    
    const results = [];
    
    for (const u of allUsers) {
      // Check if user has a VGC Towers (user-scoped, not shared)
      const userVGC = await base44.asServiceRole.entities.LocationReference.filter({
        created_by: u.email,
        name: 'VGC Towers',
        scope: { $ne: 'shared' }
      }).then(r => r[0] || null);

      const ownerVGC = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: u.email,
        name: 'VGC Towers',
        scope: { $ne: 'shared' }
      }).then(r => r[0] || null);

      const hasVGC = !!(userVGC || ownerVGC);
      const vgcId = userVGC?.id || ownerVGC?.id || null;

      results.push({
        user_email: u.email,
        has_vgc_towers: hasVGC,
        vgc_id: vgcId,
      });
    }

    const completed = results.filter(r => r.has_vgc_towers).length;
    const missing = results.filter(r => !r.has_vgc_towers);

    return Response.json({
      total_users: allUsers.length,
      with_vgc_towers: completed,
      without_vgc_towers: missing.length,
      completion_rate: `${Math.round((completed / allUsers.length) * 100)}%`,
      missing_users: missing.map(m => m.user_email),
    });
  } catch (error) {
    console.error('[auditVGCTowersForAllUsers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});