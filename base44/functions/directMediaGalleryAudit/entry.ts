/**
 * directMediaGalleryAudit
 *
 * Instead of calling fetchMediaGalleryPage, directly implement the gallery logic
 * with service role access to see the real image count and categories.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const scanStart = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    console.log(`[directMediaGalleryAudit] Direct audit for ${ownerEmail}`);

    // Fetch all conversations for this user
    let conversations = [];
    try {
      conversations = await base44.asServiceRole.entities.Conversation.filter(
        { created_by: ownerEmail },
        '-created_date',
        500
      );
    } catch (e) {
      return Response.json({ error: `Conversation fetch failed: ${e.message}` }, { status: 500 });
    }

    const conversationIds = conversations.map(c => c.id).filter(Boolean);
    console.log(`[directMediaGalleryAudit] Found ${conversationIds.length} conversations for user`);

    if (conversationIds.length === 0) {
      return Response.json({
        total_images: 0,
        conversations: 0,
        reason: 'No conversations found for user',
      });
    }

    // Fetch ALL messages with service role
    const allMessages = [];
    const BATCH_SIZE = 200;
    let batchCount = 0;

    for (let offset = 0; offset < 5000; offset += BATCH_SIZE) {
      try {
        const batch = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: { $in: conversationIds } },
          '-created_date',
          BATCH_SIZE,
          offset
        );

        if (!batch || batch.length === 0) break;
        allMessages.push(...batch);
        batchCount++;
        console.log(`[directMediaGalleryAudit] Batch ${batchCount}: ${batch.length} messages (total: ${allMessages.length})`);

        if (batch.length < BATCH_SIZE) break;
      } catch (e) {
        console.error(`[directMediaGalleryAudit] Batch error: ${e.message}`);
        break;
      }
    }

    console.log(`[directMediaGalleryAudit] Total messages scanned: ${allMessages.length}`);

    // Extract images and categorize
    const categories = {
      ai_generated_with_context: [],
      ai_generated_missing_context: [],
      user_uploaded: [],
      character_sent_image: [],
      legacy_missing_context: [],
      unknown: [],
    };

    const metadataLeakPattern = /\[NAME REFERENCE KEY|\[CHARACTER ID|\(ID:\s*[a-z0-9]+\)/i;

    for (const msg of allMessages) {
      if (!msg.image_url) continue;
      if (msg.recovery_signal === true) continue;

      const gc = msg.generation_context || null;
      const hasPrompt = !!(gc?.prompt || gc?.original_raw_prompt || gc?.scene_prompt || msg.image_description);

      let cat = 'unknown';
      if (gc) {
        cat = hasPrompt ? 'ai_generated_with_context' : 'ai_generated_missing_context';
      } else if (msg.sender_type === 'character') {
        cat = 'character_sent_image';
      } else if (msg.sender_type === 'user') {
        cat = 'user_uploaded';
      } else {
        cat = 'legacy_missing_context';
      }

      categories[cat].push({
        id: msg.id,
        has_generation_context: !!gc,
        has_display_prompt: hasPrompt,
        has_metadata_leak: metadataLeakPattern.test(
          gc?.original_raw_prompt || gc?.scene_prompt || msg.image_description || ''
        ),
        sender_type: msg.sender_type,
        created_date: msg.created_date,
      });
    }

    // Count totals
    const totalImages = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
    const metadataLeaks = Object.values(categories).reduce((sum, arr) => 
      sum + arr.filter(img => img.has_metadata_leak).length, 0
    );
    const missingContext = Object.values(categories).reduce((sum, arr) => 
      sum + arr.filter(img => !img.has_generation_context).length, 0
    );

    console.log(`[directMediaGalleryAudit] === FINAL COUNTS ===`);
    console.log(`[directMediaGalleryAudit] Total images: ${totalImages}`);
    console.log(`[directMediaGalleryAudit] ai_generated_with_context: ${categories.ai_generated_with_context.length}`);
    console.log(`[directMediaGalleryAudit] ai_generated_missing_context: ${categories.ai_generated_missing_context.length}`);
    console.log(`[directMediaGalleryAudit] user_uploaded: ${categories.user_uploaded.length}`);
    console.log(`[directMediaGalleryAudit] character_sent_image: ${categories.character_sent_image.length}`);
    console.log(`[directMediaGalleryAudit] legacy_missing_context: ${categories.legacy_missing_context.length}`);
    console.log(`[directMediaGalleryAudit] Images with metadata leak: ${metadataLeaks}`);
    console.log(`[directMediaGalleryAudit] Images without generation_context: ${missingContext}`);

    const runtimeMs = Date.now() - scanStart;

    return Response.json({
      audit_scope: 'Direct Message scan via service role',
      query_path: 'Conversation.filter({ created_by: ownerEmail }) → Message.filter({ conversation_id: { $in: ids } })',
      no_created_by_workaround: true,
      
      summary: {
        total_conversations: conversationIds.length,
        total_messages_scanned: allMessages.length,
        total_images_found: totalImages,
        batches_processed: batchCount,
      },

      category_counts: {
        ai_generated_with_context: categories.ai_generated_with_context.length,
        ai_generated_missing_context: categories.ai_generated_missing_context.length,
        user_uploaded: categories.user_uploaded.length,
        character_sent_image: categories.character_sent_image.length,
        legacy_missing_context: categories.legacy_missing_context.length,
        unknown: categories.unknown.length,
      },

      quality_checks: {
        images_without_generation_context: missingContext,
        images_with_metadata_leak: metadataLeaks,
        ai_generated_without_prompt: categories.ai_generated_missing_context.length,
      },

      sample_images: {
        ai_generated_with_context: categories.ai_generated_with_context.slice(0, 2),
        user_uploaded: categories.user_uploaded.slice(0, 2),
        ai_generated_missing_context: categories.ai_generated_missing_context.slice(0, 2),
      },

      audit_runtime_ms: runtimeMs,
      audit_completed_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[directMediaGalleryAudit] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});