import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch ALL NPC characters for this user via user-scoped SDK (service-role cannot bypass Character RLS)
    const chars1 = await base44.entities.Character.filter(
      {},
      '-created_date',
      500
    ).catch(() => []);

    // No deduplication needed — single user-scoped query
    const allChars = chars1;

    // Filter to NPC types (exclude active_created_character and deleted)
    const all = allChars.filter(c => {
      if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
      if (c.character_type === 'active_created_character') return false;
      // npc_world_service (e.g. Vick Servicio) — permanently included so they appear in contact panels and chat
      if (c.character_type === 'npc_world_service') return true;
      // INCLUDE records with missing/null character_type (legacy compatibility)
      return !c.character_type || ['npc_fictitious', 'npc_family_member', 'npc_regular'].includes(c.character_type);
    });

    const fictitiousNames = all.filter(c => c.character_type === 'npc_fictitious').map(c => c.name);
    const summary = {
      total: all.length,
      fictitious: all.filter(c => c.character_type === 'npc_fictitious').length,
      family: all.filter(c => c.character_type === 'npc_family_member').length,
      regular: all.filter(c => c.character_type === 'npc_regular').length,
      fictitiousNames,
    };
    console.log('[fetchNPCsForUser] summary:', JSON.stringify(summary));
    return Response.json({ npcs: all });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});