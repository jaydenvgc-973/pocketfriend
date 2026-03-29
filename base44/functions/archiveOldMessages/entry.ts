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

    // PROTECTED CHARACTER: Never archive Ethan's conversations
    const ETHAN_CHARACTER_ID = '69c0d59d7e382cc866ded9c9';
    const ETHAN_CONVERSATION_IDS = [
      '69c0d5a7e269fe0f4e917ab6', // main direct chat
      '69c0e3456895176175365657', // phone chat
      '69c873d9627e2d2f732dc4b2', // second direct chat
      '69c852bd41aa232960967ce0', // group chat
      '69c7daa7865ac7c2f35fa875', // Lila & Ethan group
      '69c7a44325108f819a49ce5e', // NPC/Mace chat
      '69c6076b71939c9ac942ea6e', // James & Ethan group
      '69c0ff7467e7bc3499496c1f', // Matt & Ethan group
    ];
    if (ETHAN_CONVERSATION_IDS.includes(conversationId)) {
      return Response.json({ success: true, archived: 0, message: 'Protected character — archiving skipped' });
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