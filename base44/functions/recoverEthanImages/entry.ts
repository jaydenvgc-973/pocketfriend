import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ETHAN_ID = '69c0d59d7e382cc866ded9c9';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get Ethan's character data for reference images
    const ethan = await base44.asServiceRole.entities.Character.filter({ id: ETHAN_ID });
    const ethanChar = ethan[0];
    
    if (!ethanChar) {
      return Response.json({ error: 'Ethan character not found' }, { status: 404 });
    }

    // Build reference images list for Ethan
    const ethanRefs = [];
    if (ethanChar.avatar_url) ethanRefs.push(ethanChar.avatar_url);
    if (ethanChar.reference_image_urls?.length > 0) ethanRefs.push(...ethanChar.reference_image_urls);

    // Get ALL messages from Ethan (character messages) AND messages in his conversations
    const ethanConvos = await base44.asServiceRole.entities.Conversation.filter(
      { character_ids: [ETHAN_ID] },
      "-updated_date",
      50
    );

    const convoIds = ethanConvos.map(c => c.id);
    console.log(`Found ${convoIds.length} conversations for Ethan`);

    let recoveredCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results = [];

    // Process each conversation
    for (const convoId of convoIds) {
      // Fetch all messages in this conversation
      let skip = 0;
      const limit = 100;
      
      while (true) {
        const messages = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convoId },
          "-created_date",
          limit,
          skip
        );

        if (!messages || messages.length === 0) break;

        for (const message of messages) {
          // Case 1: Message has [IMAGE: ...] tag but no image_url
          const imageTagMatch = message.content?.match(/\[IMAGE:\s*([\s\S]+?)\]/i);
          
          if (imageTagMatch && !message.image_url) {
            try {
              const imagePrompt = imageTagMatch[1].trim();
              console.log(`Recovering tagged image for message ${message.id}: ${imagePrompt.substring(0, 80)}`);

              const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
                prompt: imagePrompt,
                existing_image_urls: ethanRefs.length > 0 ? [ethanRefs[0]] : undefined
              });

              if (genRes?.url) {
                const cleanedContent = message.content.replace(/\[IMAGE:\s*[\s\S]+?\]/gi, "").trim();
                await base44.asServiceRole.entities.Message.update(message.id, {
                  image_url: genRes.url,
                  content: cleanedContent
                });
                recoveredCount++;
                results.push({ messageId: message.id, status: 'recovered', type: 'image_tag' });
              } else {
                failedCount++;
                results.push({ messageId: message.id, status: 'failed', type: 'image_tag' });
              }
            } catch (err) {
              console.error(`Failed image tag recovery for ${message.id}:`, err.message);
              failedCount++;
              results.push({ messageId: message.id, status: 'error', error: err.message });
            }
          }

          // Case 2: Message has image_url that is broken/empty string
          if (message.image_url === '' || (message.image_url && message.image_url.length < 10)) {
            try {
              console.log(`Recovering broken image URL for message ${message.id}`);
              
              // Try to regenerate from content
              const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
                prompt: `Photo from ${ethanChar.name}'s perspective. ${message.content?.substring(0, 200) || 'casual lifestyle photo'}`,
                existing_image_urls: ethanRefs.length > 0 ? [ethanRefs[0]] : undefined
              });

              if (genRes?.url) {
                await base44.asServiceRole.entities.Message.update(message.id, {
                  image_url: genRes.url
                });
                recoveredCount++;
                results.push({ messageId: message.id, status: 'recovered', type: 'broken_url' });
              } else {
                failedCount++;
              }
            } catch (err) {
              failedCount++;
            }
          }

          // Case 3: Character message with no image but has image prompt marker in content
          if (!message.image_url && message.sender_type === 'character' && 
              message.character_id === ETHAN_ID &&
              message.content?.match(/\[img:|image_prompt:|photo:/i)) {
            try {
              const markerMatch = message.content.match(/\[img:(.*?)\]|image_prompt:\s*"([^"]+)"|photo:\s*(.*?)(?:\.|$)/i);
              if (markerMatch) {
                const prompt = (markerMatch[1] || markerMatch[2] || markerMatch[3])?.trim();
                if (prompt) {
                  const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
                    prompt,
                    existing_image_urls: ethanRefs.length > 0 ? [ethanRefs[0]] : undefined
                  });
                  if (genRes?.url) {
                    const cleanedContent = message.content.replace(/\[img:.*?\]|image_prompt:\s*"[^"]+"|photo:\s*.*?(?:\.|$)/gi, "").trim();
                    await base44.asServiceRole.entities.Message.update(message.id, {
                      image_url: genRes.url,
                      content: cleanedContent
                    });
                    recoveredCount++;
                    results.push({ messageId: message.id, status: 'recovered', type: 'marker' });
                  }
                }
              }
            } catch (err) {
              failedCount++;
            }
          }
        }

        if (messages.length < limit) break;
        skip += limit;
      }
    }

    return Response.json({
      success: true,
      ethanId: ETHAN_ID,
      conversationsScanned: convoIds.length,
      recoveredImages: recoveredCount,
      failedImages: failedCount,
      skipped: skippedCount,
      details: results
    });

  } catch (error) {
    console.error('recoverEthanImages error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});