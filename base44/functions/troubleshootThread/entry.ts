import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId, characterId } = await req.json();
    
    if (!conversationId || !characterId) {
      return Response.json({ error: 'Missing conversationId or characterId' }, { status: 400 });
    }

    const results = {
      timestamp: new Date().toISOString(),
      checks: [],
      fixes_applied: [],
      summary: '',
    };

    // CHECK 1: Thread load check
    const conversation = await base44.entities.Conversation.filter({ id: conversationId });
    if (conversation.length === 0) {
      results.checks.push({
        name: 'Thread Load',
        status: 'failed',
        message: 'Conversation not found in database',
      });
    } else {
      const convo = conversation[0];
      const isCorrectType = convo.character_ids?.includes(characterId);
      results.checks.push({
        name: 'Thread Load',
        status: isCorrectType ? 'passed' : 'failed',
        message: isCorrectType 
          ? `Thread loaded correctly (type: ${convo.type})` 
          : 'Character not linked to this conversation',
      });
    }

    // CHECK 2: Message presence
    const allMessages = await base44.entities.Message.filter({ conversation_id: conversationId });
    const characterMessages = allMessages.filter(m => m.sender_type === 'character' && m.character_id === characterId);
    
    results.checks.push({
      name: 'Message Presence',
      status: allMessages.length > 0 ? 'passed' : 'warning',
      message: `Total messages: ${allMessages.length} | Character messages: ${characterMessages.length}`,
    });

    // CHECK 3: Message render (check for archived/hidden)
    const visibleMessages = allMessages.filter(m => !m.archived_date);
    results.checks.push({
      name: 'Message Visibility',
      status: visibleMessages.length > 0 ? 'passed' : 'warning',
      message: `Visible messages: ${visibleMessages.length} | Archived: ${allMessages.length - visibleMessages.length}`,
    });

    // CHECK 4: Unread state
    const unreadCharMessages = allMessages.filter(m => m.sender_type === 'character' && !m.is_read);
    results.checks.push({
      name: 'Unread State',
      status: unreadCharMessages.length === 0 ? 'passed' : 'warning',
      message: `Unread character messages: ${unreadCharMessages.length}`,
    });

    // CHECK 5: Pending messages
    const pendingMessages = await base44.entities.PendingMessage.filter({ character_id: characterId, delivered: false });
    if (pendingMessages.length > 0) {
      results.checks.push({
        name: 'Pending Messages',
        status: 'warning',
        message: `${pendingMessages.length} pending messages waiting to be delivered`,
      });
    } else {
      results.checks.push({
        name: 'Pending Messages',
        status: 'passed',
        message: 'No stuck pending messages',
      });
    }

    // CHECK 6: Media integrity
    const imageMessages = allMessages.filter(m => m.image_url);
    results.checks.push({
      name: 'Media References',
      status: imageMessages.length > 0 ? 'passed' : 'info',
      message: `Image messages found: ${imageMessages.length}`,
    });

    // CHECK 7: Protected character check
    const PROTECTED_CHARACTER_IDS = ['69c0d59d7e382cc866ded9c9'];
    const isProtected = PROTECTED_CHARACTER_IDS.includes(characterId);
    if (isProtected) {
      results.checks.push({
        name: 'Protected Character Status',
        status: 'passed',
        message: 'Protected character logic active - full message history should be loaded',
      });
    }

    // AUTO-FIX: Mark unread messages as read
    if (unreadCharMessages.length > 0) {
      for (const msg of unreadCharMessages) {
        await base44.entities.Message.update(msg.id, { is_read: true });
      }
      results.fixes_applied.push(`Marked ${unreadCharMessages.length} unread messages as read`);
    }

    // AUTO-FIX: Deliver pending messages
    if (pendingMessages.length > 0) {
      for (const pm of pendingMessages) {
        const charMsg = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: pm.character_name || 'Character',
          content: pm.content,
          image_url: pm.image_url || undefined,
          emotional_state: pm.emotional_state || 'calm',
          timestamp: new Date().toISOString(),
        });
        await base44.entities.PendingMessage.update(pm.id, { delivered: true });
      }
      results.fixes_applied.push(`Delivered ${pendingMessages.length} pending messages`);
    }

    // AUTO-FIX: Recover archived messages if no visible messages exist
    if (visibleMessages.length === 0 && allMessages.length > 0) {
      const archivedMsgs = allMessages.filter(m => m.archived_date);
      for (const msg of archivedMsgs) {
        await base44.entities.Message.update(msg.id, { archived_date: null });
      }
      results.fixes_applied.push(`Unarchived ${archivedMsgs.length} messages to restore visibility`);
    }

    // Generate summary
    const failedChecks = results.checks.filter(c => c.status === 'failed').length;
    const warningChecks = results.checks.filter(c => c.status === 'warning').length;
    
    if (failedChecks === 0 && warningChecks === 0) {
      results.summary = 'Thread is healthy - no issues detected';
    } else if (results.fixes_applied.length > 0) {
      results.summary = `Issues found and fixed: ${results.fixes_applied.join(', ')}`;
    } else {
      results.summary = `${failedChecks} critical issue(s), ${warningChecks} warning(s) found - review detailed results`;
    }

    return Response.json({
      success: true,
      data: results,
    });
  } catch (error) {
    console.error('[troubleshootThread] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});