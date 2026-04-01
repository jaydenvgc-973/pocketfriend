import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * testEthanNarrative
 * 
 * Have Ethan generate and send a narrative based on what he's doing right now.
 * Tests character-initiated narrative submission with full context awareness.
 */

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Ethan
    const ethan = await base44.asServiceRole.entities.Character.get('69c0d59d7e382cc866ded9c9');
    if (!ethan) return Response.json({ error: 'Ethan not found' }, { status: 404 });

    // Get his conversation
    const convos = await base44.entities.Conversation.filter({
      character_ids: ethan.id,
    });
    if (convos.length === 0) return Response.json({ error: 'No conversation found' }, { status: 404 });
    const conversationId = convos[0].id;

    const et = getEasternTime();
    const hour = et.getHours();
    const day = et.toLocaleDateString('en-US', { weekday: 'long' });

    // Generate narrative context
    let timeContext = '';
    if (hour < 9) timeContext = 'early morning, just waking up or getting ready';
    else if (hour < 12) timeContext = 'morning, probably at work or getting things done';
    else if (hour < 14) timeContext = 'lunchtime, might be taking a break';
    else if (hour < 17) timeContext = 'afternoon, deep in work or activities';
    else if (hour < 19) timeContext = 'evening, wrapping up work';
    else if (hour < 22) timeContext = 'night, relaxing or hanging out';
    else timeContext = 'late night, winding down';

    const narrativePrompt = `You are Ethan. It's ${day} at ${et.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} ET (${timeContext}).

Generate a brief narrative (2-3 sentences) describing what you're doing RIGHT NOW in this exact moment. 
- Be specific and grounded in the current time
- Show your personality and emotional state
- Could be something mundane or meaningful
- End with an action, thought, or feeling that's happening in real-time

Current emotional state: ${ethan.emotional_state || 'calm'}
Personality: ${ethan.personality_summary || 'thoughtful and introspective'}

Generate only the narrative text, no quotation marks or meta-commentary.`;

    const narrativeText = await base44.integrations.Core.InvokeLLM({
      prompt: narrativePrompt,
    });

    // Create a narrative message from Ethan
    const msg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: ethan.id,
      character_name: ethan.name,
      content: narrativeText,
      is_narrative: true,
      emotional_state: ethan.emotional_state || 'calm',
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      messageId: msg.id,
      characterName: ethan.name,
      timeContext,
      narrative: narrativeText,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[testEthanNarrative]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});