import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * sendProactiveMessageForCharacter
 * 
 * Sends a single proactive message from a character.
 * Designed to be called individually per character to avoid rate limits.
 */

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTimeMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinWorkHours(char) {
  if (!char.work_start_time || !char.work_end_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1]);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1]);
  return now >= start && now <= end;
}

function isSleepTime(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1]);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1]);
  
  if (sleep > wake) {
    return now >= sleep || now <= wake;
  }
  return now >= sleep && now <= wake;
}

function shouldMessageNow(char, relationshipLevel) {
  const et = getEasternTime();
  const hour = et.getHours();
  
  if (isSleepTime(char)) return false;
  if (relationshipLevel >= 80) return true;
  if (relationshipLevel >= 60) {
    if (isWithinWorkHours(char) && hour !== 12) return false;
    return true;
  }
  if (relationshipLevel >= 40) {
    if (isWithinWorkHours(char)) return false;
    return true;
  }
  if (isWithinWorkHours(char)) return false;
  if (hour >= 22 || hour <= 7) return false;
  return true;
}

async function getRecentConversationContext(base44, characterId) {
  const convos = await base44.entities.Conversation.filter({
    character_ids: characterId,
  });
  
  if (convos.length === 0) return null;
  
  const messages = await base44.entities.Message.filter(
    { conversation_id: convos[0].id },
    '-timestamp',
    5
  );
  
  if (messages.length === 0) return null;
  
  const recentTopics = messages
    .map(m => m.content)
    .slice(0, 3)
    .join(' | ');
  
  return recentTopics;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const char = await base44.asServiceRole.entities.Character.get(characterId);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // Check daily limit
    const todaysConvo = await base44.entities.Conversation.filter({
      character_ids: char.id,
    });

    if (todaysConvo.length > 0) {
      const todaysMessages = await base44.entities.Message.filter({
        conversation_id: todaysConvo[0].id,
        sender_type: 'character',
      });

      const todayCount = todaysMessages.filter(m => 
        m.created_date?.startsWith(today)
      ).length;

      if (todayCount >= 7) {
        return Response.json({
          success: false,
          reason: '7 messages already sent today',
        });
      }
    }

    // Check if appropriate time
    const relationshipLevel = char.friendship_level || 50;
    if (!shouldMessageNow(char, relationshipLevel)) {
      return Response.json({
        success: false,
        reason: 'not the right time to message',
      });
    }

    // Get context and generate
    const recentContext = await getRecentConversationContext(base44, char.id);
    const et = getEasternTime();
    const hour = et.getHours();
    
    let timeContext = '';
    if (hour >= 7 && hour < 9) timeContext = 'morning (good morning message)';
    else if (hour >= 12 && hour < 13) timeContext = 'lunch break';
    else if (hour >= 18 && hour < 20) timeContext = 'evening';
    else if (hour >= 21 && hour < 23) timeContext = 'late night (good night message)';

    const systemPrompt = `You are ${char.name}. Generate a natural, spontaneous proactive message to the user right now (1-3 sentences).
${recentContext ? `Recent conversation context: "${recentContext}". Follow up on what you were discussing or reference it naturally.` : 'Start a new topic about what you are doing or feeling.'}
Time context: ${timeContext}
Personality: ${char.personality_summary || 'friendly and thoughtful'}
Friendship level: ${relationshipLevel}/100 - adjust tone accordingly (higher = more casual/frequent, lower = more respectful).
WRITING STYLE — NON-NEGOTIABLE:
- Write like a real person texting. No theatrical or literary language.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ). Use commas or periods instead.
- Keep it short, direct, and human.
Be authentic, not overly cheerful.`;

    const messageContent = await base44.integrations.Core.InvokeLLM({
      prompt: systemPrompt,
    });

    // Find or create conversation
    const convos = await base44.entities.Conversation.filter({
      type: 'direct',
      character_ids: char.id,
    });

    let conversationId;
    if (convos.length > 0) {
      conversationId = convos[0].id;
    } else {
      const newConvo = await base44.entities.Conversation.create({
        title: char.name,
        type: 'direct',
        character_ids: [char.id],
      });
      conversationId = newConvo.id;
    }

    // Create message
    const msg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: char.id,
      character_name: char.name,
      content: messageContent,
      emotional_state: char.emotional_state || 'calm',
      timestamp: now.toISOString(),
    });

    return Response.json({
      success: true,
      messageId: msg.id,
      characterName: char.name,
      content: messageContent,
    });
  } catch (error) {
    console.error('[sendProactiveMessageForCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});