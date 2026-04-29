import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// READ-ONLY diagnostic — no writes, no created_by, no repairs
// Phase 6: Expose owner_email integrity gap for murqart@gmail.com

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGET_EMAIL = 'murqart@gmail.com';

    const mapChar = (c) => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type || null,
      owner_email: c.owner_email || null,
      owner_user_id: c.owner_user_id || null,
      status: c.status || null,
      is_test_character: c.is_test_character ?? null,
      data_scope: c.data_scope || null,
      visibility_scope: c.visibility_scope || null,
    });

    // QUERY 1: All active_created_character records (no owner filter) — up to 500
    const allActiveCreated = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'active_created_character' },
      '-created_date',
      500
    );

    // QUERY 2: All records where owner_email = murqart@gmail.com — up to 500
    const allByOwnerEmail = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      500
    );

    // QUERY 3: All active_created_character specifically for this owner
    const activeCreatedForOwner = allByOwnerEmail.filter(
      c => c.character_type === 'active_created_character'
    );

    // ANALYSIS: which active_created_characters are NOT returned by owner_email filter
    const ownerEmailIds = new Set(allByOwnerEmail.map(c => c.id));
    const missingFromOwnerEmail = allActiveCreated.filter(c => !ownerEmailIds.has(c.id));

    // ANALYSIS: active_created records with no owner_email at all
    const noOwnerEmail = allActiveCreated.filter(c => !c.owner_email);

    // ANALYSIS: active_created records with wrong owner_email (not murqart)
    const wrongOwnerEmail = allActiveCreated.filter(
      c => c.owner_email && c.owner_email !== TARGET_EMAIL
    );

    return Response.json({
      query1_all_active_created_character: {
        count: allActiveCreated.length,
        records: allActiveCreated.map(mapChar),
      },
      query2_all_by_owner_email: {
        count: allByOwnerEmail.length,
        active_created_within: activeCreatedForOwner.length,
        records: allByOwnerEmail.map(mapChar),
      },
      analysis: {
        active_created_returned_by_owner_email_filter: activeCreatedForOwner.map(mapChar),
        active_created_MISSING_from_owner_email_filter: missingFromOwnerEmail.map(mapChar),
        active_created_with_NO_owner_email: noOwnerEmail.map(mapChar),
        active_created_with_WRONG_owner_email: wrongOwnerEmail.map(mapChar),
      },
      verdict: {
        total_active_created_in_system: allActiveCreated.length,
        visible_via_owner_email: activeCreatedForOwner.length,
        missing_count: missingFromOwnerEmail.length,
        data_integrity_gap_confirmed: missingFromOwnerEmail.length > 0 || noOwnerEmail.length > 0,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});