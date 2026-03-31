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

    // ── RESTORE ORIGINAL GENERATION CONTEXT ──────────────────────────────────
    // Always pull the stored context first. This is the authoritative source.
    const ctx = message.generation_context || {};
    const originalPrompt = ctx.prompt || null;
    const originalCharId = ctx.character_id || message.character_id || null;
    const originalLocationId = ctx.location_id || null;
    const originalZoneName = ctx.zone_name || null;
    const originalLocationName = ctx.location_name || null;
    const originalLocationRefs = ctx.location_reference_images || [];
    const originalCharRefs = ctx.character_reference_images || [];
    const originalSubjectType = ctx.subject_type || 'character';

    // Fetch character for appearance metadata
    const character = originalCharId
      ? (await base44.asServiceRole.entities.Character.get(originalCharId).catch(() => null))
      : null;

    const charName = character?.name || 'the character';
    const charDesc = [character?.appearance_notes, character?.personality_summary, character?.age_range, character?.gender, character?.ethnicities?.join(', ')].filter(Boolean).join(', ');

    // Build character reference images: prefer stored context refs, fall back to character record
    let charRefImages = originalCharRefs.length > 0
      ? originalCharRefs
      : [character?.avatar_url, ...(character?.reference_image_urls || [])].filter(Boolean);

    // Fetch location reference images if we have a location_id and the stored refs are empty
    let locationRefImages = originalLocationRefs;
    if (locationRefImages.length === 0 && originalLocationId) {
      try {
        const loc = await base44.asServiceRole.entities.LocationReference.get(originalLocationId).catch(() => null);
        if (loc) {
          if (originalZoneName && loc.zones?.length > 0) {
            const zone = loc.zones.find(z => z.zone_name === originalZoneName);
            if (zone?.image_urls?.length > 0) locationRefImages = zone.image_urls.slice(0, 3);
          }
          if (locationRefImages.length === 0) {
            const firstZone = loc.zones?.find(z => z.image_urls?.length > 0);
            locationRefImages = firstZone?.image_urls?.slice(0, 3) || loc.image_urls?.slice(0, 3) || [];
          }
        }
      } catch (_) {}
    }

    const hasLocation = locationRefImages.length > 0;
    const locationLabel = [originalLocationName, originalZoneName].filter(Boolean).join(' → ');

    // ── ROOM LOCK BLOCK (reused from generateImageAsync logic) ─────────────────
    const roomLock = hasLocation ? `

════════════════════════════════════════════════════════════
ENVIRONMENT IDENTITY LOCK: ${locationLabel}
════════════════════════════════════════════════════════════
The first ${locationRefImages.length} reference image(s) are GROUND TRUTH photographs of this specific room/zone.
YOU ARE REGENERATING A PHOTO OF THE EXACT SAME SPACE.
Reproduce: flooring, walls, furniture positions, window treatments, lighting, decorative objects — everything.
ACCESS POINTS ARE SACRED: Do NOT block doors, closets, or walkways. No furniture overlap. Room must be physically usable.
ONLY the camera angle and subject placement may change.
════════════════════════════════════════════════════════════` : '';

    // ── QUALITY FOOTER ────────────────────────────────────────────────────────
    const qualityFooter = `\nABSOLUTE RULES: No floating text, no overlays, no watermarks, no brand logos. Photorealistic photograph only.`;

    // ── REFERENCE IMAGE ASSEMBLY ──────────────────────────────────────────────
    // Location refs always come first (environment anchor), then character refs
    let referenceImages;
    let prompt = '';

    if (reason === 'flawed') {
      // Same scene, same everything — just fix technical/rendering errors
      // Use original prompt verbatim. Add a hidden anatomy/quality correction pass.
      const scenePrompt = originalPrompt
        ? originalPrompt
        : `${charName} in a natural candid scene`;

      prompt = `${scenePrompt}${roomLock}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
REFERENCE PHOTOS ARE THE SOURCE OF TRUTH for both the room and the person.

TECHNICAL CORRECTION PASS — fix these issues from the previous render:
• Perfect human anatomy: correct proportions, exactly 5 fingers per hand, no extra or merged limbs
• Natural facial symmetry, correct eye gaze, no artifacts or distortions
• Furniture must not overlap, clip, or block access points (doors, closets, walkways)
• Room layout must match the reference images exactly — same floor, walls, furniture positions
• No floating objects. Physically believable placement of all elements.
Ultra high-resolution photorealistic photograph. Real photo, not illustration.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 3),
        ...charRefImages.slice(0, 4),
      ].filter(Boolean);

    } else if (reason === 'no_avatar') {
      // Same scene, same location — but push much harder on character likeness
      const scenePrompt = originalPrompt
        ? originalPrompt
        : `${charName} in a natural candid scene`;

      prompt = `${scenePrompt}${roomLock}

EXTREME CHARACTER LIKENESS REQUIREMENT for ${charName}:
The reference photos define this person's exact appearance. Match with maximum fidelity:
• FACE: Exact facial bone structure, jaw, cheekbones, forehead, chin — replicate from reference
• EYES: Exact shape, size, spacing, color, expression
• NOSE & MOUTH: Exact nose shape, lip shape, mouth structure
• SKIN: Exact complexion, undertone, skin texture, any marks
• HAIR: Exact color, texture, cut, length, style — replicate precisely
• BODY: Exact build, height proportions, posture
• FACIAL HAIR: Match exactly — if the reference shows none, generate none; if it shows a beard, match it
Do NOT invent, average, or approximate this person. The reference photos ARE this person.
${charDesc ? `Additional context: ${charDesc}.` : ''}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 3),
        ...charRefImages.slice(0, 4),
      ].filter(Boolean);

    } else if (reason === 'dont_like' && customPrompt) {
      // User edited the original prompt — use their edited version with same location/character refs
      prompt = `${customPrompt}${roomLock}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `REFERENCE IMAGE ORDER: First ${locationRefImages.length} image(s) = THE ROOM — locked environment. Remaining images = ${charName} — replicate their exact face and appearance.` : `CRITICAL: Subject is ${charName}. Replicate their exact face, features, and appearance.`}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 3),
        ...charRefImages.slice(0, 4),
      ].filter(Boolean);

    } else if (reason === 'custom_prompt' && customPrompt) {
      // Fully custom prompt — use whatever references the user context provides
      // Still include location and character refs as optional anchors
      prompt = `${customPrompt}${roomLock}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `REFERENCE IMAGE ORDER: First ${locationRefImages.length} image(s) = THE ROOM. Remaining = ${charName}.` : `Subject is ${charName}. Replicate their exact appearance from reference photos.`}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 3),
        ...charRefImages.slice(0, 4),
      ].filter(Boolean);

    } else {
      // Fallback: shouldn't normally hit this — treat as flawed retry
      const scenePrompt = originalPrompt || `${charName} in a natural candid scene`;
      prompt = `${scenePrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}. Photorealistic photograph.${qualityFooter}`;
      referenceImages = [
        ...locationRefImages.slice(0, 3),
        ...charRefImages.slice(0, 4),
      ].filter(Boolean);
    }

    console.log(`[regen] reason=${reason} | hasLocation=${hasLocation} | locationLabel="${locationLabel}" | originalPrompt="${(originalPrompt || '').substring(0, 80)}" | refs=${referenceImages.length}`);

    // ── GENERATE ──────────────────────────────────────────────────────────────
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
        return Response.json({ success: false, filtered: true, error: 'This image was blocked by the content filter. Try rephrasing the prompt.' });
      }
      throw genErr;
    }

    if (!genRes?.url) return Response.json({ success: false, error: 'Generation returned no URL' }, { status: 500 });

    // Update the message image — preserve the existing generation_context (prompt stays the same)
    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });

    // Memory
    if (character?.id) {
      await base44.asServiceRole.entities.Memory.create({
        character_id: character.id,
        title: `Sent a regenerated photo`,
        description: `The user asked to regenerate one of your photos (reason: ${reason}). You sent a new version.`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `regenerated_image_${messageId}`,
      }).catch(() => {});
    }

    return Response.json({ success: true, image_url: genRes.url });
  } catch (error) {
    console.error('[regenerateImageWithReason]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});