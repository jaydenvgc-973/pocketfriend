import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, conversationId, narrativeContent } = await req.json();

    if (!characterId || !conversationId || !narrativeContent) {
      return Response.json({ error: 'characterId, conversationId, and narrativeContent are required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Save narrative as a system message in the conversation
    const narrativeMessage = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: character[0].name,
      content: narrativeContent,
      timestamp: new Date().toISOString()
    });

    // Update character's current_life_event to reflect this narrative
    const updatedCharacter = await base44.entities.Character.update(characterId, {
      current_life_event: narrativeContent.substring(0, 150),
      life_last_updated: new Date().toISOString()
    });

    return Response.json({ 
      success: true, 
      message: narrativeMessage,
      character: updatedCharacter
    });

  } catch (error) {
    console.error('Error submitting narrative:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});