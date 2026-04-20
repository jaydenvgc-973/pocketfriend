import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const TARGET_EMAIL = 'murqart@gmail.com';
    if (user.email !== TARGET_EMAIL) {
      return Response.json({
        error: `Access denied. Only ${TARGET_EMAIL} can run this debug.`,
      }, { status: 403 });
    }

    // Replicate what fetchAllLocationsForUser does
    const [created, owned] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter(
        { created_by: TARGET_EMAIL },
        '-created_date',
        500
      ),
      base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: TARGET_EMAIL },
        '-created_date',
        500
      ),
    ]);

    console.log(`Created by: ${created.length} locations`);
    console.log(`Owned by: ${owned.length} locations`);

    const seen = new Set();
    const combined = [...created, ...owned].filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return l.status !== 'deleted';
    });

    console.log(`Combined (deduplicated): ${combined.length} locations`);

    // Count VGC Towers
    const vgcTowers = combined.filter(l => l.name && l.name.toLowerCase().includes('vgc towers'));
    console.log(`VGC Towers in combined list: ${vgcTowers.length}`);
    vgcTowers.forEach((v, i) => {
      console.log(`  [${i}] ${v.id} | ${v.name}`);
    });

    return Response.json({
      success: true,
      created_count: created.length,
      owned_count: owned.length,
      combined_count: combined.length,
      vgc_towers_count: vgcTowers.length,
      vgc_towers: vgcTowers.map(v => ({
        id: v.id,
        name: v.name,
        created_by: v.created_by,
        owner_email: v.owner_email,
      })),
      all_locations: combined.map(l => ({ id: l.id, name: l.name })),
    });
  } catch (error) {
    console.error('[debugFetchLocationsForMurqart]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});