import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId, prompt, referenceImageUrls } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    let imageUrl = null;
    const maxRetries = 5;
    const baseDelayMs = 2000;

    // Retry logic with exponential backoff
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await base44.integrations.Core.GenerateImage({
          prompt,
          existing_image_urls: referenceImageUrls && referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        });

        if (response?.url) {
          imageUrl = response.url;
          break;
        }
      } catch (error) {
        const errorMsg = error?.message?.toLowerCase() || '';
        const shouldRetry = errorMsg.includes('rate limit') || 
                          errorMsg.includes('timeout') || 
                          errorMsg.includes('network') ||
                          errorMsg.includes('temporarily') ||
                          error?.status >= 500;

        if (!shouldRetry || attempt === maxRetries - 1) {
          // Don't throw — silently fail so message still exists
          break;
        }

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s
        const delayMs = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }

    // Update message with image URL if successful
    if (imageUrl) {
      await base44.entities.Message.update(messageId, {
        image_url: imageUrl,
      });
    }

    return Response.json({ success: true, imageUrl });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});