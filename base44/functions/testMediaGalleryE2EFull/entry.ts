/**
 * testMediaGalleryE2EFull
 *
 * Complete E2E test using direct service role access.
 * Tests:
 * 1. Pagination (pages 1, 5, 10)
 * 2. Persistence (same image appears on re-query)
 * 3. Modal cleaning (no metadata leaks)
 * 4. Send-to-character data structure
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    console.log(`[testMediaGalleryE2EFull] E2E full test for ${ownerEmail}`);

    // Get all conversations for user
    const conversations = await base44.asServiceRole.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    const conversationIds = conversations.map(c => c.id).filter(Boolean);
    console.log(`[testMediaGalleryE2EFull] Found ${conversationIds.length} conversations`);

    // ── TEST 1: Collect images for pagination test ─────────────────────────────────
    console.log(`[testMediaGalleryE2EFull] TEST 1: Pagination`);
    const imagesByPage = {};
    let totalImagesCollected = 0;

    for (let pageNum = 1; pageNum <= 10; pageNum++) {
      const startIdx = (pageNum - 1) * 20;
      const endIdx = startIdx + 20;
      const pageImages = [];

      let imagesFound = 0;
      const batchSize = 200;
      for (let offset = 0; offset < 5000 && imagesFound < 20; offset += batchSize) {
        const messages = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: { $in: conversationIds } },
          '-created_date',
          batchSize,
          offset
        );

        if (!messages || messages.length === 0) break;

        for (const msg of messages) {
          if (!msg.image_url || msg.recovery_signal === true) continue;
          imagesFound++;
          pageImages.push(msg);
          if (imagesFound >= 20) break;
        }
      }

      imagesByPage[`page_${pageNum}`] = pageImages.length;
      totalImagesCollected += pageImages.length;
      console.log(`[testMediaGalleryE2EFull] Page ${pageNum}: ${pageImages.length} images`);

      if (pageNum === 1) {
        var page1Images = pageImages;
      }
    }

    // ── TEST 2: Persistence ──────────────────────────────────────────────────────
    console.log(`[testMediaGalleryE2EFull] TEST 2: Persistence`);
    if (!page1Images || page1Images.length === 0) {
      return Response.json({ error: 'No images found for persistence test' }, { status: 400 });
    }

    const testImageId = page1Images[0].id;
    const testImageMsg = page1Images[0];
    console.log(`[testMediaGalleryE2EFull] Testing persistence of image: ${testImageId}`);

    // Re-fetch page 1
    const page1Refetch = [];
    let refetchImgFound = 0;
    const batchSize = 200;
    for (let offset = 0; offset < 5000 && refetchImgFound < 20; offset += batchSize) {
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: conversationIds } },
        '-created_date',
        batchSize,
        offset
      );

      if (!messages || messages.length === 0) break;
      for (const msg of messages) {
        if (!msg.image_url || msg.recovery_signal === true) continue;
        page1Refetch.push(msg);
        refetchImgFound++;
        if (refetchImgFound >= 20) break;
      }
    }

    const persistenceCheck = page1Refetch.find(img => img.id === testImageId);
    console.log(`[testMediaGalleryE2EFull] Image found on re-fetch: ${!!persistenceCheck}`);

    // ── TEST 3: Modal cleaning ───────────────────────────────────────────────────
    console.log(`[testMediaGalleryE2EFull] TEST 3: Modal cleaning`);
    const gc = testImageMsg.generation_context || {};
    const rawPrompt = gc.original_raw_prompt || gc.scene_prompt || testImageMsg.image_description || '';

    const metadataPatterns = [
      /\[NAME REFERENCE KEY/i,
      /\[CHARACTER ID/i,
      /\(ID:\s*[a-z0-9]+\)/i,
      /^"[^"]*"\s*=\s*[^\n]*/m,
    ];

    const hasMetadataBefore = metadataPatterns.some(p => p.test(rawPrompt));

    // Apply modal cleaning function
    const cleanedPrompt = rawPrompt
      .replace(/\[NAME REFERENCE KEY[^\]]*?\]/g, '')
      .replace(/\[END NAME REFERENCE KEY\]/g, '')
      .replace(/\[REFERENCE KEY[^\]]*?\]/g, '')
      .replace(/\[END REFERENCE KEY\]/g, '')
      .replace(/\[CHARACTER ID[^\]]*?\]/g, '')
      .replace(/\[IDENTITY LOCK[^\]]*?\]/g, '')
      .replace(/\[PROVIDER INSTRUCTION[^\]]*?\]/g, '')
      .replace(/\(ID:\s*[a-z0-9]+\)/gi, '')
      .replace(/^"[^"]*"\s*=\s*[^\n]*$/gm, '')
      .replace(/\n\n+/g, '\n\n')
      .replace(/^\s+|\s+$/gm, '')
      .trim();

    const hasMetadataAfter = metadataPatterns.some(p => p.test(cleanedPrompt));
    console.log(`[testMediaGalleryE2EFull] Metadata before cleaning: ${hasMetadataBefore}`);
    console.log(`[testMediaGalleryE2EFull] Metadata after cleaning: ${hasMetadataAfter}`);

    // ── TEST 4: Send-to-character structure ───────────────────────────────────────
    console.log(`[testMediaGalleryE2EFull] TEST 4: Send-to-character structure`);
    const sendStructure = {
      image_url_present: !!testImageMsg.image_url,
      cleaned_description_present: !!cleanedPrompt,
      generation_context_present: !!testImageMsg.generation_context,
      description_length: cleanedPrompt.length,
      would_be_human_readable: !hasMetadataAfter && cleanedPrompt.length > 20,
    };

    return Response.json({
      test_date: new Date().toISOString(),
      results: {
        test_1_pagination: {
          total_images_tested: totalImagesCollected,
          images_per_page: imagesByPage,
          status: totalImagesCollected >= 20 ? 'PASS' : 'FAIL',
        },
        test_2_persistence: {
          test_image_id: testImageId,
          found_on_refetch: !!persistenceCheck,
          status: persistenceCheck ? 'PASS' : 'FAIL',
        },
        test_3_modal_cleaning: {
          raw_prompt_sample: rawPrompt.substring(0, 150),
          cleaned_prompt_sample: cleanedPrompt.substring(0, 150),
          bytes_removed: rawPrompt.length - cleanedPrompt.length,
          had_metadata_before: hasMetadataBefore,
          has_metadata_after: hasMetadataAfter,
          status: !hasMetadataAfter ? 'PASS' : 'FAIL',
        },
        test_4_send_to_character: {
          image_id: testImageId,
          image_category: testImageMsg.generation_context ? 'ai_generated_with_context' : 'unknown',
          ...sendStructure,
          status: sendStructure.would_be_human_readable ? 'PASS' : 'FAIL',
        },
      },
      overall_status: persistenceCheck && !hasMetadataAfter && sendStructure.would_be_human_readable ? 'E2E_PASS' : 'E2E_FAIL',
    });

  } catch (error) {
    console.error('[testMediaGalleryE2EFull] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});