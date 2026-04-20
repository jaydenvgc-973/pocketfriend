import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const TARGET_EMAIL = 'murqart@gmail.com';
    if (user.email !== TARGET_EMAIL) {
      return Response.json({
        error: `Access denied. Only ${TARGET_EMAIL} can run this audit.`,
      }, { status: 403 });
    }

    // Find ALL VGC Towers for this account via BOTH created_by AND owner_email
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter(
        { created_by: TARGET_EMAIL, name: { $regex: 'VGC Towers', $options: 'i' } },
        '-created_date',
        50
      ),
      base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: TARGET_EMAIL, name: { $regex: 'VGC Towers', $options: 'i' } },
        '-created_date',
        50
      ),
    ]);

    const seen = new Set();
    const allVGCTowers = [...byCreatedBy, ...byOwnerEmail].filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    console.log(`Found ${allVGCTowers.length} VGC Towers instances for ${TARGET_EMAIL}`);
    allVGCTowers.forEach((v, i) => {
      console.log(`  [${i}] ID: ${v.id} | Created: ${v.created_date} | Owner: ${v.owner_email || 'null'} | Name: ${v.name}`);
    });

    return Response.json({
      success: true,
      target_email: TARGET_EMAIL,
      total_vgc_towers_found: allVGCTowers.length,
      vgc_towers: allVGCTowers.map(v => ({
        id: v.id,
        name: v.name,
        created_by: v.created_by,
        owner_email: v.owner_email,
        created_date: v.created_date,
        resident_count: (v.residents || []).length,
      })),
    });
  } catch (error) {
    console.error('[auditAllVGCTowersForMurqart]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});