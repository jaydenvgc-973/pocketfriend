/**
 * analyzeMediaGalleryImageForSend — Visual Analysis for Promptless Gallery Images
 *
 * When a Media Gallery image lacks usable context (no prompt, no generation context,
 * no description), this function analyzes the image visually and returns inferred
 * description metadata for the NEW sent message ONLY.
 *
 * NON-NEGOTIABLE: This function does NOT modify the original gallery record.
 * It ONLY returns metadata for the new sent-message-copy.
 *
 * Returns:
 * {
 *   hasUsableContext: boolean,
 *   inferred_image_description: string (if no context),
 *   image_analysis_status: 'complete' | 'failed',
 *   image_analysis_error: string (if failed),
 *   image_analysis_source: 'media_gallery_send_visual_analysis',
 *   image_analysis_is_inferred: true,
 *   source_media_had_prompt: boolean,
 *   source_media_had_generation_context: boolean,
 * }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { image_url, displayPrompt, imageDescription, generationContext } = await req.json();

    if (!image_url) {
      return Response.json({ error: 'image_url required' }, { status: 400 });
    }

    console.log('[analyzeMediaGalleryImageForSend] Checking gallery item context');

    // Check if source has usable context
    const hasDisplayPrompt = !!displayPrompt && displayPrompt.trim().length > 0;
    const hasImageDescription = !!imageDescription && imageDescription.trim().length > 0;
    const hasGenerationContext = !!generationContext && (
      generationContext.original_raw_prompt ||
      generationContext.scene_prompt ||
      generationContext.resolved_description
    );

    const hasUsableContext = hasDisplayPrompt || hasImageDescription || hasGenerationContext;

    if (hasUsableContext) {
      console.log('[analyzeMediaGalleryImageForSend] Gallery item has usable context — using as-is');
      return Response.json({
        hasUsableContext: true,
        image_analysis_source: 'media_gallery_send_context_copy',
        image_analysis_is_inferred: false,
        source_media_had_prompt: hasDisplayPrompt,
        source_media_had_generation_context: hasGenerationContext,
      });
    }

    // No usable context — run visual analysis
    console.log('[analyzeMediaGalleryImageForSend] Gallery item has NO usable context — running visual analysis');

    const analysisRes = await base44.integrations.Core.InvokeLLM({
      prompt: `You are analyzing an image to provide a visual description for a chat character to understand it.

Provide a clear, concise visual description of what is shown in this image.

Focus on:
- Main subjects (people, objects, animals)
- Setting and location
- Mood and atmosphere
- Colors and composition
- Any notable details

Keep the description practical and avoid speculation. If you cannot see something clearly, say so.

Provide only the description, no preamble.`,
      file_urls: [image_url],
    });

    const inferred_image_description = analysisRes && typeof analysisRes === 'string' 
      ? analysisRes.trim() 
      : String(analysisRes || '').trim();

    if (!inferred_image_description) {
      console.warn('[analyzeMediaGalleryImageForSend] Visual analysis returned empty result');
      return Response.json({
        hasUsableContext: false,
        image_analysis_status: 'failed',
        image_analysis_error: 'Visual analysis could not generate a description',
        image_analysis_source: 'media_gallery_send_visual_analysis',
        image_analysis_is_inferred: true,
        source_media_had_prompt: false,
        source_media_had_generation_context: false,
      });
    }

    console.log('[analyzeMediaGalleryImageForSend] Visual analysis successful, description length:', inferred_image_description.length);

    return Response.json({
      hasUsableContext: false,
      inferred_image_description,
      image_analysis_status: 'complete',
      image_analysis_source: 'media_gallery_send_visual_analysis',
      image_analysis_is_inferred: true,
      source_media_had_prompt: false,
      source_media_had_generation_context: false,
    });

  } catch (error) {
    console.error('[analyzeMediaGalleryImageForSend] Error:', error.message);
    return Response.json({
      hasUsableContext: false,
      image_analysis_status: 'failed',
      image_analysis_error: `Analysis error: ${error.message}`,
      image_analysis_source: 'media_gallery_send_visual_analysis',
      image_analysis_is_inferred: true,
      source_media_had_prompt: false,
      source_media_had_generation_context: false,
    }, { status: 500 });
  }
});