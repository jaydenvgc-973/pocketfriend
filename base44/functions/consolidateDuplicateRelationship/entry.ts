import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * consolidateDuplicateRelationship
 * Removes duplicate NPC relationship entries, keeping the active character version.
 * Merges relationship metrics (friendship, respect, etc.) from both entries.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, relationshipName, keepRelatedCharacterId } = await req.json();

    // Fetch the character
    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const char = character[0];
    const relationships = char.fictional_relationships || [];

    // Find all entries with this name
    const dupes = relationships.filter(r => r.person_name?.toLowerCase() === relationshipName.toLowerCase());

    if (dupes.length < 2) {
      return Response.json({ success: false, message: 'No duplicates found' }, { status: 400 });
    }

    // Find the active character version (has related_character_id)
    const activeCharVersion = dupes.find(r => r.related_character_id === keepRelatedCharacterId);
    const npcVersion = dupes.find(r => !r.related_character_id || r.related_character_id !== keepRelatedCharacterId);

    if (!activeCharVersion) {
      return Response.json({ error: 'Active character version not found' }, { status: 400 });
    }

    // Merge metrics: take max values for relationship scores
    if (npcVersion) {
      activeCharVersion.friendship_level = Math.max(
        activeCharVersion.friendship_level ?? 50,
        npcVersion.friendship_level ?? 50
      );
      activeCharVersion.user_respect_level = Math.max(
        activeCharVersion.user_respect_level ?? 50,
        npcVersion.user_respect_level ?? 50
      );
      activeCharVersion.romantic_level = Math.max(
        activeCharVersion.romantic_level ?? 0,
        npcVersion.romantic_level ?? 0
      );
      activeCharVersion.attraction_level = Math.max(
        activeCharVersion.attraction_level ?? 0,
        npcVersion.attraction_level ?? 0
      );
      activeCharVersion.chosen_family_level = Math.max(
        activeCharVersion.chosen_family_level ?? 0,
        npcVersion.chosen_family_level ?? 0
      );

      // Merge descriptions if NPC has richer detail
      if (npcVersion.description && npcVersion.description.length > (activeCharVersion.description?.length ?? 0)) {
        activeCharVersion.description = npcVersion.description;
      }
    }

    // Remove all but the merged active character version
    const consolidated = relationships.filter(r => r.person_name?.toLowerCase() !== relationshipName.toLowerCase());
    consolidated.push(activeCharVersion);

    // Update character
    await base44.entities.Character.update(characterId, {
      fictional_relationships: consolidated,
    });

    return Response.json({
      success: true,
      message: `Consolidated duplicate "${relationshipName}" entries. Kept active character, merged metrics.`,
      mergedMetrics: {
        friendship_level: activeCharVersion.friendship_level,
        user_respect_level: activeCharVersion.user_respect_level,
        romantic_level: activeCharVersion.romantic_level,
        attraction_level: activeCharVersion.attraction_level,
        chosen_family_level: activeCharVersion.chosen_family_level,
      },
    });
  } catch (error) {
    console.error('[consolidateDuplicateRelationship]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});