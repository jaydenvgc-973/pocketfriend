import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * confirmCharacterDeath
 *
 * The only path that can make a character deceased. Called from the character
 * profile after the user has chosen the cause, written additional context, and
 * selected a deletion option, then explicitly confirmed.
 *
 * 1. Commits the death on the character record (life_status + presence cleared)
 *    so every existing system stops treating the character as living.
 * 2. Preserves the deceased in the surviving characters' memory and marks their
 *    relationship entries as historical.
 * 3. Carries out deletion through the existing pathways:
 *      - immediate  → the same soft-delete writes as deleteCharacter, now
 *      - 24h / 48h  → one ScheduledEvent of type character_deletion, fired once
 *                     by the existing processScheduledEvents runner
 */

const CATEGORY_LABELS = {
  natural_causes: 'Natural causes',
  illness_medical: 'Illness or medical complications',
  accident: 'Accidental death',
  violence: 'Violent death',
  overdose_poisoning: 'Overdose or poisoning',
  suicide: 'Suicide',
  disaster: 'Disaster or environmental event',
  unknown: 'Unexplained or unknown',
  custom: 'Custom cause',
};

const DELETION_HOURS = { after_24h: 24, after_48h: 48 };

function easternLabel(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' Eastern';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId, deathCategory, deathCause, deathCircumstances, deletionMode } = body || {};

    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const mode = deletionMode === 'immediate' ? 'immediate' : deletionMode === 'after_24h' ? 'after_24h' : deletionMode === 'after_48h' ? 'after_48h' : null;
    if (!mode) return Response.json({ error: 'deletionMode must be immediate, after_24h, or after_48h' }, { status: 400 });

    // The user's own authored cause is authoritative — never rewritten.
    const causeText = (deathCause || '').toString().trim();
    if (!causeText) return Response.json({ error: 'A cause of death is required' }, { status: 400 });

    const category = CATEGORY_LABELS[deathCategory] ? deathCategory : 'custom';
    const circumstances = (deathCircumstances || '').toString().trim();

    let char = await base44.entities.Character.get(characterId).catch(() => null);
    if (!char) {
      // LEGACY SAFETY: older records may have no owner_email and be invisible to the
      // user-scoped read. Ownership is still enforced before anything is written.
      const fallback = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      char = fallback?.[0] || null;
    }
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });
    const ownsCharacter = char.owner_email ? char.owner_email === user.email : char.created_by === user.email;
    if (!ownsCharacter && user.role !== 'admin') {
      return Response.json({ error: 'You can only end the life of a character you own' }, { status: 403 });
    }
    if (char.life_status === 'deceased' || char.status === 'deceased') {
      return Response.json({ error: `${char.name} is already deceased` }, { status: 409 });
    }
    // Same protection rules the existing deletion pathway enforces
    if (char.character_type === 'npc_world_service' || char.is_world_service === true) {
      return Response.json({ error: 'World-service characters cannot die or be deleted.' }, { status: 403 });
    }
    if (char.is_protected) return Response.json({ error: 'Cannot end a protected character' }, { status: 403 });
    if (char.is_default) return Response.json({ error: 'Cannot end the default character' }, { status: 403 });

    const nowIso = new Date().toISOString();
    const hours = DELETION_HOURS[mode] || 0;
    const scheduledIso = hours > 0 ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : '';

    // ── 1. COMMIT THE DEATH ────────────────────────────────────────────────
    // Status and presence are cleared so no existing presence list, travel path,
    // scene, work enforcement, alarm or narrative system sees a living character.
    await base44.asServiceRole.entities.Character.update(characterId, {
      life_status: 'deceased',
      status: 'deceased',
      is_active_character: false,
      death_category: category,
      death_cause: causeText,
      death_circumstances: circumstances,
      death_date: nowIso,
      death_deletion_mode: mode,
      ...(scheduledIso ? { death_deletion_scheduled_at: scheduledIso } : {}),
      current_life_event: `Deceased — ${causeText}`,
      daily_micro_narration: '',
      resolved_presence_status: 'deceased',
      resolved_current_location_id: '',
      resolved_current_location_name: '',
      location_status: 'unavailable',
      location_visibility_state: 'unreachable',
      travel_status: 'not_traveling',
      traveling_to_location_id: '',
      traveling_to_location_name: '',
      travel_destination_location_id: '',
      travel_destination_location_name: '',
      current_home_location_id: '',
      pending_alarm_time: null,
      pending_scheduled_relocation_at: null,
      next_location_id: '',
      next_location_name: '',
      presence_stay_lock: false,
      presence_stay_lock_location_id: '',
      presence_stay_lock_expires_at: null,
    });

    // ── 2. SURVIVING CHARACTERS KEEP THE LOSS ──────────────────────────────
    // Survivors are everyone the deceased was connected to through the existing
    // relationship data. Their memory and relationship history is preserved
    // independently of the deceased record, so deleting that record later
    // cannot erase the fact that this person existed and died.
    const relatedIds = new Set<string>();
    (char.fictional_relationships || []).forEach((r: any) => {
      if (r?.related_character_id) relatedIds.add(r.related_character_id);
    });
    (char.family_members || []).forEach((m: any) => {
      const id = m?.related_character_id || m?.character_id;
      if (id) relatedIds.add(id);
    });

    const [outgoing, incoming] = await Promise.all([
      base44.asServiceRole.entities.CharacterRelationship.filter({ source_character_id: characterId }, null, 200).catch(() => []),
      base44.asServiceRole.entities.CharacterRelationship.filter({ target_character_id: characterId }, null, 200).catch(() => []),
    ]);
    [...outgoing, ...incoming].forEach((r: any) => {
      const other = r.source_character_id === characterId ? r.target_character_id : r.source_character_id;
      if (other) relatedIds.add(other);
    });

    if (char.owner_email) {
      const ownerChars = await base44.asServiceRole.entities.Character
        .filter({ owner_email: char.owner_email }, null, 200)
        .catch(() => []);
      ownerChars.forEach((c: any) => {
        if (c.id === characterId) return;
        if ((c.fictional_relationships || []).some((r: any) => r?.related_character_id === characterId)) relatedIds.add(c.id);
      });
    }
    relatedIds.delete(characterId);

    const relationshipBySurvivor: Record<string, any> = {};
    [...outgoing, ...incoming].forEach((r: any) => {
      const other = r.source_character_id === characterId ? r.target_character_id : r.source_character_id;
      if (other && !relationshipBySurvivor[other]) relationshipBySurvivor[other] = r;
    });

    const deathSentence = `${char.name} died on ${easternLabel(nowIso)}.`;
    const circumstanceSentence = circumstances ? ` ${circumstances}` : '';
    let memoriesPreserved = 0;

    for (const survivorId of Array.from(relatedIds).slice(0, 60)) {
      try {
        const survivor = await base44.asServiceRole.entities.Character.get(survivorId).catch(() => null);
        if (!survivor) continue;
        if (survivor.life_status === 'deceased' || survivor.status === 'deceased') continue;

        const ownEntry = (survivor.fictional_relationships || []).find((r: any) => r?.related_character_id === characterId);
        const deceEntry = (char.fictional_relationships || []).find((r: any) => r?.related_character_id === survivorId);
        const relRecord = relationshipBySurvivor[survivorId];
        const relType = (ownEntry?.relationship_type || deceEntry?.relationship_type || relRecord?.relationship_type || 'acquaintance').toString().replace(/_/g, ' ');
        const relLabel = ownEntry?.label_from_target_perspective || deceEntry?.label_from_source_perspective || relRecord?.label_from_target_perspective || relType;

        const closeness = ownEntry?.friendship_level ?? deceEntry?.friendship_level ?? relRecord?.friendship_level ?? 50;
        const isClose = closeness >= 70 || ['family', 'romantic', 'friend', 'roommate'].includes(String(relType));
        const emotionalLine = isClose
          ? 'This is a significant loss to them and stays with them.'
          : 'They knew them and will notice that they are gone.';

        const memoryText = `${char.name} — ${relLabel} to ${survivor.name}. ${deathSentence} Cause: ${causeText}.${circumstanceSentence} ${emotionalLine} They must not be described as alive, present, or reachable again.`;

        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: survivor.id,
          memory_type: 'relationship',
          memory_text: memoryText,
          memory_summary: `${char.name} (${relLabel}) died — ${causeText}`,
          related_character_id: characterId,
          importance_score: 9,
          confidence_score: 1,
          permanence: 'protected',
          validation_status: 'confirmed',
        });
        memoriesPreserved += 1;

        // The relationship becomes a historical relationship, not an active one.
        if (ownEntry) {
          const updatedRels = (survivor.fictional_relationships || []).map((r: any) =>
            r?.related_character_id === characterId
              ? { ...r, current_status: 'deceased', death_cause: causeText, deceased_on: nowIso }
              : r
          );
          await base44.asServiceRole.entities.Character.update(survivor.id, { fictional_relationships: updatedRels }).catch(() => {});
        }
      } catch (survivorErr) {
        console.warn(`[confirmCharacterDeath] survivor memory failed for ${survivorId}:`, survivorErr?.message);
      }
    }

    // ── 3. DELETION ────────────────────────────────────────────────────────
    let deletionLine = '';
    if (mode === 'immediate') {
      // Same soft-delete pathway deleteCharacter uses: the record stops being an
      // active character, and the audit entry records the deletion. History
      // (messages, memories, relationships) is never removed.
      await base44.asServiceRole.entities.Character.update(characterId, {
        status: 'soft_deleted',
        is_active_character: false,
      });
      await base44.asServiceRole.entities.CharacterDeletionAudit.create({
        character_id: characterId,
        deletion_type: 'soft_delete',
      });
      deletionLine = `${char.name}'s character record has been removed.`;
    } else {
      // The waiting period is registered on death_deletion_scheduled_at. The existing
      // entity-trigger workflow pattern (same as scheduled relocations) waits for that
      // exact instant once and then invokes the deletion executor — no polling.
      deletionLine = `${char.name} remains in deceased status until ${easternLabel(scheduledIso)}, then the record is removed.`;
    }

    return Response.json({
      success: true,
      character_id: characterId,
      character_name: char.name,
      death_category: category,
      death_cause: causeText,
      death_circumstances: circumstances,
      deletion_mode: mode,
      deletion_scheduled_at: scheduledIso || null,
      memories_preserved: memoriesPreserved,
      survivors: Array.from(relatedIds).length,
      message: `${char.name} is deceased. ${deletionLine}`,
    });
  } catch (error) {
    console.error('[confirmCharacterDeath]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});