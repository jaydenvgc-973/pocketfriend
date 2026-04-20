import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // CRITICAL: Only allow murqart@gmail.com to run this
    if (user.email !== 'murqart@gmail.com') {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    // Search ALL locations in the entire system for any with "VGC Towers" in the name
    const allLocations = await base44.asServiceRole.entities.LocationReference.list(
      '-created_date',
      1000
    );

    const vgcTowers = allLocations.filter(l => 
      l.name && l.name.toLowerCase().includes('vgc towers')
    );

    console.log(`Found ${vgcTowers.length} VGC Towers in entire system`);
    
    vgcTowers.forEach((v, i) => {
      console.log(`[${i}] ID: ${v.id}`);
      console.log(`    Name: ${v.name}`);
      console.log(`    Created by: ${v.created_by}`);
      console.log(`    Owner email: ${v.owner_email}`);
      console.log(`    Scope: ${v.scope}`);
    });

    return Response.json({
      success: true,
      total_vgc_towers: vgcTowers.length,
      vgc_towers: vgcTowers.map(v => ({
        id: v.id,
        name: v.name,
        created_by: v.created_by,
        owner_email: v.owner_email,
        scope: v.scope,
        created_date: v.created_date,
      })),
    });
  } catch (error) {
    console.error('[findAllVGCTowers]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});