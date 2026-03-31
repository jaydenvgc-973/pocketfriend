import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });

    // Fetch the message
    const messages = await base44.asServiceRole.entities.Message.filter({ id: messageId });
    const message = messages[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    // Fetch character
    const character = message.character_id
      ? (await base44.asServiceRole.entities.Character.filter({ id: message.character_id }))[0]
      : null;

    const charName = character?.name || 'the character';
    const charDesc = [character?.appearance_notes, character?.personality_summary, character?.age_range, character?.gender].filter(Boolean).join(', ');

    // Build reference images — always prioritize avatar + reference photos
    // For flawed/no_avatar: repeat the avatar multiple times to force higher model weight on it
    const baseRefs = [];
    if (character?.avatar_url) baseRefs.push(character.avatar_url);
    if (character?.reference_image_urls?.length > 0) baseRefs.push(...character.reference_image_urls.slice(0, 3));

    let referenceImages = baseRefs;
    if ((reason === 'flawed' || reason === 'no_avatar') && character?.avatar_url) {
      // Repeat avatar 3x at the front so the model heavily weights it
      referenceImages = [
        character.avatar_url,
        character.avatar_url,
        character.avatar_url,
        ...baseRefs.filter(u => u !== character.avatar_url),
      ];
    }

    // Reconstruct base context from conversation
    let baseContext = '';
    if (message.conversation_id) {
      const nearby = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: message.conversation_id },
        '-created_date',
        10
      );
      const idx = nearby.findIndex(m => m.id === messageId);
      const context = idx >= 0 ? nearby.slice(idx + 1, idx + 4) : nearby.slice(0, 4);
      const userMsg = context.find(m => m.sender_type === 'user');
      if (userMsg) baseContext = `User asked: "${userMsg.content}"`;
    }

    // Build prompt based on reason
    let prompt = '';

    // Shared quality footer appended to every prompt
    const qualityFooter = `\nABSOLUTE RULES — NO EXCEPTIONS: No floating text anywhere in the image. No text overlays, captions, labels, or watermarks of any kind. No brand logos or stamps. Clean image only.`;

    if (reason === 'custom_prompt' && customPrompt) {
      // User wrote their own prompt — apply it with character context and quality requirements
      prompt = `Photorealistic photo of ${charName}${charDesc ? ` (${charDesc})` : ''}. ${customPrompt}
Natural lighting, authentic photo quality. Real photograph — not illustration or painting. Perfect anatomy, no artifacts.${qualityFooter}`;
    } else if (reason === 'flawed') {
      // Reuse the same scene/context but drastically increase reference photo adherence and fix technical issues
      prompt = `Photorealistic portrait photo of ${charName}${charDesc ? ` (${charDesc})` : ''}. ${baseContext}
REFERENCE PHOTOS ARE MANDATORY: The provided reference images define this person's exact appearance. You MUST reproduce their face, skin tone, hair, and features with maximum fidelity — treat the reference photos as the authoritative source.
TECHNICAL FIX REQUIREMENTS: Perfect human anatomy, correct proportions, natural hands with exactly 5 fingers, realistic skin texture, no artifacts, no distortions, no extra or merged limbs, correct facial symmetry, natural eye gaze. Ultra high-resolution, professional photography quality. Natural lighting. Real photograph — not an illustration, painting, or digital render.${qualityFooter}`;
    } else if (reason === 'no_avatar') {
      // Maximum possible likeness enforcement — face, hair, structure all overemphasized
      prompt = `Photorealistic photo of ${charName}. ${baseContext}
EXTREME LIKENESS REQUIREMENT: The reference photos provided are the SOLE source of truth for what this person looks like. You MUST replicate with extreme precision:
- FACE: Exact facial bone structure, jaw shape, cheekbones, forehead width, chin shape — pixel-perfect match to references.
- EYES: Exact eye shape, size, spacing, color, and expression from the reference photos.
- NOSE & MOUTH: Exact nose shape, lip shape, and mouth structure as shown in references.
- SKIN: Exact complexion, undertone, skin texture, and any distinguishing marks from references.
- HAIR: Exact hair color, texture, cut, length, style, and how it falls — replicate precisely.
Do NOT invent, average, or approximate. The reference photos ARE this person. ${charDesc ? `Additional context: ${charDesc}.` : ''}
Candid, natural lighting, authentic photo quality. Real photograph — not an illustration or painting.${qualityFooter}`;
    } else {
      // dont_like — fresh take, same character
      prompt = `Photorealistic portrait photo of ${charName}${charDesc ? ` (${charDesc})` : ''}. ${baseContext}
Fresh composition and framing — different angle, different lighting mood, different expression than before. Keep the same person and their consistent appearance from references, but try a new creative take. Authentic, candid, natural lighting. Real photograph quality.${qualityFooter}`;
    }

    // Generate the image
    let genRes;
    try {
      genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });
    } catch (genErr) {
      const msg = genErr?.message || '';
      const isFiltered = msg.includes('filtered') || msg.includes('guidelines') || msg.includes('blocked') || msg.includes('violated');
      if (isFiltered) {
        return Response.json({ success: false, filtered: true, error: 'This image was blocked by the content filter. Try rephrasing the prompt to avoid suggestive or explicit content.' });
      }
      throw genErr;
    }

    if (!genRes?.url) return Response.json({ success: false, error: 'Generation returned no URL' }, { status: 500 });

    // Update message with new image
    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });

    // Store memory so character remembers sending a regenerated image
    if (character?.id) {
      await base44.asServiceRole.entities.Memory.create({
        character_id: character.id,
        title: `Sent a regenerated photo`,
        description: `The user asked to regenerate one of your photos (reason: ${reason === 'flawed' ? 'image was flawed' : reason === 'no_avatar' ? 'did not look like you' : 'they wanted a different one'}). You sent a new version.`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `regenerated_image_${messageId}`,
      });
    }

    return Response.json({ success: true, image_url: genRes.url });
  } catch (error) {
    console.error('[regenerateImageWithReason]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});