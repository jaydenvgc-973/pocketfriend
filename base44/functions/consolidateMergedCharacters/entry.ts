import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { masterCharacterId, duplicateCharacterIds, mergeReason } = await req.json();

    if (!masterCharacterId || !duplicateCharacterIds || duplicateCharacterIds.length === 0) {
      return Response.json({ error: 'masterCharacterId and duplicateCharacterIds required' }, { status: 400 });
    }

    // Fetch master and duplicates
    const allChars = await base44.entities.Character.list();
    const master = allChars.find(c => c.id === masterCharacterId);
    const duplicates = allChars.filter(c => duplicateCharacterIds.includes(c.id));

    if (!master || duplicates.length === 0) {
      return Response.json({ error: 'Master or duplicates not found' }, { status: 404 });
    }

    // Consolidate relationships: merge all fictional_relationships from duplicates into master
    let masterRels = JSON.parse(JSON.stringify(master.fictional_relationships || []));
    
    duplicates.forEach(dup => {
      (dup.fictional_relationships || []).forEach(rel => {
        const existing = masterRels.find(r => (r.person_name || '').toLowerCase() === (rel.person_name || '').toLowerCase());
        if (existing) {
          // Merge stats: take the max of each score
          existing.friendship_level = Math.max(existing.friendship_level ?? 50, rel.friendship_level ?? 50);
          existing.user_respect_level = Math.max(existing.user_respect_level ?? 50, rel.user_respect_level ?? 50);
          existing.romantic_level = Math.max(existing.romantic_level ?? 0, rel.romantic_level ?? 0);
          existing.attraction_level = Math.max(existing.attraction_level ?? 0, rel.attraction_level ?? 0);
          existing.trust_level = Math.max(existing.trust_level ?? 50, rel.trust_level ?? 50);
        } else {
          masterRels.push({ ...rel });
        }
      });
    });

    // Consolidate aliases: merge all aliases from duplicates into master
    let masterAliases = JSON.parse(JSON.stringify(master.aliases || []));
    duplicates.forEach(dup => {
      (dup.aliases || []).forEach(alias => {
        const exists = masterAliases.some(a => a.normalized === alias.normalized);
        if (!exists) {
          masterAliases.push({ ...alias });
        }
      });
    });

    // Update master character with consolidated data
    await base44.entities.Character.update(masterCharacterId, {
      fictional_relationships: masterRels,
      aliases: masterAliases,
      status: 'active',
    });

    // Mark all duplicates as merged into master
    for (const dup of duplicates) {
      await base44.entities.Character.update(dup.id, {
        status: 'merged',
        merged_into_character_id: masterCharacterId,
      });
    }

    // Log the merge to CharacterMergeLog for audit trail
    for (const dup of duplicates) {
      await base44.entities.CharacterMergeLog.create({
        canonical_character_id: masterCharacterId,
        duplicate_character_id: dup.id,
        canonical_character_name: master.name,
        duplicate_character_name: dup.name,
        merge_reason: mergeReason || 'User-initiated merge from UI',
        merged_aliases_count: (dup.aliases || []).length,
        merged_relationships_count: (dup.fictional_relationships || []).length,
      });
    }

    return Response.json({
      success: true,
      masterCharacterId,
      mergedCount: duplicates.length,
      consolidatedRelationships: masterRels.length,
      consolidatedAliases: masterAliases.length,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});