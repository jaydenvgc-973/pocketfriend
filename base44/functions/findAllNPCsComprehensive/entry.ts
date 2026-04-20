import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * findAllNPCsComprehensive
 * 
 * Find ALL NPCs on adobevgc@gmail.com regardless of character_type field
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'adobevgc@gmail.com';

    // Get ALL characters on the account
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
    });

    // Separate by type
    const summary = {
      total_characters: allChars.length,
      by_type: {},
      inactive_status: [],
    };

    for (const char of allChars) {
      const type = char.character_type || 'unknown';
      if (!summary.by_type[type]) {
        summary.by_type[type] = [];
      }
      summary.by_type[type].push({
        id: char.id,
        name: char.name,
        status: char.status,
        character_type: char.character_type,
      });

      if (char.status !== 'active') {
        summary.inactive_status.push({
          name: char.name,
          status: char.status,
          type: char.character_type,
        });
      }
    }

    return Response.json(summary);
  } catch (error) {
    console.error('[findAllNPCsComprehensive]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});