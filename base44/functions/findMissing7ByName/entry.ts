import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Search for the 7 missing npc_fictitious characters by name only
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const missingNames = ['Carlos Mendez', 'Demi Rivers', 'Jordan Li', 'Leah Park', 'Mace', 'Mia Chen', 'Rick Taylor'];

    // Search across ALL characters, no owner filter
    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 1000).catch(() => []);
    
    const found = allChars.filter(c => missingNames.includes(c.name));

    console.log(`[findMissing7ByName] Found ${found.length} of 7 missing characters`);
    found.forEach(c => {
      console.log(`  ${c.name}: owner_email=${c.owner_email}, owner_user_id=${c.owner_user_id}, type=${c.character_type}, status=${c.status}`);
    });

    return Response.json({
      found: found.length,
      characters: found.map(c => ({
        id: c.id,
        name: c.name,
        owner_email: c.owner_email,
        owner_user_id: c.owner_user_id,
        character_type: c.character_type,
        status: c.status,
        created_by: c.created_by
      }))
    });
  } catch (error) {
    console.error('[findMissing7ByName]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});