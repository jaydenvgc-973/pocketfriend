import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // SOURCE 1: owner_email-scoped query — catches all characters created for this account
    const chars1 = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      '-created_date',
      500
    ).catch(() => []);

    // SOURCE 2: npc_world_service characters scoped to this account only.
    // These are service characters (e.g. Vick Servicio) that must be scoped by owner_email
    // to prevent cross-account bleed. An empty-filter query on npc_world_service returns
    // Vick records from ALL accounts, causing duplicate Vick entries in the UI.
    const worldServiceChars = await base44.entities.Character.filter(
      { character_type: 'npc_world_service', owner_email: ownerEmail },
      '-created_date',
      10
    ).catch(() => []);

    // Merge and deduplicate by id — chars1 has priority (it is owner-scoped)
    const seen = new Set();
    const allChars = [];
    for (const c of [...chars1, ...worldServiceChars]) {
      if (!c.id || seen.has(c.id)) continue;
      seen.add(c.id);
      allChars.push(c);
    }

    // Filter to NPC types (exclude active_created_character and deleted)
    // CRITICAL: owner_email must match — never include cross-account records.
    const all = allChars.filter(c => {
      if (c.status === 'deleted' || c.status === 'soft_deleted') return false;
      if (c.character_type === 'active_created_character') return false;
      // Strict owner-email guard — prevents cross-account Vick bleed
      if (c.owner_email && c.owner_email !== ownerEmail) return false;
      // npc_world_service (e.g. Vick Servicio) — included only when owner matches
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