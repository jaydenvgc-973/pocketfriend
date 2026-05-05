import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * previewCharacterMerge — Read-only pre-merge analysis
 *
 * Returns a structured comparison of two or more character records
 * so the user can make an informed decision before merging.
 *
 * OWNERSHIP: All records must share the same owner_email as the authenticated user.
 * created_by is NEVER used.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterIds, ownerEmail } = await req.json();

    // Ownership guard
    if (!ownerEmail || ownerEmail !== user.email) {
      return Response.json({ error: 'ownerEmail must match authenticated user' }, { status: 403 });
    }
    if (!Array.isArray(characterIds) || characterIds.length < 2) {
      return Response.json({ error: 'At least 2 characterIds required' }, { status: 400 });
    }

    // Load all character records by ID — owner_email scoped
    const charResults = await Promise.all(
      characterIds.map(id =>
        base44.entities.Character.filter({ id, owner_email: ownerEmail }, null, 1).catch(() => [])
      )
    );
    const characters = charResults.map(r => r?.[0]).filter(Boolean);

    if (characters.length < 2) {
      return Response.json({ error: 'Could not load 2+ characters with matching owner_email' }, { status: 404 });
    }

    // Check all belong to same owner
    const ownerMismatch = characters.find(c => c.owner_email !== ownerEmail);
    const ownershipWarning = ownerMismatch
      ? `Character "${ownerMismatch.name}" has owner_email "${ownerMismatch.owner_email}" — does not match your account. Merge blocked.`
      : null;

    // Count conversations per character
    const convoCounts = {};
    for (const char of characters) {
      try {
        const convos = await base44.entities.Conversation.filter({ character_ids: char.id }).catch(() => []);
        convoCounts[char.id] = convos.length;
      } catch {
        convoCounts[char.id] = 0;
      }
    }

    // Count memories per character
    const memoryCounts = {};
    for (const char of characters) {
      try {
        const mems = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, null, 500).catch(() => []);
        memoryCounts[char.id] = mems.length;
      } catch {
        memoryCounts[char.id] = 0;
      }
    }

    // Count CharacterMemory per character
    const charMemoryCounts = {};
    for (const char of characters) {
      try {
        const mems = await base44.asServiceRole.entities.CharacterMemory.filter({ character_id: char.id }, null, 500).catch(() => []);
        charMemoryCounts[char.id] = mems.length;
      } catch {
        charMemoryCounts[char.id] = 0;
      }
    }

    // Count Life Events per character
    const lifeEventCounts = {};
    for (const char of characters) {
      try {
        const evts = await base44.asServiceRole.entities.LifeEvent.filter({ character_id: char.id }, null, 500).catch(() => []);
        lifeEventCounts[char.id] = evts.length;
      } catch {
        lifeEventCounts[char.id] = 0;
      }
    }

    // Determine profile completeness score (higher = more complete)
    function profileScore(char) {
      let score = 0;
      if (char.personality_summary?.length > 10) score += 5;
      if (char.backstory?.length > 10) score += 4;
      if (char.profile_summary?.length > 10) score += 3;
      if (char.occupation) score += 2;
      if (char.avatar_url) score += 3;
      if (char.image_avatar_url) score += 2;
      if ((char.fictional_relationships || []).length > 0) score += 2;
      if ((char.family_members || []).length > 0) score += 2;
      if (char.current_home_location_id) score += 2;
      if (char.occupation_location_id) score += 2;
      if (char.emotional_state) score += 1;
      if (char.current_situation?.length > 5) score += 1;
      if (char.current_life_event?.length > 5) score += 1;
      if ((char.memories || []).length > 0) score += 1;
      return score;
    }

    // Detect conflicting fields between character records
    const COMPARE_FIELDS = [
      'personality_summary', 'backstory', 'profile_summary', 'occupation',
      'current_situation', 'current_life_event', 'emotional_state',
      'current_home_location_id', 'occupation_location_id', 'avatar_url',
      'sleep_start_time', 'wake_up_time', 'work_start_time', 'work_end_time',
    ];
    const conflicts = [];
    for (const field of COMPARE_FIELDS) {
      const values = {};
      let allSame = true;
      let prevVal = undefined;
      for (const char of characters) {
        const v = char[field] || null;
        values[char.id] = v;
        if (prevVal !== undefined && v !== prevVal) allSame = false;
        prevVal = v;
      }
      if (!allSame) {
        // Only flag if at least one has a non-null value
        const hasAnyValue = Object.values(values).some(v => v != null && v !== '');
        if (hasAnyValue) conflicts.push({ field, values });
      }
    }

    // Score and recommend primary
    const scored = characters.map(c => ({
      ...c,
      _score: profileScore(c) + (convoCounts[c.id] || 0) * 2 + (memoryCounts[c.id] || 0) + (charMemoryCounts[c.id] || 0) + (lifeEventCounts[c.id] || 0),
    }));
    scored.sort((a, b) => b._score - a._score);
    const recommendedPrimary = scored[0];

    // Build per-character summary
    const characterSummaries = characters.map(char => ({
      id: char.id,
      name: char.name,
      character_type: char.character_type,
      owner_email: char.owner_email,
      avatar_url: char.avatar_url || char.image_avatar_url || null,
      created_date: char.created_date,
      updated_date: char.updated_date,
      is_recommended: char.id === recommendedPrimary.id,
      profile_score: profileScore(char),
      has_profile: profileScore(char) >= 3,
      has_conversations: (convoCounts[char.id] || 0) > 0,
      conversation_count: convoCounts[char.id] || 0,
      has_memories: ((memoryCounts[char.id] || 0) + (charMemoryCounts[char.id] || 0)) > 0,
      memory_count: (memoryCounts[char.id] || 0) + (charMemoryCounts[char.id] || 0),
      has_life_events: (lifeEventCounts[char.id] || 0) > 0,
      life_event_count: lifeEventCounts[char.id] || 0,
      has_relationships: ((char.fictional_relationships || []).length + (char.family_members || []).length) > 0,
    }));

    return Response.json({
      success: true,
      characters: characterSummaries,
      recommended_primary_id: recommendedPrimary.id,
      conflicts,
      ownership_warning: ownershipWarning,
      total_conversations: Object.values(convoCounts).reduce((a, b) => a + b, 0),
      total_memories: Object.values(memoryCounts).reduce((a, b) => a + b, 0) + Object.values(charMemoryCounts).reduce((a, b) => a + b, 0),
      total_life_events: Object.values(lifeEventCounts).reduce((a, b) => a + b, 0),
    });

  } catch (error) {
    console.error('[previewCharacterMerge]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});