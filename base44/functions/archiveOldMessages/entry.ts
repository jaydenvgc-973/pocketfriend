import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { conversationId, keepRecent, isProtected } = body;

    if (!conversationId) {
      return Response.json({ error: 'conversationId required' }, { status: 400 });
    }

    // Fetch conversation to get character_id and check if protected
    const conversation = await base44.entities.Conversation.filter(
      { id: conversationId },
      "-created_date",
      1
    ).then(arr => arr?.[0]);

    if (!conversation) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Get user settings to check if character is protected
    const userSettings = await base44.entities.UserSettings.filter(
      { created_by: user.email },
      "-created_date",
      1
    ).then(arr => arr?.[0]) || {};

    const characterId = conversation.character_ids?.[0];
    const charIsProtected = characterId && (userSettings.protected_character_ids || []).includes(characterId);

    // Use passed-in isProtected if provided, otherwise calculate
    const protectedStatus = isProtected !== undefined ? isProtected : charIsProtected;
    
    // Protected characters: keep more messages in buffer (50 vs 30)
    const keepCount = parseInt(keepRecent || (protectedStatus ? "50" : "30"));

    // Fetch all messages in conversation
    const allMessages = await base44.entities.Message.filter(
      { conversation_id: conversationId },
      "-created_date",
      1000
    );

    // CRITICAL: Never archive messages from today (in user's timezone America/New_York)
    // Today's messages are always protected and stay visible immediately
    // Calculate midnight of today in America/New_York timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      timeZone: 'America/New_York' 
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year').value;
    const month = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    const todayStart = new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString();
    
    let messagesToArchive = [];
    
    // Only consider archiving messages older than today
    const archiveableMessages = allMessages.filter(m => 
      !m.archived_date && 
      m.created_date < todayStart
    );
    
    // Archive only if we exceed keepCount AND have old messages available
    if (archiveableMessages.length > 0 && allMessages.length > keepCount) {
      messagesToArchive = archiveableMessages.slice(0, allMessages.length - keepCount);
    }

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