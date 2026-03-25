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

    const response = await base44.integrations.Core.GenerateImage({
      prompt,
      existing_image_urls: referenceImageUrls && referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    });

    if (response?.url) {
      await base44.entities.Message.update(messageId, {
        image_url: response.url,
      });
      return Response.json({ success: true, imageUrl: response.url });
    }

    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});