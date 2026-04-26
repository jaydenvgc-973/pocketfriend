import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FIND ACTUAL CHARACTER IDs BY NAME
 * 
 * The CSV IDs do not exist in the system.
 * Search by character name to find actual current IDs.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const CSV_NAMES = [
      // ADOBEVGC (4)
      'Jayden Jackson',
      'Alden Spencer',
      'Chris Brown',
      'Ken',
      // MURQART (11)
      'Melody Jackson Perry',
      'Andre Rivera',
      'Brian Anderson',
      'Test Character',
      'Lila Green',
      'Nathan Parker',
      'James Anderson',
      'Ethan Thompson',
      'Ava Dei Park',
      'Jonathan Anthony Smith',
      'Matt Lopez'
    ];

    const results = {
      total_search: CSV_NAMES.length,
      found: [],
      not_found: []
    };

    // List all characters to search by name
    const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 500);

    for (const csvName of CSV_NAMES) {
      // Exact match first
      let match = allChars.find(c => c.name === csvName);

      // Normalized match (trim, case insensitive)
      if (!match) {
        const normalized = csvName.trim().toLowerCase();
        match = allChars.find(c => c.name.trim().toLowerCase() === normalized);
      }

      if (match) {
        results.found.push({
          csv_name: csvName,
          actual_id: match.id,
          actual_name: match.name,
          character_type: match.character_type,
          is_active_character: match.is_active_character,
          owner_email: match.owner_email,
          created_by: match.created_by
        });
      } else {
        results.not_found.push(csvName);
      }
    }

    return Response.json({
      task: 'FIND_ACTUAL_CHARACTER_IDs_BY_NAME',
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});