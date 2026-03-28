import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const BLOCKING_ACTIVITIES = ['showering', 'shower', 'swimming', 'swim', 'bathroom', 'sick', 'nausea', 'throwing up', 'vomiting', 'sleeping', 'sleep'];
const DAILY_MESSAGE_LIMIT = 3;

function isCharacterBlocked(character) {
  if (!character.current_activity) return false;
  const activity = character.current_activity.toLowerCase();
  return BLOCKING_ACTIVITIES.some(blocked => activity.includes(blocked));
}

function getDateKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId } = await req.json();

    if (!messageId) {
      return Response.json({ error: 'messageId required' }, { status: 400 });
    }

    const messages_result = await base44.entities.Message.filter({ id: messageId });
    const message = messages_result?.[0];
    if (!message || message.sender_type !== 'user') {
      return Response.json({ error: 'Invalid message' }, { status: 400 });
    }

    const convos = await base44.entities.Conversation.filter({ id: message.conversation_id });
    const conversation = convos?.[0];
    if (!conversation || conversation.type !== 'group') {
      return Response.json({ error: 'Invalid conversation' }, { status: 400 });
    }

    const characters = await base44.entities.Character.list();
    const convoCharacters = characters.filter(c =>
      conversation.character_ids?.includes(c.id)
    );

    const messages = await base44.entities.Message.filter(
      { conversation_id: conversation.id },
      'created_date',
      100
    );

    const today = getDateKey();
    const messageCountToday = {};

    for (const char of convoCharacters) {
      messageCountToday[char.id] = 0;
    }

    messages.forEach(msg => {
      if (msg.sender_type === 'character' && msg.timestamp) {
        const msgDate = new Date(msg.timestamp);
        const msgDateKey = `${msgDate.getUTCFullYear()}-${String(msgDate.getUTCMonth() + 1).padStart(2, '0')}-${String(msgDate.getUTCDate()).padStart(2, '0')}`;
        if (msgDateKey === today) {
          messageCountToday[msg.character_id] = (messageCountToday[msg.character_id] || 0) + 1;
        }
      }
    });

    for (const character of convoCharacters) {
      // Skip if character is blocked by activity
      if (isCharacterBlocked(character)) {
        continue;
      }

      // Skip if character hit daily message limit
      if (messageCountToday[character.id] >= DAILY_MESSAGE_LIMIT) {
        continue;
      }

      const uncomfortableStates = ['irritated', 'defensive', 'closed-off'];
      const isUncomfortable = uncomfortableStates.includes(character.emotional_state);
      const delayMs = isUncomfortable
        ? (60 + Math.random() * 60) * 1000
        : (5 + Math.random() * 55) * 1000;

      await new Promise(r => setTimeout(r, delayMs));

      const historyLines = messages
        .map(m => `${m.sender_type === 'user' ? 'User' : m.character_name}: ${m.content}`)
        .join('\n');

      const otherParticipants = convoCharacters
        .filter(c => c.id !== character.id)
        .map(c => c.name)
        .join(', ');

      const systemPrompt = character.system_prompt || `You are ${character.name}, a ${character.age_range || 'person'} year old ${character.gender}. ${character.personality_summary || ''} ${character.background_story || ''}`;

      const fullPrompt = `${systemPrompt}

YOU ARE IN A GROUP CHAT with: ${otherParticipants ? `the user and ${otherParticipants}` : 'just you and the user'}.
This is a real group conversation. You can — and should — speak to the other characters directly, not just the user. Address them by name. React to what they said. Disagree, agree, laugh, clap back. You are all real people having a conversation together. The user is not the only one you talk to in here.

Your current emotional state: ${character.emotional_state || 'calm'}.
Your current life situation: ${character.current_situation || ''}.
${character.current_life_event ? `What is on your mind right now: ${character.current_life_event}` : ''}

Group conversation so far:
${historyLines}

Write ONLY your next reply as ${character.name}. Do NOT include your name as a label. Keep it natural, short, and in your character's voice.
- React to whoever just spoke — the user OR another character.
- Do NOT end with a question every time. Sometimes just say what you think and stop.
- You have your own life and opinions. Share them. You are not just reacting — you are participating.
- Do NOT assume or reference anything about the user's family unless they've told you directly in this conversation.`;

      let responseText = '';
      try {
        const response = await base44.integrations.Core.InvokeLLM({ 
          prompt: fullPrompt,
          add_context_from_internet: false 
        });
        responseText = (response || '').replace(/^[\w\s]+:\s*/i, '').trim();
        if (!responseText) continue;
      } catch (err) {
        continue;
      }

      await base44.entities.Message.create({
        conversation_id: conversation.id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: responseText,
        emotional_state: character.emotional_state || 'calm',
        timestamp: new Date().toISOString(),
      });

      messageCountToday[character.id]++;
    }

    await base44.entities.Conversation.update(conversation.id, {
      last_message_date: new Date().toISOString(),
    });

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});