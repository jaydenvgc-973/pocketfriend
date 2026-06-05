/**
 * proofFamilyGraphData
 *
 * One-shot diagnostic: scans ALL characters for the authenticated user
 * and returns every character that has a non-empty family_members array,
 * with full family_members contents. Used to identify real characters
 * with parent/sibling/child relationships for family graph verification.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all characters owned by this user
    const chars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      300
    ).catch(() => []);

    // Also fetch NPCs via service role
    const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
    const npcs = npcRes?.data?.npcs || [];

    const ownedIds = new Set(chars.map(c => c.id));
    const allChars = [...chars, ...npcs.filter(n => !ownedIds.has(n.id))];

    // Find characters with non-empty family_members
    const withFamily = allChars
      .filter(c => c.family_members && c.family_members.length > 0)
      .map(c => ({
        id: c.id,
        name: c.name || c.display_name,
        age: c.age || null,
        gender: c.gender || null,
        character_type: c.character_type || null,
        status: c.status,
        family_members: c.family_members.map(m => ({
          name: m.name,
          relationship_type: m.relationship_type,
          character_id: m.character_id || null,
          age: m.age || null,
        })),
      }));

    // Build a parent-to-children map: parentId → [childChar, ...]
    // so we can identify sibling groups
    const parentToChildren = {};
    for (const c of allChars) {
      for (const m of (c.family_members || [])) {
        if (!m.character_id) continue;
        const rel = (m.relationship_type || '').toLowerCase();
        const isParentRole = [
          'father','dad','daddy','mother','mom','mommy','parent',
          'birth father','birth mother','stepfather','stepdad',
          'stepmother','stepmom','adoptive father','adoptive mother',
          'biological father','biological mother','foster father','foster mother',
        ].includes(rel);
        if (isParentRole) {
          if (!parentToChildren[m.character_id]) parentToChildren[m.character_id] = [];
          parentToChildren[m.character_id].push({ id: c.id, name: c.name, age: c.age, gender: c.gender });
        }
      }
    }

    // Find sibling groups: any parent with 2+ children
    const siblingGroups = Object.entries(parentToChildren)
      .filter(([, children]) => children.length >= 2)
      .map(([parentId, children]) => {
        const parentChar = allChars.find(c => c.id === parentId);
        return {
          parent_id: parentId,
          parent_name: parentChar?.name || '(unknown parent)',
          sibling_count: children.length,
          siblings: children,
        };
      });

    return Response.json({
      success: true,
      total_chars_scanned: allChars.length,
      chars_with_family: withFamily.length,
      sibling_groups_found: siblingGroups.length,
      with_family: withFamily,
      sibling_groups: siblingGroups,
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});