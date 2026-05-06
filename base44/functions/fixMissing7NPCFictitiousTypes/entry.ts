import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Find the 7 missing npc_fictitious (by name) and fix their character_type field
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const missingNames = ['Carlos Mendez', 'Demi Rivers', 'Jordan Li', 'Leah Park', 'Mace', 'Mia Chen', 'Rick Taylor'];

    // Search for these characters across all owner scopes
    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 1000).catch(() => []);
    const found = allChars.filter(c => missingNames.includes(c.name) && c.owner_email === user.email);

    console.log(`[fixMissing7NPCFictitiousTypes] Found ${found.length} of 7 characters for ${user.email}`);

    const results = { fixed: [], already_correct: [], errors: [] };

    for (const char of found) {
      try {
        if (char.character_type === 'npc_fictitious') {
          results.already_correct.push(char.name);
        } else {
          await base44.asServiceRole.entities.Character.update(char.id, {
            character_type: 'npc_fictitious'
          });
          results.fixed.push({ name: char.name, was: char.character_type || 'null' });
        }
      } catch (err) {
        results.errors.push({ name: char.name, error: err.message });
      }
    }

    console.log(`[fixMissing7NPCFictitiousTypes] Fixed ${results.fixed.length}, already correct: ${results.already_correct.length}`);

    return Response.json({
      found: found.length,
      fixed: results.fixed.length,
      fixed_list: results.fixed,
      already_correct: results.already_correct,
      errors: results.errors
    });
  } catch (error) {
    console.error('[fixMissing7NPCFictitiousTypes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});