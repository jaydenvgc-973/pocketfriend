import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Target NPCs that show [NO LOCATION]
    const targetNames = ['Carlos Mendez', 'Demi Rivers', 'Leah Park', 'Mia Chen', 'Sofia Garcia'];

    // Fetch all npc_fictitious
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, character_type: 'npc_fictitious' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious' }),
    ]);

    const seen = new Set();
    const allNPCs = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    const targetNPCs = allNPCs.filter(npc => targetNames.includes(npc.name));

    const investigation = {
      targetNPCs: targetNPCs.length,
      npcs: targetNPCs.map(npc => ({
        name: npc.name,
        id: npc.id,
        character_type: npc.character_type,
        status: npc.status,
        resolved_current_location_id: npc.resolved_current_location_id,
        resolved_current_location_name: npc.resolved_current_location_name,
        current_home_location_id: npc.current_home_location_id,
        presence_state: npc.presence_state,
        resolved_presence_status: npc.resolved_presence_status,
        valid_from: npc.valid_from,
        valid_until: npc.valid_until,
        protected_active: npc.protected_active,
        created_by: npc.created_by,
        owner_email: npc.owner_email,
      })),
    };

    return Response.json(investigation);
  } catch (error) {
    console.error('[investigateNPCLocationState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});