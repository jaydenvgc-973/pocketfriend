import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * EXPORT ROW-BY-ROW CLASSIFICATION
 * 
 * Matches exactly 43 export rows to app records.
 * Identifies misplaced characters across accounts.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ─────────────────────────────────────────────────────────────────
    // ACTUAL EXPORT DATA (43 ROWS - CONTROLLING SOURCE)
    // ─────────────────────────────────────────────────────────────────

    const EXPORT_MURQART = [
      'Andre Rivera', 'Ava Dei Park', 'Brian Anderson', 'Ethan Thompson',
      'James Anderson', 'Jonathan Anthony Smith', 'Lila Green', 'Matt Lopez',
      'Melody Jackson Perry', 'Nathan Parker', 'Carlos Mendez', 'Demi Rivers',
      'Mia Chen', 'Leah Park', 'Rick Taylor', 'Jordan Li', 'Mace',
      'Jasmine Rodriguez', 'Nick Decker', 'Udelka', 'Vanessa', 'Camila',
      'Sofia Garcia', 'Michael', 'Javier', 'Marisol', 'Terrance Gibbons',
      'Briar Kieran', 'Abuela Sophia', 'Amelia Johnson', 'Daniela', 'Kiara',
      'Nancy', 'Sarah', 'Larry', 'Stephanie'
    ];

    const EXPORT_ADOBEVGC = [
      'Mark', 'Ken', 'Chris Brown', 'Alden Spencer', 'Jayden Jackson', 'Mateo', 'Leo'
    ];

    // Create full export with row numbers
    const exportRows = [
      ...EXPORT_MURQART.map((name, idx) => ({ row: idx + 1, name, account: 'murqart@gmail.com' })),
      ...EXPORT_ADOBEVGC.map((name, idx) => ({ row: EXPORT_MURQART.length + idx + 1, name, account: 'adobevgc@gmail.com' }))
    ];

    // ─────────────────────────────────────────────────────────────────
    // QUERY APP DATA
    // ─────────────────────────────────────────────────────────────────

    // Query murqart account (user role - own characters)
    const murqartUserRole = await base44.entities.Character.list('-updated_date', 500);

    // Query adobevgc account (service role to see all)
    const adobevgcChars = await base44.asServiceRole.entities.Character.filter(
      { created_by: 'adobevgc@gmail.com' },
      '-updated_date',
      500
    ).catch(() => []);

    // Also check all characters from service role to catch ownership fields
    const allCharsServiceRole = await base44.asServiceRole.entities.Character.list('-updated_date', 500);

    // Get aliases
    const aliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);

    // ─────────────────────────────────────────────────────────────────
    // MATCH EACH EXPORT ROW
    // ─────────────────────────────────────────────────────────────────

    const classifiedRows = [];

    for (const exportRow of exportRows) {
      const { row, name, account } = exportRow;

      // Search in user role characters
      const userMatch = murqartUserRole.find(c => c.name === name);

      // Search in all service role characters
      const serviceMatch = allCharsServiceRole.find(c => c.name === name);

      // Search in aliases
      const aliasMatch = aliases.find(a => a.alias_name === name);

      // Determine classification
      let match = null;
      let misplaced = false;

      if (userMatch) {
        match = {
          name: userMatch.name,
          entity: 'Character',
          role_scope: 'user',
          character_type: userMatch.character_type,
          status: userMatch.status,
          id: userMatch.id,
          owner_email: userMatch.owner_email,
          created_by: userMatch.created_by,
          match_type: 'exact',
        };
        
        // Check for cross-account misplacement
        if (account === 'adobevgc@gmail.com' && (userMatch.created_by !== 'adobevgc@gmail.com')) {
          misplaced = true;
        }
      } else if (serviceMatch) {
        match = {
          name: serviceMatch.name,
          entity: 'Character',
          role_scope: 'service',
          character_type: serviceMatch.character_type,
          status: serviceMatch.status,
          id: serviceMatch.id,
          owner_email: serviceMatch.owner_email,
          created_by: serviceMatch.created_by,
          match_type: 'exact',
        };
        
        // Check for cross-account misplacement
        if (account === 'adobevgc@gmail.com' && (serviceMatch.created_by !== 'adobevgc@gmail.com')) {
          misplaced = true;
        }
      } else if (aliasMatch) {
        match = {
          name: aliasMatch.alias_name,
          entity: 'CharacterAlias',
          character_id: aliasMatch.character_id,
          match_type: 'alias',
        };
      }

      classifiedRows.push({
        export_row: row,
        export_name: name,
        expected_account: account,
        matched: !!match,
        match_type: match?.match_type || 'unmatched',
        entity: match?.entity || null,
        matched_name: match?.name || null,
        character_type: match?.character_type || null,
        status: match?.status || null,
        role_scope: match?.role_scope || null,
        id: match?.id || null,
        owner_email: match?.owner_email || null,
        created_by: match?.created_by || null,
        misplaced: misplaced,
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────

    const matched = classifiedRows.filter(r => r.matched).length;
    const unmatched = classifiedRows.filter(r => !r.matched).length;
    const misplaced = classifiedRows.filter(r => r.misplaced).length;

    return Response.json({
      task: 'EXPORT_ROW_BY_ROW_CLASSIFICATION',
      export_total: 43,
      matched_count: matched,
      unmatched_count: unmatched,
      misplaced_count: misplaced,
      
      classified_rows: classifiedRows,

      misplaced_records: classifiedRows.filter(r => r.misplaced),

      critical_checks: {
        mateo_misplaced: classifiedRows.find(r => r.export_name === 'Mateo' && r.misplaced),
        leo_misplaced: classifiedRows.find(r => r.export_name === 'Leo' && r.misplaced),
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});