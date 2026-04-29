import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// READ-ONLY — no writes, no repairs
// Phase 6 Step 3: Isolate which compound filter causes records to drop

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGET_EMAIL = 'murqart@gmail.com';

    const summarize = (records) => ({
      count: records.length,
      names: records.map(c => c.name),
      ids: records.map(c => c.id),
      type_breakdown: records.reduce((acc, c) => {
        const t = c.character_type || 'MISSING';
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {}),
    });

    // A: owner_email + character_type (no status)
    const A = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, character_type: 'active_created_character' },
      '-created_date',
      500
    );

    // B: owner_email + status (no character_type)
    const B = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, status: 'active' },
      '-created_date',
      500
    );

    // C: character_type + status (no owner_email)
    const C = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'active_created_character', status: 'active' },
      '-created_date',
      500
    );

    // D: all three (current Travel query)
    const D = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL, status: 'active', character_type: 'active_created_character' },
      '-created_date',
      500
    );

    const rA = summarize(A);
    const rB = summarize(B);
    const rC = summarize(C);
    const rD = summarize(D);

    // Which combination drops the most records vs A
    const breakingFilters = [];
    if (rD.count < rA.count) breakingFilters.push('Adding status:active to owner_email+character_type drops records');
    if (rC.count < rA.count) breakingFilters.push('Adding status:active without owner_email also drops records');
    if (rB.count < rA.count) breakingFilters.push('Adding status:active to owner_email drops records even without character_type');

    // Names present in A but missing from D (the dropped records)
    const dIds = new Set(D.map(c => c.id));
    const droppedByD = A.filter(c => !dIds.has(c.id)).map(c => ({
      id: c.id,
      name: c.name,
      status: c.status,
      character_type: c.character_type,
      owner_email: c.owner_email,
    }));

    return Response.json({
      A_owner_email_plus_character_type: rA,
      B_owner_email_plus_status: rB,
      C_character_type_plus_status: rC,
      D_all_three_current_travel_query: rD,
      analysis: {
        breaking_filter_observations: breakingFilters,
        records_in_A_but_missing_from_D: droppedByD,
        A_vs_D_delta: rA.count - rD.count,
        safe_to_use_A_instead_of_D: rA.count >= rD.count,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});