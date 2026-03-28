import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * PHASE 4: MESSAGE LIMIT REINTRODUCTION
 * 
 * Correct behavior:
 * - Per-character-thread limit: 20 visible messages
 * - Protected characters (e.g., Ethan): 50 visible messages
 * - NEW messages ALWAYS allowed, never blocked
 * - Trimming happens AFTER message is saved and in memory
 * - Only oldest visible message removed when over limit
 * - Removed messages archived (not deleted)
 * - Media grid unaffected
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { conversationId, characterId } = body;

    if (!conversationId || !characterId) {
      return Response.json({ error: 'conversationId and characterId required' }, { status: 400 });
    }

    // Get user settings to check if character is protected
    const userSettings = await base44.entities.UserSettings.filter(
      { created_by: user.email },
      "-created_date",
      1
    ).then(arr => arr?.[0]) || {};

    const isProtected = (userSettings.protected_character_ids || []).includes(characterId);
    const messageLimit = isProtected ? 50 : 20;

    // Fetch all visible (non-archived) messages in conversation
    const allMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId, archived_date: { $exists: false } },
      "-created_date",
      100
    );

    // If under limit, nothing to trim
    if (allMessages.length <= messageLimit) {
      return Response.json({
        success: true,
        trimmed: 0,
        totalVisible: allMessages.length,
        limit: messageLimit
      });
    }

    // Trim oldest message (move to archived state)
    const oldestMsg = allMessages[allMessages.length - 1];
    const archiveDate = new Date().toISOString();

    try {
      await base44.entities.Message.update(oldestMsg.id, { archived_date: archiveDate });
    } catch (e) {
      console.error('Failed to archive oldest message:', e.message);
    }

    return Response.json({
      success: true,
      trimmed: 1,
      totalVisible: allMessages.length - 1,
      limit: messageLimit,
      archivedMessageId: oldestMsg.id
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});