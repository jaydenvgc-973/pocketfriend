import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RETURN-HOME AUTOMATION — STAGGERED SMALL-BATCH
 *
 * Runs at 1:00 AM ET daily.
 * Returns VGC Towers NPC residents home in small batches (max 5 per execution).
 *
 * Uses user-scoped Character writes (same pattern as distributeVGCTowersNPCs).
 */

const RETURN_BATCH_LIMIT = 5;

const NPC_ELIGIBLE_TYPES = [
  'npc', 'background', 'npc_fictitious_person', 'npc_fictitious',
  'npc_regular', 'npc_family_member', 'promoted_npc', 'family_npc',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    const now = new Date();
    const log = [];

    // Load all VGC Towers via service role (works)
    const [accountLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    const seenIds = new Set();
    const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
    if (vgcTowersList.length === 0) {
      return Response.json({ success: true, message: 'No VGC Towers found', returned: 0 });
    }

    let totalReturned = 0;
    let totalDeferred = 0;
    let totalProtected = 0;

    for (const vgcTowers of vgcTowersList) {
      const VGC_ID = vgcTowers.id;
      const ownerEmail = vgcTowers.owner_email;

      const residentStubs = vgcTowers.residents || [];
      const residentIdSet = new Set([
        ...residentStubs.map(r => r.character_id).filter(Boolean),
        ...(vgcTowers.resident_character_ids || []),
      ]);

      // Read characters via asServiceRole — read RLS now allows admin access
      const allCharactersRaw = await base44.asServiceRole.entities.Character.filter(
        { owner_email: ownerEmail, status: 'active' }, null, 500
      );

      const allCharactersForTower = allCharactersRaw.filter(c =>
        residentIdSet.has(c.id) || c.current_home_location_id === VGC_ID
      );

      const vgcResidents = allCharactersForTower.filter(c =>
        c.status !== 'deleted' &&
        c.status !== 'soft_deleted' &&
        NPC_ELIGIBLE_TYPES.includes(c.character_type) &&
        !c.protected_active
      );

      if (vgcResidents.length === 0) continue;

      const awayResidents = vgcResidents.filter(npc => npc.resolved_current_location_id !== VGC_ID);
      if (awayResidents.length === 0) continue;

      const protected_ = awayResidents.filter(npc => shouldProtectFromHomeReturn(npc));
      const returnable = awayResidents.filter(npc => !shouldProtectFromHomeReturn(npc));

      totalProtected += protected_.length;
      protected_.forEach(npc => log.push(`[${ownerEmail}] ${npc.name} → PROTECTED from 1AM return`));

      const thisBatch = returnable.slice(0, RETURN_BATCH_LIMIT);
      const deferred = returnable.slice(RETURN_BATCH_LIMIT);

      totalDeferred += deferred.length;
      deferred.forEach(npc => log.push(`[${ownerEmail}] ${npc.name} → DEFERRED to next return cycle`));

      // User-scoped writes — same pattern as distributeVGCTowersNPCs
      for (const npc of thisBatch) {
        await base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'return_home_block_1am',
          location_status: 'home',
          presence_state: 'home',
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: null,
          last_location_update_time: now.toISOString(),
          return_location_id: null,
          next_move_at: null,
          vgc_travel_day_active: false,
          current_travel_block: null,
        });
        log.push(`[${ownerEmail}] ${npc.name} → VGC Towers (1 AM staggered return)`);
        totalReturned++;
      }
    }

    return Response.json({
      success: true,
      mode: 'return_home_staggered',
      timestamp: now.toISOString(),
      accounts_processed: vgcTowersList.length,
      batch_limit: RETURN_BATCH_LIMIT,
      returned: totalReturned,
      deferred: totalDeferred,
      protected: totalProtected,
      next_return_window: 'next 1 AM ET run (deferred residents)',
      log,
    });

  } catch (error) {
    console.error('[returnVGCResidentsHome]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function isWorkScheduleActive(char) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return false;
  const [sh, sm] = char.work_start_time.split(':').map(Number);
  const [eh, em] = char.work_end_time.split(':').map(Number);
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return nowMin >= startMin || nowMin < endMin;
  return nowMin >= startMin && nowMin < endMin;
}

function isSchoolScheduleActive(char) {
  if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  return nowMin >= 480 && nowMin < 900;
}

function shouldProtectFromHomeReturn(char) {
  if (isWorkScheduleActive(char)) return true;
  if (isSchoolScheduleActive(char)) return true;
  // Sleeping/napping NPCs MUST be returned home — they should not be sleeping at public venues.
  // Only hospitalized characters are protected (medical facility is their current care location).
  if (['hospitalized'].includes(char.resolved_presence_status)) return true;
  if (char.is_jailed || char.house_arrest_active) return true;
  if (['user_confirmed_overnight', 'overnight_stay_approved', 'overnight_travel_approved'].includes(char.resolved_source_reason)) return true;
  return false;
}