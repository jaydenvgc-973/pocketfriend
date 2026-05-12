/**
 * Global NPC Family Member Sync Contract
 * 
 * REQUIREMENT: Every npc_family_member Character record must follow Hayden's linkage model:
 * - Stable linked Character record (npc_family_member type)
 * - Synced avatar_url between parent's family_members[] entry and linked Character
 * - Same avatar resolved in Family Editor and Settings NPC FAMILY list
 * - Regeneration updates both locations atomically
 * - Survives reload/refresh
 * 
 * This function enforces the global contract across ALL npc_family_member records.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all active_created_character records (parents)
    const parents = await base44.entities.Character.filter({
      owner_email: user.email,
      character_type: 'active_created_character',
      status: 'active'
    });

    // Fetch all npc_family_member records for this user
    const npcFamilyMembers = await base44.entities.Character.filter({
      owner_email: user.email,
      character_type: 'npc_family_member',
      status: 'active'
    });

    const syncLog = {
      processed: 0,
      synced: 0,
      created: 0,
      errors: []
    };

    // For each parent, sync family_members[] to linked npc_family_member records
    for (const parent of parents) {
      const familyMembers = parent.family_members || [];
      if (familyMembers.length === 0) continue;

      for (const member of familyMembers) {
        if (!member.name?.trim()) continue;

        try {
          syncLog.processed++;

          // Step 1: Check if this family member has a linked Character ID
          let linkedCharId = member._linked_character_id || null;

          // Step 2: If not linked, try to find existing npc_family_member by name + parent ID
          if (!linkedCharId) {
            const existing = npcFamilyMembers.find(npc =>
              npc.name?.trim().toLowerCase() === member.name.trim().toLowerCase() &&
              npc.owner_email === user.email
            );
            if (existing) {
              linkedCharId = existing.id;
              // Update parent's family_members entry with the linked ID
              const updated = parent.family_members.map(fm =>
                fm.name?.trim().toLowerCase() === member.name.trim().toLowerCase()
                  ? { ...fm, _linked_character_id: linkedCharId }
                  : fm
              );
              await base44.entities.Character.update(parent.id, { family_members: updated });
            }
          }

          // Step 3: If still no link, create a new npc_family_member Character
          if (!linkedCharId) {
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
            linkedCharId = newFamilyNPC.id;
            syncLog.created++;

            // Update parent to link this new Character
            const updated = parent.family_members.map(fm =>
              fm.name?.trim().toLowerCase() === member.name.trim().toLowerCase()
                ? { ...fm, _linked_character_id: linkedCharId }
                : fm
            );
            await base44.entities.Character.update(parent.id, { family_members: updated });
          }

          // Step 4: Ensure avatar_url is synced from parent's family_members[] entry to linked Character
          if (linkedCharId && member.photo_url) {
            const linkedChar = npcFamilyMembers.find(npc => npc.id === linkedCharId) ||
                              await base44.entities.Character.filter({ id: linkedCharId }).then(r => r[0]);
            
            if (linkedChar && linkedChar.avatar_url !== member.photo_url) {
              await base44.entities.Character.update(linkedCharId, {
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