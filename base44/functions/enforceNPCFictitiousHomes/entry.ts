import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const isLockdown = hour >= 1 && hour < 10;

    // Fetch all npc_fictitious for this user
    const [byCreatedBy, byOwnerEmail, allLocations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, character_type: 'npc_fictitious', status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious', status: 'active' }),
      base44.entities.LocationReference.filter({ created_by: user.email }),
    ]);

    const seen = new Set();
    const allNPCs = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    const VGC_ID = vgcTowers.id;

    const fixes = [];
    const fixed = [];

    // Enforce: Every npc_fictitious MUST have current_home_location_id = VGC_ID
    for (const npc of allNPCs) {
      const needsFix = !npc.current_home_location_id || npc.current_home_location_id !== VGC_ID;
      
      if (needsFix) {
        const updateData = {
          current_home_location_id: VGC_ID,
        };

        // During lockdown (1-10 AM), force them home immediately
        if (isLockdown) {
          updateData.resolved_current_location_id = VGC_ID;
          updateData.resolved_current_location_name = 'VGC Towers';
          updateData.resolved_presence_status = 'home';
          updateData.resolved_location_type = 'home';
          updateData.resolved_source_reason = 'lockdown_enforcement';
          updateData.presence_state = 'home';
          updateData.source_of_move = 'system';
          updateData.valid_from = now.toISOString();
          updateData.valid_until = null;
          updateData.return_location_id = null;
        }

        fixes.push(base44.asServiceRole.entities.Character.update(npc.id, updateData));
        fixed.push({
          name: npc.name,
          hadHome: !!npc.current_home_location_id,
          wasAtLocation: npc.resolved_current_location_name,
          action: isLockdown ? 'returned_home_lockdown' : 'home_assigned',
        });
      }
    }

    if (fixes.length > 0) {
      await Promise.all(fixes);
    }

    return Response.json({
      success: true,
      timestamp: now.toISOString(),
      hourET: hour,
      isLockdown,
      totalNPCs: allNPCs.length,
      fixed: fixed.length,
      details: fixed,
    });
  } catch (error) {
    console.error('[enforceNPCFictitiousHomes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});