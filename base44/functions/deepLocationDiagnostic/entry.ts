import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // Deep location check
    const locationCheck = {
      homeLocation: {
        id: ethan.current_home_location_id,
        exists: ethan.current_home_location_id ? !!locMap[ethan.current_home_location_id] : false,
        name: ethan.current_home_location_id ? locMap[ethan.current_home_location_id]?.name : 'NO HOME',
      },
      workLocation: {
        id: ethan.occupation_location_id,
        exists: ethan.occupation_location_id ? !!locMap[ethan.occupation_location_id] : false,
        name: ethan.occupation_location_id ? locMap[ethan.occupation_location_id]?.name : 'NO WORK',
      },
      currentWorkLocation: {
        id: ethan.current_work_location_id,
        exists: ethan.current_work_location_id ? !!locMap[ethan.current_work_location_id] : false,
        name: ethan.current_work_location_id ? locMap[ethan.current_work_location_id]?.name : 'NOT SET',
      },
      schoolLocation: {
        id: ethan.current_school_location_id,
        exists: ethan.current_school_location_id ? !!locMap[ethan.current_school_location_id] : false,
        name: ethan.current_school_location_id ? locMap[ethan.current_school_location_id]?.name : 'NOT SET',
      },
    };

    // Check conversations
    const convs = await base44.entities.Conversation.filter({ character_ids: [ethan.id] });

    // Check messages
    const messages = await base44.entities.Message.filter({ character_id: ethan.id });

    // Check if character is in any location's resident list
    const residesAt = locations.filter(l => l.resident_character_ids?.includes(ethan.id) || l.resident_character_names?.includes(ethan.name));

    // Check financial data
    const financial = await base44.entities.CharacterFinancial.filter({ character_id: ethan.id });

    return Response.json({
      timestamp: new Date().toISOString(),
      characterName: ethan.name,
      characterId: ethan.id,
      locationCheck,
      conversationCount: convs.length,
      messageCount: messages.length,
      residesAtLocations: residesAt.map(l => ({ id: l.id, name: l.name })),
      financialRecordExists: financial.length > 0,
      financialBalance: financial[0]?.current_balance || 'NO RECORD',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});