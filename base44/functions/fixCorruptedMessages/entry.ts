import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const CONVO_ID = '69c873d9627e2d2f732dc4b2';

  // Get payload to allow pagination offset
  let body = {};
  try { body = await req.json(); } catch (_) {}
  const offset = body.offset || 0;
  const batchSize = 80;

  // Fetch a batch of messages
  const allMessages = await base44.asServiceRole.entities.Message.filter(
    { conversation_id: CONVO_ID },
    '-created_date',
    batchSize,
    offset
  );

  let fixedCount = 0;
  let deletedCount = 0;
  const errors = [];

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  let opCount = 0;
  for (const msg of allMessages) {
    const content = msg.content;

    // Rate limit: pause every 20 ops
    if (opCount > 0 && opCount % 20 === 0) {
      await sleep(1500);
    }

    // Case 1: content is corrupted object (from the failed $replace op)
    if (content !== null && typeof content === 'object') {
      try {
        await base44.asServiceRole.entities.Message.delete(msg.id);
        deletedCount++;
        opCount++;
      } catch (e) {
        errors.push(`Delete failed for ${msg.id}: ${e.message}`);
      }
      continue;
    }

    // Case 2: content is a string containing "Mark" — replace with "Jayden"
    if (typeof content === 'string' && /\bMark\b/.test(content)) {
      const fixed = content.replace(/\bMark\b/g, 'Jayden');
      try {
        await base44.asServiceRole.entities.Message.update(msg.id, { content: fixed });
        fixedCount++;
        opCount++;
      } catch (e) {
        errors.push(`Update failed for ${msg.id}: ${e.message}`);
      }
    }
  }

  return Response.json({
    success: true,
    offset,
    batchSize,
    totalScanned: allMessages.length,
    deletedCorrupted: deletedCount,
    fixedMarkReferences: fixedCount,
    hasMore: allMessages.length === batchSize,
    nextOffset: offset + allMessages.length,
    errors: errors.slice(0, 10),
  });
});