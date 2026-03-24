import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { messageId } = await req.json();
    
    if (!messageId) {
      return Response.json({ error: 'messageId required' }, { status: 400 });
    }

    const message = await base44.asServiceRole.entities.Message.get(messageId);
    
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    // Extract [IMAGE: ...] tag
    const imageMatch = message.content?.match(/\[IMAGE:\s*([\s\S]+?)\]/);
    
    if (!imageMatch) {
      return Response.json({ error: 'No [IMAGE: ...] tag found in this message' }, { status: 400 });
    }

    if (message.image_url) {
      return Response.json({ error: 'Message already has an image' }, { status: 400 });
    }

    const imagePrompt = imageMatch[1].trim();
    
    // Fetch the character for reference images
    const character = message.character_id 
      ? await base44.asServiceRole.entities.Character.get(message.character_id)
      : null;

    // Prepare reference images
    const referenceImages = [];
    if (character?.reference_image_urls?.length > 0) {
      referenceImages.push(character.reference_image_urls[0]);
    } else if (character?.avatar_url) {
      referenceImages.push(character.avatar_url);
    }

    // Generate the image
    const genRes = await base44.integrations.Core.GenerateImage({
      prompt: imagePrompt,
      existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined
    });

    if (!genRes?.url) {
      return Response.json({ error: 'Image generation failed' }, { status: 500 });
    }

    // Clean up the [IMAGE: ...] tag and update with the generated image
    const cleanedContent = message.content.replace(/\[IMAGE:\s*[\s\S]+?\]/g, "").trim();
    
    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      content: cleanedContent
    });

    return Response.json({
      success: true,
      imageUrl: genRes.url,
      message: 'Image recovered and message updated'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});