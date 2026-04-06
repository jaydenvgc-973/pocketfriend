import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters
    const allCharacters = await base44.entities.Character.list('-created_date', 1000);

    // Count by character_type
    const typeCount = {};
    const statusCount = {};
    const details = {
      byType: {},
      byStatus: {},
    };

    allCharacters.forEach(char => {
      const type = char.character_type || 'undefined';
      const status = char.status || 'active';

      typeCount[type] = (typeCount[type] || 0) + 1;
      statusCount[status] = (statusCount[status] || 0) + 1;

      if (!details.byType[type]) details.byType[type] = [];
      if (!details.byStatus[status]) details.byStatus[status] = [];

      details.byType[type].push({ id: char.id, name: char.name, status: char.status });
      details.byStatus[status].push({ id: char.id, name: char.name, type: char.character_type });
    });

    // Apply filter logic
    const activeChars = allCharacters.filter(c => 
      (c.character_type === 'active' || !c.character_type) && c.status === 'active'
    );

    const npcFamilyChars = allCharacters.filter(c => 
      c.character_type === 'family_npc' && c.status === 'active'
    );

    return Response.json({
      totalCharacters: allCharacters.length,
      typeCounts: typeCount,
      statusCounts: statusCount,
      filterResults: {
        activeCharacters: activeChars.length,
        npcFamily: npcFamilyChars.length,
      },
      details,
      activeCharsList: activeChars.map(c => ({ id: c.id, name: c.name, type: c.character_type })),
      npcFamilyList: npcFamilyChars.map(c => ({ id: c.id, name: c.name, type: c.character_type })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});