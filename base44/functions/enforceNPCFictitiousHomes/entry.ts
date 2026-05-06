import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * enforceNPCFictitiousHomes
 *
 * RULE: Only enforce home presence for NPCs that are EXPLICITLY assigned to VGC Towers.
 * NPCs with their own home location are NOT touched.
 * NPCs missing a home are marked as needing repair — NOT relocated to VGC Towers.
 *
 * VGC Towers is NOT a universal fallback. Missing home ≠ lives at VGC Towers.
 */

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
    const [byOwnerEmail, allLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious', status: 'active' }),
      base44.entities.LocationReference.filter({ owner_email: user.email }),
    ]);

    const seen = new Set();
    const allNPCs = byOwnerEmail.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    const VGC_ID = vgcTowers?.id || null;

    const fixes = [];
    const fixed = [];
    const skipped = [];
    const needsRepair = [];

    for (const npc of allNPCs) {
      const assignedHome = npc.current_home_location_id || null;

      // CASE 1: NPC has their own home that is NOT VGC Towers — do not touch them.
      // Their home is authoritative; this function has no jurisdiction over them.
      if (assignedHome && assignedHome !== VGC_ID) {
        skipped.push({ name: npc.name, reason: 'has_own_home', home_id: assignedHome });
        continue;
      }

      // CASE 2: NPC is explicitly assigned to VGC Towers — enforce lockdown return if applicable.
      if (assignedHome === VGC_ID && VGC_ID) {
        const needsReturn = isLockdown && npc.resolved_current_location_id !== VGC_ID;
        if (needsReturn) {
          fixes.push(base44.asServiceRole.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_source_reason: 'lockdown_enforcement',
            presence_state: 'home',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: null,
            return_location_id: null,
          }));
          fixed.push({ name: npc.name, action: 'returned_home_lockdown' });
        } else {
          skipped.push({ name: npc.name, reason: 'vgc_resident_no_action_needed' });
        }
        continue;
      }

      // CASE 3: NPC has no home at all.
      // RULE: Do NOT assign VGC Towers. Mark as needing housing repair.
      // Missing home ≠ lives at VGC Towers.
      needsRepair.push({ name: npc.name, id: npc.id, reason: 'no_home_assigned' });
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
      skipped: skipped.length,
      needsRepair: needsRepair.length,
      details: { fixed, skipped, needsRepair },
      rule: 'VGC_TOWERS_IS_NOT_A_FALLBACK_HOME — only VGC-assigned NPCs are returned home during lockdown. NPCs with own homes are untouched. NPCs without homes are flagged for repair.',
    });
  } catch (error) {
    console.error('[enforceNPCFictitiousHomes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});