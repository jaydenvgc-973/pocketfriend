import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
// Old direct conversation (has the bulk of history)
const OLD_CONVO_ID = '69c0d5a7e269fe0f4e917ab6';
// Current direct conversation (what the chat page uses)
const CURRENT_CONVO_ID = '69c873d9627e2d2f732dc4b2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    // startOffset allows running in chunks to avoid rate limits
    const startOffset = body?.startOffset || 0;
    const chunkSize = body?.chunkSize || 100;

    // Fetch all messages from the OLD conversation
    let allOldMessages = [];
    let skip = 0;
    const limit = 200;

    while (true) {
      const batch = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: OLD_CONVO_ID },
        'created_date',
        limit,
        skip
      );
      if (!batch || batch.length === 0) break;
      allOldMessages = [...allOldMessages, ...batch];
      if (batch.length < limit) break;
      skip += limit;
    }

    console.log(`Found ${allOldMessages.length} messages in old conversation`);

    // Fetch ALL existing messages in the CURRENT conversation (paginated) to build dedup sets
    let allCurrentMsgs = [];
    let cSkip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: CURRENT_CONVO_ID },
        'created_date',
        200,
        cSkip
      );
      if (!batch || batch.length === 0) break;
      allCurrentMsgs = [...allCurrentMsgs, ...batch];
      if (batch.length < 200) break;
      cSkip += 200;
      await new Promise(r => setTimeout(r, 200));
    }

    const existingTimestamps = new Set(allCurrentMsgs.map(m => m.timestamp || m.created_date?.toString()));
    const existingContents = new Set(allCurrentMsgs.map(m => `${m.sender_type}:${typeof m.content === 'string' ? m.content.substring(0, 50) : ''}`));

    console.log(`Current conversation has ${allCurrentMsgs.length} messages`);

    // Identify messages to move (skip duplicates first)
    const allToMove = [];
    for (const msg of allOldMessages) {
      const tsKey = msg.timestamp || msg.created_date?.toString();
      const contentKey = `${msg.sender_type}:${typeof msg.content === 'string' ? msg.content.substring(0, 50) : ''}`;
      if (existingTimestamps.has(tsKey) || existingContents.has(contentKey)) continue;
      allToMove.push(msg);
      existingTimestamps.add(tsKey);
      existingContents.add(contentKey);
    }

    // Process only a chunk at a time to avoid rate limits
    const toMove = allToMove.slice(startOffset, startOffset + chunkSize);
    const remaining = allToMove.length - startOffset - toMove.length;

    console.log(`Total eligible: ${allToMove.length}, processing chunk [${startOffset}..${startOffset + toMove.length}], remaining after: ${remaining}`);

    // Sequential updates with retry to avoid rate limits
    let moved = 0;
    for (const msg of toMove) {
      let retries = 3;
      while (retries > 0) {
        try {
          await base44.asServiceRole.entities.Message.update(msg.id, { conversation_id: CURRENT_CONVO_ID });
          moved++;
          break;
        } catch (err) {
          if (err?.status === 429 || err?.message?.includes('Rate limit')) {
            retries--;
            await new Promise(r => setTimeout(r, 1500));
          } else {
            throw err;
          }
        }
      }
      await new Promise(r => setTimeout(r, 150));
    }
    const skipped = allOldMessages.length - allToMove.length;

    // Update the current conversation's last_message_date to reflect the oldest message now included
    const allMessages = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: CURRENT_CONVO_ID },
      'created_date',
      1
    );
    const oldestMsg = allMessages[0];

    console.log(`Moved: ${moved}, Skipped (duplicates): ${skipped}`);

    return Response.json({
      success: true,
      oldConversationId: OLD_CONVO_ID,
      currentConversationId: CURRENT_CONVO_ID,
      oldMessageCount: allOldMessages.length,
      totalEligible: allToMove.length,
      movedThisRun: moved,
      skippedDuplicates: skipped,
      remaining,
      nextOffset: remaining > 0 ? startOffset + moved : null,
      totalInCurrentConvo: allCurrentMsgs.length + moved,
    });

  } catch (error) {
    console.error('recoverEthanMessages error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});