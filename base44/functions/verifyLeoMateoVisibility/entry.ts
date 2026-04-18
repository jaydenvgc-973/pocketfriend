import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'adobevgc@gmail.com';
    const leoId = '69e2ac3276e99598733d00f4';
    const mateoId = '69e2adcd435862dcccb898a0';

    // Replicate the NPCContactPanel query logic exactly
    const byCreatedBy = await base44.asServiceRole.entities.Character.filter({
      created_by: targetEmail,
      character_type: { $in: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'] }
    });

    const byOwnerEmail = await base44.asServiceRole.entities.Character.filter({
      owner_email: targetEmail,
      character_type: { $in: ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'] }
    });

    // Merge and deduplicate
    const seen = new Set();
    const rawNpcCharacters = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    // Apply the second filter (line 46-51 of NPCContactPanel)
    const npcCharacters = rawNpcCharacters.filter(c => {
      if (c.protected_active) return false;
      const isNPC = ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type);
      return isNPC && c.owner_email === targetEmail;
    });

    const leoFound = npcCharacters.find(c => c.id === leoId);
    const mateoFound = npcCharacters.find(c => c.id === mateoId);

    return Response.json({
      success: true,
      raw_query_count: rawNpcCharacters.length,
      after_filter_count: npcCharacters.length,
      leo_appears: !!leoFound,
      mateo_appears: !!mateoFound,
      leo_details: leoFound ? {
        id: leoFound.id,
        name: leoFound.name,
        character_type: leoFound.character_type,
        owner_email: leoFound.owner_email,
        protected_active: leoFound.protected_active,
      } : 'NOT FOUND',
      mateo_details: mateoFound ? {
        id: mateoFound.id,
        name: mateoFound.name,
        character_type: mateoFound.character_type,
        owner_email: mateoFound.owner_email,
        protected_active: mateoFound.protected_active,
      } : 'NOT FOUND',
      all_npc_names: npcCharacters.map(c => ({ id: c.id, name: c.name, type: c.character_type })),
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});