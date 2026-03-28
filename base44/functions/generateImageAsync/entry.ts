import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// subjectType: "character" | "user" | "joint"
// Only use user references when subjectType is "user" or "joint"
// Never use user references for "character" images

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId, prompt, characterReferenceImages, userReferenceImages, characterName, subjectType } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    const hasUserImages = userReferenceImages && userReferenceImages.length > 0;
    const hasCharacterImages = characterReferenceImages && characterReferenceImages.length > 0;

    // Parse [TAG] from start of prompt as override (set by LLM in system prompt)
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) {
      resolvedSubjectType = tagMatch[1].toLowerCase();
    }
    // Strip the tag from the actual prompt
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    let referenceImages;
    let enhancedPrompt = cleanPrompt;

    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [...characterReferenceImages.slice(0, 2), ...userReferenceImages.slice(0, 2)];
      enhancedPrompt = `${prompt}\n\nCRITICAL: This photo features BOTH ${characterName} AND the user together. The first reference images are of ${characterName} — replicate their exact face and appearance. The remaining reference images are of the USER — replicate their exact face, features, skin tone, and appearance with pristine accuracy. Both people must look like their respective reference images.`;
    } else if (resolvedSubjectType === "user" && hasUserImages) {
      referenceImages = userReferenceImages.slice(0, 3);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance with pristine accuracy.`;
    } else if (hasCharacterImages) {
      // "character" or fallback — NEVER include user references
      referenceImages = characterReferenceImages.slice(0, 3);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject of this photo is ${characterName}. Use the provided reference images to replicate their exact face, features, and appearance. Do NOT include any other person.`;
    } else {
      referenceImages = undefined;
    }

    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (response?.url) {
      await base44.entities.Message.update(messageId, { image_url: response.url });
      return Response.json({ success: true, imageUrl: response.url });
    }

    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});