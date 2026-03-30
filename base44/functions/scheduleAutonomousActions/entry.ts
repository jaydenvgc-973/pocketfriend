import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active characters for this user
    const characters = await base44.entities.Character.filter(
      { status: 'active', created_by: user.email },
      '-updated_date',
      100
    );

    if (characters.length === 0) {
      return Response.json({ scheduled: 0 });
    }

    // For each character, get their primary conversation and schedule an autonomous action
    let scheduled = 0;

    for (const char of characters) {
      try {
        // Find primary conversation (most recent direct chat)
        const convos = await base44.entities.Conversation.filter(
          { type: 'direct', character_ids: [char.id], created_by: user.email },
          '-updated_date',
          1
        );

        if (convos.length === 0) continue;

        const convo = convos[0];

        // Trigger autonomous action for this character
        await base44.functions.invoke('generateAutonomousAction', {
          characterId: char.id,
          conversationId: convo.id,
        }).catch(() => {});

        scheduled++;
      } catch (charErr) {
        console.error(`Error scheduling action for ${char.name}:`, charErr.message);
      }
    }

    return Response.json({ scheduled, total: characters.length });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});