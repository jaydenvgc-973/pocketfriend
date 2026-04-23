import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt, manualLocationId, manualZoneId } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });

    // Fetch the message — use direct get for exact message ID binding (no wrong-message substitution)
    const message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });
    console.log(`[regen] REQUEST: messageId=${messageId} | reason=${reason} | message.character_id=${message.character_id || 'none'} | has_generation_context=${!!message.generation_context}`);

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

    // Fetch the character's current location and zone to resolve proper imagery
    let currentLocationId = originalLocationId || manualLocationId || null;
    let currentZoneName = originalZoneName || manualZoneId || null;
    
    // If no location specified, fetch character's resolved location
    if (!currentLocationId && character) {
      currentLocationId = character.resolved_current_location_id || character.current_home_location_id;
      currentZoneName = character.resolved_location_type === 'home' ? 'bedroom' : null;
      if (character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping') {
        currentZoneName = 'bedroom';
      }
      console.log(`[regen] Fetched character location: ${currentLocationId} | zone hint: ${currentZoneName}`);
    }

    // Fetch location reference images from the resolved location + zone
    let locationRefImages = originalLocationRefs;
    if (locationRefImages.length === 0 && currentLocationId) {
      try {
        const loc = await base44.asServiceRole.entities.LocationReference.get(currentLocationId).catch(() => null);
        if (loc) {
          // Try to find the exact zone
          if (currentZoneName && loc.zones?.length > 0) {
            const zone = loc.zones.find(z => z.zone_name?.toLowerCase() === currentZoneName.toLowerCase());
            if (zone?.image_urls?.length > 0) {
              locationRefImages = zone.image_urls.slice(0, 6);
              console.log(`[regen] Matched zone "${currentZoneName}" at "${loc.name}": ${locationRefImages.length} images`);
            }
          }
          // Fallback: first zone with images
          if (locationRefImages.length === 0 && loc.zones?.length > 0) {
            const firstZone = loc.zones.find(z => z.image_urls?.length > 0);
            if (firstZone) {
              locationRefImages = firstZone.image_urls.slice(0, 6);
              currentZoneName = firstZone.zone_name;
              console.log(`[regen] Auto-resolved zone "${currentZoneName}" at "${loc.name}": ${locationRefImages.length} images`);
            }
          }
          // Fallback: location flat images
          if (locationRefImages.length === 0 && loc.image_urls?.length > 0) {
            locationRefImages = loc.image_urls.slice(0, 6);
            console.log(`[regen] Using location flat images at "${loc.name}": ${locationRefImages.length}`);
          }
        }
      } catch (err) {
        console.warn('[regen] Location image fetch failed:', err.message);
      }
    }

    // Use the resolved location and zone
    let effectiveLocationId = currentLocationId;
    let effectiveZoneName = currentZoneName;
    let effectiveLocationName = originalLocationName;
    
    // Fetch location name if we have ID
    if (effectiveLocationId && !effectiveLocationName) {
      try {
        const loc = await base44.asServiceRole.entities.LocationReference.get(effectiveLocationId).catch(() => null);
        if (loc) effectiveLocationName = loc.name;
      } catch (err) {
        console.warn('[regen] Failed to fetch location name:', err.message);
      }
    }
    
    // If user manually selected a different location, override
    if (manualLocationId && manualLocationId !== effectiveLocationId) {
      effectiveLocationId = manualLocationId;
      effectiveZoneName = manualZoneId || null;
      locationRefImages = [];
      const manualLoc = await base44.asServiceRole.entities.LocationReference.get(manualLocationId).catch(() => null);
      if (manualLoc) {
        effectiveLocationName = manualLoc.name;
        if (effectiveZoneName && manualLoc.zones?.length > 0) {
          const zone = manualLoc.zones.find(z => z.zone_name?.toLowerCase() === effectiveZoneName.toLowerCase());
          if (zone?.image_urls?.length > 0) locationRefImages = zone.image_urls.slice(0, 6);
        }
        if (locationRefImages.length === 0 && manualLoc.zones?.length > 0) {
          const firstZone = manualLoc.zones.find(z => z.image_urls?.length > 0);
          if (firstZone) {
            locationRefImages = firstZone.image_urls.slice(0, 6);
            effectiveZoneName = firstZone.zone_name;
          }
        }
        if (locationRefImages.length === 0 && manualLoc.image_urls?.length > 0) {
          locationRefImages = manualLoc.image_urls.slice(0, 6);
        }
      }
    }

    let hasLocation = locationRefImages.length > 0;
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
      // ── STRICT LOCATION REBUILD FOR WRONG_LOCATION ────────────────────────
      // When reason === 'wrong_location', the environment MUST be completely rebuilt.
      // The original prompt is NO LONGER AUTHORITATIVE for scene description.
      // Only the location and character identity are preserved.
      let scenePrompt = '';
      if (reason === 'wrong_location' && hasLocation) {
        // HARD OVERRIDE: Build scene description EXCLUSIVELY from corrected location
        scenePrompt = `A scene at ${effectiveLocationName}${effectiveZoneName ? ` in the ${effectiveZoneName}` : ''}.`;
      } else if (reason === 'wrong_location') {
        // No location images — use generic description without old environment language
        scenePrompt = `${charName} in a scene.`;
      } else {
        // reason === 'flawed' — preserve original intent but not environment language
        scenePrompt = originalPrompt
          ? originalPrompt.replace(/\b(bedroom|home|apartment|house|morning|night|sunrise|sunset|waking|sleeping|bed|couch|sofa|living room|kitchen|bathroom|backyard|patio|lying in|laying in|in bed|at home|at my place|sitting on|standing in a room)\b/gi, '')
          : `${charName} in a natural candid scene`;
      }

      // For 'wrong_location', ABSOLUTELY MANDATE location is the ONLY source for scenery
      const locationEmphasis = (reason === 'wrong_location' && hasLocation)
        ? `
════════════════════════════════════════════════════════════
⛔ LOCATION OVERRIDE — ABSOLUTE RULE ⛔
════════════════════════════════════════════════════════════
THE USER CORRECTED THE LOCATION. THIS IS A HARD ENVIRONMENT RESET.

The first ${locationRefImages.length} reference image(s) ARE GROUND TRUTH photographs of the exact location:
${effectiveLocationName}${effectiveZoneName ? ` → ${effectiveZoneName}` : ''}

CRITICAL ENFORCEMENT:
✗ DO NOT use any background, room, or environment from character avatar photos
✗ DO NOT preserve old scene data from the original wrong location
✗ DO NOT use generic home/bedroom/indoor language
✗ DO NOT blend avatar environment into the new location

✓ REBUILD the entire scene from the corrected location reference images
✓ Match the location's exact spatial context, fixtures, and atmosphere
✓ The ONLY source for scenery is the location reference images and location type

This is NOT a soft adjustment. This is a complete environment rebuild.
════════════════════════════════════════════════════════════`
        : '';

      // Verify location images were actually retrieved
      if ((reason === 'wrong_location' || reason === 'flawed') && hasLocation && locationRefImages.length === 0) {
        console.warn(`[regen] ⚠️ WARNING: Location marked as having images but none were resolved. Using prompt-only generation.`);
        hasLocation = false;
      }

      prompt = `${scenePrompt}${roomLock}${locationEmphasis}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.

AVATAR SEPARATION RULE (MANDATORY):
Character reference images determine ONLY:
  ✓ Face shape, facial features, skin tone
  ✓ Hair texture, length, color
  ✓ Body type and proportions
  ✓ Age presentation

Character reference images do NOT determine:
  ✗ Background or room scenery
  ✗ Environmental context from avatar photo
  ✗ Any environmental elements
  
LOCATION SOURCE RULE:
The location is determined EXCLUSIVELY by:
  ✓ Location reference images provided
  ✓ Location name and zone
  ✓ Location category and type
  ✗ NOT by character avatar background

TECHNICAL CORRECTION PASS — fix these issues from the previous render:
• Perfect human anatomy: correct proportions, exactly 5 fingers per hand, no extra or merged limbs
• Natural facial symmetry, correct eye gaze, no artifacts or distortions
• Furniture must not overlap, clip, or block access points (doors, closets, walkways)
• No floating objects. Physically believable placement of all elements.

CHARACTER HAIR — STRICT:
• Hair LENGTH must exactly match the reference photos — do NOT shorten or lengthen
• Hair texture, curl pattern, color, and style must also match the reference precisely

Ultra high-resolution photorealistic photograph. Real photo, not illustration.${qualityFooter}`;

      // For 'wrong_location', LOCATION IMAGES MUST COME FIRST AND BE DOMINANT
      // This ensures the model locks the space before rendering the character
      const isWrongLoc = reason === 'wrong_location';
      if (isWrongLoc && locationRefImages.length > 0) {
        // LOCATION FIRST: Maximum location images, minimal character refs
        referenceImages = [
          ...locationRefImages.slice(0, 6),  // Full location dataset for space lock
          ...charRefImages.slice(0, 1),      // Minimal char ref after location is locked
        ].filter(Boolean);
      } else {
        // Fallback for 'flawed' or no location
        referenceImages = [
          ...locationRefImages.slice(0, isWrongLoc ? 4 : 3),
          ...charRefImages.slice(0, isWrongLoc ? 3 : 3),
        ].filter(Boolean);
      }

    } else if (reason === 'no_avatar') {
      // Character likeness issue — use ONLY facial/body features from avatar, NOT environment
      // Location must come from resolved location reference images, NOT avatar background
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

      const avatarSeparationWarning = `

CRITICAL — AVATAR SEPARATION RULE:
Reference photos of ${charName} ARE ONLY FOR:
  ✓ Facial bone structure, jaw, cheekbones, forehead, chin
  ✓ Eye shape, size, spacing, color
  ✓ Nose shape, lip shape, mouth structure
  ✓ Skin complexion, undertone, texture, marks
  ✓ Hair color, texture, cut, length, style
  ✓ Body type, height proportions, build, posture
  ✓ Facial hair (beard, stubble, etc.)

Reference photos are NEVER for:
  ✗ Background, scenery, room environment
  ✗ Avatar photo setting or location context
  ✗ Bedroom walls, furniture, or indoor background
  ✗ Avatar photo lighting or time-of-day context

Location MUST ONLY come from location reference images provided (${effectiveLocationName}${effectiveZoneName ? ` → ${effectiveZoneName}` : ''}).`;

      prompt = `${scenePrompt}${roomLock}

EXTREME CHARACTER LIKENESS REQUIREMENT${isMultiPerson ? ' (MULTI-PERSON)' : ''} for ${charName}:
The reference photos define ${isMultiPerson ? 'each person\'s' : 'this person\'s'} exact appearance. Match facial and body features with maximum fidelity:
• FACE: Exact facial bone structure, jaw, cheekbones, forehead, chin — replicate from reference
• EYES: Exact shape, size, spacing, color, expression
• NOSE & MOUTH: Exact nose shape, lip shape, mouth structure
• SKIN: Exact complexion, undertone, skin texture, any marks
• HAIR: Exact color, texture, cut, LENGTH, style — replicate precisely. Do NOT shorten or lengthen.
• BODY: Exact build, height proportions, posture
• FACIAL HAIR: Match exactly — if reference shows none, generate none; if it shows a beard, match it
Do NOT invent, average, or approximate. The reference photos ARE the people.${multiPersonNote}${avatarSeparationWarning}
${charDesc ? `Additional context: ${charDesc}.` : ''}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      // LOCATION IMAGES MUST COME FIRST so model locks the space before rendering character
      // This prevents avatar background from contaminating the scene
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

    // ── PRE-GENERATION VALIDATION ─────────────────────────────────────────────
    // CRITICAL: Verify prompt matches resolved location before generation
    if (reason === 'wrong_location' && hasLocation) {
      const promptLower = prompt.toLowerCase();
      const locationLower = (effectiveLocationName || '').toLowerCase();
      const zoneLower = (effectiveZoneName || '').toLowerCase();
      
      // Check for avatar-contamination patterns that indicate wrong environment
      const avatarEnvPatterns = /\b(my bedroom|lying in bed|morning selfie|waking up|sleeping|bedroom at home|home interior|apartment|house|living room from avatar)\b/i;
      if (avatarEnvPatterns.test(prompt) && !avatarEnvPatterns.test(originalPrompt)) {
        console.warn(`[regen] ⚠️ AVATAR CONTAMINATION DETECTED in regenerated prompt — removing environment language`);
        // Strip avatar-derived environment language
        prompt = prompt.replace(avatarEnvPatterns, '');
      }
      
      // Verify location name appears in prompt or location images exist
      if (locationRefImages.length === 0 && !promptLower.includes(locationLower) && !promptLower.includes(zoneLower)) {
        console.warn(`[regen] ⚠️ LOCATION MISMATCH: Prompt does not reference "${effectiveLocationName}". Force-injecting location context.`);
        prompt = `At ${effectiveLocationName}${effectiveZoneName ? ` in the ${effectiveZoneName}` : ''}: ${prompt}`;
      }
      
      console.log(`[regen] Pre-generation validation passed for wrong_location correction`);
    }

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

    if (!genRes?.url) {
      return Response.json({ success: false, error: 'Generation returned no URL' }, { status: 500 });
    }

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

    return Response.json({ success: true, image_url: genRes.url, reason });
  } catch (error) {
    console.error('[regenerateImageWithReason]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});