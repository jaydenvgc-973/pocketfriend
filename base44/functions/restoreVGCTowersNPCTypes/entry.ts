import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * restoreVGCTowersNPCTypes
 * 
 * Restores all residents in VGC Towers to NPC character_type
 * (Fixes accidental "active" classification that breaks travel distribution)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get VGC Towers
    const vgc = await base44.asServiceRole.entities.LocationReference.filter({
      created_by: 'adobevgc@gmail.com',
      name: 'VGC Towers',
    }).then(r => r[0]);

    if (!vgc) {
      return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    }

    // Get all residents from VGC Towers
    const residentIds = new Set();
    
    // From residents array
    (vgc.residents || []).forEach(r => {
      if (r.character_id) residentIds.add(r.character_id);
    });

    // From resident_character_ids (legacy)
    (vgc.resident_character_ids || []).forEach(id => residentIds.add(id));

    // From resident_family_members that have source_character_id
    (vgc.resident_family_members || []).forEach(f => {
      if (f.source_character_id) residentIds.add(f.source_character_id);
    });

    const fixed = [];
    const failed = [];

    for (const charId of residentIds) {
      try {
        const char = await base44.asServiceRole.entities.Character.filter({ id: charId }).then(r => r[0]);
        
        if (!char) {
          failed.push({ id: charId, reason: 'Character not found' });
          continue;
        }

        // Only update if currently "active" — restore to "npc"
        if (char.character_type === 'active') {
          await base44.asServiceRole.entities.Character.update(charId, {
            character_type: 'npc',
          });

          fixed.push({
            id: charId,
            name: char.name,
            old_type: 'active',
            new_type: 'npc',
          });
        } else {
          fixed.push({
            id: charId,
            name: char.name,
            type: char.character_type,
            status: 'already_correct',
          });
        }
      } catch (err) {
        failed.push({ id: charId, reason: err.message });
      }
    }

    return Response.json({
      success: true,
      total_residents: residentIds.size,
      fixed: fixed.filter(f => f.status !== 'already_correct' || f.old_type === 'active').length,
      already_correct: fixed.filter(f => f.status === 'already_correct').length,
      failed: failed.length,
      details: {
        fixed: fixed.filter(f => f.old_type === 'active'),
        failed,
      },
    });
  } catch (error) {
    console.error('[restoreVGCTowersNPCTypes]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});