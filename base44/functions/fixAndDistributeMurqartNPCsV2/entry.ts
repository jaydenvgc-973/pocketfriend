import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixAndDistributeMurqartNPCsV2
 * 
 * Update all NPCs to new VGC Towers, then distribute them (inline logic)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';
    const NEW_VGC_ID = '69e5af3008e572cf82f0b1b5';
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();

    const unknownNPCNames = [
      'Rick Taylor', 'Demi Rivers', 'Jordan Li', 'Leah Park', 'Mia Chen',
      'Carlos Mendez', 'Jasmine Rodriguez', 'Nick Decker', 'Amelia Johnson',
      'Briar Kieran', 'Terrance Gibbons',
    ];

    // Get all data
    const [byCreated, byOwner, userLocs, sharedLocs] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.Character.filter({ owner_email: targetEmail }),
      base44.asServiceRole.entities.LocationReference.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    const allChars = [...byCreated, ...byOwner];
    const allLocs = [...userLocs, ...sharedLocs];

    // Find NPCs
    const npcsToDistribute = [];
    for (const name of unknownNPCNames) {
      const npc = allChars.find(c => c.name === name);
      if (npc) npcsToDistribute.push(npc);
    }

    // Update all to new VGC Towers
    const updatePromises = npcsToDistribute.map(npc =>
      base44.asServiceRole.entities.Character.update(npc.id, {
        current_home_location_id: NEW_VGC_ID,
      })
    );
    await Promise.all(updatePromises);

    // Get valid social locations (same logic as distributeVGCTowersNPCs)
    const socialLocations = allLocs.filter(loc => {
      if (loc.id === NEW_VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.location_type === 'character_specific') return false;
      if (loc.scope === 'character_specific') return false;
      const isUserOwned = loc.created_by === targetEmail;
      const isShared = loc.scope === 'shared';
      if (!isUserOwned && !isShared) return false;
      
      // Check if closed
      if (!loc.operating_hours || loc.operating_hours.length === 0) return true;
      const dayOfWeek = nowET.getDay();
      const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
      const todayHours = loc.operating_hours.filter(h => h.day_of_week === dayOfWeek);
      const dayAgnostic = loc.operating_hours.filter(h => h.day_of_week == null);
      const entries = todayHours.length > 0 ? todayHours : dayAgnostic;
      if (entries.length === 0) return true;
      return entries.some(h => {
        const [oh, om] = h.open_time?.split(':').map(Number) || [0, 0];
        const [ch, cm] = h.close_time?.split(':').map(Number) || [23, 59];
        const openMin = oh * 60 + om;
        const closeMin = ch * 60 + cm;
        if (openMin <= closeMin) return currentMin >= openMin && currentMin <= closeMin;
        return currentMin >= openMin || currentMin <= closeMin;
      });
    });

    const isLockdown = hour >= 1 && hour < 10;

    if (isLockdown || socialLocations.length === 0) {
      return Response.json({
        success: true,
        mode: isLockdown ? 'lockdown' : 'no_social_locations',
        npcs_updated: npcsToDistribute.length,
        npcs_distributed: 0,
        message: isLockdown ? 'Lockdown mode - NPCs at home' : 'No social locations available',
      });
    }

    // Distribute NPCs
    const ROTATION_THRESHOLD_MS = 30 * 60 * 1000;
    const distributions = [];
    const log = [];

    for (let i = 0; i < npcsToDistribute.length; i++) {
      const npc = npcsToDistribute[i];
      const nameHash = npc.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const selectedLoc = socialLocations[(i + nameHash) % socialLocations.length];

      distributions.push(
        base44.asServiceRole.entities.Character.update(npc.id, {
          resolved_current_location_id: selectedLoc.id,
          resolved_current_location_name: selectedLoc.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          resolved_source_reason: 'vgc_distribution',
          presence_state: 'social_visit',
          valid_from: now.toISOString(),
          valid_until: new Date(now.getTime() + ROTATION_THRESHOLD_MS * 2).toISOString(),
          return_location_id: NEW_VGC_ID,
        })
      );
      log.push(`${npc.name} → ${selectedLoc.name}`);
    }

    await Promise.all(distributions);

    return Response.json({
      success: true,
      npcs_updated: npcsToDistribute.length,
      npcs_distributed: npcsToDistribute.length,
      social_locations_available: socialLocations.map(l => l.name),
      distribution_log: log,
    });
  } catch (error) {
    console.error('[fixAndDistributeMurqartNPCsV2]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});