import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnosisNPCsOnAccount
 * 
 * Check all NPCs on adobevgc@gmail.com, their current locations, and assign them to VGC Towers
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'adobevgc@gmail.com';

    // Find all NPCs on the target account
    const [npcsByCreated, npcsByOwner] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({
        created_by: targetEmail,
        character_type: { $in: ['npc', 'family_npc', 'background', 'promoted_npc'] },
      }),
      base44.asServiceRole.entities.Character.filter({
        owner_email: targetEmail,
        character_type: { $in: ['npc', 'family_npc', 'background', 'promoted_npc'] },
      }),
    ]);

    const seenIds = new Set();
    const npcs = [...npcsByCreated, ...npcsByOwner].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return c.status !== 'deleted' && c.status !== 'moved_away';
    });

    // Get VGC Towers
    const [vgcByCreated, vgcByOwner] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({
        created_by: targetEmail,
        name: 'VGC Towers',
      }),
      base44.asServiceRole.entities.LocationReference.filter({
        owner_email: targetEmail,
        name: 'VGC Towers',
      }),
    ]);

    const vgc = vgcByCreated[0] || vgcByOwner[0];

    if (!vgc) {
      return Response.json({ error: 'No VGC Towers found on this account' }, { status: 400 });
    }

    // Check current NPC locations and assign to VGC Towers
    const assignments = [];

    for (const npc of npcs) {
      const isAlreadyResident = (vgc.resident_character_ids || []).includes(npc.id) ||
        (vgc.residents || []).some(r => r.character_id === npc.id);

      if (!isAlreadyResident && npc.status === 'active') {
        // Add to residents array
        const newResident = {
          character_id: npc.id,
          character_name: npc.name,
          avatar_url: npc.image_avatar_url || npc.avatar_url || null,
          moved_in_date: new Date().toISOString(),
        };

        const currentResidents = vgc.residents || [];
        await base44.asServiceRole.entities.LocationReference.update(vgc.id, {
          residents: [...currentResidents, newResident],
        });

        assignments.push({
          npc_name: npc.name,
          npc_id: npc.id,
          assigned: true,
          character_type: npc.character_type,
        });
      } else {
        assignments.push({
          npc_name: npc.name,
          npc_id: npc.id,
          assigned: isAlreadyResident,
          character_type: npc.character_type,
          reason: isAlreadyResident ? 'already_resident' : 'inactive',
        });
      }
    }

    return Response.json({
      account_email: targetEmail,
      total_npcs: npcs.length,
      vgc_towers_id: vgc.id,
      assignments,
    });
  } catch (error) {
    console.error('[diagnosisNPCsOnAccount]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});