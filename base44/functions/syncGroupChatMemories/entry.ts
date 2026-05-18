import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * SYNC GROUP CHAT MEMORIES — Life Journal Writer
 *
 * Called after a Group Chat cycle completes.
 * Reads the most recent exchange, extracts meaningful content via LLM,
 * and writes CharacterMemory records for every directly involved character.
 *
 * A record is only written when the exchange contains emotional weight,
 * conflict, affection, plans, promises, apologies, revelations, or
 * relationship-relevant information. Small talk is skipped.
 *
 * Each involved character gets their OWN perspective-based memory entry.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversationId, source = 'group_chat' } = await req.json();
    if (!conversationId) return Response.json({ error: 'conversationId required' }, { status: 400 });

    // Load conversation
    const convos = await base44.entities.Conversation.filter({ id: conversationId });
    const conversation = convos?.[0];
    if (!conversation) return Response.json({ error: 'Conversation not found' }, { status: 404 });

    const characterIds = conversation.character_ids || [];
    if (characterIds.length === 0) return Response.json({ success: true, skipped: 'no characters' });

    // Load characters involved
    const allChars = await base44.entities.Character.filter({ owner_email: user.email });
    const convoCharacters = allChars.filter(c => characterIds.includes(c.id));
    if (convoCharacters.length === 0) return Response.json({ success: true, skipped: 'characters not found' });

    // Load last 30 messages — enough to capture a full recent exchange
    const messages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      '-created_date',
      30
    );
    const recentMessages = messages.slice().reverse(); // chronological order

    if (recentMessages.length < 2) return Response.json({ success: true, skipped: 'not enough messages' });

    // ── PROTECTION: exclude recovery signals and non-eligible messages from memory input ──
    // recovery_signal:true messages are technical failure states, never character dialogue.
    // memory_eligible:false messages must not enter the memory extraction pipeline.
    // Both checks are required — a message may have one without the other during partial writes.
    const eligibleMessages = recentMessages.filter(m => {
      if (m.recovery_signal === true) return false;
      if (m.memory_eligible === false) return false;
      return true;
    });

    if (eligibleMessages.length < 2) return Response.json({ success: true, skipped: 'not enough eligible messages after filtering recovery signals' });

    // Build a readable transcript — only from verified character dialogue
    const transcript = eligibleMessages
      .map(m => {
        const speaker = m.sender_type === 'user' ? 'User' : (m.character_name || 'Character');
        return `${speaker}: ${(m.content || '').slice(0, 300)}`;
      })
      .join('\n');

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateStr = nowET.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = nowET.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const participantNames = convoCharacters.map(c => c.name).join(', ');

    // Extract meaningful content from the exchange — one pass for all characters
    const extraction = await base44.integrations.Core.InvokeLLM({
      prompt: `You are analyzing a group conversation that just happened.

Date/Time: ${dateStr} at ${timeStr} ET
Source: ${source === 'world_phone' ? 'World Phone call/message' : 'Group Chat'}
Participants: User, ${participantNames}

Transcript:
${transcript}

Determine if this conversation contains MEANINGFUL content worth storing as character memory.

Meaningful content includes:
- Emotional exchanges (affection, conflict, hurt, excitement, jealousy, tension)
- Plans, promises, agreements, decisions
- Apologies or forgiveness
- Important personal information shared
- Relationship shifts between any two participants
- Revelations or secrets
- Invitations or rejections

Small talk, greetings, and trivial exchanges do NOT qualify.

If meaningful:
- Write a short summary (2-4 sentences) of what happened from a neutral narrator perspective
- Identify which characters were directly involved (by name)
- Note the emotional tone
- Note any relationship impact

Return JSON only.`,
      response_json_schema: {
        type: 'object',
        properties: {
          is_meaningful: { type: 'boolean' },
          summary: { type: 'string', description: 'Neutral 2-4 sentence summary of what happened. null if not meaningful.' },
          emotional_tone: { type: 'string', description: 'Overall emotional tone of the exchange. null if not meaningful.' },
          directly_involved_characters: {
            type: 'array',
            items: { type: 'string' },
            description: 'Names of characters who actively spoke or were directly addressed. null if not meaningful.'
          },
          relationship_impact: { type: 'string', description: 'How relationships shifted, if at all. null if none.' },
          plans_or_promises: { type: 'string', description: 'Any plans made, promises given, or follow-up expected. null if none.' }
        },
        required: ['is_meaningful']
      }
    });

    if (!extraction?.is_meaningful) {
      return Response.json({ success: true, skipped: 'not meaningful enough to store' });
    }

    const summary = extraction.summary || '';
    if (!summary.trim()) return Response.json({ success: true, skipped: 'no summary generated' });

    // Write a CharacterMemory entry for each involved character
    const involvedNames = extraction.directly_involved_characters || convoCharacters.map(c => c.name);
    const involvedCharacters = convoCharacters.filter(c =>
      involvedNames.some(n => n.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n.toLowerCase()))
    );

    // If we couldn't narrow it down, write for all participants
    const targetCharacters = involvedCharacters.length > 0 ? involvedCharacters : convoCharacters;

    const sourceLabel = source === 'world_phone' ? 'World Phone' : 'Group Chat';
    const writes = [];

    for (const char of targetCharacters) {
      const otherNames = targetCharacters
        .filter(c => c.id !== char.id)
        .map(c => c.name)
        .join(', ');

      const memoryText = [
        `[${sourceLabel} — ${dateStr} at ${timeStr}]`,
        `Present: ${participantNames}, User.`,
        summary,
        extraction.emotional_tone ? `Emotional tone: ${extraction.emotional_tone}.` : null,
        extraction.relationship_impact ? `Relationship impact: ${extraction.relationship_impact}.` : null,
        extraction.plans_or_promises ? `Plans/promises: ${extraction.plans_or_promises}.` : null,
      ].filter(Boolean).join(' ');

      writes.push(
        base44.entities.CharacterMemory.create({
          character_id: char.id,
          memory_type: 'event',
          memory_text: memoryText,
          memory_summary: `${sourceLabel} with ${otherNames || 'the group'}: ${summary.slice(0, 150)}`,
          importance_score: extraction.relationship_impact || extraction.plans_or_promises ? 7 : 5,
          confidence_score: 0.85,
          permanence: 'long_term',
          validation_status: 'confirmed',
        }).catch(err => {
          console.error(`[syncGroupChatMemories] Failed to write memory for ${char.name}:`, err.message);
        })
      );
    }

    await Promise.all(writes);

    console.log(`[syncGroupChatMemories] Wrote ${writes.length} memory entries for conversation ${conversationId}`);

    return Response.json({
      success: true,
      memories_written: writes.length,
      characters: targetCharacters.map(c => c.name),
      is_meaningful: true,
      summary: summary.slice(0, 200),
    });

  } catch (error) {
    console.error('[syncGroupChatMemories] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});