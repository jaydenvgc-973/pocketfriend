import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * triggerCharacterNarratives
 *
 * Autonomously generates and injects narrative messages into active character conversations.
 * Narratives are short, third-person scene-setting moments that ground the conversation
 * in real life — what the character is doing, something happening around them, a shift in mood.
 *
 * Rules:
 * - Only fires for characters with an active conversation (at least 3 messages)
 * - Max 2 narratives per character per day
 * - Only runs if the character has been active recently (message in last 24h)
 * - Random chance (40%) per eligible character to keep it feeling natural, not mechanical
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Allow scheduled invocation (no user token)
    try { await base44.auth.me(); } catch (_) {}

    const allCharacters = await base44.asServiceRole.entities.Character.list();
    const activeCharacters = allCharacters.filter(c => (!c.status || c.status === 'active') && c.created_by);

    const results = [];
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    for (const character of activeCharacters) {
      try {
        // Find the most recent direct conversation for this character
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { character_ids: character.id, type: 'direct' },
          '-last_message_date',
          1
        );
        if (!convos.length) continue;

        const convo = convos[0];

        // Only proceed if the conversation has been active in the last 24h
        if (!convo.last_message_date || convo.last_message_date < oneDayAgo) continue;

        // Count narratives already sent today for this character
        const todayNarratives = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id, is_narrative: true },
          '-timestamp',
          10
        );
        const narrativesToday = todayNarratives.filter(m => m.timestamp?.startsWith(todayStr)).length;
        if (narrativesToday >= 2) {
          results.push({ characterId: character.id, name: character.name, status: 'skipped', reason: '2 narratives already today' });
          continue;
        }

        // Get recent messages for context
        const recentMessages = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id },
          '-timestamp',
          10
        );
        if (recentMessages.length < 3) continue;

        // 40% random chance — keeps it feeling natural
        if (Math.random() > 0.40) {
          results.push({ characterId: character.id, name: character.name, status: 'skipped', reason: 'random chance' });
          continue;
        }

        // Build context for narrative generation
        const recentText = recentMessages
          .slice(0, 5)
          .reverse()
          .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content}`)
          .join('\n');

        const lifeContext = character.current_life_event || '';
        const microNarration = character.daily_micro_narration || '';
        const emotionalState = character.emotional_state || 'calm';
        const city = [character.city, character.state].filter(Boolean).join(', ');
        const weather = character.weather_summary || '';

        const etNow = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', weekday: 'long' });

        const prompt = `You are writing a short, third-person narrative moment for a character named ${character.name}.

CHARACTER CONTEXT:
- Personality: ${character.personality_summary || 'no summary'}
- Current emotional state: ${emotionalState}
- What they're doing right now: ${microNarration || 'going about their day'}
- What's on their mind: ${lifeContext || 'nothing major'}
- Location: ${city || 'their area'}
- Current time: ${etNow} Eastern
${weather ? `- Weather: ${weather}` : ''}

RECENT CONVERSATION:
${recentText}

TASK:
Write a short narrative moment (1–3 sentences, STRICTLY third person) that:
- Reflects something authentic happening in ${character.name}'s life RIGHT NOW
- Fits naturally after the conversation above — like a scene cut or life update
- Is grounded and real — NOT dramatic, NOT poetic, NOT over-written
- Feels like something a friend would text between messages, or a quiet narrator note
- NEVER mentions the user or addresses them directly
- Can be about a small action (making coffee, checking their phone), a thought, something they noticed, or a shift in mood
- STRICTLY third person — use "${character.name}" or pronouns (he/she/they). NEVER "I", "me", "my"

Examples of good tone:
"${character.name} sets his phone down and just sits with it for a second."
"She finishes getting ready, grabs her keys, and heads out without looking back."
"He's been a little off all day — nothing specific, just one of those days."

Return ONLY the narrative text, nothing else.`;

        const narrativeContent = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });

        if (!narrativeContent?.trim()) continue;

        // Save as narrative message
        await base44.asServiceRole.entities.Message.create({
          conversation_id: convo.id,
          sender_type: 'character',
          character_id: character.id,
          character_name: character.name,
          content: narrativeContent.trim(),
          is_narrative: true,
          is_read: false,
          timestamp: now.toISOString(),
        });

        // Update conversation preview
        await base44.asServiceRole.entities.Conversation.update(convo.id, {
          last_message_preview: narrativeContent.trim().substring(0, 100),
          last_message_date: now.toISOString(),
        });

        results.push({ characterId: character.id, name: character.name, status: 'sent', narrative: narrativeContent.trim().substring(0, 80) });

      } catch (charErr) {
        results.push({ characterId: character.id, name: character.name, status: 'error', error: charErr.message });
      }
    }

    return Response.json({ success: true, results });

  } catch (error) {
    console.error('[triggerCharacterNarratives]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});