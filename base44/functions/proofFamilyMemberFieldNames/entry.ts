/**
 * proofFamilyMemberFieldNames
 * Inspect every field name used in family_members across all characters.
 * Reveals the actual schema being used vs what the resolver expects.
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

    // Collect every unique key found in family_members entries
    const allFieldNames = new Set();
    const linkFieldSamples = []; // samples of entries that have any id-like field
    const parentTypeEntries = [];

    const PARENT_TYPES = new Set([
      'father','dad','daddy','mother','mom','mommy','parent',
      'birth father','birth mother','biological father','biological mother',
      'stepfather','stepdad','stepmother','stepmom',
      'adoptive father','adoptive mother','foster father','foster mother',
    ]);

    for (const c of allChars) {
      for (const m of (c.family_members || [])) {
        Object.keys(m).forEach(k => allFieldNames.add(k));

        // Any entry with an id-like field
        const idFields = Object.keys(m).filter(k =>
          k.toLowerCase().includes('id') || k.toLowerCase().includes('character')
        );
        if (idFields.length > 0) {
          const sample = {};
          idFields.forEach(k => { sample[k] = m[k]; });
          sample._parent_char_name = c.name;
          sample._relationship_type = m.relationship_type;
          sample._member_name = m.name;
          linkFieldSamples.push(sample);
        }

        // Parent-type entries with any id
        const rel = (m.relationship_type || '').toLowerCase();
        if (PARENT_TYPES.has(rel)) {
          parentTypeEntries.push({
            owner_char_id: c.id,
            owner_char_name: c.name,
            member_name: m.name,
            relationship_type: m.relationship_type,
            all_fields: m,
          });
        }
      }
    }

    return Response.json({
      success: true,
      all_field_names_found: [...allFieldNames].sort(),
      link_field_samples: linkFieldSamples.slice(0, 30),
      parent_type_entries: parentTypeEntries,
    });

  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});