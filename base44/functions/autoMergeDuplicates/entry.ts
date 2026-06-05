import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * autoMergeDuplicates
 *
 * OWNERSHIP: owner_email is the ONLY ownership source of truth.
 * created_by is PERMANENTLY FORBIDDEN — never used, never referenced.
 *
 * Finds duplicate character names scoped to the authenticated user's owner_email,
 * then merges duplicates into the oldest/most complete record.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // OWNERSHIP GATE: filter strictly by owner_email — NOT created_by, NOT list-all
    const userChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      500
    ).catch(() => []);

    // Exclude already-removed records and world-service characters
    // npc_world_service characters (e.g. Vick Servicio) are permanently protected from merging.
    const activeChars = userChars.filter(c =>
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged' &&
      c.character_type !== 'npc_world_service' &&
      c.is_world_service !== true
    );

    // Group by normalized name
    const nameMap = new Map();
    for (const char of activeChars) {
      const normalized = char.name?.toLowerCase().trim() || '';
      if (!normalized) continue;
      if (!nameMap.has(normalized)) nameMap.set(normalized, []);
      nameMap.get(normalized).push(char);
    }

    let merged = 0;
    const mergeLog = [];

    for (const [name, dupes] of nameMap.entries()) {
      if (dupes.length < 2) continue;

      // Sort oldest first — master is the earliest created record
      const sorted = dupes.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      const master = sorted[0];
      const duplicates = sorted.slice(1);

      // SAFETY: verify master has owner_email before touching anything
      if (!master.owner_email) {
        mergeLog.push({
          name,
          skipped: true,
          reason: 'Master record is missing owner_email — skipped for safety',
          masterId: master.id,
        });
        continue;
      }

      // Remap fictional_relationships and family_members on ALL owner-scoped characters
      const allOwnerChars = await base44.entities.Character.filter(
        { owner_email: user.email },
        null,
        500
      ).catch(() => []);

      for (const char of allOwnerChars) {
        const updatedRels = (char.fictional_relationships || []).map(rel =>
          duplicates.some(dup => dup.id === rel.related_character_id)
            ? { ...rel, related_character_id: master.id }
            : rel
        );
        const updatedFms = (char.family_members || []).map(fm =>
          duplicates.some(dup => dup.id === fm.character_id)
            ? { ...fm, character_id: master.id }
            : fm
        );
        const relsChanged = JSON.stringify(updatedRels) !== JSON.stringify(char.fictional_relationships || []);
        const fmsChanged = JSON.stringify(updatedFms) !== JSON.stringify(char.family_members || []);
        if (relsChanged || fmsChanged) {
          await base44.entities.Character.update(char.id, {
            fictional_relationships: updatedRels,
            family_members: updatedFms,
          }).catch(() => {});
        }
      }

      // Mark duplicates as merged — do NOT delete (safe audit trail)
      for (const dup of duplicates) {
        await base44.entities.Character.update(dup.id, {
          status: 'merged',
          merged_into_character_id: master.id,
        }).catch(() => {});
        merged++;
        mergeLog.push({
          name,
          masterId: master.id,
          masterName: master.name,
          mergedId: dup.id,
        });
      }
    }

    return Response.json({
      success: true,
      merged,
      mergeLog,
      message: `Merged ${merged} duplicate character(s) into masters`,
    });

  } catch (error) {
    console.error('[autoMergeDuplicates]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});