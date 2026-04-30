import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CROSS-PAGE MEMORY RETRIEVAL
 * Fetches recent conversation history and stored memories for a character
 * across ALL surfaces (Chat, Scene, GroupChat, Text).
 * Returns a merged context string for injection into any LLM prompt.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { characterId, limitMessages = 20 } = await req.json();
  if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

  // 1. Fetch all conversations involving this character (owned by this user)
  const allConversations = await base44.entities.Conversation.filter({
    owner_email: user.email,
  }).catch(() => []);

  const charConvos = allConversations.filter(c => {
    if (c.character_id === characterId) return true;
    if (Array.isArray(c.character_ids) && c.character_ids.includes(characterId)) return true;
    return false;
  });

  // 2. Fetch recent messages from all those conversations
  const allMessages = [];
  for (const convo of charConvos) {
    const msgs = await base44.entities.Message.filter(
      { conversation_id: convo.id },
      '-created_date',
      limitMessages
    ).catch(() => []);
    allMessages.push(...msgs.map(m => ({ ...m, conversation_type: convo.type || 'direct' })));
  }

  // Sort by timestamp ascending, take the most recent limitMessages
  allMessages.sort((a, b) => new Date(a.created_date || a.timestamp) - new Date(b.created_date || b.timestamp));
  const recentMessages = allMessages.slice(-limitMessages);

  // 3. Fetch stored CharacterMemory records for this character
  const memories = await base44.entities.CharacterMemory.filter({
    character_id: characterId,
  }, '-importance_score', 15).catch(() => []);

  // 4. Build the merged context string
  const contextLines = [];

  if (recentMessages.length > 0) {
    contextLines.push('=== RECENT CONVERSATION HISTORY (across all pages) ===');
    for (const m of recentMessages) {
      const label = m.sender_type === 'user'
        ? (m.played_as_character_name || 'User')
        : (m.character_name || 'Character');
      const surface = m.conversation_type !== 'direct' ? ` [${m.conversation_type}]` : '';
      contextLines.push(`${label}${surface}: ${(m.content || '').slice(0, 150)}`);
    }
  }

  if (memories.length > 0) {
    contextLines.push('\n=== STORED MEMORIES ===');
    for (const mem of memories) {
      const line = mem.memory_summary || mem.memory_text || '';
      if (line.trim()) contextLines.push(`• [${mem.memory_type}] ${line.slice(0, 200)}`);
    }
  }

  const contextText = contextLines.join('\n');

  return Response.json({
    success: true,
    contextText,
    messageCount: recentMessages.length,
    memoryCount: memories.length,
  });
});