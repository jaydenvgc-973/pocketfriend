import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * guardVickPermanentEmployment
 *
 * Vick Servicio is permanently employed as the VGC Recovery Yard Operator.
 * His employment, workplace, and home must NEVER change.
 *
 * This function validates incoming Character updates and rejects/repairs
 * any attempt to reassign Vick's job, workplace, or move him to VGC Towers.
 *
 * RULES (PERMANENT):
 * - Vick CANNOT be reassigned to another job
 * - Vick CANNOT be unemployed
 * - Vick CANNOT be moved into normal NPC employment flows
 * - Vick CANNOT be assigned to VGC Towers
 * - Vick's home MUST remain VGC Recovery Yard
 * - Vick's work MUST remain VGC Recovery Yard
 * - If a mismatch is detected, repair fields to Recovery Yard
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json();
    const { character_id, owner_email, update_data, action } = payload;

    if (!character_id || !owner_email) {
      return Response.json({ error: 'character_id and owner_email required' }, { status: 400 });
    }

    // Fetch Vick (service-role to catch world-service records)
    const vickRecs = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service', name: 'Vick Servicio', owner_email },
      null,
      1
    ).catch(() => []);

    const vick = vickRecs[0];
    if (!vick) {
      // Vick doesn't exist for this account — nothing to guard
      return Response.json({ success: true, isVick: false });
    }

    // Is this Vick?
    if (character_id !== vick.id) {
      return Response.json({ success: true, isVick: false });
    }

    // ── VICK DETECTED — ENFORCE PERMANENT EMPLOYMENT ──────────────────────

    // Fetch Recovery Yard
    const recoveryYardRecs = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email, name: 'VGC Recovery Yard' },
      null,
      1
    ).catch(() => []);

    const recoveryYard = recoveryYardRecs[0];
    if (!recoveryYard) {
      console.warn(`[guardVickPermanentEmployment] Recovery Yard not found for ${owner_email} — cannot guard Vick`);
      return Response.json({ error: 'Recovery Yard not found for this account' }, { status: 400 });
    }

    const RECOVERY_YARD_ID = recoveryYard.id;

    // ── VALIDATE / REPAIR UPDATE DATA ───────────────────────────────────
    let repaired = false;
    const guards = {
      occupation_location_id: RECOVERY_YARD_ID,
      occupation_location_name: recoveryYard.name,
      current_work_location_id: RECOVERY_YARD_ID,
      current_home_location_id: RECOVERY_YARD_ID,
    };

    // Check each guard field
    for (const [field, guardValue] of Object.entries(guards)) {
      if (update_data && update_data[field] && update_data[field] !== guardValue) {
        console.warn(`[guardVickPermanentEmployment] Attempted to change Vick.${field} from ${guardValue} to ${update_data[field]} — BLOCKED`);
        // Overwrite with guarded value
        update_data[field] = guardValue;
        repaired = true;
      }
    }

    // Ensure guarded fields are always present (protect against unsets)
    if (!update_data) return Response.json({ success: true, isVick: true, repaired: false });
    
    if (!update_data.occupation_location_id) {
      update_data.occupation_location_id = RECOVERY_YARD_ID;
      repaired = true;
    }
    if (!update_data.occupation_location_name) {
      update_data.occupation_location_name = recoveryYard.name;
      repaired = true;
    }
    if (!update_data.current_work_location_id) {
      update_data.current_work_location_id = RECOVERY_YARD_ID;
      repaired = true;
    }
    if (!update_data.current_home_location_id) {
      update_data.current_home_location_id = RECOVERY_YARD_ID;
      repaired = true;
    }

    return Response.json({
      success: true,
      isVick: true,
      vickId: vick.id,
      recoveryYardId: RECOVERY_YARD_ID,
      repaired,
      guardsApplied: repaired ? Object.keys(guards) : [],
    });

  } catch (error) {
    console.error('[guardVickPermanentEmployment]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});