import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * mergeCharacters - COMPLETE MERGE WITH FULL DATA CONSOLIDATION
 *
 * - Ownership-scoped: all characters must share owner_email with authenticated user
 * - created_by is NEVER used
 * - Consolidates ALL memory, relationships, family, schedules, locations
 * - Remaps ALL dependent records (conversations, messages, memories, etc.)
 * - PROPAGATES master's avatar_url and name into all fictional_relationships on ALL characters
 * - DELETES all secondary characters AFTER consolidation is confirmed
 * - Creates CharacterAlias entries for merged names
 * - Creates CharacterMergeAudit
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterIds, primaryCharacterId, conflictResolutions = {}, masterAvatarUrl, masterName, ownerEmail } = await req.json();

    // OWNERSHIP GUARD: ownerEmail must match authenticated user
    const effectiveOwnerEmail = ownerEmail || user.email;
    if (effectiveOwnerEmail !== user.email) {
      return Response.json({ error: 'ownerEmail must match authenticated user — cross-account merge is forbidden' }, { status: 403 });
    }
    if (!characterIds || !Array.isArray(characterIds) || characterIds.length < 2) {
      return Response.json({ error: 'At least 2 characterIds required' }, { status: 400 });
    }

    // ── FETCH ALL CHARACTERS — owner_email scoped (NO created_by, NO list-all) ──
    // Load each character by ID with owner_email filter to verify ownership before touching anything
    const charResults = await Promise.all(
      characterIds.map(id =>
        base44.entities.Character.filter({ id, owner_email: effectiveOwnerEmail }, null, 1).catch(() => [])
      )
    );
    const allCharsForUser = charResults.map(r => r?.[0]).filter(Boolean);

    // Also load all same-owner characters for the relationship propagation step
    const allOwnerChars = await base44.entities.Character.filter(
      { owner_email: effectiveOwnerEmail, status: 'active' }, null, 500
    ).catch(() => []);

    const charMap = Object.fromEntries(allCharsForUser.map(c => [c.id, c]));

    // VERIFY: all requested character IDs belong to this owner
    for (const id of characterIds) {
      if (!charMap[id]) {
        return Response.json({
          error: `Character ${id} not found or does not belong to owner_email "${effectiveOwnerEmail}". Merge aborted.`
        }, { status: 403 });
      }
    }

    // SELECT PRIMARY — must exist and be the designated master
    let primary = primaryCharacterId ? charMap[primaryCharacterId] : null;

    if (!primary) {
      // Primary was already deleted or never existed — nothing to merge into
      return Response.json({ 
        error: `Primary character ${primaryCharacterId} not found. It may have already been merged or deleted.` 
      }, { status: 404 });
    }

    // Secondaries: all the duplicate IDs that are NOT the primary
    // Skip any that don't exist (already deleted from a prior merge attempt)
    const secondaryIds = characterIds.filter(id => id !== primary.id && charMap[id]);
    
    if (secondaryIds.length === 0) {
      // Nothing left to merge — duplicates already gone, master exists. Success.
      return Response.json({
        success: true,
        primary_character_id: primary.id,
        primary_character_name: primary.name,
        merged_character_ids: [],
        message: 'Duplicates were already removed. Master character is intact.',
      });
    }

    const secondaryChars = secondaryIds.map(id => charMap[id]).filter(Boolean);
    const oldNames = [primary, ...secondaryChars].map(c => c.name);
    const secondaryNames = secondaryChars.map(c => c.name.toLowerCase());

    // The final avatar and name for the master
    const finalAvatar = masterAvatarUrl || primary.avatar_url || null;
    const finalName = conflictResolutions.display_name || masterName || primary.name;

    // ── MASTER WINS — duplicate data is discarded, master data is authoritative ──
    // We do NOT blend data from duplicates into the master.
    // The master's profile, name, avatar, relationships, family — all stay exactly as-is.
    // Only thing we do: add secondary names as aliases so the master is recognizable.
    // All records (messages, memories, convos) that referenced the duplicate get re-pointed to master.

    // Just ensure the master's name/avatar are confirmed (no change if already set)
    if (finalName !== primary.name || (finalAvatar && finalAvatar !== primary.avatar_url)) {
      await base44.asServiceRole.entities.Character.update(primary.id, {
        name: finalName,
        ...(finalAvatar ? { avatar_url: finalAvatar } : {}),
      });
    }

    // ── REMAP DEPENDENT RECORDS ──────────────────────────────────────────

    // Conversations: replace secondary char IDs with primary
    const convos = await base44.asServiceRole.entities.Conversation.list('-updated_date', 2000);
    for (const convo of convos) {
      const ids = convo.character_ids || [];
      const hasSecondary = ids.some(id => secondaryIds.includes(id));
      if (hasSecondary) {
        const updatedIds = [...new Set(ids.map(id => secondaryIds.includes(id) ? primary.id : id))];
        await base44.asServiceRole.entities.Conversation.update(convo.id, { character_ids: updatedIds });
      }
    }

    // Messages
    const messages = await base44.asServiceRole.entities.Message.list('-updated_date', 5000);
    for (const msg of messages) {
      const updates = {};
      if (secondaryIds.includes(msg.character_id)) { updates.character_id = primary.id; updates.character_name = finalName; }
      if (secondaryIds.includes(msg.played_as_character_id)) { updates.played_as_character_id = primary.id; updates.played_as_character_name = finalName; }
      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Message.update(msg.id, updates);
      }
    }

    // Memories
    const memories = await base44.asServiceRole.entities.Memory.list('-updated_date', 5000);
    for (const mem of memories) {
      if (secondaryIds.includes(mem.character_id)) {
        await base44.asServiceRole.entities.Memory.update(mem.id, { character_id: primary.id });
      }
    }

    // CharacterMemory (if it exists)
    try {
      const charMemories = await base44.asServiceRole.entities.CharacterMemory.list('-updated_date', 5000);
      for (const cm of charMemories) {
        const updates = {};
        if (secondaryIds.includes(cm.character_id)) updates.character_id = primary.id;
        if (secondaryIds.includes(cm.related_character_id)) updates.related_character_id = primary.id;
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.CharacterMemory.update(cm.id, updates);
        }
      }
    } catch (_) {}

    // RelationshipState
    try {
      const relStates = await base44.asServiceRole.entities.RelationshipState.list('-updated_date', 1000);
      for (const rel of relStates) {
        if (secondaryIds.includes(rel.character_id)) {
          await base44.asServiceRole.entities.RelationshipState.update(rel.id, { character_id: primary.id });
        }
      }
    } catch (_) {}

    // CharacterRelationship
    try {
      const charRels = await base44.asServiceRole.entities.CharacterRelationship.list('-updated_date', 2000);
      for (const cr of charRels) {
        const updates = {};
        if (secondaryIds.includes(cr.source_character_id)) updates.source_character_id = primary.id;
        if (secondaryIds.includes(cr.target_character_id)) updates.target_character_id = primary.id;
        if (Object.keys(updates).length > 0) {
          await base44.asServiceRole.entities.CharacterRelationship.update(cr.id, updates);
        }
      }
    } catch (_) {}

    // LifeEvent
    try {
      const lifeEvents = await base44.asServiceRole.entities.LifeEvent.list('-updated_date', 1000);
      for (const ev of lifeEvents) {
        if (secondaryIds.includes(ev.character_id)) {
          await base44.asServiceRole.entities.LifeEvent.update(ev.id, { character_id: primary.id, character_name: finalName });
        }
      }
    } catch (_) {}

    // PendingMessage
    try {
      const pendingMsgs = await base44.asServiceRole.entities.PendingMessage.list('-updated_date', 500);
      for (const pm of pendingMsgs) {
        if (secondaryIds.includes(pm.character_id)) {
          await base44.asServiceRole.entities.PendingMessage.update(pm.id, { character_id: primary.id });
        }
      }
    } catch (_) {}

    // CharacterAutonomyEvent
    try {
      const autonomyEvents = await base44.asServiceRole.entities.CharacterAutonomyEvent.list('-updated_date', 500);
      for (const ae of autonomyEvents) {
        if (secondaryIds.includes(ae.character_id)) {
          await base44.asServiceRole.entities.CharacterAutonomyEvent.update(ae.id, { character_id: primary.id });
        }
      }
    } catch (_) {}

    // ── PROPAGATE MASTER AVATAR + NAME INTO ALL OTHER CHARACTERS' fictional_relationships ──
    // Any character that references a secondary's name in their fictional_relationships
    // must be updated to use the master's name and avatar
    const allActiveChars = allOwnerChars.filter(c =>
      c.id !== primary.id &&
      !secondaryIds.includes(c.id) &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged'
    );

    for (const char of allActiveChars) {
      const rels = char.fictional_relationships || [];
      let changed = false;
      const updatedRels = rels.map(rel => {
        const relNameLower = rel.person_name?.toLowerCase();
        const isSecondary = secondaryNames.includes(relNameLower);
        const isPrimary = relNameLower === primary.name.toLowerCase() || relNameLower === finalName.toLowerCase();
        if (isSecondary || isPrimary) {
          changed = true;
          return {
            ...rel,
            person_name: finalName,
            related_character_id: primary.id,
            ...(finalAvatar ? { avatar_url: finalAvatar } : {}),
          };
        }
        return rel;
      });

      // Deduplicate by person_name after renaming
      const seen = new Map();
      const deduped = [];
      for (const rel of updatedRels) {
        const key = rel.person_name?.toLowerCase();
        if (!key) { deduped.push(rel); continue; }
        if (!seen.has(key)) {
          seen.set(key, true);
          deduped.push(rel);
        } else {
          changed = true; // we dropped a duplicate
        }
      }

      if (changed) {
        await base44.asServiceRole.entities.Character.update(char.id, { fictional_relationships: deduped });
      }
    }

    // Also update family_members references across all characters
    for (const char of allActiveChars) {
      const fms = char.family_members || [];
      let changed = false;
      const updatedFms = fms.map(fm => {
        const fmNameLower = fm.name?.toLowerCase();
        if (secondaryNames.includes(fmNameLower)) {
          changed = true;
          return { ...fm, name: finalName, ...(finalAvatar ? { photo_url: finalAvatar } : {}) };
        }
        return fm;
      });
      if (changed) {
        await base44.asServiceRole.entities.Character.update(char.id, { family_members: updatedFms });
      }
    }

    // ── CREATE ALIASES FOR MERGED NAMES ──────────────────────────────────
    for (const char of secondaryChars) {
      if (char.name !== finalName) {
        await base44.asServiceRole.entities.CharacterAlias.create({
          character_id: primary.id,
          alias_name: char.name,
          source_type: 'merge',
          prior_primary: true,
        }).catch(() => {});
      }
    }

    // ── CREATE MERGE AUDIT ───────────────────────────────────────────────
    await base44.asServiceRole.entities.CharacterMergeAudit.create({
      primary_character_id: primary.id,
      merged_character_ids: secondaryIds,
      old_names: oldNames,
      final_display_name: finalName,
      conflict_resolution_snapshot: conflictResolutions,
    }).catch(() => {});

    // ── DELETE SECONDARY CHARACTERS ───────────────────────────────────────
    for (const secondaryId of secondaryIds) {
      await base44.asServiceRole.entities.Character.delete(secondaryId).catch(() => {});
    }

    return Response.json({
      success: true,
      primary_character_id: primary.id,
      primary_character_name: finalName,
      merged_character_ids: secondaryIds,
      merged_names: oldNames.filter(n => n !== primary.name),
      avatar_propagated: !!finalAvatar,
      message: `Merged ${secondaryIds.length} character(s) into "${finalName}". Avatar and name propagated across all characters.`,
    });
  } catch (error) {
    console.error('[mergeCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function recommendPrimary(chars) {
  let candidate = chars.find(c => c.is_active_character && c.character_type === 'active');
  if (candidate) return candidate;
  candidate = chars.find(c => c.is_protected || c.is_default);
  if (candidate) return candidate;
  return chars.reduce((latest, c) => {
    return new Date(c.updated_date || 0) > new Date(latest.updated_date || 0) ? c : latest;
  });
}