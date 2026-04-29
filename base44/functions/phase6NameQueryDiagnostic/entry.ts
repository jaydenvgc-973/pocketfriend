import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// READ-ONLY — no writes, no repairs
// Phase 6 Step 2: Compare created_by vs owner_email vs asServiceRole for specific names

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGET_EMAIL = 'murqart@gmail.com';

    const NAMES = [
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

    const results = [];

    for (const name of NAMES) {
      // PATH 1: created_by + active_created_character + name (user-scoped RLS path the old Travel used)
      const byCreatedBy = await base44.entities.Character.filter({
        created_by: TARGET_EMAIL,
        status: 'active',
        character_type: 'active_created_character',
        name,
      });

      // PATH 2: owner_email + active_created_character + name (new Travel query path)
      const byOwnerEmail = await base44.entities.Character.filter({
        owner_email: TARGET_EMAIL,
        status: 'active',
        character_type: 'active_created_character',
        name,
      });

      // PATH 3: asServiceRole name only — no other filter
      const byServiceRoleName = await base44.asServiceRole.entities.Character.filter(
        { name },
        '-created_date',
        50
      );

      const mapRecord = (c) => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type || null,
        owner_email: c.owner_email || null,
        created_by: c.created_by || null,
        status: c.status || null,
      });

      results.push({
        name,
        found_by_created_by_path: byCreatedBy.length > 0,
        found_by_owner_email_path: byOwnerEmail.length > 0,
        found_by_service_role_name: byServiceRoleName.length > 0,
        created_by_records: byCreatedBy.map(mapRecord),
        owner_email_records: byOwnerEmail.map(mapRecord),
        service_role_records: byServiceRoleName.map(mapRecord),
      });
    }

    // Summary
    const foundByCreatedByOnly = results.filter(r => r.found_by_created_by_path && !r.found_by_owner_email_path);
    const foundByOwnerEmailOnly = results.filter(r => !r.found_by_created_by_path && r.found_by_owner_email_path);
    const foundByBoth = results.filter(r => r.found_by_created_by_path && r.found_by_owner_email_path);
    const foundByNeitherButServiceRole = results.filter(r => !r.found_by_created_by_path && !r.found_by_owner_email_path && r.found_by_service_role_name);
    const notFoundAnywhere = results.filter(r => !r.found_by_created_by_path && !r.found_by_owner_email_path && !r.found_by_service_role_name);

    return Response.json({
      per_name_results: results,
      summary: {
        found_by_created_by_path_only: foundByCreatedByOnly.map(r => r.name),
        found_by_owner_email_path_only: foundByOwnerEmailOnly.map(r => r.name),
        found_by_both_paths: foundByBoth.map(r => r.name),
        found_by_service_role_only: foundByNeitherButServiceRole.map(r => ({ name: r.name, records: r.service_role_records })),
        not_found_anywhere: notFoundAnywhere.map(r => r.name),
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});