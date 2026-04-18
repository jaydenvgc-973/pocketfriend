import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Check both accounts
    const accounts = ['adobevgc@gmail.com', 'murqart@gmail.com'];
    const results = {};

    for (const email of accounts) {
      const byCreatedBy = await base44.asServiceRole.entities.Character.filter({
        created_by: email,
        character_type: { $in: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'] }
      });

      const byOwnerEmail = await base44.asServiceRole.entities.Character.filter({
        owner_email: email,
        character_type: { $in: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'] }
      });

      const seen = new Set();
      const rawNpcCharacters = [...byCreatedBy, ...byOwnerEmail].filter(c => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

      const npcCharacters = rawNpcCharacters.filter(c => {
        if (c.protected_active) return false;
        const isNPC = ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type);
        return isNPC && c.owner_email === email;
      });

      results[email] = {
        total_npcs_found: npcCharacters.length,
        npcs: npcCharacters.map(c => ({
          id: c.id,
          name: c.name,
          type: c.character_type,
          owner_email: c.owner_email,
          protected_active: c.protected_active
        }))
      };
    }

    return Response.json(results);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});