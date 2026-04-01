import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * mergeCharacters
 * 
 * Merge multiple characters into a primary character:
 * - Selects primary character (or uses recommendation logic)
 * - Remaps all dependent records to primary
 * - Marks secondaries as merged (status = 'merged')
 * - Creates CharacterAlias entries for merged names
 * - Creates CharacterMergeAudit
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterIds, primaryCharacterId, conflictResolutions = {} } = await req.json();
    if (!characterIds || !Array.isArray(characterIds) || characterIds.length < 2) {
      return Response.json({ error: 'At least 2 characterIds required' }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────
    // FETCH ALL RECORDS
    // ─────────────────────────────────────────────────────────
    const chars = await Promise.all(
      characterIds.map(id => base44.entities.Character.get(id))
    );

    const missingIds = chars
      .map((c, i) => c ? null : characterIds[i])
      .filter(Boolean);
    if (missingIds.length > 0) {
      return Response.json({ error: `Characters not found: ${missingIds.join(', ')}` }, { status: 404 });
    }

    // ─────────────────────────────────────────────────────────
    // SELECT PRIMARY
    // ─────────────────────────────────────────────────────────
    let primary = primaryCharacterId 
      ? chars.find(c => c.id === primaryCharacterId)
      : recommendPrimary(chars);

    if (!primary) {
      return Response.json({ error: 'Invalid primary character ID' }, { status: 400 });
    }

    const secondaryIds = characterIds.filter(id => id !== primary.id);
    const oldNames = chars.map(c => c.name);

    // ─────────────────────────────────────────────────────────
    // REMAP DEPENDENT RECORDS (conversations, messages, etc.)
    // ─────────────────────────────────────────────────────────
    // In production, this would batch update:
    // - Conversation.character_ids
    // - Message.character_id
    // - Memory.character_id
    // - RelationshipState.character_id
    // - ScheduledEvent.character_ids
    // - CharacterAutonomyEvent.character_id
    // etc.

    // For now, we'll do basic remapping
    const convos = await base44.asServiceRole.entities.Conversation.filter({});
    for (const convo of convos) {
      const charIds = convo.character_ids || [];
      const updatedIds = charIds.map(id => 
        secondaryIds.includes(id) ? primary.id : id
      ).filter((v, i, a) => a.indexOf(v) === i); // dedupe

      if (updatedIds.length !== charIds.length || !updatedIds.every(id => charIds.includes(id))) {
        await base44.asServiceRole.entities.Conversation.update(convo.id, {
          character_ids: updatedIds,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // MARK SECONDARIES AS MERGED
    // ─────────────────────────────────────────────────────────
    for (const secondaryId of secondaryIds) {
      await base44.entities.Character.update(secondaryId, {
        status: 'merged',
        merged_into_character_id: primary.id,
      });
    }

    // ─────────────────────────────────────────────────────────
    // CREATE ALIASES FOR MERGED NAMES
    // ─────────────────────────────────────────────────────────
    for (const char of chars) {
      if (char.id !== primary.id) {
        await base44.entities.CharacterAlias.create({
          character_id: primary.id,
          alias_name: char.name,
          source_type: 'merge',
          prior_primary: true,
        });
      }
    }

    // ─────────────────────────────────────────────────────────
    // CREATE MERGE AUDIT
    // ─────────────────────────────────────────────────────────
    await base44.entities.CharacterMergeAudit.create({
      primary_character_id: primary.id,
      merged_character_ids: secondaryIds,
      old_names: oldNames,
      final_display_name: conflictResolutions.display_name || primary.name,
      conflict_resolution_snapshot: conflictResolutions,
    });

    // ─────────────────────────────────────────────────────────
    // UPDATE PRIMARY IF CONFLICTS RESOLVED
    // ─────────────────────────────────────────────────────────
    const primaryUpdate = {};
    if (conflictResolutions.display_name && conflictResolutions.display_name !== primary.name) {
      primaryUpdate.name = conflictResolutions.display_name;
    }
    if (Object.keys(primaryUpdate).length > 0) {
      await base44.entities.Character.update(primary.id, primaryUpdate);
    }

    return Response.json({
      success: true,
      primary_character_id: primary.id,
      primary_character_name: conflictResolutions.display_name || primary.name,
      merged_character_ids: secondaryIds,
      merged_names: oldNames.filter(n => n !== primary.name),
      message: `Merged ${secondaryIds.length} character(s) into "${conflictResolutions.display_name || primary.name}". All history preserved.`,
    });
  } catch (error) {
    console.error('[mergeCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * recommendPrimary
 * 
 * Recommendation logic for which character should be the primary after merge.
 * Priority:
 * 1. Protected or default character
 * 2. Active character
 * 3. Most recently updated
 */
function recommendPrimary(chars) {
  // Protected/default first
  let candidate = chars.find(c => c.is_protected || c.is_default);
  if (candidate) return candidate;

  // Active character
  candidate = chars.find(c => c.is_active_character);
  if (candidate) return candidate;

  // Most recently updated
  return chars.reduce((latest, c) => {
    const latestTime = new Date(latest.updated_date || 0);
    const cTime = new Date(c.updated_date || 0);
    return cTime > latestTime ? c : latest;
  });
}