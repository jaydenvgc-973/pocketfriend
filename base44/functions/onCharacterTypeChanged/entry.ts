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

    const wasNPC = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person',
      'npc_regular', 'npc_family_member', 'npc_fictitious'].includes(oldType || char.character_type);
    const isNowActive = newType === 'active_created_character' || newType === 'active';

    // ── CASE B: PROMOTED TO ACTIVE → Full lifecycle migration ────────────────
    // Promotion is NOT cosmetic. It is a full state migration.
    // We must preserve all existing lifecycle fields and only ADD missing ones.
    // CRITICAL: Never erase sleep rhythm, needs history, or presence continuity.
    if (wasNPC && isNowActive) {
      const now = new Date().toISOString();

      // SLEEP RHYTHM: preserve existing values (character individuality), backfill only gaps.
      // An NPC that slept 23:00–07:00 carries that rhythm into active life — do not reset it.
      const sleepPreserve = {};
      if (!char.sleep_start_time) sleepPreserve.sleep_start_time = '23:00';
      if (!char.wake_up_time) sleepPreserve.wake_up_time = '07:00';
      if (char.sleep_debt_hours === undefined || char.sleep_debt_hours === null) sleepPreserve.sleep_debt_hours = 0;

      // NEEDS BASELINE: active created characters require needs simulation eligibility.
      const needsPreserve = {};
      if (!char.needs_initialized) {
        needsPreserve.needs_initialized = true;
        if (char.hunger_value === undefined || char.hunger_value === null) needsPreserve.hunger_value = 70;
        if (char.energy_value === undefined || char.energy_value === null) needsPreserve.energy_value = 75;
        if (char.social_value === undefined || char.social_value === null) needsPreserve.social_value = 65;
        if (char.health_value === undefined || char.health_value === null) needsPreserve.health_value = 80;
        if (char.mental_value === undefined || char.mental_value === null) needsPreserve.mental_value = 70;
        if (char.financial_need_value === undefined || char.financial_need_value === null) needsPreserve.financial_need_value = 60;
        if (char.hygiene_value === undefined || char.hygiene_value === null) needsPreserve.hygiene_value = 75;
        if (char.comfort_value === undefined || char.comfort_value === null) needsPreserve.comfort_value = 70;
      }

      const updates = {
        character_type: 'active_created_character',
        // Keep resolved_current_location_id as their home — do not displace them
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        resolved_source_reason: 'promoted_to_active_created',
        resolved_last_updated_at: now,
        // Preserve/backfill sleep rhythm and needs — active autonomy requires a baseline
        ...sleepPreserve,
        ...needsPreserve,
      };

      await base44.entities.Character.update(characterId, updates);
      console.log(`[onCharacterTypeChanged] ${char.name} promoted to active_created_character — lifecycle migrated | sleep_backfilled=${Object.keys(sleepPreserve).length > 0} | needs_backfilled=${Object.keys(needsPreserve).length > 0}`);
      return Response.json({ success: true, action: 'promoted_to_active_created', characterId, sleep_backfilled: sleepPreserve, needs_backfilled: needsPreserve });
    }

    // ── CASE: Demoted to NPC → Assign VGC Towers home if missing ─────────────
    const isNowNPC = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person',
      'npc_regular', 'npc_family_member', 'npc_fictitious'].includes(newType);
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