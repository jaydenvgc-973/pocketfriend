import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const PERSONAL_HOME_ID = '69d03c56a5e65c211c8a6105';
    const FAMILY_HOME_ID   = '69d03c5558a81a27afb716eb';

    const all = await base44.entities.Character.list('-updated_date', 100);

    // Find Linda, Thomas (not found in the 6)
    const linda = all.filter(c => c.name?.toLowerCase().includes('linda'));
    const thomas = all.filter(c => c.name?.toLowerCase() === 'thomas' && c.character_type === 'npc_family_member');

    const fmt = (c) => ({
      id: c.id, name: c.name, type: c.character_type,
      home: c.current_home_location_id,
      resolved: c.resolved_current_location_id,
      resolved_name: c.resolved_current_location_name,
      reason: c.resolved_source_reason,
    });

    return Response.json({
      linda_chars: linda.map(fmt),
      thomas_chars: thomas.map(fmt),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});