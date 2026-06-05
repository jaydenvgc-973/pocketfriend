/**
 * proofFamilyGraphFull
 * Returns complete family data for all characters — no truncation.
 * Focused on name-based parent linkage so sibling derivation can work without character_id.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.entities.Character.filter(
      { owner_email: user.email }, null, 300
    ).catch(() => []);

    const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
    const npcs = npcRes?.data?.npcs || [];
    const ownedIds = new Set(chars.map(c => c.id));
    const allChars = [...chars, ...npcs.filter(n => !ownedIds.has(n.id))];

    const PARENT_TYPES = new Set([
      'father','dad','daddy','mother','mom','mommy','parent',
      'birth father','birth mother','biological father','biological mother',
      'stepfather','stepdad','stepmother','stepmom',
      'adoptive father','adoptive mother','foster father','foster mother',
    ]);

    // Build name→character map for name-based resolution
    const charByName = new Map();
    for (const c of allChars) {
      const n = (c.name || c.display_name || '').toLowerCase().trim();
      const dn = (c.display_name || '').toLowerCase().trim();
      if (n) charByName.set(n, c);
      if (dn && dn !== n) charByName.set(dn, c);
    }

    // For each parent name, find children who list them as a parent
    const parentNameToChildren = {};
    for (const c of allChars) {
      for (const m of (c.family_members || [])) {
        const rel = (m.relationship_type || '').toLowerCase();
        if (!PARENT_TYPES.has(rel)) continue;
        const parentName = (m.name || '').toLowerCase().trim();
        if (!parentName) continue;
        if (!parentNameToChildren[parentName]) parentNameToChildren[parentName] = [];
        parentNameToChildren[parentName].push({
          child_id: c.id,
          child_name: c.name,
          child_age: c.age,
          child_gender: c.gender,
          parent_name: m.name,
          parent_character_id: m.character_id || null,
          via_rel: rel,
        });
      }
    }

    // Sibling groups: parent names with 2+ children
    const siblingGroups = Object.entries(parentNameToChildren)
      .filter(([, children]) => children.length >= 2)
      .map(([parentName, children]) => {
        const resolvedParentChar = charByName.get(parentName);
        return {
          parent_name: parentName,
          parent_char_id: resolvedParentChar?.id || null,
          parent_resolvable: !!resolvedParentChar,
          sibling_count: children.length,
          siblings: children,
        };
      });

    // Full family data per character
    const familyData = allChars
      .filter(c => c.family_members && c.family_members.length > 0)
      .map(c => ({
        id: c.id,
        name: c.name,
        age: c.age,
        gender: c.gender,
        character_type: c.character_type,
        family_members: c.family_members,
      }));

    return Response.json({
      success: true,
      total_scanned: allChars.length,
      chars_with_family: familyData.length,
      sibling_groups_by_parent_name: siblingGroups.length,
      // Key diagnostic: can we resolve parent names to character records?
      parent_names_scanned: Object.keys(parentNameToChildren),
      sibling_groups: siblingGroups,
      family_data: familyData,
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});