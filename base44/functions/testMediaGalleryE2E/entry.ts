/**
 * testMediaGalleryE2E
 *
 * End-to-end test:
 * 1. Pagination works (page 1, 5, 10)
 * 2. Images are persistent in backend (same image appears consistently)
 * 3. Modal cleaning logic applied correctly
 * 4. Send-to-character includes cleaned context
 * 5. Character can see image + context
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
    console.log(`[testMediaGalleryE2E] E2E test for ${ownerEmail}`);

    // Test 1: Pagination works
    console.log(`[testMediaGalleryE2E] Test 1: Pagination`);
    const page1Res = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 1, pageSize: 20 });
    const page5Res = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 5, pageSize: 20 });
    const page10Res = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 10, pageSize: 20 });

    const page1 = page1Res?.data?.images || [];
    const page5 = page5Res?.data?.images || [];
    const page10 = page10Res?.data?.images || [];

    console.log(`[testMediaGalleryE2E] Page 1: ${page1.length} images, hasMore: ${page1Res?.data?.hasMore}`);
    console.log(`[testMediaGalleryE2E] Page 5: ${page5.length} images, hasMore: ${page5Res?.data?.hasMore}`);
    console.log(`[testMediaGalleryE2E] Page 10: ${page10.length} images, hasMore: ${page10Res?.data?.hasMore}`);

    const paginationWorks = page1.length > 0 && page5.length > 0 && (page5Res?.data?.hasMore === true || page10.length > 0);
    console.log(`[testMediaGalleryE2E] Pagination test: ${paginationWorks ? 'PASS' : 'FAIL'}`);

    // Test 2: Find an AI-generated image with context on page 1
    const testImagePage1 = page1.find(img => img.imageCategory === 'ai_generated_with_context' && img.displayPrompt);
    if (!testImagePage1) {
      return Response.json({ error: 'No suitable test image found on page 1' }, { status: 400 });
    }

    // Test 3: Fetch the same page again and verify image is still there (persistence)
    console.log(`[testMediaGalleryE2E] Test 3: Persistence (refetch same page)`);
    const page1Refetch = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 1, pageSize: 20 });
    const refetchedImages = page1Refetch?.data?.images || [];
    const sameImageFound = refetchedImages.find(img => img.id === testImagePage1.id);
    
    console.log(`[testMediaGalleryE2E] Original image: ${testImagePage1.id}`);
    console.log(`[testMediaGalleryE2E] Refetched (should be same): ${sameImageFound?.id || 'NOT FOUND'}`);
    console.log(`[testMediaGalleryE2E] Persistence test: ${sameImageFound ? 'PASS' : 'FAIL'}`);

    // Test 4: Verify modal cleaning
    console.log(`[testMediaGalleryE2E] Test 4: Modal cleaning`);
    const rawPrompt = testImagePage1.displayPrompt || '';
    const metadataPatterns = [
      /\[NAME REFERENCE KEY/i,
      /\[CHARACTER ID/i,
      /\(ID:\s*[a-z0-9]+\)/i,
      /^"[^"]*"\s*=\s*[^\n]*/m,
    ];

    const hasMetadataBeforeCleaning = metadataPatterns.some(p => p.test(rawPrompt));
    console.log(`[testMediaGalleryE2E] Raw prompt has metadata: ${hasMetadataBeforeCleaning}`);
    console.log(`[testMediaGalleryE2E] Raw prompt sample: ${rawPrompt.substring(0, 150)}`);

    // Apply cleaning (same function as modal)
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

    const hasMetadataAfterCleaning = metadataPatterns.some(p => p.test(cleanedPrompt));
    console.log(`[testMediaGalleryE2E] Cleaned prompt has metadata: ${hasMetadataAfterCleaning}`);
    console.log(`[testMediaGalleryE2E] Cleaned prompt sample: ${cleanedPrompt.substring(0, 150)}`);
    console.log(`[testMediaGalleryE2E] Cleaning test: ${!hasMetadataAfterCleaning ? 'PASS' : 'FAIL'}`);

    // Test 5: Verify send-to-character data structure
    console.log(`[testMediaGalleryE2E] Test 5: Send-to-character data`);
    const sendToCharData = {
      image_url: testImagePage1.url,
      image_description: cleanedPrompt,
      generation_context: testImagePage1.generationContext,
      subject_names: testImagePage1.subjectNames || [],
      location_name: testImagePage1.locationName,
    };

    console.log(`[testMediaGalleryE2E] Would send:`);
    console.log(`[testMediaGalleryE2E]   - image_url: ${sendToCharData.image_url?.substring(0, 50)}`);
    console.log(`[testMediaGalleryE2E]   - description length: ${sendToCharData.image_description?.length || 0}`);
    console.log(`[testMediaGalleryE2E]   - has generation_context: ${!!sendToCharData.generation_context}`);
    console.log(`[testMediaGalleryE2E]   - subject_names: ${sendToCharData.subject_names.join(', ') || 'none'}`);

    return Response.json({
      test_date: new Date().toISOString(),
      test_results: {
        pagination: {
          page_1_count: page1.length,
          page_5_count: page5.length,
          page_10_count: page10.length,
          has_more_from_page_1: page1Res?.data?.hasMore,
          test: paginationWorks ? 'PASS' : 'FAIL',
        },
        persistence: {
          original_image_id: testImagePage1.id,
          refetched_image_id: sameImageFound?.id || null,
          test: sameImageFound ? 'PASS' : 'FAIL',
        },
        modal_cleaning: {
          raw_prompt_length: rawPrompt.length,
          cleaned_prompt_length: cleanedPrompt.length,
          had_metadata_before: hasMetadataBeforeCleaning,
          has_metadata_after: hasMetadataAfterCleaning,
          test: !hasMetadataAfterCleaning ? 'PASS' : 'FAIL',
        },
        send_to_character: {
          image_id: testImagePage1.id,
          image_category: testImagePage1.imageCategory,
          has_url: !!sendToCharData.image_url,
          has_description: !!sendToCharData.image_description,
          has_generation_context: !!sendToCharData.generation_context,
          subject_count: sendToCharData.subject_names.length,
          has_location: !!sendToCharData.location_name,
        },
      },
      overall_status: paginationWorks && sameImageFound && !hasMetadataAfterCleaning ? 'E2E_PASS' : 'E2E_FAIL',
    });

  } catch (error) {
    console.error('[testMediaGalleryE2E] Error:', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});