import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId, prompt, characterReferenceImages, userReferenceImages, characterName, userMessage } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    // Detect if the image request is about the user based on the original user message
    // Look for patterns like "send me a pic of me", "take a photo of me", "picture of myself", etc.
    const userMsg = (userMessage || "").toLowerCase();
    const isAboutUser =
      /\b(pic|picture|photo|image|selfie|shot)\b.*(of me|of myself|with me)\b/i.test(userMsg) ||
      /\b(send me|show me)\b.*(me|myself)\b/i.test(userMsg) ||
      /\bpicture of me\b|\bphoto of me\b|\bpic of me\b|\bselfie with me\b/i.test(userMsg) ||
      /\bme in\b|\bme at\b|\bme with\b/i.test(userMsg);

    // Choose the right reference images
    const hasUserImages = userReferenceImages && userReferenceImages.length > 0;
    const hasCharacterImages = characterReferenceImages && characterReferenceImages.length > 0;

    let referenceImages;
    let enhancedPrompt = prompt;

    if (isAboutUser && hasUserImages) {
      // Use user's reference images — the subject of the photo is the user
      referenceImages = userReferenceImages.slice(0, 3);
      enhancedPrompt = `${prompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance. This must look like a real photo of the person in the reference images.`;
    } else if (!isAboutUser && hasCharacterImages) {
      // Use character's reference images
      referenceImages = characterReferenceImages.slice(0, 3);
      enhancedPrompt = `${prompt}\n\nCRITICAL: The subject of this photo is ${characterName}. Use the provided reference images to replicate their exact face, features, and appearance. This must look like a real photo of the person in the reference images.`;
    } else {
      // No matching reference images available
      referenceImages = hasCharacterImages ? characterReferenceImages.slice(0, 3) : undefined;
    }

    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
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