import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    let recoveredCount = 0;
    let failedCount = 0;
    let skip = 0;
    const limit = 100;

    while (true) {
      const messages = await base44.asServiceRole.entities.Message.list('-created_date', limit, skip);
      if (!messages || messages.length === 0) break;

      for (const message of messages) {
        // Look for messages with [IMAGE: ...] tags that don't have an image_url
        const imageMatch = message.content?.match(/\[IMAGE:\s*([\s\S]+?)\]/);
        
        if (imageMatch && !message.image_url) {
          try {
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

            if (genRes?.url) {
              // Clean up the [IMAGE: ...] tag and update with the generated image
              const cleanedContent = message.content.replace(/\[IMAGE:\s*[\s\S]+?\]/g, "").trim();
              
              await base44.asServiceRole.entities.Message.update(message.id, {
                image_url: genRes.url,
                content: cleanedContent
              });
              
              recoveredCount++;
            } else {
              failedCount++;
            }
          } catch (err) {
            failedCount++;
          }
        }
      }

      if (messages.length < limit) break;
      skip += limit;
    }

    return Response.json({
      success: true,
      recoveredImages: recoveredCount,
      failedImages: failedCount
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});