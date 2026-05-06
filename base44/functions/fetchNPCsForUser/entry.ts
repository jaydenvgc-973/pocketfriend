import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch ALL NPC characters for this user across multiple methods to ensure complete visibility:
    // 1. Try owner_email filter (preferred source of truth)
    // 2. Also fetch by owner_user_id to catch orphaned/legacy records
    // 3. Deduplicate and return union of both results
    
    const chars1 = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      500
    ).catch(() => []);

    const chars2 = await base44.asServiceRole.entities.Character.filter(
      { owner_user_id: user.id },
      '-created_date',
      500
    ).catch(() => []);

    // Deduplicate by ID
    const seen = new Set();
    const allChars = [];
    [...chars1, ...chars2].forEach(c => {
      if (!seen.has(c.id)) {
        allChars.push(c);
        seen.add(c.id);
      }
    });

    // Filter to NPC types (exclude active_created_character and deleted)
    const all = allChars.filter(c => {
      if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
      if (c.character_type === 'active_created_character') return false;
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