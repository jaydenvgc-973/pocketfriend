import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Complete reassignment: Transfer ALL npc_fictitious + ALL npc_family_member 
 * from adobevgc@gmail.com to murqart@gmail.com
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch ALL characters from adobevgc
    const allAdobeChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: 'adobevgc@gmail.com' },
      'created_date',
      500
    );

    // Filter: ONLY npc_fictitious + npc_family_member types
    const toTransfer = allAdobeChars.filter(c => 
      (c.character_type === 'npc_fictitious' || c.character_type === 'npc_family_member')
    );

    const results = {
      npc_fictitious: [],
      npc_family_member: [],
      skipped: []
    };

    for (const char of toTransfer) {
      try {
        await base44.asServiceRole.entities.Character.update(char.id, {
          owner_email: 'murqart@gmail.com',
        });
        
        if (char.character_type === 'npc_fictitious') {
          results.npc_fictitious.push({ id: char.id, name: char.name });
        } else if (char.character_type === 'npc_family_member') {
          results.npc_family_member.push({ id: char.id, name: char.name });
        }
      } catch (err) {
        results.skipped.push({ id: char.id, name: char.name, error: err.message });
      }
    }

    console.log(`[fixMurqartCharacterOwnershipComplete] Transferred ${results.npc_fictitious.length} npc_fictitious + ${results.npc_family_member.length} npc_family_member`);

    return Response.json({
      success: true,
      npc_fictitious_count: results.npc_fictitious.length,
      npc_family_member_count: results.npc_family_member.length,
      npc_fictitious_list: results.npc_fictitious,
      npc_family_member_list: results.npc_family_member,
      skipped: results.skipped,
    });
  } catch (error) {
    console.error('[fixMurqartCharacterOwnershipComplete]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});