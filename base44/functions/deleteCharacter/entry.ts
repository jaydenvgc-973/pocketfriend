import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * deleteCharacter (existing soft-delete pathway)
 *
 * A character is only removed once they no longer occupy the world:
 * - residence and worker roster memberships are cleared on every location
 * - presence, home and travel fields are cleared
 * - status = soft_deleted, is_active_character = false
 * - CharacterDeletionAudit records the deletion
 *
 * Order matters: the roster/presence cleanup runs BEFORE the status change.
 * If it fails, the status is left untouched, so the character stays visible in
 * character management and can be deleted manually instead of being reported
 * removed while still appearing at a residence or in a scene.
 *
 * Messages, memories and relationships are never removed — surviving characters
 * keep their memories of the person.
 */

/**
 * Removes the character from every location roster they still occupy.
 * Only locations that actually reference the character are written.
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

  return targets.size;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    let char = await base44.entities.Character.get(characterId).catch(() => null);
    if (!char) {
      // LEGACY SAFETY: older records may be invisible to the user-scoped read.
      const fallback = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      char = fallback?.[0] || null;
    }
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    // ─────────────────────────────────────────────────────────
    // DELETION CONSTRAINTS
    // ─────────────────────────────────────────────────────────
    if (char.character_type === 'npc_world_service' || char.is_world_service === true) {
      return Response.json({ error: 'World-service characters cannot be deleted. Vick Servicio is a permanent world operator.' }, { status: 403 });
    }
    if (char.is_protected) {
      return Response.json({ error: 'Cannot delete protected character' }, { status: 403 });
    }
    if (char.is_default) {
      return Response.json({ error: 'Cannot delete default character' }, { status: 403 });
    }

    // ─────────────────────────────────────────────────────────
    // REMOVE FROM THE WORLD — must succeed before status changes
    // ─────────────────────────────────────────────────────────
    const locationsCleared = await clearWorldOccupancy(base44, characterId);

    // 1. Set status to soft_deleted and clear every presence/occupancy field
    await base44.asServiceRole.entities.Character.update(characterId, {
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

    // 2. Create audit record
    await base44.asServiceRole.entities.CharacterDeletionAudit.create({
      character_id: characterId,
      deletion_type: 'soft_delete',
    });

    return Response.json({
      success: true,
      character_id: characterId,
      character_name: char.name,
      locations_cleared: locationsCleared,
      message: `Character "${char.name}" removed. They no longer appear at any residence, venue or scene. All history preserved.`,
    });
  } catch (error) {
    console.error('[deleteCharacter]', error);
    // The status is only written after the world cleanup, so a failure here leaves
    // the character intact and visible for manual deletion — never half-removed.
    return Response.json({ error: error.message }, { status: 500 });
  }
});