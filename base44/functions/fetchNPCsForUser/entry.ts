import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch ALL NPC characters for this user using ONLY owner_email (source of truth).
    // Retry up to 3 times on rate-limit or transient errors to prevent flaky empty returns.
    let rawChars = [];
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rawChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: user.email },
          '-created_date',
          300
        );
        if (rawChars.length > 0) break; // got a real result
        // Got empty — might be transient. If last attempt, keep it.
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        }
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    if (lastError && rawChars.length === 0) throw lastError;

    const all = rawChars.filter(c => {
      if (c.status === 'deleted') return false;
      if (c.character_type === 'active_created_character') return false;
      return true;
    });

    const fictitiousNames = all.filter(c => c.character_type === 'npc_fictitious').map(c => c.name);
    const summary = {
      total: all.length,
      fictitious: all.filter(c => c.character_type === 'npc_fictitious').length,
      family: all.filter(c => c.character_type === 'npc_family_member').length,
      regular: all.filter(c => c.character_type === 'npc_regular').length,
      other: all.filter(c => !['npc_fictitious','npc_family_member','npc_regular'].includes(c.character_type)).length,
      fictitiousNames,
    };
    console.log('[fetchNPCsForUser] summary:', JSON.stringify(summary));
    return Response.json({ npcs: all });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});