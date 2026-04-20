import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt, manualLocationId, manualZoneId } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });

    // Fetch the message
    const messages = await base44.asServiceRole.entities.Message.filter({ id: messageId });
    const message = messages[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    // ── RESTORE ORIGINAL GENERATION CONTEXT ──────────────────────────────────
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

    // Build character reference images
    let charRefImages = originalCharRefs.length > 0
      ? originalCharRefs
      : [character?.avatar_url, ...(character?.reference_image_urls || [])].filter(Boolean);

    // Fetch location reference images if needed
    let locationRefImages = originalLocationRefs;
    if (locationRefImages.length === 0 && (originalLocationId || manualLocationId)) {
      try {
        const locId = manualLocationId || originalLocationId;
        const loc = await base44.asServiceRole.entities.LocationReference.get(locId).catch(() => null);
        if (loc) {
          const zoneToUse = manualZoneId || originalZoneName;
          if (zoneToUse && loc.zones?.length > 0) {
            const zone = loc.zones.find(z => z.zone_name === zoneToUse);
            if (zone?.image_urls?.length > 0) {
              locationRefImages = zone.image_urls.slice(0, 6);
              console.log(`[regen] Zone "${zoneToUse}" images: ${locationRefImages.length}`);
            }
          }
          if (locationRefImages.length === 0 && loc.zones?.length > 0) {
            const firstZone = loc.zones.find(z => z.image_urls?.length > 0);
            if (firstZone) {
              locationRefImages = firstZone.image_urls.slice(0, 6);
              console.log(`[regen] Auto-zone "${firstZone.zone_name}" images: ${locationRefImages.length}`);
            }
          }
          if (locationRefImages.length === 0 && loc.image_urls?.length > 0) {
            locationRefImages = loc.image_urls.slice(0, 6);
            console.log(`[regen] Location flat images: ${locationRefImages.length}`);
          }
        }
      } catch (err) {
        console.warn('[regen] Location image fetch failed:', err.message);
      }
    }

    // If user manually selected a correct location, override the stored generation context
    let effectiveLocationId = originalLocationId;
    let effectiveZoneName = originalZoneName;
    let effectiveLocationName = originalLocationName;
    if (manualLocationId) {
      effectiveLocationId = manualLocationId;
      effectiveZoneName = manualZoneId || null;
      const manualLoc = await base44.asServiceRole.entities.LocationReference.get(manualLocationId).catch(() => null);
      if (manualLoc) {
        effectiveLocationName = manualLoc.name;
        locationRefImages = [];
        if (effectiveZoneName && manualLoc.zones?.length > 0) {
          const zone = manualLoc.zones.find(z => z.zone_name === effectiveZoneName);
          if (zone?.image_urls?.length > 0) locationRefImages = zone.image_urls.slice(0, 3);
        }
        if (locationRefImages.length === 0) {
          const firstZone = manualLoc.zones?.find(z => z.image_urls?.length > 0);
          locationRefImages = firstZone?.image_urls?.slice(0, 3) || manualLoc.image_urls?.slice(0, 3) || [];
          if (!effectiveZoneName && firstZone) effectiveZoneName = firstZone.zone_name;
        }
      }
    }

    const hasLocation = locationRefImages.length > 0;
    const locationLabel = [effectiveLocationName, effectiveZoneName].filter(Boolean).join(' → ');

    // ── ROOM LOCK BLOCK ────────────────────────────────────────────────────────
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
    let referenceImages;
    let prompt = '';

    if (reason === 'wrong_location' || reason === 'flawed') {
      // Fix technical errors AND enforce location/zone + character fidelity strictly
      const scenePrompt = originalPrompt
        ? originalPrompt
        : `${charName} in a natural candid scene`;

      // For 'wrong_location', emphasize that the user-selected location is the PRIMARY fix
      const locationEmphasis = (reason === 'wrong_location' && hasLocation)
        ? `
THE USER SELECTED A CORRECT LOCATION — THIS IS THE PRIMARY FIX:
The first ${locationRefImages.length} reference image(s) ARE GROUND TRUTH photographs of the exact room the user specified.
HIGHEST PRIORITY: Match the room/zone perfectly. Study these location reference images with extreme care.
• Reproduce: flooring, walls, furniture positions, placement, window treatments, lighting, decorative objects, colors
• This is the most important correction — get the location right
The character must be placed INSIDE this specific room/zone — not a similar one, not an invented variation.`
        : '';

      prompt = `${scenePrompt}${roomLock}${locationEmphasis}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
REFERENCE PHOTOS ARE THE SOURCE OF TRUTH for both the room and the person.

TECHNICAL CORRECTION PASS — fix these issues from the previous render:
• Perfect human anatomy: correct proportions, exactly 5 fingers per hand, no extra or merged limbs
• Natural facial symmetry, correct eye gaze, no artifacts or distortions
• Furniture must not overlap, clip, or block access points (doors, closets, walkways)
• No floating objects. Physically believable placement of all elements.

CHARACTER HAIR — STRICT:
• Hair LENGTH must exactly match the reference photos — do NOT shorten or lengthen
• Hair texture, curl pattern, color, and style must also match the reference precisely

Ultra high-resolution photorealistic photograph. Real photo, not illustration.${qualityFooter}`;

      // For 'wrong_location', prioritize location refs heavily. For 'flawed', balance.
      const isWrongLoc = reason === 'wrong_location';
      referenceImages = [
        ...locationRefImages.slice(0, isWrongLoc ? 5 : 4),  // More location refs if user specified wrong location
        ...charRefImages.slice(0, isWrongLoc ? 2 : 3),      // Fewer char refs to emphasize location fix
      ].filter(Boolean);

    } else if (reason === 'no_avatar') {
      // Same scene, same location — push hard on character likeness
      const scenePrompt = originalPrompt
        ? originalPrompt
        : `${charName} in a natural candid scene`;

      // Detect if multiple people should be in this image
      const isMultiPerson = originalSubjectType === 'joint' || (originalCharRefs.length > 0 && originalLocationRefs.some(ref => ref.includes('both') || ref.includes('together')));
      const multiPersonNote = isMultiPerson ? `

CRITICAL — MULTIPLE PEOPLE IN THIS IMAGE:
• There are multiple distinct individuals. Each person must have a DIFFERENT face — no person appears twice.
• Reference all provided avatars and ensure each person is uniquely identifiable.
• Even if people are similar in appearance (e.g. siblings), they MUST have subtle but clear differences: slightly different nose shape, eye spacing, facial structure, or bone structure.
• Every face in the image must correspond to one of the provided reference photos.` : '';

      prompt = `${scenePrompt}${roomLock}

EXTREME CHARACTER LIKENESS REQUIREMENT${isMultiPerson ? ' (MULTI-PERSON)' : ''} for ${charName}:
The reference photos define ${isMultiPerson ? 'each person\'s' : 'this person\'s'} exact appearance. Match with maximum fidelity:
• FACE: Exact facial bone structure, jaw, cheekbones, forehead, chin — replicate from reference
• EYES: Exact shape, size, spacing, color, expression
• NOSE & MOUTH: Exact nose shape, lip shape, mouth structure
• SKIN: Exact complexion, undertone, skin texture, any marks
• HAIR: Exact color, texture, cut, LENGTH, style — replicate precisely. Do NOT shorten or lengthen.
• BODY: Exact build, height proportions, posture
• FACIAL HAIR: Match exactly — if the reference shows none, generate none; if it shows a beard, match it
Do NOT invent, average, or approximate. The reference photos ARE the people.${multiPersonNote}
${charDesc ? `Additional context: ${charDesc}.` : ''}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 3),
      ].filter(Boolean);

    } else if (reason === 'dont_like' && customPrompt) {
      prompt = `${customPrompt}${roomLock}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `REFERENCE IMAGE ORDER: First ${locationRefImages.length} image(s) = THE ROOM — locked environment. Remaining images = ${charName} — replicate their exact face and appearance.` : `CRITICAL: Subject is ${charName}. Replicate their exact face, features, and appearance.`}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 3),
      ].filter(Boolean);

    } else if (reason === 'custom_prompt' && customPrompt) {
      prompt = `${customPrompt}${roomLock}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `REFERENCE IMAGE ORDER: First ${locationRefImages.length} image(s) = THE ROOM. Remaining = ${charName}.` : `Subject is ${charName}. Replicate their exact appearance from reference photos.`}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 3),
      ].filter(Boolean);

    } else {
      const scenePrompt = originalPrompt || `${charName} in a natural candid scene`;
      prompt = `${scenePrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}. Photorealistic photograph.${qualityFooter}`;
      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 3),
      ].filter(Boolean);
    }

    console.log(`[regen] reason=${reason} | hasLocation=${hasLocation} | locationLabel="${locationLabel}" | manualLocationId=${manualLocationId || 'none'} | originalPrompt="${(originalPrompt || '').substring(0, 80)}" | refs=${referenceImages.length}`);

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

    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });

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