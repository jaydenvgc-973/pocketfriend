import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters
    const allChars = await base44.entities.Character.list('-created_date', 500);
    const userChars = allChars.filter(c => c.created_by === user.email && c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged');

    // Find duplicate names
    const nameMap = new Map();
    userChars.forEach(char => {
      const normalized = char.name?.toLowerCase().trim() || '';
      if (!normalized) return;
      if (!nameMap.has(normalized)) {
        nameMap.set(normalized, []);
      }
      nameMap.get(normalized).push(char);
    });

    const mergeOps = [];
    let merged = 0;

    // For each duplicate group, merge into oldest/strongest
    for (const [name, dupes] of nameMap.entries()) {
      if (dupes.length < 2) continue;

      // Sort by created_date (oldest first) - master is the earliest
      const sorted = dupes.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      const master = sorted[0];
      const duplicates = sorted.slice(1);

      // Update all relationships pointing to duplicates to point to master
      const allCharacters = await base44.entities.Character.list('-created_date', 500);
      for (const char of allCharacters) {
        const updated = {
          fictional_relationships: (char.fictional_relationships || []).map(rel => 
            duplicates.some(dup => dup.id === rel.related_character_id) 
              ? { ...rel, related_character_id: master.id }
              : rel
          ),
          family_members: (char.family_members || []).map(fm =>
            duplicates.some(dup => dup.id === fm.character_id)
              ? { ...fm, character_id: master.id }
              : fm
          ),
        };
        if (JSON.stringify(updated) !== '{}') {
          await base44.entities.Character.update(char.id, updated);
        }
      }

      // Mark duplicates as merged
      for (const dup of duplicates) {
        await base44.entities.Character.update(dup.id, {
          status: 'merged',
          merged_into_character_id: master.id,
        });
        merged++;
      }
    }

    return Response.json({ 
      success: true, 
      merged,
      message: `Merged ${merged} duplicate character(s) into masters` 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});