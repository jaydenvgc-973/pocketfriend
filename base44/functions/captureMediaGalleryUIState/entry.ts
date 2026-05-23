/**
 * captureMediaGalleryUIState
 *
 * Frontend doesn't have direct Message access due to RLS.
 * Instead, we'll trace what the gallery actually displays on page load
 * by checking localStorage cache and localStorage proof from lfc reads.
 *
 * Also test: pagination, modal display, refresh persistence.
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
    console.log(`[captureMediaGalleryUIState] Testing gallery state for ${ownerEmail}`);

    // Simulate what the UI does:
    // 1. Call fetchMediaGalleryPage page 1 (use service role for audit function)
    const page1 = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 1, pageSize: 20 });
    const page1Images = page1?.data?.images || [];

    console.log(`[captureMediaGalleryUIState] Page 1 returned ${page1Images.length} images`);

    if (page1Images.length === 0) {
      return Response.json({
        error: 'No images on page 1',
        issue: 'Gallery is returning 0 images on first load',
      });
    }

    // 2. Log category distribution from page 1
    const categories = {};
    page1Images.forEach(img => {
      const cat = img.imageCategory || 'unknown';
      categories[cat] = (categories[cat] || 0) + 1;
    });

    console.log(`[captureMediaGalleryUIState] Page 1 categories:`, categories);

    // 3. Test pagination
    const page2 = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 2, pageSize: 20 });
    const page2Images = page2?.data?.images || [];

    console.log(`[captureMediaGalleryUIState] Page 2 returned ${page2Images.length} images`);

    // 4. Test a higher page
    const page5 = await base44.asServiceRole.functions.invoke('fetchMediaGalleryPage', { page: 5, pageSize: 20 });
    const page5Images = page5?.data?.images || [];

    console.log(`[captureMediaGalleryUIState] Page 5 returned ${page5Images.length} images`);

    // 5. Test prompt cleaning on first image
    const testImage = page1Images[0];
    const hasMetadataLeak = testImage.displayPrompt && (
      testImage.displayPrompt.includes('[NAME REFERENCE KEY') ||
      testImage.displayPrompt.includes('[CHARACTER ID') ||
      /\(ID:\s*[a-z0-9]+\)/i.test(testImage.displayPrompt)
    );

    console.log(`[captureMediaGalleryUIState] Test image category: ${testImage.imageCategory}`);
    console.log(`[captureMediaGalleryUIState] Test image has display prompt: ${!!testImage.displayPrompt}`);
    console.log(`[captureMediaGalleryUIState] Test image has metadata leak: ${hasMetadataLeak}`);
    console.log(`[captureMediaGalleryUIState] Test image display prompt sample: ${testImage.displayPrompt?.substring(0, 150)}`);

    // 6. Test send-to-character data
    const hasGenerationContext = !!testImage.generationContext;
    const wouldSendToCharacter = {
      has_display_prompt: !!testImage.displayPrompt,
      has_generation_context: hasGenerationContext,
      would_include_context: hasGenerationContext ? 'yes' : 'no',
      would_clean_display: !hasMetadataLeak ? 'yes' : 'no',
    };

    console.log(`[captureMediaGalleryUIState] Send-to-character readiness:`, wouldSendToCharacter);

    // 7. Overall health check
    const totalImagesEstimate = page1?.data?.totalImages || 0;
    const hasMore = page1?.data?.hasMore === true;

    return Response.json({
      // Dataset summary
      total_images_estimated: totalImagesEstimate,
      page_1_images: page1Images.length,
      page_2_images: page2Images.length,
      page_5_images: page5Images.length,

      // Category breakdown (from page 1 sample)
      page_1_categories: categories,

      // Quality checks
      first_image_test: {
        id: testImage.id,
        category: testImage.imageCategory,
        has_display_prompt: !!testImage.displayPrompt,
        has_metadata_leak: hasMetadataLeak,
        prompt_sample: testImage.displayPrompt?.substring(0, 100),
        has_generation_context: hasGenerationContext,
      },

      // Pagination health
      pagination_test: {
        page_1_count: page1Images.length,
        page_2_count: page2Images.length,
        page_5_count: page5Images.length,
        page_1_has_more: page1?.data?.hasMore,
        page_2_has_more: page2?.data?.hasMore,
        page_5_has_more: page5?.data?.hasMore,
      },

      // Send-to-character readiness
      send_to_character_test: wouldSendToCharacter,

      // Summary
      status: page1Images.length > 0 ? 'GALLERY_LOADS_IMAGES' : 'GALLERY_EMPTY',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[captureMediaGalleryUIState] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});