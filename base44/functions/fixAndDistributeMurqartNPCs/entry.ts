import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixAndDistributeMurqartNPCs
 * 
 * Update all 11 NPCs to point to the NEW VGC Towers ID, then distribute them
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';
    const NEW_VGC_ID = '69e5af3008e572cf82f0b1b5'; // Just created
    const unknownNPCNames = [
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

    // Get all characters
    const [byCreated, byOwner] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.Character.filter({ owner_email: targetEmail }),
    ]);

    // Find all 11 NPCs and update them
    const npcsToUpdate = [];
    for (const npcName of unknownNPCNames) {
      const npc = [...byCreated, ...byOwner].find(c => c.name === npcName);
      if (npc) {
        npcsToUpdate.push(npc);
      }
    }

    // Update all to new VGC Towers ID
    const updatePromises = npcsToUpdate.map(npc =>
      base44.asServiceRole.entities.Character.update(npc.id, {
        current_home_location_id: NEW_VGC_ID,
      })
    );
    await Promise.all(updatePromises);

    // Now invoke distributeVGCTowersNPCs via the SDK function invoke
    const distributeRes = await base44.asServiceRole.functions.invoke('distributeVGCTowersNPCs', {});

    return Response.json({
      success: true,
      npcs_updated: npcsToUpdate.length,
      new_vgc_towers_id: NEW_VGC_ID,
      distribution_result: distributeRes?.data || distributeRes,
    });
  } catch (error) {
    console.error('[fixAndDistributeMurqartNPCs]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});