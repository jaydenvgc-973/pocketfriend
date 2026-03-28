import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    let body = {};
    try {
      const text = await req.text();
      if (text) body = JSON.parse(text);
    } catch {
      // ignore parse errors
    }

    const characterId = body?.characterId;
    if (!characterId) {
      return new Response(JSON.stringify({ error: 'characterId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const base44 = createClientFromRequest(req);

    // Fetch character
    const chars = await base44.entities.Character.filter({ id: characterId });
    if (!chars?.[0]) {
      return new Response(JSON.stringify({ error: 'Character not found', success: false }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // Fetch messages and conversations in parallel
    const [msgs, convos, mems] = await Promise.all([
      base44.entities.Message.filter({ character_id: characterId }, '-created_date', 1000),
      base44.entities.Conversation.filter({ character_ids: [characterId] }),
      base44.entities.Memory.filter({ character_id: characterId })
    ]);

    return new Response(JSON.stringify({
      success: true,
      character: chars[0].name,
      stats: {
        totalMessages: msgs?.length || 0,
        characterMessages: msgs?.filter(m => m.sender_type === 'character').length || 0,
        userMessages: msgs?.filter(m => m.sender_type === 'user').length || 0,
        messagesWithImages: msgs?.filter(m => m.image_url).length || 0,
        conversations: convos?.length || 0,
        memories: mems?.length || 0
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ 
      error: String(error?.message || 'Unknown error'),
      success: false
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});