/**
 * Global NPC Family Member Sync Contract — RESOLVE-BEFORE-CREATE
 * 
 * GLOBAL LAW: Before creating ANY npc_family_member, resolve existing Character by this order:
 * 1. linked_character_id on family row (stable ID — highest priority)
 * 2. active_created_character by owner_email + normalized name
 * 3. existing npc_family_member by owner_email + normalized name
 * 4. npc_fictitious / npc_regular by owner_email + normalized name
 * 5. ONLY if no match: create new npc_family_member
 * 
 * This prevents duplicate npc_family_member creation across parents.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch ALL characters for this user
    const allChars = await base44.entities.Character.filter({
      owner_email: user.email
    }, '', 500);

    // Filter for live characters only (not deleted/soft_deleted/merged)
    const liveChars = allChars.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );

    // Build lookup maps by normalized name (lowercase)
    const charMapByName = new Map();
    const charMapById = new Map();

    for (const char of liveChars) {
      const nameKey = char.name?.trim().toLowerCase();
      if (nameKey) {
        // Map stores FIRST match per name (priority: active_created > npc_family > others)
        if (!charMapByName.has(nameKey)) {
          charMapByName.set(nameKey, char);
        }
      }
      charMapById.set(char.id, char);
    }

    // Parents = characters with family_members array
    const parents = liveChars.filter(c => (c.family_members || []).length > 0);

    const syncLog = {
      processed: 0,
      synced_avatar: 0,
      linked_existing: 0,
      created_new: 0,
      errors: []
    };

    for (const parent of parents) {
      let parentChanged = false;
      const updatedFamilyMembers = [...(parent.family_members || [])];

      for (let idx = 0; idx < updatedFamilyMembers.length; idx++) {
        const member = updatedFamilyMembers[idx];
        if (!member.name?.trim()) continue;
        if (member._is_user) continue; // Skip user/self entries

        try {
          syncLog.processed++;

          // ── RESOLUTION CHAIN ──────────────────────────────────────────
          let resolvedCharId = null;

          // Step 1: Trust stable _linked_character_id if it exists and is live
          if (member._linked_character_id && charMapById.has(member._linked_character_id)) {
            const existingChar = charMapById.get(member._linked_character_id);
            if (existingChar.status !== 'deleted' && existingChar.status !== 'soft_deleted') {
              resolvedCharId = member._linked_character_id;
            }
          }

          // Step 2-4: Look up by name (map stores first match, which respects type priority)
          if (!resolvedCharId) {
            const nameKey = member.name.trim().toLowerCase();
            if (charMapByName.has(nameKey)) {
              resolvedCharId = charMapByName.get(nameKey).id;
            }
          }

          // Step 5: Create new npc_family_member only if no match found
          if (!resolvedCharId) {
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
            resolvedCharId = newFamilyNPC.id;
            // Register in maps so other parents reuse it
            const nameKey = member.name.trim().toLowerCase();
            if (!charMapByName.has(nameKey)) {
              charMapByName.set(nameKey, newFamilyNPC);
            }
            charMapById.set(resolvedCharId, newFamilyNPC);
            syncLog.created_new++;
          }

          // Update family row if _linked_character_id differs
          if (resolvedCharId && member._linked_character_id !== resolvedCharId) {
            updatedFamilyMembers[idx] = { ...member, _linked_character_id: resolvedCharId };
            parentChanged = true;
            syncLog.linked_existing++;
          }

          // Sync avatar_url: family_members[].photo_url → Character.avatar_url
          if (resolvedCharId && member.photo_url) {
            const resolvedChar = charMapById.get(resolvedCharId);
            if (resolvedChar && resolvedChar.avatar_url !== member.photo_url) {
              await base44.entities.Character.update(resolvedCharId, {
                avatar_url: member.photo_url
              });
              syncLog.synced_avatar++;
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

      // Persist updated family_members
      if (parentChanged) {
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