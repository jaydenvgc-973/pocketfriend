import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ONE-TIME FIX: Ethan's family members (npc_family_member type) were incorrectly
 * assigned resolved_current_location_id = VGC Towers ID by the distributeVGCTowersNPCs
 * function, because NPC_ELIGIBLE_TYPES previously included 'npc_family_member'.
 *
 * This function finds all npc_family_member characters whose resolved_current_location_id
 * points to VGC Towers, and resets them to their actual home (current_home_location_id).
 *
 * Safe: only writes to npc_family_member characters.
 * Does NOT affect VGC Towers npc_fictitious residents.
 * Does NOT remove any characters.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find VGC Towers
    const locations = await base44.entities.LocationReference.filter(
      { owner_email: user.email }, null, 200
    );
    const vgcTowers = locations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) {
      return Response.json({ message: 'VGC Towers not found — nothing to fix' });
    }
    const VGC_ID = vgcTowers.id;

    // Find Ethan's Family Home
    const ethanHome = locations.find(l =>
      l.name === "Ethan's Family Home" || l.name === "Ethan Thompson's Home" ||
      l.name === "Ethan's Home"
    );

    // Find all npc_family_member characters currently placed at VGC Towers
    const allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    const wronglyAtVGC = allChars.filter(c =>
      c.character_type === 'npc_family_member' &&
      c.resolved_current_location_id === VGC_ID
    );

    const now = new Date().toISOString();
    const fixes = [];

    for (const char of wronglyAtVGC) {
      // Determine their real home
      const realHomeId = char.current_home_location_id || ethanHome?.id || null;
      const realHomeName = realHomeId
        ? (locations.find(l => l.id === realHomeId)?.name || char.resolved_current_location_name || 'Home')
        : null;

      if (!realHomeId) {
        fixes.push({ name: char.name, action: 'skipped — no home ID found', id: char.id });
        continue;
      }

      // If their home IS VGC Towers, skip (they legitimately belong there)
      if (realHomeId === VGC_ID) {
        fixes.push({ name: char.name, action: 'skipped — home is actually VGC Towers', id: char.id });
        continue;
      }

      await base44.entities.Character.update(char.id, {
        resolved_current_location_id: realHomeId,
        resolved_current_location_name: realHomeName,
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'fix_family_member_wrongly_at_vgc',
        presence_state: 'home',
        last_location_update_time: now,
      });

      fixes.push({
        name: char.name,
        id: char.id,
        action: 'fixed',
        from: 'VGC Towers',
        to: realHomeName,
      });
    }

    return Response.json({
      success: true,
      vgc_id: VGC_ID,
      ethan_home_id: ethanHome?.id || null,
      wrongly_at_vgc_count: wronglyAtVGC.length,
      fixes,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});