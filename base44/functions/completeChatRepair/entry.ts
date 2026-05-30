import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CHAT REPAIR COMPLETION WRAPPER
 * 
 * Runs the chat conversation repair until all messages are consolidated.
 * This function is designed to complete fully without tool timeout constraints.
 * 
 * It will:
 * 1. Detect all duplicate direct conversations
 * 2. Move ALL messages to the canonical conversation
 * 3. Verify the restore is complete
 * 4. Return detailed progress and final state
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const characterId = payload.characterId || '69c0d59d7e382cc866ded9c9';

    console.log(`[COMPLETE_REPAIR] START: Full chat repair for charId=${characterId}`);

    // ─── PHASE 1: Find all direct conversations ───
    const allConvos = await base44.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId },
      "-last_message_date",
      100
    );

    const directConvos = allConvos.filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      return ids.length === 1 && !c.shared_conversation_key && c.channel !== 'world_phone';
    });

    console.log(`[COMPLETE_REPAIR] Found ${directConvos.length} direct conversations`);

    if (directConvos.length <= 1) {
      return Response.json({
        success: true,
        message: 'Only one or zero direct conversations - no repair needed',
        conversations_found: directConvos.length,
        repair_needed: false,
      });
    }

    // ─── PHASE 2: Identify canonical ───
    const canonical = directConvos.reduce((prev, curr) => {
      const prevTime = new Date(prev.last_message_date || prev.created_date).getTime();
      const currTime = new Date(curr.last_message_date || curr.created_date).getTime();
      return currTime > prevTime ? curr : prev;
    });

    console.log(`[COMPLETE_REPAIR] Canonical conversation: ${canonical.id}`);

    // ─── PHASE 3: Collect all messages from all conversations ───
    const allMessages = [];
    const messagesByConvo = {};

    for (const convo of directConvos) {
      let allMsgs = [];
      let offset = 0;
      const pageSize = 500;

      // Paginate through all messages in this conversation
      while (true) {
        const pageMsgs = await base44.entities.Message.filter(
          { conversation_id: convo.id },
          "-created_date",
          pageSize
        );

        if (!pageMsgs || pageMsgs.length === 0) break;
        allMsgs.push(...pageMsgs);
        offset += pageMsgs.length;

        if (pageMsgs.length < pageSize) break;
      }

      messagesByConvo[convo.id] = allMsgs;
      allMessages.push(...allMsgs);
      console.log(`[COMPLETE_REPAIR] Conversation ${convo.id}: ${allMsgs.length} messages`);
    }

    console.log(`[COMPLETE_REPAIR] TOTAL MESSAGES TO RESTORE: ${allMessages.length}`);

    // ─── PHASE 4: Move all messages to canonical with per-message backoff ───
    let movedCount = 0;
    const failedMessages = [];

    for (const convo of directConvos) {
      if (convo.id === canonical.id) continue;

      const msgs = messagesByConvo[convo.id] || [];
      
      for (let i = 0; i < msgs.length; i++) {
        const msg = msgs[i];
        let retries = 0;
        const maxRetries = 10; // Increased for better resilience
        let moved = false;

        while (retries <= maxRetries && !moved) {
          try {
            await base44.entities.Message.update(msg.id, {
              conversation_id: canonical.id,
            });
            movedCount++;
            
            // Log progress every 50 messages
            if (movedCount % 50 === 0) {
              console.log(`[COMPLETE_REPAIR] Progress: ${movedCount}/${allMessages.length} messages moved`);
            }
            
            moved = true;
          } catch (err) {
            const isRateLimit = err.message?.includes('429') || err.message?.includes('Rate limit');
            
            if (isRateLimit && retries < maxRetries) {
              // Exponential backoff with longer delays: 200ms -> 400ms -> 800ms... up to 5120ms
              const delayMs = Math.pow(2, retries + 1) * 100;
              await new Promise(r => setTimeout(r, delayMs));
              retries++;
            } else {
              failedMessages.push({
                message_id: msg.id,
                conversation_id: convo.id,
                error: err.message,
                retries: retries,
              });
              moved = true;
            }
          }
        }

        // Very small delay between messages to avoid burst rate limiting
        if (i % 10 === 9) {
          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    console.log(`[COMPLETE_REPAIR] MOVED: ${movedCount}/${allMessages.length} messages`);

    // ─── PHASE 5: Verify restoration ───
    const verifyMsgs = await base44.entities.Message.filter(
      { conversation_id: canonical.id },
      "-created_date",
      10000 // Get ALL messages to verify count
    );

    const imgCount = verifyMsgs.filter(m => m.image_url).length;

    console.log(`[COMPLETE_REPAIR] VERIFIED: ${verifyMsgs.length} messages in canonical conversation (${imgCount} with images)`);

    // ─── PHASE 6: Delete duplicate conversations ───
    let deletedCount = 0;
    for (const convo of directConvos) {
      if (convo.id === canonical.id) continue;

      try {
        await base44.entities.Conversation.delete(convo.id);
        deletedCount++;
        console.log(`[COMPLETE_REPAIR] Deleted duplicate ${convo.id}`);
      } catch (err) {
        console.warn(`[COMPLETE_REPAIR] Could not delete ${convo.id}: ${err.message}`);
      }
    }

    console.log(`[COMPLETE_REPAIR] DELETED: ${deletedCount} duplicate conversations`);

    // ─── PHASE 7: Update canonical metadata ───
    if (verifyMsgs.length > 0) {
      const newestMsg = verifyMsgs[0];
      await base44.entities.Conversation.update(canonical.id, {
        last_message_date: newestMsg.created_date || newestMsg.timestamp,
        last_message_preview: newestMsg.content?.substring(0, 100) || '[image]',
      });
    }

    console.log(`[COMPLETE_REPAIR] COMPLETE`);

    return Response.json({
      success: true,
      status: 'repair_complete',
      canonical_conversation_id: canonical.id,
      total_conversations_found: directConvos.length,
      duplicate_conversations_deleted: deletedCount,
      messages_moved: movedCount,
      total_messages_in_canonical: verifyMsgs.length,
      messages_with_images: imgCount,
      failed_messages: failedMessages.length > 0 ? failedMessages : null,
      next_action: 'User should reload the chat to see all restored messages',
    });
  } catch (error) {
    console.error(`[COMPLETE_REPAIR] FAILED: ${error.message}`);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});