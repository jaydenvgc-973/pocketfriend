import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// READ-ONLY — no writes, no repairs
// Phase 6 Step 5: Direct ID lookup via asServiceRole to confirm stored ownership fields

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const TARGETS = [
      { name: 'Melody Jackson Perry', id: '69cef8406d65304465075d79' },
      { name: 'Lila Green',           id: '69c7b299fe07fcd80eedfdfd' },
      { name: 'Matt Lopez',           id: '69c01e985ccb5ecb47d2972e' },
    ];

    const results = [];

    for (const target of TARGETS) {
      const rows = await base44.asServiceRole.entities.Character.filter(
        { id: target.id },
        '-created_date',
        5
      );

      if (rows.length === 0) {
        results.push({
          queried_name: target.name,
          queried_id: target.id,
          found: false,
          id: null,
          name: null,
          owner_email: null,
          owner_user_id: null,
          character_type: null,
          status: null,
          data_scope: null,
          visibility_scope: null,
        });
      } else {
        const c = rows[0];
        results.push({
          queried_name: target.name,
          queried_id: target.id,
          found: true,
          id: c.id,
          name: c.name,
          owner_email: c.owner_email || null,
          owner_user_id: c.owner_user_id || null,
          character_type: c.character_type || null,
          status: c.status || null,
          data_scope: c.data_scope || null,
          visibility_scope: c.visibility_scope || null,
        });
      }
    }

    const allFound = results.every(r => r.found);
    const noneFound = results.every(r => !r.found);
    const foundWithCorrectOwnerEmail = results.filter(r => r.found && r.owner_email === 'murqart@gmail.com');
    const foundWithMissingOwnerEmail = results.filter(r => r.found && !r.owner_email);
    const foundWithWrongOwnerEmail = results.filter(r => r.found && r.owner_email && r.owner_email !== 'murqart@gmail.com');

    let classification;
    if (noneFound) {
      classification = 'SDK/SERVICE_ROLE_VISIBILITY_MISMATCH — records not reachable via asServiceRole by ID, but were found via RLS name queries. This is a platform-level isolation issue, not an ownership backfill issue.';
    } else if (foundWithCorrectOwnerEmail.length === results.filter(r => r.found).length) {
      classification = 'RECORDS_FOUND_WITH_CORRECT_OWNER_EMAIL — owner_email is correctly set. The bulk compound filter failure is a platform index inconsistency, not missing ownership data.';
    } else if (foundWithMissingOwnerEmail.length > 0) {
      classification = 'OWNERSHIP_BACKFILL_NEEDED — records found but owner_email is null/missing. Must write owner_email to these records.';
    } else if (foundWithWrongOwnerEmail.length > 0) {
      classification = 'WRONG_OWNER_EMAIL — records found but owner_email does not match murqart@gmail.com. Data belongs to a different account or was migrated incorrectly.';
    } else {
      classification = 'PARTIAL — mixed state across records. Review per-record detail.';
    }

    return Response.json({
      results,
      summary: {
        total_queried: TARGETS.length,
        found: results.filter(r => r.found).length,
        not_found: results.filter(r => !r.found).length,
        found_with_correct_owner_email: foundWithCorrectOwnerEmail.length,
        found_with_missing_owner_email: foundWithMissingOwnerEmail.length,
        found_with_wrong_owner_email: foundWithWrongOwnerEmail.length,
        classification,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});