import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// READ-ONLY — no writes, no repairs
// Phase 6 Step 4: Confirm exact character_type for expected characters via owner_email+status query

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGET_EMAIL = 'murqart@gmail.com';

    const EXPECTED_NAMES = [
      'Melody Jackson Perry',
      'Lila Green',
      'Matt Lopez',
      'Nathan Parker',
      'Shiloh Devon',
      'Andre Rivera',
      'Ava Dei Park',
      'Brian Anderson',
      'Ethan Thompson',
      'James Anderson',
      'Jonathan Anthony Smith',
    ];

    // The only query path that returned > 1 record in Step 3 was owner_email + status
    // Use it with NO character_type filter to get all active records for this owner
    const allActive = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, status: 'active' },
      '-created_date',
      500
    );

    // Also try WITHOUT status filter — maybe some expected chars have non-active status
    const allByOwner = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      500
    );

    const mapRecord = (c) => ({
      id: c.id,
      name: c.name,
      owner_email: c.owner_email || null,
      status: c.status || null,
      character_type: c.character_type || 'MISSING_TYPE',
      is_test_character: c.is_test_character ?? null,
    });

    // Extract expected names from allActive
    const expectedNamesLower = EXPECTED_NAMES.map(n => n.toLowerCase());
    const matchedInActive = allActive.filter(c =>
      expectedNamesLower.includes((c.name || '').toLowerCase())
    ).map(mapRecord);

    // Extract expected names from allByOwner (no status filter)
    const matchedInAllByOwner = allByOwner.filter(c =>
      expectedNamesLower.includes((c.name || '').toLowerCase())
    ).map(mapRecord);

    // What names were NOT found in either query?
    const foundNames = new Set(matchedInAllByOwner.map(c => c.name?.toLowerCase()));
    const notFoundAnywhere = EXPECTED_NAMES.filter(n => !foundNames.has(n.toLowerCase()));

    // Full type breakdown of allActive
    const activeTypeBreakdown = allActive.reduce((acc, c) => {
      const t = c.character_type || 'MISSING_TYPE';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    // Full type breakdown of allByOwner
    const allOwnerTypeBreakdown = allByOwner.reduce((acc, c) => {
      const t = c.character_type || 'MISSING_TYPE';
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});

    // Full record list for allByOwner — to see what IS there
    const allByOwnerMapped = allByOwner.map(mapRecord);

    // Verdict
    const anyExpectedFoundWithWrongType = matchedInAllByOwner.some(
      c => c.character_type !== 'active_created_character'
    );
    const anyExpectedFoundWithCorrectType = matchedInAllByOwner.some(
      c => c.character_type === 'active_created_character'
    );

    return Response.json({
      query_owner_email_plus_status_active: {
        total_count: allActive.length,
        type_breakdown: activeTypeBreakdown,
        expected_names_matched: matchedInActive,
        all_names: allActive.map(c => c.name),
      },
      query_owner_email_only: {
        total_count: allByOwner.length,
        type_breakdown: allOwnerTypeBreakdown,
        expected_names_matched: matchedInAllByOwner,
        all_records: allByOwnerMapped,
      },
      not_found_in_either_query: notFoundAnywhere,
      verdict: {
        expected_chars_found: matchedInAllByOwner.length,
        expected_chars_missing: notFoundAnywhere.length,
        any_found_with_wrong_type: anyExpectedFoundWithWrongType,
        any_found_with_correct_type: anyExpectedFoundWithCorrectType,
        conclusion: notFoundAnywhere.length === EXPECTED_NAMES.length
          ? 'NONE of the expected characters are visible to asServiceRole via owner_email at all — they exist in a different data scope or have a different owner_email stored'
          : anyExpectedFoundWithWrongType && !anyExpectedFoundWithCorrectType
          ? 'Expected characters exist but stored with WRONG character_type — bulk type filter correctly excludes them because they are not actually active_created_character in the DB'
          : anyExpectedFoundWithCorrectType
          ? 'Expected characters exist with CORRECT character_type — failure is SDK index inconsistency, not a data problem'
          : 'Partial match — mixed types or partial data integrity issue',
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});