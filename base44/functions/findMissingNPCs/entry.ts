import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const murqartEmail = 'murqart@gmail.com';

    // Get ALL characters created by murqart with NPC types
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: murqartEmail
    });

    const allNPCs = allChars.filter(c => 
      ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type)
    );

    // Apply the filter that NPCContactPanel uses
    const visibleNPCs = allNPCs.filter(c => {
      if (c.protected_active) return false;
      const isNPC = ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type);
      return isNPC && c.created_by === murqartEmail;
    });

    const hiddenNPCs = allNPCs.filter(c => !visibleNPCs.find(v => v.id === c.id));

    return Response.json({
      total_npcs_created_by_murqart: allNPCs.length,
      visible_on_list: visibleNPCs.map(c => ({
        id: c.id,
        name: c.name,
        created_by: c.created_by,
        owner_email: c.owner_email,
        protected_active: c.protected_active
      })),
      hidden_npcs: hiddenNPCs.map(c => ({
        id: c.id,
        name: c.name,
        created_by: c.created_by,
        owner_email: c.owner_email,
        protected_active: c.protected_active,
        reason: c.protected_active ? 'protected_active=true' : 'other filter'
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});