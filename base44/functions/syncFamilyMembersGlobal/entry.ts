/**
 * Global NPC Family Member Sync Contract
 * 
 * GLOBAL LAW: RESOLVE-OR-LINK before create. NEVER create-first.
 * 
 * Resolution order before any npc_family_member creation:
 * 1. Existing _linked_character_id on the family row (stable ID — highest priority)
 * 2. active_created_character by owner_email + normalized name
 * 3. npc_family_member by owner_email + normalized name (any status=active, deduplicated)
 * 4. npc_fictitious / npc_regular by owner_email + normalized name
 * 5. ONLY if no match found: create new npc_family_member
 * 
 * This prevents:
 * - Leo Parker being created twice (once per parent)
 * - Lila Green getting a ghost npc_family_member when she exists as active_created_character
 * - Same person having multiple identities from different parents' family lists
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch ALL characters for this user (all types) — needed for full resolve-or-link lookup
    const allChars = await base44.entities.Character.filter({
      owner_email: user.email
    }, '', 500);

    // Separate by type for lookup
    const activeCreated = allChars.filter(c =>
      c.character_type === 'active_created_character' &&
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );
    const npcFamilyMembers = allChars.filter(c =>
      c.character_type === 'npc_family_member' &&
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );
    const otherNPCs = allChars.filter(c =>
      (c.character_type === 'npc_fictitious' || c.character_type === 'npc_regular') &&
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );

    // Build normalized-name lookup maps
    const activeCreatedByName = new Map(activeCreated.map(c => [c.name?.trim().toLowerCase(), c]));
    const npcFamilyByName = new Map(npcFamilyMembers.map(c => [c.name?.trim().toLowerCase(), c]));
    const otherNPCByName = new Map(otherNPCs.map(c => [c.name?.trim().toLowerCase(), c]));
    const allById = new Map(allChars.map(c => [c.id, c]));

    // Parents = active_created_character records with family_members
    const parents = activeCreated.filter(c => (c.family_members || []).length > 0);

    const syncLog = {
      processed: 0,
      synced: 0,
      created: 0,
      linked: 0,
      skipped_active_created: 0,
      errors: []
    };

    for (const parent of parents) {
      const familyMembers = parent.family_members || [];
      let parentNeedsUpdate = false;
      const updatedFamilyMembers = [...familyMembers];

      for (let idx = 0; idx < updatedFamilyMembers.length; idx++) {
        const member = updatedFamilyMembers[idx];
        if (!member.name?.trim()) continue;

        // Skip user/self entries
        if (member._is_user) continue;

        try {
          syncLog.processed++;
          const nameKey = member.name.trim().toLowerCase();

          // ── RESOLVE ORDER ──────────────────────────────────────────────────
          let resolvedId = null;

          // 1. Existing stable _linked_character_id (trust it if the record still exists)
          if (member._linked_character_id && allById.has(member._linked_character_id)) {
            const existing = allById.get(member._linked_character_id);
            if (existing.status !== 'deleted' && existing.status !== 'soft_deleted') {
              resolvedId = member._linked_character_id;
            }
          }

          // 2. active_created_character by name — DO NOT create npc_family_member for these
          if (!resolvedId && activeCreatedByName.has(nameKey)) {
            const activeChar = activeCreatedByName.get(nameKey);
            resolvedId = activeChar.id;
            syncLog.skipped_active_created++;
            // Update the family row to link to the active character
            updatedFamilyMembers[idx] = { ...member, _linked_character_id: resolvedId };
            parentNeedsUpdate = true;
            continue; // Do NOT try to sync avatar — active char manages its own
          }

          // 3. Existing npc_family_member by name
          if (!resolvedId && npcFamilyByName.has(nameKey)) {
            resolvedId = npcFamilyByName.get(nameKey).id;
          }

          // 4. Other NPC types (npc_fictitious, npc_regular) by name
          if (!resolvedId && otherNPCByName.has(nameKey)) {
            resolvedId = otherNPCByName.get(nameKey).id;
          }

          // 5. ONLY if no match: create new npc_family_member
          if (!resolvedId) {
            const newFamilyNPC = await base44.entities.Character.create({
              name: member.name.trim(),
              character_type: 'npc_family_member',
              owner_email: user.email,
              owner_user_id: user.id,
              created_by_role: user.role || 'user',
              status: 'active',
              is_active_character: false,
              visibility_scope: 'account_private',
              data_scope: 'private_user',
              exclude_from_homepage: true,
              exclude_from_roster: true,
              avatar_url: member.photo_url || null
            });
            resolvedId = newFamilyNPC.id;
            // Register in lookup so subsequent parents don't create another
            npcFamilyByName.set(nameKey, newFamilyNPC);
            allById.set(resolvedId, newFamilyNPC);
            syncLog.created++;
          }

          // ── UPDATE family row if resolvedId differs from current link ──────
          if (resolvedId && member._linked_character_id !== resolvedId) {
            updatedFamilyMembers[idx] = { ...member, _linked_character_id: resolvedId };
            parentNeedsUpdate = true;
            syncLog.linked++;
          }

          // ── AVATAR SYNC: family_members[].photo_url → linked Character.avatar_url ─
          if (resolvedId && member.photo_url) {
            const linkedChar = allById.get(resolvedId);
            if (linkedChar && linkedChar.avatar_url !== member.photo_url) {
              await base44.entities.Character.update(resolvedId, {
                avatar_url: member.photo_url
              });
              syncLog.synced++;
            }
          }

        } catch (err) {
          syncLog.errors.push({
            member: member.name,
            parent: parent.name,
            error: err.message
          });
        }
      }

      // Write updated family_members back to parent if anything changed
      if (parentNeedsUpdate) {
        await base44.entities.Character.update(parent.id, {
          family_members: updatedFamilyMembers
        });
      }
    }

    return Response.json({
      success: true,
      ...syncLog
    });
  } catch (error) {
    return Response.json(
      { error: error.message, type: 'backend_error' },
      { status: 500 }
    );
  }
});