import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// DIAGNOSTIC ONLY — no writes, no auth.me(), no created_by
// Purpose: find why Melody Jackson Perry (active_created_character) is visible in dashboard
//          but NOT returned by asServiceRole Character.filter({ character_type: 'active_created_character' })

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGET_EMAIL = 'murqart@gmail.com';
    const TARGET_USER_ID = '69bfd8da2f47364437a2deab';
    const MELODY_NAME = 'Melody Jackson Perry';

    const mapChar = (c) => ({
      id: c.id,
      name: c.name,
      primary_name: c.primary_name || null,
      owner_email: c.owner_email || null,
      owner_user_id: c.owner_user_id || null,
      character_type: c.character_type || null,
      status: c.status || null,
    });

    // ── BLOCK A: Compound filter queries (what scheduledLocationEnforcement uses) ──

    // A1: The exact query used by scheduledLocationEnforcement — does it return Melody?
    const a1 = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character'
    });

    // A2: Same compound filter but with explicit high limit
    const a2 = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'active_created_character' },
      '-created_date',
      500
    );

    // A3: owner_email only, high limit (already known: 20 results)
    const a3 = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL },
      '-created_date',
      500
    );

    // A4: owner_email + character_type compound — does compound filter drop records?
    const a4 = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, character_type: 'active_created_character' },
      '-created_date',
      500
    );

    // A5: owner_user_id only — does querying by user ID find Melody?
    const a5 = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: TARGET_USER_ID },
      '-created_date',
      500
    );

    // A6: owner_user_id + character_type
    const a6 = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: TARGET_USER_ID, character_type: 'active_created_character' },
      '-created_date',
      500
    );

    // ── BLOCK B: Name-based searches (no type filter) ──

    // B1: name exact match, no other filter
    const b1 = await base44.asServiceRole.entities.Character.filter(
      { name: MELODY_NAME },
      '-created_date',
      500
    );

    // B2: owner_email + name exact match
    const b2 = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, name: MELODY_NAME },
      '-created_date',
      500
    );

    // B3: owner_user_id + name exact match
    const b3 = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: TARGET_USER_ID, name: MELODY_NAME },
      '-created_date',
      500
    );

    // ── BLOCK C: No filter, maximum limit — raw count vs compound count ──

    // C1: no filter, limit 500
    const c1 = await base44.asServiceRole.entities.Character.filter(
      {},
      '-created_date',
      500
    );

    // C2: no filter, limit 1000 — does higher limit return more?
    const c2 = await base44.asServiceRole.entities.Character.filter(
      {},
      '-created_date',
      1000
    );

    // ── BLOCK D: Targeted ID lookup ──
    // Dashboard-confirmed ID from prior screenshot: 69cef8406d65304465075d79
    // Try both known ID formats
    const KNOWN_IDS = [
      '69cef8406d65304465075d79',  // from prior diagnostic attempt
    ];

    const idResults = [];
    for (const id of KNOWN_IDS) {
      const r = await base44.asServiceRole.entities.Character.filter({ id });
      idResults.push({ queried_id: id, found: r.length > 0, result: r.map(mapChar) });
    }

    // ── ANALYSIS ──

    // From A3 (owner_email only, 500 limit) — find all active_created_character records
    const a3ActiveCreated = a3.filter(c => c.character_type === 'active_created_character');
    const a3MelodyMatch = a3.filter(c => (c.name || '').toLowerCase().includes('melody'));

    // From C1 — total record count visible to service role
    const c1ActiveCreated = c1.filter(c => c.character_type === 'active_created_character');
    const c1MelodyMatch = c1.filter(c => (c.name || '').toLowerCase().includes('melody'));

    // Type breakdown helpers
    const breakdown = (arr) => {
      const b = {};
      for (const c of arr) {
        const t = c.character_type || 'MISSING_TYPE';
        b[t] = (b[t] || 0) + 1;
      }
      return b;
    };

    return Response.json({
      // ── Core discrepancy check ──
      discrepancy: {
        a1_compound_filter_default_limit: { count: a1.length, type_breakdown: breakdown(a1) },
        a2_compound_filter_limit500: { count: a2.length, type_breakdown: breakdown(a2) },
        a4_owner_email_plus_type_limit500: { count: a4.length, records: a4.map(mapChar) },
        a6_owner_user_id_plus_type_limit500: { count: a6.length, records: a6.map(mapChar) },
        note: 'If a1/a2 count differs from C1 active_created count, compound filter is dropping records',
      },

      // ── Owner-scoped queries ──
      owner_scoped: {
        a3_owner_email_only_count: a3.length,
        a3_active_created_within: a3ActiveCreated.length,
        a3_active_created_records: a3ActiveCreated.map(mapChar),
        a3_melody_matches: a3MelodyMatch.map(mapChar),
        a5_owner_user_id_only: { count: a5.length, type_breakdown: breakdown(a5), active_created: a5.filter(c => c.character_type === 'active_created_character').map(mapChar) },
      },

      // ── Name searches ──
      name_searches: {
        b1_name_no_filter: { count: b1.length, results: b1.map(mapChar) },
        b2_owner_email_plus_name: { count: b2.length, results: b2.map(mapChar) },
        b3_owner_user_id_plus_name: { count: b3.length, results: b3.map(mapChar) },
      },

      // ── Raw totals (pagination test) ──
      raw_totals: {
        c1_no_filter_limit500: { count: c1.length, active_created_count: c1ActiveCreated.length, melody_matches: c1MelodyMatch.map(mapChar) },
        c2_no_filter_limit1000: { count: c2.length, note: 'If > c1 count, pagination is confirmed' },
      },

      // ── Direct ID lookup ──
      id_lookups: idResults,

      // ── Summary ──
      summary: {
        melody_found_by_compound_type_filter: a2.some(c => (c.name || '').toLowerCase().includes('melody')),
        melody_found_by_owner_email_name: b2.length > 0,
        melody_found_by_owner_user_id_name: b3.length > 0,
        melody_found_in_raw_no_filter: c1MelodyMatch.length > 0,
        pagination_confirmed: c2.length > c1.length,
        compound_filter_drops_records: a2.length < c1ActiveCreated.length,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});