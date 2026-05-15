/**
 * generateImageWithOutfitValidation — Wrapper that calls generateImageAsync and then
 * validates the result against the closet outfit lock. If it fails, regenerates with escalation.
 *
 * This is a post-generation validation layer that ensures the image matches the outfit.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    messageId,
    prompt,
    subjectType,
    characterId,
    senderCharacterId,
    characterName,
    characterReferenceImages,
    userReferenceImages,
    userWorldName,
    characterEmotionalState,
    charOutfitText, // NEW: the canonical outfit text from closet
  } = await req.json();

  if (!messageId || !prompt) {
    return Response.json({ error: 'Missing messageId or prompt' }, { status: 400 });
  }

  const MAX_OUTFIT_ATTEMPTS = 3;
  let attemptCount = 0;

  while (attemptCount < MAX_OUTFIT_ATTEMPTS) {
    attemptCount++;
    console.log(`[validateWrapper] Outfit validation attempt ${attemptCount}/${MAX_OUTFIT_ATTEMPTS}`);

    // Call generateImageAsync with the current prompt
    let genRes = null;
    try {
      genRes = await base44.asServiceRole.functions.invoke('generateImageAsync', {
        messageId,
        prompt,
        subjectType,
        characterId,
        senderCharacterId,
        characterName,
        characterReferenceImages,
        userReferenceImages,
        userWorldName,
        characterEmotionalState,
      });
    } catch (genErr) {
      console.error(`[validateWrapper] generateImageAsync failed: ${genErr?.message}`);
      return Response.json({ error: genErr?.message || 'Image generation failed' }, { status: 500 });
    }

    if (!genRes?.data?.success) {
      return Response.json(genRes?.data || { error: 'Generation failed' }, { status: 422 });
    }

    const imageUrl = genRes.data.imageUrl;

    // Validate outfit if required
    if (!charOutfitText) {
      console.log(`[validateWrapper] No outfit text — accepting image as-is`);
      return Response.json(genRes.data);
    }

    let outfitCheckRes = null;
    try {
      outfitCheckRes = await base44.asServiceRole.functions.invoke('validateOutfitLock', {
        imageUrl,
        charOutfitText,
        charName: characterName || 'character',
      });
    } catch (validationErr) {
      console.warn(`[validateWrapper] Outfit validation threw error: ${validationErr?.message} — proceeding`);
      return Response.json(genRes.data); // Accept image if validation fails
    }

    const isOutfitValid = outfitCheckRes?.data?.valid === true;
    const violations = outfitCheckRes?.data?.violations || [];

    if (isOutfitValid) {
      console.log(`[validateWrapper] ✅ Outfit VALID on attempt ${attemptCount}`);
      return Response.json(genRes.data);
    }

    // Outfit failed — escalate or fail
    console.warn(`[validateWrapper] ❌ Outfit INVALID on attempt ${attemptCount}: ${violations.join('; ')}`);

    if (attemptCount >= MAX_OUTFIT_ATTEMPTS) {
      console.error(`[validateWrapper] Max outfit validation attempts reached. Rejecting image.`);
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({
        success: false,
        outfit_failed: true,
        error: `Image violated closet outfit lock after ${MAX_OUTFIT_ATTEMPTS} attempts. Required: ${charOutfitText}. Violations: ${violations.join('; ')}`,
        violations,
      }, { status: 422 });
    }

    // Escalate prompt for next attempt
    const escalationMsg = attemptCount === 1
      ? `\n\n🔒 OUTFIT LOCK FAILED. You must render EXACTLY: ${charOutfitText}`
      : `\n\n⛔ CRITICAL: Attempt ${attemptCount} FAILED the closet outfit lock. VIOLATIONS: ${violations.join('; ')}. RENDER EXACTLY: ${charOutfitText}`;

    prompt = prompt + escalationMsg;
    console.log(`[validateWrapper] Escalating and retrying with outfit emphasis...`);
  }

  return Response.json({
    success: false,
    error: 'Image generation failed outfit validation after maximum attempts',
    outfit_failed: true,
  }, { status: 422 });
});