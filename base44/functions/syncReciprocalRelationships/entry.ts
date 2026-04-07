import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Sync reciprocal relationships between active characters.
 * 
 * When a character's fictional_relationships are updated:
 * - For each relationship pointing to an active character, create/update the reciprocal on the target character
 * - The reciprocal is determined by the character's gender (or neutral if non-binary/other)
 * 
 * This ensures that if Character A lists Character B as "mentor", then Character B will have Character A as "mentee".
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, fictional_relationships } = await req.json();

    if (!character_id || !fictional_relationships) {
      return Response.json({ error: 'Missing character_id or fictional_relationships' }, { status: 400 });
    }

    // Fetch the source character to get their gender
    const sourceChar = await base44.entities.Character.filter({ id: character_id });
    if (!sourceChar || sourceChar.length === 0) {
      return Response.json({ error: 'Source character not found' }, { status: 404 });
    }

    const source = sourceChar[0];
    const sourceGender = source.gender || 'other';

    // Fetch all active characters
    const allChars = await base44.entities.Character.filter({
      status: 'active',
      character_type: 'active'
    });

    const activeCharMap = {};
    allChars.forEach(c => {
      activeCharMap[c.id] = c;
    });

    // Process each relationship in the source character's list
    const updates = {};

    for (const rel of fictional_relationships) {
      // Only process relationships with related_character_id (i.e., linked to active characters)
      if (!rel.related_character_id) continue;

      const targetChar = activeCharMap[rel.related_character_id];
      if (!targetChar) continue; // Target is not an active character

      // Determine the reciprocal relationship type
      const reciprocal = getReciprocalRole(rel.relationship_type, sourceGender);

      // Initialize target's update if not already done
      if (!updates[rel.related_character_id]) {
        updates[rel.related_character_id] = [...(targetChar.fictional_relationships || [])];
      }

      // Find or create the reciprocal relationship on the target
      const targetRels = updates[rel.related_character_id];
      const existingIdx = targetRels.findIndex(
        r => r.related_character_id === character_id && r.person_name === source.name
      );

      if (existingIdx !== -1) {
        // Update existing reciprocal
        targetRels[existingIdx] = {
          ...targetRels[existingIdx],
          relationship_type: reciprocal,
          person_name: source.name,
          related_character_id: character_id,
          avatar_url: source.avatar_url || targetRels[existingIdx].avatar_url,
        };
      } else {
        // Create new reciprocal
        targetRels.push({
          person_name: source.name,
          related_character_id: character_id,
          relationship_type: reciprocal,
          description: rel.description ? `Reciprocal: ${rel.description}` : '',
          current_status: rel.current_status || '',
          emotional_impact: rel.emotional_impact || '',
          history_summary: rel.history_summary || '',
          last_interaction_summary: rel.last_interaction_summary || '',
          avatar_url: source.avatar_url || null,
          user_respect_level: rel.user_respect_level ?? 50,
          friendship_level: rel.friendship_level ?? 75,
          romantic_level: rel.romantic_level ?? 0,
          attraction_level: rel.attraction_level ?? 0,
          chosen_family_level: rel.chosen_family_level ?? 0,
        });
      }
    }

    // Apply all updates to target characters
    const updatePromises = Object.entries(updates).map(([targetId, rels]) =>
      base44.entities.Character.update(targetId, { fictional_relationships: rels }).catch(() => {})
    );

    await Promise.all(updatePromises);

    return Response.json({ success: true, updated: Object.keys(updates).length });
  } catch (error) {
    console.error('syncReciprocalRelationships error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Compute the reciprocal relationship type based on source character's gender.
 */
function getReciprocalRole(relationshipType, sourceGender) {
  const gender = sourceGender || 'other';
  const isMale = gender === 'male';
  const isFemale = gender === 'female';

  const pick = (male, female, neutral = 'friend') => {
    if (isMale) return male;
    if (isFemale) return female;
    return neutral;
  };

  // Map relationship types to their reciprocals
  const reciprocals = {
    'mentor': 'mentee',
    'mentee': 'mentor',
    'case manager': 'client',
    'client': 'case manager',
    'friend': 'friend',
    'best friend': 'best friend',
    'close friend': 'close friend',
    'acquaintance': 'acquaintance',
    'coworker': 'coworker',
    'colleague': 'colleague',
    'boss': 'employee',
    'employee': 'boss',
    'classmate': 'classmate',
    'teammate': 'teammate',
    'roommate': 'roommate',
    'romantic interest': 'romantic interest',
    'significant other': 'significant other',
    'ex': 'ex',
    'enemy': 'enemy',
    'rival': 'rival',
    // Family types
    'mother': pick('son', 'daughter', 'child'),
    'father': pick('son', 'daughter', 'child'),
    'sister': pick('brother', 'sister', 'sibling'),
    'brother': pick('brother', 'sister', 'sibling'),
    'aunt': pick('nephew', 'niece', 'niece/nephew'),
    'uncle': pick('nephew', 'niece', 'niece/nephew'),
    'niece': pick('uncle', 'aunt', 'aunt/uncle'),
    'nephew': pick('uncle', 'aunt', 'aunt/uncle'),
    'daughter': pick('father', 'mother', 'parent'),
    'son': pick('father', 'mother', 'parent'),
    'cousin': 'cousin',
    'spouse': 'spouse',
    'other': 'other',
  };

  return reciprocals[relationshipType] || relationshipType;
}