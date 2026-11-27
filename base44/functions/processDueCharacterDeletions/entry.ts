import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * processDueCharacterDeletions
 *
 * Executor for a deletion that was chosen at the time of death (24 or 48 hours).
 * Invoked once by the "Character Deletion — Trigger on death_deletion_scheduled_at Set"
 * workflow at the registered instant. It is not polled and creates no timers.
 *
 * Removal uses the same writes as deleteCharacter: residence/roster memberships and
 * presence are cleared first, then the record stops being an active character, and a
 * CharacterDeletionAudit entry records the deletion. If the cleanup fails, the status
 * is left untouched so the character remains visible in character management and can
 * be deleted manually rather than being reported removed while still occupying a home.
 *
 * Messages, memories and relationships are never removed — surviving characters keep
 * their protected memories of the deceased.
 */

async function clearWorldOccupancy(base44, characterId) {
  const [asResident, asWorker] = await Promise.all([
    base44.asServiceRole.entities.LocationReference
      .filter({ resident_character_ids: [characterId] }, null, 200)
      .catch(() => []),
    base44.asServiceRole.entities.LocationReference
      .filter({ worker_character_ids: [characterId] }, null, 200)
      .catch(() => []),
  ]);

  const targets = new Map();
  [...asResident, ...asWorker].forEach((loc) => {
    if (loc?.id) targets.set(loc.id, loc);
  });

  for (const loc of targets.values()) {
    const residents = loc.resident_character_ids || [];
    const family = loc.resident_family_members || [];
    const workers = loc.worker_character_ids || [];
    const inResidents = residents.includes(characterId);
    const inFamily = family.some((f) => f?.character_id === characterId);
    const inWorkers = workers.includes(characterId);
    if (!inResidents && !inFamily && !inWorkers) continue;

    await base44.asServiceRole.entities.LocationReference.update(loc.id, {
      ...(inResidents ? { resident_character_ids: residents.filter((id) => id !== characterId) } : {}),
      ...(inFamily ? { resident_family_members: family.filter((f) => f?.character_id !== characterId) } : {}),
      ...(inWorkers ? { worker_character_ids: workers.filter((id) => id !== characterId) } : {}),
    });
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Runs from the deletion workflow with no end user, or from an admin. A signed-in
  // non-admin may not trigger deletions.
  const user = await base44.auth.me().catch(() => null);
  if (user && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const nowIso = new Date().toISOString();

  // ── TEMPORARY NPCs SPAWNED FROM SCENES ────────────────────────────────────
  // The scheduled expiration names the one temporary NPC it was created for, and that
  // instant is read from the character's own temporary_npc_expires_at. Nothing scans or
  // polls: this runs once, at the registered time, and confirms then that the NPC is
  // still temporary. An NPC the user made permanent is no longer temporary, so the
  // execution leaves them exactly as they are. Expired ones are removed from the world
  // with the same occupancy cleanup, then hard deleted so no inaccessible record stays.
  const body = await req.json().catch(() => ({}));
  const targetIds = Array.isArray(body?.character_ids) ? body.character_ids.filter(Boolean) : [];
  const temporary = targetIds.length > 0
    ? await base44.asServiceRole.entities.Character
      .filter({ id: { $in: targetIds } }, null, 50)
      .catch(() => [])
    : [];
  const expired = temporary.filter((c) =>
    // Permanence is the authority: an NPC the user made permanent through NPC Connect
    // is no longer temporary, so a lifespan registered before that decision can never
    // remove them — whatever the old timestamp says.
    c.is_temporary_npc === true &&
    c.temporary_npc_expires_at &&
    c.temporary_npc_expires_at <= nowIso &&
    c.status !== 'deleted' &&
    c.status !== 'merged' &&
    c.is_world_service !== true
  );

  const expiredDeleted = [];
  const expiredFailed = [];
  for (const c of expired) {
    try {
      await clearWorldOccupancy(base44, c.id);
      // Hard delete: the record itself is removed, so they cannot remain as an
      // inaccessible character in any directory.
      await base44.asServiceRole.entities.Character.delete(c.id);
      await base44.asServiceRole.entities.CharacterDeletionAudit.create({
        character_id: c.id,
        deletion_type: 'hard_delete',
      }).catch(() => null);
      expiredDeleted.push({ character_id: c.id, character_name: c.name });
    } catch (err) {
      expiredFailed.push({ character_id: c.id, character_name: c.name, error: err?.message });
    }
  }

  const deceased = await base44.asServiceRole.entities.Character
    .filter({ life_status: 'deceased' }, null, 200)
    .catch(() => []);

  const due = deceased.filter((c) =>
    c.death_deletion_scheduled_at &&
    c.death_deletion_scheduled_at <= nowIso &&
    c.status !== 'soft_deleted'
  );

  const deleted = [];
  const failed = [];
  for (const c of due) {
    try {
      // Remove from the world first — the status change only follows a completed cleanup.
      await clearWorldOccupancy(base44, c.id);

      await base44.asServiceRole.entities.Character.update(c.id, {
        status: 'soft_deleted',
        is_active_character: false,
        resolved_current_location_id: '',
        resolved_current_location_name: '',
        current_home_location_id: '',
        temporary_housing_location_id: '',
        location_status: 'unavailable',
        location_visibility_state: 'unreachable',
        travel_status: 'not_traveling',
        traveling_to_location_id: '',
        traveling_to_location_name: '',
        travel_destination_location_id: '',
        travel_destination_location_name: '',
        next_location_id: '',
        next_location_name: '',
        pending_scheduled_relocation_at: null,
        presence_stay_lock: false,
        presence_stay_lock_location_id: '',
        presence_stay_lock_expires_at: null,
      });
      await base44.asServiceRole.entities.CharacterDeletionAudit.create({
        character_id: c.id,
        deletion_type: 'soft_delete',
      });
      deleted.push({ character_id: c.id, character_name: c.name });
    } catch (err) {
      // Status untouched: the character stays visible for manual deletion.
      failed.push({ character_id: c.id, character_name: c.name, error: err?.message });
    }
  }

  return Response.json({
    success: true,
    processed: deleted.length,
    deleted,
    failed,
    temporary_npcs_removed: expiredDeleted.length,
    temporary_npcs: expiredDeleted,
    temporary_npc_failures: expiredFailed,
  });
});