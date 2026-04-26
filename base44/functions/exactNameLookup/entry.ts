import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const EXPECTED_NAMES = [
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

    // Fetch ALL characters (no filter) using service role to bypass RLS
    const allChars = await base44.asServiceRole.entities.Character.list(
      null,
      1000
    );

    const results = [];
    const notFound = [];

    for (const expectedName of EXPECTED_NAMES) {
      const found = allChars.find(c => c.name === expectedName);
      
      if (found) {
        results.push({
          name: found.name,
          id: found.id,
          owner_email: found.owner_email || 'NOT SET',
          character_type: found.character_type || 'NOT SET',
          status: found.status || 'NOT SET',
          created_by: found.created_by || 'NOT SET'
        });
      } else {
        notFound.push(expectedName);
      }
    }

    return Response.json({
      total_expected: EXPECTED_NAMES.length,
      found_count: results.length,
      not_found_count: notFound.length,
      found_records: results,
      not_found_names: notFound,
      EXACT_NAME_LOOKUP_FAILURE: notFound.length > 0
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});