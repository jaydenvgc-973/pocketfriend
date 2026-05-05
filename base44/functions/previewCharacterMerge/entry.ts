import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * previewCharacterMerge — Read-only pre-merge analysis
 *
 * OWNERSHIP: owner_email is the ONLY ownership source of truth.
 * created_by is PERMANENTLY FORBIDDEN.
 *
 * LEGACY RECORD HANDLING:
 * - If a character is found by ID but has no owner_email, it is flagged as LEGACY_MISSING_OWNER.
 * - It is NOT merged until owner_email is safely backfilled.
 * - No fallback to created_by, no silent assumption of ownership.
 * - Returns structured flags the UI uses to show "needs repair" state.
 *
 * FLOW:
 * 1. Load each character by ID via service role (to find records regardless of RLS).
 * 2. Verify owner_email on each record.
 * 3. If owner_email matches authenticated user → safe for preview.
 * 4. If owner_email is missing/null → LEGACY_MISSING_OWNER (not a 404, not silently excluded).
 * 5. If owner_email belongs to a different user → CROSS_ACCOUNT_BLOCKED (never merge).
 * 6. If ID not found at all → RECORD_NOT_FOUND.
 * 7. Merge is only allowed when ALL records are in the VERIFIED state.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterIds, ownerEmail } = await req.json();

    // Ownership guard: ownerEmail must match the authenticated user
    if (!ownerEmail || ownerEmail !== user.email) {
      return Response.json({ error: 'ownerEmail must match authenticated user' }, { status: 403 });
    }
    if (!Array.isArray(characterIds) || characterIds.length < 2) {
      return Response.json({ error: 'At least 2 characterIds required' }, { status: 400 });
    }

    // ── STEP 1: Load each character by ID via service role ────────────────────
    // Service role is required here because some legacy records may lack owner_email
    // and therefore be invisible to RLS. We load them to REPORT their state, not to
    // bypass ownership — ownership is verified in step 2.
    const charResults = await Promise.all(
      characterIds.map(id =>
        base44.asServiceRole.entities.Character.filter({ id }, null, 1).catch(() => [])
      )
    );

    // ── STEP 2: Classify each record by ownership state ───────────────────────
    const classifiedRecords = characterIds.map((id, idx) => {
      const record = charResults[idx]?.[0] || null;

      if (!record) {
        return { id, state: 'RECORD_NOT_FOUND', record: null };
      }

      if (!record.owner_email) {
        return { id, state: 'LEGACY_MISSING_OWNER', record };
      }

      if (record.owner_email !== user.email) {
        return { id, state: 'CROSS_ACCOUNT_BLOCKED', record };
      }

      return { id, state: 'VERIFIED', record };
    });

    // ── STEP 3: Check if merge is safe ────────────────────────────────────────
    const unsafe = classifiedRecords.filter(r => r.state !== 'VERIFIED');
    const mergeBlocked = unsafe.length > 0;

    // Collect only verified characters for comparison data
    const verifiedChars = classifiedRecords
      .filter(r => r.state === 'VERIFIED')
      .map(r => r.record);

    // ── STEP 4: Build per-character summaries (verified records only) ─────────
    const convoCounts = {};
    const memoryCounts = {};
    const charMemoryCounts = {};
    const lifeEventCounts = {};

    for (const char of verifiedChars) {
      try {
        const convos = await base44.entities.Conversation.filter({ character_ids: char.id }).catch(() => []);
        convoCounts[char.id] = convos.length;
      } catch { convoCounts[char.id] = 0; }

      try {
        const mems = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, null, 500).catch(() => []);
        memoryCounts[char.id] = mems.length;
      } catch { memoryCounts[char.id] = 0; }

      try {
        const cmems = await base44.asServiceRole.entities.CharacterMemory.filter({ character_id: char.id }, null, 500).catch(() => []);
        charMemoryCounts[char.id] = cmems.length;
      } catch { charMemoryCounts[char.id] = 0; }

      try {
        const evts = await base44.asServiceRole.entities.LifeEvent.filter({ character_id: char.id }, null, 500).catch(() => []);
        lifeEventCounts[char.id] = evts.length;
      } catch { lifeEventCounts[char.id] = 0; }
    }

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

    // Detect conflicting fields between verified character records
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
      for (const char of verifiedChars) {
        const v = char[field] || null;
        values[char.id] = v;
        if (prevVal !== undefined && v !== prevVal) allSame = false;
        prevVal = v;
      }
      if (!allSame) {
        const hasAnyValue = Object.values(values).some(v => v != null && v !== '');
        if (hasAnyValue) conflicts.push({ field, values });
      }
    }

    // Score and recommend primary (from verified records only)
    let recommendedPrimaryId = null;
    if (verifiedChars.length >= 1) {
      const scored = verifiedChars.map(c => ({
        ...c,
        _score: profileScore(c) + (convoCounts[c.id] || 0) * 2 + (memoryCounts[c.id] || 0) + (charMemoryCounts[c.id] || 0) + (lifeEventCounts[c.id] || 0),
      }));
      scored.sort((a, b) => b._score - a._score);
      recommendedPrimaryId = scored[0].id;
    }

    // Build per-character summaries
    const characterSummaries = verifiedChars.map(char => ({
      id: char.id,
      name: char.name,
      character_type: char.character_type || null,
      owner_email: char.owner_email,
      avatar_url: char.avatar_url || char.image_avatar_url || null,
      created_date: char.created_date,
      updated_date: char.updated_date,
      is_recommended: char.id === recommendedPrimaryId,
      profile_score: profileScore(char),
      has_profile: profileScore(char) >= 3,
      has_conversations: (convoCounts[char.id] || 0) > 0,
      conversation_count: convoCounts[char.id] || 0,
      has_memories: ((memoryCounts[char.id] || 0) + (charMemoryCounts[char.id] || 0)) > 0,
      memory_count: (memoryCounts[char.id] || 0) + (charMemoryCounts[char.id] || 0),
      has_life_events: (lifeEventCounts[char.id] || 0) > 0,
      life_event_count: lifeEventCounts[char.id] || 0,
      has_relationships: ((char.fictional_relationships || []).length + (char.family_members || []).length) > 0,
      ownership_state: 'VERIFIED',
    }));

    // Build unsafe record summaries (visible in UI — never hidden)
    const unsafeSummaries = unsafe.map(r => ({
      id: r.id,
      name: r.record?.name || null,
      character_type: r.record?.character_type || null,
      owner_email: r.record?.owner_email || null,
      ownership_state: r.state,
      // State-specific message for the UI to display
      repair_message: r.state === 'LEGACY_MISSING_OWNER'
        ? 'This record is missing owner_email and must be repaired before it can be merged.'
        : r.state === 'CROSS_ACCOUNT_BLOCKED'
        ? 'This record belongs to a different account. Cross-account merge is forbidden.'
        : 'This record could not be found. It may have already been deleted or merged.',
    }));

    return Response.json({
      success: true,
      merge_blocked: mergeBlocked,
      merge_blocked_reason: mergeBlocked
        ? `${unsafe.length} record(s) cannot be merged until ownership is repaired. See unsafe_records for details.`
        : null,
      characters: characterSummaries,
      unsafe_records: unsafeSummaries,
      recommended_primary_id: recommendedPrimaryId,
      conflicts,
      total_conversations: Object.values(convoCounts).reduce((a, b) => a + b, 0),
      total_memories: Object.values(memoryCounts).reduce((a, b) => a + b, 0) + Object.values(charMemoryCounts).reduce((a, b) => a + b, 0),
      total_life_events: Object.values(lifeEventCounts).reduce((a, b) => a + b, 0),
    });

  } catch (error) {
    console.error('[previewCharacterMerge]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});