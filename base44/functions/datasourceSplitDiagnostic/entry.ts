import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DATA SOURCE SPLIT DIAGNOSTIC
 * 
 * Query 6 independent sources and compare what each returns.
 * Do NOT assume field paths or entity names.
 * Prove where the 43 export characters are and where they go missing.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const expectedNames = [
      'Andre Rivera',
      'Ava Dei Park',
      'Brian Anderson',
      'Ethan Thompson',
      'James Anderson',
      'Jonathan Anthony Smith',
      'Lila Green',
      'Matt Lopez',
      'Melody Jackson Perry',
      'Nathan Parker'
    ];

    // ── SOURCE 1: User context, no filter ────────────────────────────────
    const source1 = await base44.entities.Character.list('-updated_date', 500);
    const source1Found = source1.filter(c => expectedNames.includes(c.name));
    const source1FieldCheck = source1[0] ? {
      hasTopLevelOwnerEmail: 'owner_email' in source1[0],
      hasTopLevelCharacterType: 'character_type' in source1[0],
      hasTopLevelStatus: 'status' in source1[0],
      hasDataNested: 'data' in source1[0],
      allKeys: Object.keys(source1[0]).slice(0, 20),
    } : null;

    // ── SOURCE 2: Service role, no filter ───────────────────────────────
    const source2 = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const source2Found = source2.filter(c => expectedNames.includes(c.name));
    const source2FieldCheck = source2[0] ? {
      hasTopLevelOwnerEmail: 'owner_email' in source2[0],
      hasTopLevelCharacterType: 'character_type' in source2[0],
      hasTopLevelStatus: 'status' in source2[0],
      hasDataNested: 'data' in source2[0],
      allKeys: Object.keys(source2[0]).slice(0, 20),
    } : null;

    // ── SOURCE 3: User filter by owner_email ───────────────────────────
    const source3 = await base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 500);
    const source3Found = source3.filter(c => expectedNames.includes(c.name));

    // ── SOURCE 4: Service role filter by owner_email ─────────────────────
    const source4 = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email }, '-updated_date', 500);
    const source4Found = source4.filter(c => expectedNames.includes(c.name));

    // ── SOURCE 5: User filter by character_type ────────────────────────
    const source5 = await base44.entities.Character.filter({ character_type: 'active_created_character' }, '-updated_date', 500);
    const source5Found = source5.filter(c => expectedNames.includes(c.name));

    // ── SOURCE 6: Service role filter by character_type ──────────────────
    const source6 = await base44.asServiceRole.entities.Character.filter({ character_type: 'active_created_character' }, '-updated_date', 500);
    const source6Found = source6.filter(c => expectedNames.includes(c.name));

    // ── COLLECT ALL UNIQUE NAMES FROM ALL SOURCES ────────────────────────
    const allNames = new Set();
    [source1, source2, source3, source4, source5, source6].forEach(src => {
      src.forEach(c => allNames.add(c.name));
    });

    // ── COUNT ACTIVE_CREATED_CHARACTER ─────────────────────────────────
    const countBySource = {
      source1: source1.filter(c => c.character_type === 'active_created_character').length,
      source2: source2.filter(c => c.character_type === 'active_created_character').length,
      source3: source3.filter(c => c.character_type === 'active_created_character').length,
      source4: source4.filter(c => c.character_type === 'active_created_character').length,
      source5: source5.filter(c => c.character_type === 'active_created_character').length,
      source6: source6.filter(c => c.character_type === 'active_created_character').length,
    };

    // ── OWNER EMAIL VALUES FOUND ───────────────────────────────────────
    const ownerEmails = {
      source1: new Set(source1.map(c => c.owner_email).filter(Boolean)),
      source2: new Set(source2.map(c => c.owner_email).filter(Boolean)),
      source3: new Set(source3.map(c => c.owner_email).filter(Boolean)),
      source4: new Set(source4.map(c => c.owner_email).filter(Boolean)),
      source5: new Set(source5.map(c => c.owner_email).filter(Boolean)),
      source6: new Set(source6.map(c => c.owner_email).filter(Boolean)),
    };

    return Response.json({
      diagnostic: 'DATA_SOURCE_SPLIT_ANALYSIS',
      user_email: user.email,
      expected_characters: expectedNames,
      
      sources: {
        source1: {
          name: 'User context list()',
          total_returned: source1.length,
          expected_chars_found: source1Found.map(c => c.name),
          expected_chars_count: source1Found.length,
          active_created_character_count: countBySource.source1,
          all_character_types: new Set(source1.map(c => c.character_type)),
          owner_emails: Array.from(ownerEmails.source1),
          field_check: source1FieldCheck,
        },
        source2: {
          name: 'Service role list()',
          total_returned: source2.length,
          expected_chars_found: source2Found.map(c => c.name),
          expected_chars_count: source2Found.length,
          active_created_character_count: countBySource.source2,
          all_character_types: new Set(source2.map(c => c.character_type)),
          owner_emails: Array.from(ownerEmails.source2),
          field_check: source2FieldCheck,
        },
        source3: {
          name: 'User filter(owner_email)',
          total_returned: source3.length,
          expected_chars_found: source3Found.map(c => c.name),
          expected_chars_count: source3Found.length,
          active_created_character_count: countBySource.source3,
        },
        source4: {
          name: 'Service filter(owner_email)',
          total_returned: source4.length,
          expected_chars_found: source4Found.map(c => c.name),
          expected_chars_count: source4Found.length,
          active_created_character_count: countBySource.source4,
        },
        source5: {
          name: 'User filter(character_type)',
          total_returned: source5.length,
          expected_chars_found: source5Found.map(c => c.name),
          expected_chars_count: source5Found.length,
          active_created_character_count: countBySource.source5,
        },
        source6: {
          name: 'Service filter(character_type)',
          total_returned: source6.length,
          expected_chars_found: source6Found.map(c => c.name),
          expected_chars_count: source6Found.length,
          active_created_character_count: countBySource.source6,
        },
      },

      comparison: {
        total_unique_names_across_all_sources: allNames.size,
        highest_count_returned: Math.max(source1.length, source2.length, source3.length, source4.length, source5.length, source6.length),
        lowest_count_returned: Math.min(source1.length, source2.length, source3.length, source4.length, source5.length, source6.length),
        expected_10_found_in_any_source: source1Found.length > 0 || source2Found.length > 0 || source3Found.length > 0 || source4Found.length > 0 || source5Found.length > 0 || source6Found.length > 0,
        expected_10_found_in_which_sources: {
          source1: source1Found.length,
          source2: source2Found.length,
          source3: source3Found.length,
          source4: source4Found.length,
          source5: source5Found.length,
          source6: source6Found.length,
        },
      },

      CRITICAL_QUESTION: source2.length < 43 ? 'The expected 10 characters (and 32 others) are NOT in the Character entity. Check if they exist in a different entity.' : 'All 43 are present in at least one Character source.',
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});