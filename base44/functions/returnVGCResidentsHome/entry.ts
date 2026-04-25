import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETURN-HOME AUTOMATION
 * Runs at 1:00 AM ET daily.
 * Forces all npc_fictitious residents of VGC Towers back home.
 * Guarantees travel window closure and home restoration.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Runs as scheduled automation — no user session. Uses service role.
    const now = new Date();
    const log = [];

    // NPC types that live in VGC Towers (must match Character entity schema)
    const NPC_ELIGIBLE_TYPES = ['npc_fictitious', 'npc_regular', 'npc_family_member', 'family_npc'];

    // Load ALL active characters + locations via service role
    const [allCharacters, accountLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    const seenIds = new Set();
    const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    // Find all VGC Towers (one per account)
    const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
    if (vgcTowersList.length === 0) {
      return Response.json({ success: true, message: 'No VGC Towers found', returned: 0 });
    }

    let totalReturned = 0;

    // Process each account's VGC Towers independently (account isolation)
    for (const vgcTowers of vgcTowersList) {
      const VGC_ID = vgcTowers.id;
      const ownerEmail = vgcTowers.created_by || vgcTowers.owner_email;

      const vgcResidents = allCharacters.filter(c =>
        c.current_home_location_id === VGC_ID &&
        NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
        !c.protected_active
      );

      if (vgcResidents.length === 0) continue;

      // Return all residents who are not already home
      const toReturn = vgcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);

      if (toReturn.length > 0) {
        await Promise.all(toReturn.map(npc => {
          log.push(`[${ownerEmail}] ${npc.name} → VGC Towers (1 AM return-home)`);
          return base44.asServiceRole.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_source_reason: 'return_home_block_1am',
            presence_state: 'home',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: null,
            return_location_id: null,
            next_move_at: null,
          });
        }));
        totalReturned += toReturn.length;
      }
    }

    return Response.json({
      success: true,
      mode: 'return_home',
      timestamp: now.toISOString(),
      accountsProcessed: vgcTowersList.length,
      returned: totalReturned,
      log,
    });

  } catch (error) {
    console.error('[returnVGCResidentsHome]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});