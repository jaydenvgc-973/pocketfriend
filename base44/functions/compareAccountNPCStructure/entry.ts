import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const workingEmail = 'murqart@gmail.com';
    const brokenEmail = 'adobevgc@gmail.com';

    // Get ALL NPCs from both accounts (no filters, raw data)
    const workingAllChars = await base44.asServiceRole.entities.Character.filter({
      created_by: workingEmail
    });
    const workingNPCs = workingAllChars.filter(c => 
      ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type)
    );

    const brokenAllChars = await base44.asServiceRole.entities.Character.filter({
      created_by: brokenEmail
    });
    const brokenNPCs = brokenAllChars.filter(c => 
      ['npc', 'family_npc', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type)
    );

    // Extract key fields for comparison
    const workingNPCStructure = workingNPCs.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      created_by: c.created_by,
      owner_email: c.owner_email,
      protected_active: c.protected_active,
      is_test_character: c.is_test_character,
      diagnostic_only: c.diagnostic_only,
      exclude_from_homepage: c.exclude_from_homepage
    }));

    const brokenNPCStructure = brokenNPCs.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      created_by: c.created_by,
      owner_email: c.owner_email,
      protected_active: c.protected_active,
      is_test_character: c.is_test_character,
      diagnostic_only: c.diagnostic_only,
      exclude_from_homepage: c.exclude_from_homepage
    }));

    return Response.json({
      working_account: {
        email: workingEmail,
        npc_count: workingNPCs.length,
        npcs: workingNPCStructure
      },
      broken_account: {
        email: brokenEmail,
        npc_count: brokenNPCs.length,
        npcs: brokenNPCStructure
      },
      differences: {
        note: "Compare these structures to see what's different between working and broken accounts"
      }
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});