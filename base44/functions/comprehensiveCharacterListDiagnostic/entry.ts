import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('User:', user.email);

    // Fetch all characters
    const allCharacters = await base44.entities.Character.list('-created_date', 1000);
    console.log('Total characters in system:', allCharacters.length);

    // Filter by created_by
    const userCharacters = allCharacters.filter(c => c.created_by === user.email);
    console.log('Characters created by user:', userCharacters.length);

    // Analyze all character_type values in user's characters
    const typeAnalysis = {};
    userCharacters.forEach(c => {
      const type = c.character_type || 'undefined';
      if (!typeAnalysis[type]) typeAnalysis[type] = [];
      typeAnalysis[type].push({ id: c.id, name: c.name, status: c.status });
    });

    console.log('Character types in user characters:', Object.keys(typeAnalysis));

    // Test each filter individually
    const activeFilter = userCharacters.filter(c => 
      (c.character_type === 'active' || c.character_type === 'user_created' || !c.character_type) && c.status === 'active'
    );

    const npcFictFilter = userCharacters.filter(c => 
      c.character_type === 'npc' && c.status === 'active'
    );

    const npcFamilyFilter = userCharacters.filter(c => 
      c.character_type === 'family_npc' && c.status === 'active'
    );

    const movedAwayFilter = userCharacters.filter(c => 
      c.status === 'moved_away'
    );

    const deletedFilter = userCharacters.filter(c => 
      c.status === 'deleted' || c.status === 'soft_deleted'
    );

    console.log('Active characters:', activeFilter.length);
    console.log('NPC Fictitious:', npcFictFilter.length);
    console.log('NPC Family:', npcFamilyFilter.length);
    console.log('Moved Away:', movedAwayFilter.length);
    console.log('Deleted:', deletedFilter.length);

    // Show all family_npc characters in entire system
    const allFamilyNPC = allCharacters.filter(c => c.character_type === 'family_npc');
    console.log('All family_npc in system:', allFamilyNPC.length);

    // Check if any family_npc belong to this user
    const userFamilyNPC = allFamilyNPC.filter(c => c.created_by === user.email);
    console.log('User family_npc:', userFamilyNPC.length);

    return Response.json({
      userEmail: user.email,
      totalCharactersInSystem: allCharacters.length,
      userCharactersTotal: userCharacters.length,
      characterTypeBreakdown: typeAnalysis,
      filterResults: {
        active: { count: activeFilter.length, items: activeFilter.map(c => ({ id: c.id, name: c.name, type: c.character_type })) },
        npcFictitious: { count: npcFictFilter.length, items: npcFictFilter.map(c => ({ id: c.id, name: c.name, type: c.character_type })) },
        npcFamily: { count: npcFamilyFilter.length, items: npcFamilyFilter.map(c => ({ id: c.id, name: c.name, type: c.character_type })) },
        movedAway: { count: movedAwayFilter.length, items: movedAwayFilter.map(c => ({ id: c.id, name: c.name })) },
        deleted: { count: deletedFilter.length, items: deletedFilter.map(c => ({ id: c.id, name: c.name })) },
      },
      systemFamilyNPCInfo: {
        totalInSystem: allFamilyNPC.length,
        belongToUser: userFamilyNPC.length,
        allSystemFamilyNPC: allFamilyNPC.map(c => ({ id: c.id, name: c.name, createdBy: c.created_by })),
      },
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});