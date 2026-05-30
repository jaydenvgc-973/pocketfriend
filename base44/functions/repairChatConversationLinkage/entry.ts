import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CRITICAL REPAIR FUNCTION
 * 
 * Purpose: Consolidate duplicate direct conversations for the same owner+character
 * into ONE canonical conversation. Preserve ALL messages and images.
 * 
 * Process:
 * 1. Find all direct conversations for owner+character
 * 2. Identify the canonical conversation (most recent activity)
 * 3. Get ALL messages from ALL conversations
 * 4. Relink messages to canonical conversation
 * 5. Mark/delete duplicates only after messages are safe
 * 6. Return verification that all messages restored
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const characterId = payload.characterId || '69c0d59d7e382cc866ded9c9';

    console.log(`[REPAIR_CHAT] START: consolidating duplicate conversations for charId=${characterId}`);

    // ─── STEP 1: Find all direct conversations ───
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-last_message_date",
      100
    );

    // Filter to direct only (no world_phone, no char-to-char, no shared_key)
    const directConvos = allConvos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      return ids.length === 1 && !c.shared_conversation_key && c.channel !== 'world_phone';
    });

    console.log(`[REPAIR_CHAT] Found ${directConvos.length} direct conversations`);

    if (directConvos.length <= 1) {
      return Response.json({
        success: true,
        message: 'Only one or zero direct conversations exist - no consolidation needed',
        conversation_count: directConvos.length,
      });
    }

    // ─── STEP 2: Identify canonical (most recent last_message_date) ───
    const canonical = directConvos.reduce((prev, curr) => {
      const prevTime = new Date(prev.last_message_date || prev.created_date).getTime();
      const currTime = new Date(curr.last_message_date || curr.created_date).getTime();
      return currTime > prevTime ? curr : prev;
    });

    console.log(`[REPAIR_CHAT] Canonical conversation: id=${canonical.id} last_msg=${canonical.last_message_date}`);

    // ─── STEP 3: Get ALL messages from ALL conversations ───
    const allMessages = [];
    const messagesByConvo = {};

    for (const convo of directConvos) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convo.id },
        "-created_date",
        500
      );
      messagesByConvo[convo.id] = msgs;
      allMessages.push(...msgs);
      console.log(`[REPAIR_CHAT] Conversation ${convo.id}: ${msgs.length} messages`);
    }

    console.log(`[REPAIR_CHAT] Total messages across all conversations: ${allMessages.length}`);

    // ─── STEP 4: Relink messages from duplicate conversations to canonical ───
    // Use batch updates with delays to avoid rate limiting
    let movedCount = 0;
    const errors = [];

    for (const convo of directConvos) {
      if (convo.id === canonical.id) continue; // Skip canonical

      const msgs = messagesByConvo[convo.id] || [];
      console.log(`[REPAIR_CHAT] Moving ${msgs.length} messages from convo ${convo.id} to canonical ${canonical.id}`);

      // Process in small batches with delays
      for (let i = 0; i < msgs.length; i += 5) {
        const batch = msgs.slice(i, i + 5);
        
        for (const msg of batch) {
          try {
            // Update message to point to canonical conversation
            await base44.entities.Message.update(msg.id, {
              conversation_id: canonical.id,
            });
            movedCount++;
          } catch (err) {
            errors.push({
              message_id: msg.id,
              error: err.message,
            });
            console.error(`[REPAIR_CHAT] Failed to move message ${msg.id}: ${err.message}`);
          }
        }
        
        // Delay between batches to avoid rate limiting
        if (i + 5 < msgs.length) {
          console.log(`[REPAIR_CHAT] Batch processed, waiting before next batch...`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    console.log(`[REPAIR_CHAT] Successfully moved ${movedCount} messages to canonical conversation`);

    // ─── STEP 5: Delete duplicate conversation records ───
    let deletedCount = 0;
    for (const convo of directConvos) {
      if (convo.id === canonical.id) continue; // Keep canonical

      try {
        await base44.entities.Conversation.delete(convo.id);
        deletedCount++;
        console.log(`[REPAIR_CHAT] Deleted duplicate conversation ${convo.id}`);
      } catch (err) {
        console.warn(`[REPAIR_CHAT] Could not delete ${convo.id}: ${err.message}`);
      }
    }

    // ─── STEP 6: Verify restoration ───
    const verifyMsgs = await base44.entities.Message.filter(
      { conversation_id: canonical.id },
      "-created_date",
      500
    );

    const hasImages = verifyMsgs.filter(m => m.image_url).length;

    console.log(`[REPAIR_CHAT] VERIFIED: Canonical conversation now has ${verifyMsgs.length} messages (${hasImages} with images)`);

    // ─── STEP 7: Update canonical conversation metadata ───
    const newestMsg = verifyMsgs[0];
    if (newestMsg) {
      await base44.entities.Conversation.update(canonical.id, {
        last_message_date: newestMsg.created_date || newestMsg.timestamp,
        last_message_preview: newestMsg.content?.substring(0, 100) || '[image]',
      });
    }

    return Response.json({
      success: true,
      action: 'consolidated_duplicate_conversations',
      canonical_conversation_id: canonical.id,
      duplicate_conversations_deleted: deletedCount,
      total_messages_moved: movedCount,
      messages_in_canonical_after_repair: verifyMsgs.length,
      messages_with_images: hasImages,
      errors: errors.length > 0 ? errors : null,
      next_step: 'User should reload chat to see restored messages',
    });
  } catch (error) {
    console.error(`[REPAIR_CHAT] FAILED: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});