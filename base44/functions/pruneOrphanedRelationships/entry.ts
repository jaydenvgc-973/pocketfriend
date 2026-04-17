import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters owned by the user
    const allCharacters = await base44.entities.Character.filter({ created_by: user.email });
    const characterIds = new Set(allCharacters.map(c => c.id));

    let totalOrphaned = 0;
    let charactersFixed = 0;
    const results = [];

    // Scan each character's fictional_relationships
    for (const character of allCharacters) {
      const originalCount = (character.fictional_relationships || []).length;
      
      // Filter out relationships pointing to non-existent characters
      const cleanedRelationships = (character.fictional_relationships || []).filter(rel => {
        if (!rel.related_character_id) {
          // Keep relationships without IDs (they're NPC-only entries)
          return true;
        }
        // Only keep if the related character exists
        return characterIds.has(rel.related_character_id);
      });

      const orphanedCount = originalCount - cleanedRelationships.length;

      if (orphanedCount > 0) {
        // Update character with cleaned relationships
        await base44.entities.Character.update(character.id, {
          fictional_relationships: cleanedRelationships
        });

        totalOrphaned += orphanedCount;
        charactersFixed++;

        results.push({
          character: character.name,
          characterId: character.id,
          orphanedCount,
          originalCount,
          cleanedCount: cleanedRelationships.length
        });
      }
    }

    return Response.json({
      success: true,
      summary: `Scanned ${allCharacters.length} characters. Fixed ${charactersFixed} characters. Removed ${totalOrphaned} orphaned relationship(s).`,
      details: results,
      totalCharacters: allCharacters.length,
      charactersFixed,
      totalOrphaned
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});