import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { conversationId, keepRecent = 50 } = body;

    if (!conversationId) {
      return Response.json({ error: 'conversationId required' }, { status: 400 });
    }

    // Fetch all messages for this conversation, sorted by creation date
    const allMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      "-created_date",
      1000
    );

    if (!allMessages || allMessages.length <= keepRecent) {
      return Response.json({ 
        success: true, 
        archived: 0, 
        message: 'No messages to archive' 
      });
    }

    // Mark older messages as archived (add archive_date, keep them in DB)
    const toArchive = allMessages.slice(keepRecent);
    let archivedCount = 0;

    for (const msg of toArchive) {
      try {
        // Mark message as archived without deleting it
        await base44.entities.Message.update(msg.id, {
          archived_date: new Date().toISOString()
        }).catch(() => {});
        archivedCount++;
      } catch (e) {
        // Continue even if individual archive fails
      }
    }

    return Response.json({
      success: true,
      archived: archivedCount,
      totalMessages: allMessages.length,
      visibleMessages: keepRecent
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});