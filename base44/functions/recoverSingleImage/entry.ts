import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, forceRegenerate = false } = await req.json();
    if (!messageId) return Response.json({ error: 'messageId required' }, { status: 400 });

    const messages = await base44.asServiceRole.entities.Message.filter({ id: messageId });
    const message = messages[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    // If already has a valid image URL, return it (unless force regenerating)
    if (message.image_url && message.image_url.startsWith('http') && !forceRegenerate) {
      return Response.json({ success: true, image_url: message.image_url, source: 'existing' });
    }

    // Fetch character for reference images
    const character = message.character_id
      ? (await base44.asServiceRole.entities.Character.filter({ id: message.character_id }))[0]
      : null;

    // Build reference images list
    const referenceImages = [];
    if (character?.avatar_url) referenceImages.push(character.avatar_url);
    if (character?.reference_image_urls?.length > 0) {
      referenceImages.push(...character.reference_image_urls.slice(0, 2));
    }

    // --- STEP 1: Try to extract prompt from [IMAGE: ...] tag in content ---
    let imagePrompt = null;
    const imageTagMatch = message.content?.match(/\[IMAGE:\s*([\s\S]+?)\]/i);
    if (imageTagMatch) {
      imagePrompt = imageTagMatch[1].trim();
      console.log(`[recoverSingleImage] Found [IMAGE:] tag prompt: "${imagePrompt.substring(0, 80)}"`);
    }

    // --- STEP 2: If no tag, look at surrounding conversation for context ---
    if (!imagePrompt && message.conversation_id) {
      const nearbyMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: message.conversation_id },
        '-created_date',
        30
      );

      // Find the user message just before this one (most likely the image request)
      const msgIndex = nearbyMsgs.findIndex(m => m.id === messageId);
      const contextWindow = msgIndex >= 0
        ? nearbyMsgs.slice(msgIndex + 1, msgIndex + 5) // messages after (they're reversed)
        : nearbyMsgs.slice(0, 5);

      const userRequest = contextWindow.find(m => m.sender_type === 'user');
      const recentContext = nearbyMsgs.slice(0, 6).reverse().map(m =>
        `${m.sender_type === 'user' ? 'User' : (character?.name || 'Character')}: ${m.content}`
      ).filter(t => t.trim()).join('\n');

      // Use LLM to reconstruct the most likely image prompt
      const promptGuess = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `A character named "${character?.name || 'the character'}" was about to send a photo in a chat conversation.

Character description: ${character?.appearance_notes || character?.personality_summary || 'No description available'}
Character details: ${[character?.age_range, character?.gender, character?.city].filter(Boolean).join(', ')}

Recent conversation context:
${recentContext}

${userRequest ? `The user just said: "${userRequest.content}"` : ''}

Based on this context, write a vivid, specific image generation prompt (1-3 sentences) describing what photo this character would have sent. Focus on: what the character looks like in the photo, their setting/environment, their expression and pose. Make it realistic and consistent with the character. Return ONLY the image prompt, nothing else.`,
      });

      imagePrompt = promptGuess?.trim() || null;
      console.log(`[recoverSingleImage] LLM-generated prompt: "${imagePrompt?.substring(0, 80)}"`);
    }

    // --- STEP 3: Final fallback — generic character selfie prompt ---
    if (!imagePrompt) {
      const charDesc = [
        character?.appearance_notes,
        character?.personality_summary,
        character?.age_range,
        character?.gender
      ].filter(Boolean).join(', ');
      imagePrompt = `A realistic photo of ${character?.name || 'a person'}${charDesc ? ` (${charDesc})` : ''}, candid shot, natural lighting, authentic selfie or casual photo style.`;
      console.log(`[recoverSingleImage] Using fallback prompt`);
    }

    // --- STEP 4: Generate the image ---
    console.log(`[recoverSingleImage] Generating image with prompt: "${imagePrompt.substring(0, 100)}..."`);
    const genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: imagePrompt,
      existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (!genRes?.url) {
      return Response.json({ success: false, error: 'Image generation returned no URL' }, { status: 500 });
    }

    // --- STEP 5: Clean content and save ---
    // Also strip [IMAGE_FAILED] marker so the UI transitions from failed/placeholder to loaded
    const cleanedContent = (message.content || '')
      .replace(/\[IMAGE:\s*[\s\S]+?\]/gi, '')
      .replace(/\[IMAGE_FAILED\]/gi, '')
      .trim();
    console.log(`[recoverSingleImage] Writing image_url to message ${messageId}: ${genRes.url.substring(0, 60)}...`);
    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      content: cleanedContent,
    });
    console.log(`[recoverSingleImage] ✓ DB updated — real-time subscription should fire image_url for message ${messageId}`);

    console.log(`[recoverSingleImage] ✓ Image recovered/regenerated for message ${messageId}`);
    return Response.json({ success: true, image_url: genRes.url, source: forceRegenerate ? 'regenerated' : 'recovered' });

  } catch (error) {
    console.error('[recoverSingleImage]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});