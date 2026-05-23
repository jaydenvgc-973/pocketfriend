/**
 * diagnosePaginationCollapse
 *
 * Diagnoses why only 18 images are found in 200 messages:
 * 1. How many total messages exist across all conversations?
 * 2. How many messages have image_url?
 * 3. Is the $in filter with many conversation IDs truncating results?
 * 4. Does the compound cursor skip batches incorrectly?
 * 5. What is the actual image distribution across messages?
 *
 * DIAGNOSTIC ONLY — no writes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    const conversations = await base44.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date', 500
    );
    const conversationIds = (conversations || []).map(c => c.id).filter(Boolean);
    console.log(`[diagnosePaginationCollapse] ${conversationIds.length} conversations`);

    // Step 1: How many total messages in a single batch of 200?
    const batch1 = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: { $in: conversationIds } },
      '-created_date',
      200
    );
    const imagesInBatch1 = (batch1 || []).filter(m => m.image_url && !m.recovery_signal);

    console.log(`[diagnosePaginationCollapse] Batch1: ${batch1?.length} msgs, ${imagesInBatch1.length} images`);

    // Step 2: Is batch returning less than 200? If so, $in limit may be the issue.
    const batchActualCount = batch1?.length || 0;

    // Step 3: Try querying individual conversations to count total messages
    let totalMessageCount = 0;
    let totalImageCount = 0;
    const convoSamples = [];

    for (const convoId of conversationIds.slice(0, 10)) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convoId },
        '-created_date',
        200
      );
      const imgs = (msgs || []).filter(m => m.image_url && !m.recovery_signal);
      totalMessageCount += msgs?.length || 0;
      totalImageCount += imgs.length;
      if (imgs.length > 0) {
        convoSamples.push({ convo_id: convoId, msg_count: msgs?.length, image_count: imgs.length });
      }
    }

    // Step 4: Does $in with many IDs (169) limit results?
    // Try with just 10 IDs vs all IDs
    const batch_10ids = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: { $in: conversationIds.slice(0, 10) } },
      '-created_date',
      200
    );

    const batch_50ids = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: { $in: conversationIds.slice(0, 50) } },
      '-created_date',
      200
    );

    // Step 5: Check if there are more than 200 messages total
    let cumulativeCount = 0;
    for (let offset = 0; offset < 5000; offset += 200) {
      const b = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        '-created_date',
        200,
        offset
      );
      if (!b || b.length === 0) break;
      cumulativeCount += b.length;
      if (b.length < 200) break;
    }

    // Step 6: Count total images across ALL messages using offset pagination
    let totalImagesViaOffset = 0;
    for (let offset = 0; offset < 50000; offset += 200) {
      const b = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        '-created_date',
        200,
        offset
      );
      if (!b || b.length === 0) break;
      totalImagesViaOffset += b.filter(m => m.image_url && !m.recovery_signal).length;
      if (b.length < 200) break;
    }

    return Response.json({
      diagnostic_date: new Date().toISOString(),
      conversation_count: conversationIds.length,
      batch_test: {
        batch_with_all_ids: batchActualCount,
        batch_with_10_ids: batch_10ids?.length || 0,
        batch_with_50_ids: batch_50ids?.length || 0,
        images_in_full_batch: imagesInBatch1.length,
        note: batchActualCount < 200 
          ? 'IMPORTANT: $in query returned LESS than 200 messages — either total count is low OR $in with many IDs is limited'
          : '$in query returned full 200 — no $in limit issue',
      },
      total_message_count: cumulativeCount,
      total_images_via_offset: totalImagesViaOffset,
      images_per_convo_sample: convoSamples,
      conclusion: totalImagesViaOffset < 20
        ? `ONLY ${totalImagesViaOffset} IMAGES EXIST IN THE DATASET — pagination collapse is because there are genuinely few images`
        : `${totalImagesViaOffset} images exist — pagination should work but something is dropping images`,
    });

  } catch (error) {
    console.error('[diagnosePaginationCollapse] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});