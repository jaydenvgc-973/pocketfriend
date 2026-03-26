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

    const userMsg = (userMessage || "").toLowerCase();
    const promptLower = (prompt || "").toLowerCase();

    const hasUserImages = userReferenceImages && userReferenceImages.length > 0;
    const hasCharacterImages = characterReferenceImages && characterReferenceImages.length > 0;

    // Detect if the image includes BOTH the character and the user together
    const isJointPhoto =
      /\b(us|together|both|with (you|me|each other)|the two of us|selfie with)\b/i.test(userMsg) ||
      /\b(us|together|both|with (you|me|each other)|the two of us)\b/i.test(promptLower) ||
      (/\bwith\b/i.test(promptLower) && /\b(me|user)\b/i.test(promptLower));

    // Detect if the image is solely about the user
    const isAboutUser =
      !isJointPhoto && (
        /\b(pic|picture|photo|image|selfie|shot)\b.*(of me|of myself|with me)\b/i.test(userMsg) ||
        /\b(send me|show me)\b.*(me|myself)\b/i.test(userMsg) ||
        /\bpicture of me\b|\bphoto of me\b|\bpic of me\b|\bselfie with me\b/i.test(userMsg) ||
        /\bme in\b|\bme at\b|\bme with\b/i.test(userMsg)
      );

    let referenceImages;
    let enhancedPrompt = prompt;

    if (isJointPhoto && hasUserImages && hasCharacterImages) {
      // Combine both sets — character images first, then user images
      referenceImages = [...characterReferenceImages.slice(0, 2), ...userReferenceImages.slice(0, 2)];
      enhancedPrompt = `${prompt}\n\nCRITICAL: This photo features BOTH ${characterName} AND the user together. The first reference images are of ${characterName} — replicate their exact face and appearance. The remaining reference images are of the USER — replicate their exact face, features, skin tone, and appearance with pristine accuracy. Both people must look like their respective reference images. Render the user's appearance faithfully and with high fidelity.`;
    } else if (isAboutUser && hasUserImages) {
      // User is the sole subject
      referenceImages = userReferenceImages.slice(0, 3);
      enhancedPrompt = `${prompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance with pristine accuracy. This must look like a real photo of the person in the reference images.`;
    } else if (hasCharacterImages) {
      // Character is the sole subject
      referenceImages = characterReferenceImages.slice(0, 3);
      enhancedPrompt = `${prompt}\n\nCRITICAL: The subject of this photo is ${characterName}. Use the provided reference images to replicate their exact face, features, and appearance. This must look like a real photo of the person in the reference images.`;
    } else {
      referenceImages = undefined;
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