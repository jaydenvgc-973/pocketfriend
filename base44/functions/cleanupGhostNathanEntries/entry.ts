import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email, status: 'active' });

    const ghostNames = ['nathan parker', 'theo', 'nathan'];
    const rumbaId = '69d2d823508af7e47d3a3676';
    // Nathan Parker's actual character ID - should never appear as an unlinked NPC
    const nathanCharacterId = '69c7b299fe07fcd80eedfdfc';

    let fixedCount = 0;
    const fixes = [];

    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      let changed = false;

      const cleanedRels = rels.map(rel => {
        const nameNorm = (rel.person_name || '').toLowerCase().trim();
        const isGhostNathan = ghostNames.includes(nameNorm) && !rel.related_character_id;
        const isNathanWithLocation = rel.related_character_id === nathanCharacterId && rel.current_location_id;

        if (isGhostNathan && rel.current_location_id) {
          // Remove stale location from unlinked "Nathan" NPC entries
          fixes.push({ owner: char.name, ghost: rel.person_name, location_id: rel.current_location_id });
          changed = true;
          return { ...rel, current_location_id: null };
        }

        if (isNathanWithLocation) {
          // Nathan is a real character - he should not have current_location_id set on relationship entries
          fixes.push({ owner: char.name, linked: rel.person_name, location_id: rel.current_location_id });
          changed = true;
          return { ...rel, current_location_id: null };
        }

        return rel;
      });

      if (changed) {
        await base44.entities.Character.update(char.id, { fictional_relationships: cleanedRels });
        fixedCount++;
      }
    }

    return Response.json({
      success: true,
      message: `Cleaned up ghost Nathan entries in ${fixedCount} characters.`,
      fixes,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});