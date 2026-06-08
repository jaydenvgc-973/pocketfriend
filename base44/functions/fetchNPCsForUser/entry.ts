import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // SOURCE 1: owner_email-scoped query — catches all characters created for this account
    const chars1 = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      500
    ).catch(() => []);

    // SOURCE 2: npc_world_service characters scoped to this account only.
    const worldServiceChars = await base44.entities.Character.filter(
      { character_type: 'npc_world_service', owner_email: ownerEmail },
      '-created_date',
      10
    ).catch(() => []);

    // SOURCE 3: null-owner npc_fictitious/npc_family_member records referenced by this
    // account's owned characters via fictional_relationships or family_members.
    // These are legacy records created before owner_email was reliably set. They are
    // invisible to owner_email-scoped queries but still belong to this account.
    const referencedIds = new Set();
    for (const c of chars1) {
      for (const rel of (c.fictional_relationships || [])) {
        if (rel.related_character_id) referencedIds.add(rel.related_character_id);
      }
      for (const fm of (c.family_members || [])) {
        const id = fm.character_id || fm.related_character_id;
        if (id) referencedIds.add(id);
      }
    }

    // Only fetch if there are referenced IDs not already returned by SOURCE 1
    const source1Ids = new Set(chars1.map(c => c.id));
    const missingReferencedIds = [...referencedIds].filter(id => !source1Ids.has(id));
    const nullOwnerReferenced = missingReferencedIds.length > 0
      ? (await Promise.all(
          missingReferencedIds.map(id =>
            base44.asServiceRole.entities.Character.filter({ id }).catch(() => [])
          )
        )).flat().filter(c =>
          !c.owner_email &&
          (c.character_type === 'npc_fictitious' || c.character_type === 'npc_family_member' || c.character_type === 'npc_regular') &&
          c.status !== 'deleted' && c.status !== 'soft_deleted'
        )
      : [];

    if (nullOwnerReferenced.length > 0) {
      console.log(`[fetchNPCsForUser] Found ${nullOwnerReferenced.length} null-owner referenced NPCs: ${nullOwnerReferenced.map(c => c.name).join(', ')}`);
    }

    // Merge and deduplicate by id — chars1 has priority (it is owner-scoped)
    const seen = new Set();
    const allChars = [];
    for (const c of [...chars1, ...worldServiceChars, ...nullOwnerReferenced]) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      allChars.push(c);
    }

    // Filter to NPC types (exclude active_created_character and deleted)
    // CRITICAL: owner_email must match — never include cross-account records.
    const all = allChars.filter(c => {
      if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
      if (c.character_type === 'active_created_character') return false;
      // Strict owner-email guard — prevents cross-account Vick bleed
      if (c.owner_email && c.owner_email !== ownerEmail) return false;
      // npc_world_service — included only when owner matches
      if (c.character_type === 'npc_world_service') return true;
      // DUPLICATE VICK GUARD: if a record is named Vick Servicio but does NOT have
      // character_type='npc_world_service', it is a stale/corrupt duplicate from a previous
      // creation attempt that failed to set the type field. Exclude it — the canonical Vick
      // already passed through the npc_world_service path above.
      const nameKey = (c.name || '').toLowerCase().trim();
      if (nameKey === 'vick servicio' || nameKey === 'victor servicio') return false;
      // INCLUDE records with missing/null character_type (legacy compatibility)
      return !c.character_type || ['npc_fictitious', 'npc_family_member', 'npc_regular'].includes(c.character_type);
    });

    const fictitiousNames = all.filter(c => c.character_type === 'npc_fictitious').map(c => c.name);
    const summary = {
      total: all.length,
      fictitious: all.filter(c => c.character_type === 'npc_fictitious').length,
      family: all.filter(c => c.character_type === 'npc_family_member').length,
      regular: all.filter(c => c.character_type === 'npc_regular').length,
      fictitiousNames,
    };
    console.log('[fetchNPCsForUser] summary:', JSON.stringify(summary));
    return Response.json({ npcs: all });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});