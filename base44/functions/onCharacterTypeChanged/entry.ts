import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * onCharacterTypeChanged
 *
 * Called when a character's type changes (e.g. NPC → Active promotion).
 * Enforces travel eligibility rules:
 * - If promoted to active: remove from VGC Towers travel, clear NPC travel fields
 * - If moved to NPC: assign VGC Towers home if not already set
 *
 * Body: { characterId, newType, oldType }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, newType, oldType } = await req.json();
    if (!characterId || !newType) {
      return Response.json({ error: 'characterId and newType are required' }, { status: 400 });
    }

    const char = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const wasNPC = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'].includes(oldType || char.character_type);
    const isNowActive = newType === 'active';

    // ── CASE B: PROMOTED TO ACTIVE → Remove from VGC Towers travel ───────────
    if (wasNPC && isNowActive) {
      const updates = {
        character_type: 'active',
        // Clear NPC travel fields — active characters are not eligible for VGC distribution
        presence_state: 'home',
        presence_reason: 'promoted_to_active',
        source_of_move: 'promotion',
        valid_from: new Date().toISOString(),
        valid_until: null,
        return_location_id: null,
        // Keep resolved_current_location_id as their home — don't displace them
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'promoted_to_active',
      };

      await base44.entities.Character.update(characterId, updates);
      console.log(`[onCharacterTypeChanged] ${char.name} promoted to active — removed from VGC travel eligibility`);
      return Response.json({ success: true, action: 'promoted_to_active', characterId });
    }

    // ── CASE: Demoted to NPC → Assign VGC Towers home if missing ─────────────
    const isNowNPC = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'].includes(newType);
    if (isNowNPC && !char.current_home_location_id) {
      // Find user's VGC Towers
      const [byCreated, byOwner] = await Promise.all([
        base44.entities.LocationReference.filter({ created_by: user.email, name: 'VGC Towers' }),
        base44.entities.LocationReference.filter({ owner_email: user.email, name: 'VGC Towers' }),
      ]);
      const seen = new Set();
      const userVGC = [...byCreated, ...byOwner].find(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return l.scope !== 'shared';
      });

      if (userVGC) {
        await base44.entities.Character.update(characterId, {
          character_type: newType,
          current_home_location_id: userVGC.id,
          resolved_current_location_id: userVGC.id,
          resolved_current_location_name: userVGC.name,
          resolved_location_type: 'home',
          resolved_presence_status: 'home',
          resolved_source_reason: 'npc_home_assigned',
          presence_state: 'home',
        });
        console.log(`[onCharacterTypeChanged] ${char.name} demoted to NPC — assigned VGC Towers home`);
        return Response.json({ success: true, action: 'npc_home_assigned', characterId, vgc_id: userVGC.id });
      }
    }

    return Response.json({ success: true, action: 'no_change_needed', characterId });
  } catch (error) {
    console.error('[onCharacterTypeChanged]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});