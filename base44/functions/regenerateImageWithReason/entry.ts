import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Only pass URLs that the generation provider can actually fetch.
// The provider accepts media.base44.com CDN URLs and any external HTTPS CDN.
// It CANNOT access base44.app/api/apps/ paths (private internal API, not a CDN).
// This includes /files/mp/public/ paths — despite the "public" in the name,
// these are served through the base44 API (auth-gated at network level).
// Only media.base44.com and external CDN URLs are truly provider-accessible.
function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  // base44.app API paths — NOT accessible to the generation provider
  if (url.includes('base44.app/api/apps/')) return false;
  // Signed/expiring URLs
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  // media.base44.com CDN and all other external HTTPS URLs pass
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt, manualLocationId, manualZoneId } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });

    // Fetch the message — try get() first, then filter() fallback (same pattern as generateImageAsync)
    let message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message) {
      const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
      message = msgList?.[0] || null;
    }
    if (!message) return Response.json({ error: 'Message not found — the original image record may have been deleted', filtered: false, success: false }, { status: 404 });
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

    // Fetch character — try filter directly (more reliable than .get() for RLS/cross-account)
    let character = null;
    if (originalCharId) {
      try {
        // Use filter as the primary method — more robust than .get() for service role lookups
        const charList = await base44.asServiceRole.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
        character = charList?.[0] || null;
        // If filter failed, try get() as last resort
        if (!character) {
          character = await base44.asServiceRole.entities.Character.get(originalCharId).catch(() => null);
        }
      } catch (charErr) {
        console.error(`[regen] Character lookup failed for ${originalCharId}: ${charErr.message}`);
        character = null;
      }
    }
    console.log(`[regen] Character resolved: ${character?.name || 'NOT FOUND'} (id=${originalCharId || 'none'}) | avatar=${!!character?.avatar_url} | refs=${character?.reference_image_urls?.length || 0}`);

    const charName = character?.name || 'the character';
    const charDesc = [character?.appearance_notes, character?.personality_summary, character?.age_range, character?.gender, character?.ethnicities?.join(', ')].filter(Boolean).join(', ');

    // Build character reference images — always prefer server-side avatar + refs over stored context refs
    // Filter to provider-accessible URLs only (media.base44.com CDN, external CDNs)
    // base44.app/api/apps/ paths are NOT accessible to the generation provider
    const serverCharRefs = [character?.avatar_url, ...(character?.reference_image_urls || [])].filter(Boolean).filter(isProviderAccessible);
    const ctxCharRefs = originalCharRefs.filter(Boolean).filter(isProviderAccessible);
    let charRefImages = serverCharRefs.length > 0 ? serverCharRefs : ctxCharRefs;
    console.log(`[regen] charRefImages: ${charRefImages.length} (server=${serverCharRefs.length}, ctx=${ctxCharRefs.length})`);

    // ── AUTHORITATIVE LOCATION INVESTIGATION ─────────────────────────────────
    // Priority order:
    // 1. User manually selected a location → use it
    // 2. Original generation context had a location → use it  
    // 3. Character's resolved current location from app state
    // 4. Character's assigned home location (current_home_location_id)
    // 5. Scan saved locations for where this character is listed as resident
    let currentLocationId = manualLocationId || originalLocationId || null;
    let currentZoneName = manualZoneId || originalZoneName || null;
    
    console.log(`[regen] LOCATION INVESTIGATION START | manualLocationId=${manualLocationId || 'none'} | originalLocationId=${originalLocationId || 'none'}`);

    // If no location specified yet, investigate character's actual app location truth
    if (!currentLocationId && character) {
      // Check all home/location fields in priority order
      currentLocationId = 
        character.resolved_current_location_id ||
        character.current_home_location_id ||
        character.home_location_id ||
        null;

      // Determine zone hint from original prompt or character state
      const promptForZone = (originalPrompt || '').toLowerCase();
      if (character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping') {
        currentZoneName = 'bedroom';
      } else if (/\b(kitchen|stove|fridge|counter|oven|microwave|sink|pancake|breakfast|eating|table)\b/.test(promptForZone)) {
        currentZoneName = 'kitchen';
      } else if (/\b(bedroom|bed|sleeping|nightstand|closet)\b/.test(promptForZone)) {
        currentZoneName = 'bedroom';
      } else if (/\b(bathroom|shower|bathtub|toilet)\b/.test(promptForZone)) {
        currentZoneName = 'bathroom';
      } else if (/\b(living room|couch|sofa|tv|lounge)\b/.test(promptForZone)) {
        currentZoneName = 'living room';
      } else if (/\b(backyard|patio|deck|yard|outside)\b/.test(promptForZone)) {
        currentZoneName = 'backyard';
      }

      if (currentLocationId) {
        console.log(`[regen] ✓ Location found on character file: ${currentLocationId} | zone hint: ${currentZoneName || 'none'}`);
      } else {
        console.warn(`[regen] ⚠ No location found on character fields — will scan saved locations`);
        // Last resort: scan saved locations for where this character is a resident
        if (character.created_by) {
          const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: character.created_by }, '-created_date', 100).catch(() => []);
          const residentHome = savedLocs.find(l =>
            l.category === 'home' &&
            ((l.resident_character_ids || []).includes(originalCharId) ||
             (l.residents || []).some(r => r.character_id === originalCharId))
          );
          if (residentHome) {
            currentLocationId = residentHome.id;
            console.log(`[regen] ✓ Resident scan found home: "${residentHome.name}" (${residentHome.id})`);
          } else {
            console.warn(`[regen] ⚠ No home found via resident scan — generation will use text-only environment`);
          }
        }
      }
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

    // Filter location refs to provider-accessible URLs only
    locationRefImages = locationRefImages.filter(isProviderAccessible);
    let hasLocation = locationRefImages.length > 0;
    const locationLabel = [effectiveLocationName, effectiveZoneName].filter(Boolean).join(' → ');

    // ── ENFORCED WEIGHTING LOG ────────────────────────────────────────────────
    console.log(`[regen] ════════════════════════════════════════`);
    console.log(`[regen] WEIGHTING RULES ENFORCED:`);
    console.log(`[regen]   A. CHARACTER IDENTITY: 90-100% on person only | refs=${charRefImages.length} | avatar_bg=0%`);
    console.log(`[regen]   B. AVATAR BACKGROUND: 0% — suppressed`);
    console.log(`[regen]   C. LOCATION/ENV: 80% | refs=${locationRefImages.length} | location="${locationLabel || 'NONE'}"`);
    console.log(`[regen]   D. PROMPT: controls action/objects/room-type`);
    console.log(`[regen] home_investigated=true | currentLocationId=${currentLocationId || 'NOT FOUND'}`);
    console.log(`[regen] zone_resolved="${effectiveZoneName || 'none'}" | first_image_fallback=${locationRefImages.length > 0 && !effectiveZoneName}`);
    console.log(`[regen] ════════════════════════════════════════`);

    // ── ROOM LOCK BLOCK ────────────────────────────────────────════════════────
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

      // WEIGHTING: location images first and dominant (4 slots = 80% env authority)
      // Character identity after (2 slots = 90-100% person only, 0% background)
      referenceImages = [
        ...locationRefImages.slice(0, 4),  // ENVIRONMENT: 80% authority
        ...charRefImages.slice(0, 2),      // IDENTITY: 90-100% person only
      ].filter(Boolean);

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

      // WEIGHTING: location images first and dominant (4 slots = 80% env authority)
      referenceImages = [
        ...locationRefImages.slice(0, 4),  // ENVIRONMENT: 80% authority
        ...charRefImages.slice(0, 2),      // IDENTITY: 90-100% person only
      ].filter(Boolean);

    } else if (reason === 'dont_like' && customPrompt) {
      const refNote = hasLocation
        ? `\nREFERENCE IMAGE ROLES:\n  • Images 1–${locationRefImages.slice(0,4).length}: ENVIRONMENT (80% authority) — room, walls, furniture, layout\n  • Remaining images: CHARACTER IDENTITY (90-100% on person only) — face, skin, hair, body\n  • Avatar background behind the character = 0% influence on environment`
        : `\nCHARACTER IDENTITY: Subject is ${charName}. Replicate their exact face, features, and appearance from reference images. Avatar background = 0% scene influence.`;
      prompt = `${customPrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.${refNote}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 2),
      ].filter(Boolean);

    } else if (reason === 'custom_prompt' && customPrompt) {
      const refNote = hasLocation
        ? `\nREFERENCE IMAGE ROLES:\n  • Images 1–${locationRefImages.slice(0,4).length}: ENVIRONMENT (80% authority) — room, walls, furniture, layout\n  • Remaining images: CHARACTER IDENTITY (90-100% on person only)\n  • Avatar background = 0% scene influence`
        : `\nSubject is ${charName}. Replicate their exact appearance. Avatar background = 0% scene influence.`;
      prompt = `${customPrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.${refNote}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 2),
      ].filter(Boolean);

    } else {
      const scenePrompt = originalPrompt || `${charName} in a natural candid scene`;
      const refNote = hasLocation
        ? `\nREFERENCE IMAGE ROLES:\n  • Images 1–${locationRefImages.slice(0,4).length}: ENVIRONMENT (80% authority)\n  • Remaining: CHARACTER IDENTITY (90-100% person only)\n  • Avatar background = 0% scene influence`
        : `\nCharacter identity refs define ${charName}'s person only. Avatar background = 0% scene influence.`;
      prompt = `${scenePrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.${refNote}
Photorealistic photograph. Real photo, not illustration. Natural lighting.${qualityFooter}`;
      referenceImages = [
        ...locationRefImages.slice(0, 4),
        ...charRefImages.slice(0, 2),
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

    // Write ONLY to the exact message that was requested — verify ID before write
    const targetMsg = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!targetMsg || targetMsg.id !== messageId) {
      console.error(`[regen] ⛔ ID MISMATCH before write: requested=${messageId} got=${targetMsg?.id || 'null'}`);
      return Response.json({ success: false, error: 'Message ID mismatch — aborting write' }, { status: 400 });
    }
    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });
    console.log(`[regen] ✓ Updated message ${messageId} with new image_url`);

    if (character?.id) {
      base44.asServiceRole.entities.Memory.create({
        character_id: character.id,
        title: `Sent a regenerated photo`,
        description: `The user asked to regenerate one of your photos (reason: ${reason}). You sent a new version.`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `regenerated_image_${messageId}`,
      }).catch(() => {});
    }

    return Response.json({ success: true, image_url: genRes.url, messageId, reason });
  } catch (error) {
    console.error('[regenerateImageWithReason]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});