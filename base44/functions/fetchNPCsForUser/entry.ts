import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch ALL NPC characters for this user using ONLY owner_email (source of truth)
    // owner_email is the canonical ownership field — created_by is permanently forbidden
    const all = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      300
    ).then(chars => 
      chars.filter(c => {
        // Exclude hard-deleted
        if (c.status === 'deleted') return false;
        // Only return NPC types (not active_created_character)
        if (c.character_type === 'active_created_character') return false;
        return true;
      })
    );

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