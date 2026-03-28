import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      messageId,
      prompt,
      characterReferenceImages = [],
      userReferenceImages = []
    } = body;

    if (!messageId || !prompt) {
      return Response.json({ 
        error: 'messageId and prompt required' 
      }, { status: 400 });
    }

    // Generate image using AI
    const generateRes = await base44.integrations.Core.GenerateImage({
      prompt,
      existing_image_urls: [...characterReferenceImages, ...userReferenceImages]
    });

    if (!generateRes?.url) {
      throw new Error('Failed to generate image');
    }

    const imageUrl = generateRes.url;

    // Update message with generated image
    await base44.entities.Message.update(messageId, { image_url: imageUrl });

    return Response.json({
      success: true,
      imageUrl,
      message: 'Image generated and saved'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});