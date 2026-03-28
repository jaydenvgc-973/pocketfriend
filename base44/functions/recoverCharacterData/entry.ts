import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    // Fetch all data for this character
    const [character, conversations, messages, memories] = await Promise.all([
      base44.entities.Character.filter({ id: characterId }),
      base44.entities.Conversation.filter({ character_ids: [characterId] }),
      base44.entities.Message.filter({ character_id: characterId }),
      base44.entities.Memory.filter({ character_id: characterId })
    ]);

    const char = character[0];
    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Count messages by type
    const directMsgs = messages.filter(m => {
      const convo = conversations.find(c => c.id === m.conversation_id);
      return convo?.type === 'direct';
    });
    const phoneMsgs = messages.filter(m => {
      const convo = conversations.find(c => c.id === m.conversation_id);
      return convo?.type === 'phone';
    });
    const msgsWithImages = messages.filter(m => m.image_url);

    return Response.json({
      success: true,
      character: {
        id: char.id,
        name: char.name,
        avatar_url: char.avatar_url
      },
      conversations: {
        total: conversations.length,
        direct: conversations.filter(c => c.type === 'direct').length,
        phone: conversations.filter(c => c.type === 'phone').length
      },
      messages: {
        total: messages.length,
        direct: directMsgs.length,
        phone: phoneMsgs.length,
        withImages: msgsWithImages.length,
        byCharacter: messages.filter(m => m.sender_type === 'character').length,
        byUser: messages.filter(m => m.sender_type === 'user').length
      },
      memories: {
        total: memories.length
      },
      allDataPresent: messages.length > 0 && conversations.length > 0,
      data: {
        conversations,
        messages: messages.slice(-50), // Last 50 messages
        memories: memories.slice(-20) // Last 20 memories
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});