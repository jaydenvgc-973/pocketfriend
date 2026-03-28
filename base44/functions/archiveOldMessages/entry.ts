import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { conversationId, keepRecent } = body;

    if (!conversationId) {
      return Response.json({ error: 'conversationId required' }, { status: 400 });
    }

    const keepCount = parseInt(keepRecent || "50");

    // Fetch all messages in conversation
    const allMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      "-created_date",
      1000
    );

    if (!allMessages || allMessages.length <= keepCount) {
      return Response.json({ 
        success: true, 
        archived: 0,
        message: `Conversation has ${allMessages?.length || 0} messages, keeping ${keepCount}. No archival needed.`
      });
    }

    // Messages beyond keepCount are candidates for archival
    const messagesToArchive = allMessages.slice(keepCount);
    
    // Filter to only messages not yet archived
    const notYetArchived = messagesToArchive.filter(m => !m.archived_date);

    if (notYetArchived.length === 0) {
      return Response.json({ 
        success: true, 
        archived: 0,
        message: 'All old messages already archived'
      });
    }

    // Mark older messages as archived (set archived_date timestamp)
    const archiveDate = new Date().toISOString();
    let archivedCount = 0;

    for (const msg of notYetArchived) {
      try {
        await base44.entities.Message.update(msg.id, { archived_date: archiveDate });
        archivedCount++;
      } catch (e) {
        // Continue on individual message failures
      }
    }

    return Response.json({
      success: true,
      archived: archivedCount,
      total: allMessages.length,
      retained: keepCount
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});