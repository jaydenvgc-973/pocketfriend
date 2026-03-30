import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Submit character action and/or dialogue as separate messages.
 * 
 * This is the core submission flow that ensures:
 * 1. Actions are stored as narrative entries (is_narrative: true)
 * 2. Dialogue is stored as dialogue messages (is_narrative: false)
 * 3. Actions always come before dialogue when both exist
 * 4. Both use the existing Message entity
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      characterId,
      characterName,
      conversationId,
      action,
      dialogue,
      emotionalState = 'calm',
      isAutonomous = false,
    } = await req.json();

    if (!characterId || !conversationId) {
      return Response.json({ error: 'characterId and conversationId required' }, { status: 400 });
    }

    // Validate content
    const actionValid = action && typeof action === 'string' && action.trim().length > 5;
    const dialogueValid = dialogue && typeof dialogue === 'string' && dialogue.trim().length > 3 && !/^\.+$/.test(dialogue.trim());

    if (!actionValid && !dialogueValid) {
      return Response.json({ error: 'action and/or dialogue required with valid content' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const createdMessages = [];

    // STEP 1: Submit action as narrative entry (if exists)
    if (actionValid) {
      const actionMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: characterName,
        content: action.trim(),
        emotional_state: emotionalState,
        is_narrative: true,
        timestamp,
      });
      createdMessages.push(actionMsg);
    }

    // STEP 2: Submit dialogue as normal message (if exists)
    if (dialogueValid) {
      const dialogueMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: characterName,
        content: dialogue.trim(),
        emotional_state: emotionalState,
        is_narrative: false,
        timestamp: new Date(new Date(timestamp).getTime() + 100).toISOString(), // slight delay for ordering
      });
      createdMessages.push(dialogueMsg);
    }

    // Update conversation timestamps
    if (createdMessages.length > 0) {
      const lastMsg = createdMessages[createdMessages.length - 1];
      await base44.entities.Conversation.update(conversationId, {
        last_message_preview: dialogue?.trim() || action?.trim().substring(0, 100),
        last_message_date: lastMsg.timestamp,
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      messages: createdMessages,
      actionId: createdMessages.find(m => m.is_narrative)?.id || null,
      dialogueId: createdMessages.find(m => !m.is_narrative)?.id || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});