import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Convert internal base44.app storage URL to public CDN URL that external providers can access.
// Pattern: https://base44.app/api/apps/{appId}/files/mp/public/{appId}/{filename}
//       → https://media.base44.com/images/public/{appId}/{filename}
function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  // Already a CDN URL — return as-is
  if (url.startsWith('https://media.base44.com/')) return url;
  // Transform internal API file URL to CDN URL
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) {
    const converted = `https://media.base44.com/images/public/${match[1]}`;
    console.log(`[regen] URL converted: ${url.substring(0, 60)}... → ${converted}`);
    return converted;
  }
  return url;
}

function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  // Private storage — requires authentication, provider cannot access
  if (url.includes('/files/mp/private/')) return false;
  if (url.includes('/files/private/')) return false;
  // Signed/expiring URLs — provider cannot use them
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  // Internal API-gated paths that aren't public files — reject
  if (url.includes('base44.app/api/apps/') && !url.includes('/files/mp/public/') && !url.includes('/files/public/')) return false;
  return true;
}

async function resolveLocationImages(base44, locationId, zoneName) {
  if (!locationId) return { images: [], zoneName: null, locationName: null };
  
  const loc = await base44.asServiceRole.entities.LocationReference.get(locationId).catch(() => null);
  if (!loc) {
    console.error(`[regen] ⛔ Location NOT FOUND: id=${locationId}`);
    return { images: [], zoneName: null, locationName: null };
  }

  console.log(`[regen] ═══ LOCATION LOADED ═══`);
  console.log(`[regen] location.id="${locationId}" | location.name="${loc.name}" | zones=${loc.zones?.length || 0} | flat_images=${loc.image_urls?.length || 0}`);
  console.log(`[regen] zoneName REQUESTED: "${zoneName || 'null'}"`);
  
  // AUDIT: log all zones in this location
  loc.zones?.forEach((z, i) => {
    console.log(`[regen]   Zone[${i}]: name="${z.zone_name}" | image_urls count=${z.image_urls?.length || 0}`);
    if (z.image_urls?.length > 0) {
      z.image_urls.slice(0, 2).forEach((url, ui) => {
        console.log(`[regen]     Image[${ui}]: ${url.substring(0, 80)}`);
      });
    }
  });

  let images = [];
  let resolvedZone = null;

  // STEP 1: Exact zone match (MANDATORY when zoneName provided)
  if (zoneName && loc.zones?.length > 0) {
    console.log(`[regen] STEP 1: Searching for exact zone match: "${zoneName}"`);
    const zone = loc.zones.find(z => z.zone_name && z.zone_name.toLowerCase() === zoneName.toLowerCase());
    if (zone) {
      console.log(`[regen] ✓ EXACT MATCH FOUND: zone.zone_name="${zone.zone_name}"`);
      const rawUrls = zone.image_urls || [];
      console.log(`[regen]   Raw zone.image_urls count: ${rawUrls.length}`);
      
      const filtered = rawUrls.map(url => {
        const converted = toPublicCDN(url);
        const accessible = isProviderAccessible(converted);
        console.log(`[regen]   URL: ${url.substring(0, 50)}... → ${accessible ? '✓ accessible' : '✗ NOT accessible'}`);
        return converted;
      }).filter(isProviderAccessible);
      
      images = filtered.slice(0, 6);
      resolvedZone = zone.zone_name;
      console.log(`[regen] ✓ ZONE MATCH RESULT: zone="${zone.zone_name}" | raw_urls=${rawUrls.length} | accessible=${images.length} | final_slot=${images.length}`);
    } else {
      const available = loc.zones?.map(z => z.zone_name).join(', ') || '(no zones)';
      console.error(`[regen] ⛔ STEP 1 FAILED: Zone "${zoneName}" NOT FOUND in location. Available zones: ${available}`);
    }
  } else {
    if (zoneName) {
      console.warn(`[regen] ⚠️ zoneName="${zoneName}" provided but no zones in location`);
    } else {
      console.log(`[regen] zoneName is null/empty — will use STEP 2 fallback`);
    }
  }

  // STEP 2: First zone with accessible images (ONLY if NO zoneName was requested)
  // CRITICAL: If user explicitly selected a zone and STEP 1 failed, DO NOT fall back to other zones.
  // This prevents the system from compositing images from multiple zones.
  if (zoneName && images.length === 0) {
    // User explicitly requested a zone but it has zero images — STOP here. No fallback.
    console.log(`[regen] ⛔ STRICT ZONE LOCK: User requested zone="${zoneName}" but it has no accessible images. NO FALLBACK to other zones.`);
    return { images: [], zoneName: null, locationName: loc.name };
  } else if (images.length === 0 && loc.zones?.length > 0) {
    console.log(`[regen] STEP 2: No zoneName requested. Finding first zone with accessible images...`);
    const firstZone = loc.zones.find(z => (z.image_urls || []).map(toPublicCDN).some(isProviderAccessible));
    if (firstZone) {
      const rawUrls = firstZone.image_urls || [];
      images = rawUrls.map(toPublicCDN).filter(isProviderAccessible).slice(0, 6);
      resolvedZone = firstZone.zone_name;
      console.log(`[regen] ✓ STEP 2 RESULT: using first zone="${resolvedZone}" | raw_urls=${rawUrls.length} | accessible=${images.length}`);
    } else {
      console.warn(`[regen] ⚠️ STEP 2 FAILED: no zone with accessible images found`);
    }
  }

  // STEP 3: Flat location images (ONLY if NO zoneName was requested)
  // If user explicitly selected a zone, we already returned early above. So STEP 3 only fires
  // when zoneName was null/empty and no zone-based images were found.
  if (images.length === 0 && !zoneName && loc.image_urls?.length > 0) {
    console.log(`[regen] STEP 3: No zoneName requested. Using flat location.image_urls...`);
    const rawUrls = loc.image_urls;
    images = rawUrls.map(toPublicCDN).filter(isProviderAccessible).slice(0, 6);
    console.log(`[regen] ✓ STEP 3 RESULT: flat_images | raw=${rawUrls.length} | accessible=${images.length}`);
  }

  console.log(`[regen] ═══ resolveLocationImages FINAL RESULT ═══`);
  console.log(`[regen] location="${loc.name}" | resolvedZone="${resolvedZone || '(none — fallback used)'}" | images_count=${images.length}`);
  if (images.length > 0) {
    images.slice(0, 3).forEach((url, i) => {
      console.log(`[regen]   Image[${i}]: ${url.substring(0, 80)}`);
    });
  }
  return { images, zoneName: resolvedZone, locationName: loc.name };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt, manualLocationId, manualZoneId } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });
    
    console.log(`[regen] ▶ REQUEST: messageId=${messageId} | reason=${reason} | manualLocationId=${manualLocationId || 'NONE'} | manualZoneId=${manualZoneId || 'NONE'}`);

    // Fetch the message
    let message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message) {
      const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
      message = msgList?.[0] || null;
    }
    if (!message) return Response.json({ error: 'Message not found', success: false }, { status: 404 });

    const ctx = message.generation_context || {};
    const originalPrompt = ctx.prompt || null;
    const originalCharId = ctx.character_id || message.character_id || null;
    const originalSubjectType = ctx.subject_type || 'character';

    // Fetch character
    let character = null;
    if (originalCharId) {
      const charListUser = await base44.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
      character = charListUser?.[0] || null;
      if (!character) character = await base44.asServiceRole.entities.Character.get(originalCharId).catch(() => null);
      if (!character) {
        const charList = await base44.asServiceRole.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
        character = charList?.[0] || null;
      }
      if (!character && message?.created_by) {
        const charList2 = await base44.asServiceRole.entities.Character.filter({ id: originalCharId, created_by: message.created_by }, null, 1).catch(() => []);
        character = charList2?.[0] || null;
      }
    }
    console.log(`[regen] Character: ${character?.name || 'NOT FOUND'} (id=${originalCharId || 'none'})`);

    const charName = character?.name || 'the character';
    // Build safe appearance description — strip outfit/clothing entirely (it may contain sensitive content
    // that triggers content filters). Only use physical/demographic descriptors.
    const charDesc = [character?.appearance_notes, character?.age_range, character?.gender, character?.ethnicities?.join(', ')].filter(Boolean).join(', ');

    // Build character reference images
    // Always CDN-convert ALL refs first, then filter for provider accessibility.
    // For flawed/no_avatar: use ALL available refs (avatar + reference_image_urls) for max identity lock.
    // For other reasons: avatar_url only as primary, with reference_image_urls as supplemental.
    const isFlawed = reason === 'flawed';
    const isNoAvatar = reason === 'no_avatar';
    const avatarUrl = character?.avatar_url ? toPublicCDN(character.avatar_url) : null;
    let charRefImages = [];
    if (avatarUrl && isProviderAccessible(avatarUrl)) {
      charRefImages.push(avatarUrl);
      console.log(`[regen] ✓ Using character avatar_url (CDN): ${avatarUrl.substring(0, 80)}`);
    } else {
      console.warn(`[regen] ⚠️ avatar_url not accessible (raw="${character?.avatar_url?.substring(0, 60) || 'null'}")`);
    }
    // For flawed/no_avatar: add all accessible reference_image_urls for maximum identity fidelity
    if ((isFlawed || isNoAvatar) && character?.reference_image_urls?.length > 0) {
      for (const ref of character.reference_image_urls) {
        const converted = toPublicCDN(ref);
        if (isProviderAccessible(converted) && !charRefImages.includes(converted)) {
          charRefImages.push(converted);
        } else if (!isProviderAccessible(toPublicCDN(ref))) {
          console.warn(`[regen] ⚠️ reference_image_url inaccessible after CDN conversion: ${ref?.substring(0, 60)}`);
        }
      }
      console.log(`[regen] ${reason} mode: expanded charRefImages to ${charRefImages.length} (avatar + reference_image_urls)`);
    }

    // ── HARD FAIL: zero usable identity refs for character-centered request ───
    // reason=no_avatar specifically means identity correction — cannot proceed without refs.
    // reason=flawed means full re-render — cannot proceed without refs.
    // reason=wrong_location only: location is being corrected, identity uses whatever is available.
    // For ALL other reasons with zero refs: also hard fail to prevent random-person generation.
    const characterCenteredReasons = ['no_avatar', 'flawed', 'dont_like', 'custom_prompt'];
    if (originalCharId && charRefImages.length === 0) {
      console.error(`[regen] ⛔ HARD FAIL — ZERO USABLE IDENTITY REFS for character "${charName}" (id=${originalCharId})`);
      console.error(`[regen] avatar_url raw: "${character?.avatar_url?.substring(0, 80) || 'null'}"`);
      console.error(`[regen] reference_image_urls count: ${character?.reference_image_urls?.length ?? 0}`);
      console.error(`[regen] All identity refs are stored as private/internal URLs the provider cannot access.`);
      console.error(`[regen] reason="${reason}" — refusing to dispatch, would generate a random person.`);
      console.error(`[regen] FIX: Re-upload avatar via character photo editor to store as media.base44.com CDN URL.`);
      return Response.json({
        success: false,
        identity_refs_count: 0,
        character_id: originalCharId,
        character_name: charName,
        error: `No usable identity reference images found for "${charName}". The character's photos may be stored as private URLs. Re-upload the avatar photo to fix this.`,
      }, { status: 422 });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // LOCATION RESOLUTION — STRICT PRIORITY ORDER
    //
    // RULE: manualLocationId ALWAYS wins. It must be resolved FIRST.
    //       Nothing from the original generation context may override it.
    //       The original location refs are DISCARDED when manual is provided.
    // ══════════════════════════════════════════════════════════════════════════
    
    let locationRefImages = [];
    let effectiveLocationName = null;
    let effectiveZoneName = null;
    let effectiveLocationId = null;

    if (manualLocationId) {
      // ── PATH A: USER EXPLICITLY SELECTED A LOCATION (AND OPTIONALLY ZONE) ─
      // This is the HIGHEST PRIORITY. Do NOT mix with original context.
      console.log(`[regen] ═══ PATH A: MANUAL LOCATION SELECTED ═══`);
      console.log(`[regen] manualLocationId="${manualLocationId}" | manualZoneId="${manualZoneId || '(none — will auto-detect if multiple zones)'}" | reason="${reason}"`);
      
      effectiveLocationId = manualLocationId;
      const resolved = await resolveLocationImages(base44, manualLocationId, manualZoneId || null);
      locationRefImages = resolved.images;
      effectiveZoneName = resolved.zoneName;
      effectiveLocationName = resolved.locationName;

      // CRITICAL VALIDATION: if user explicitly selected a zone but got zero images, HALT
      if (manualZoneId && locationRefImages.length === 0) {
        console.error(`[regen] ⛔ CRITICAL FAILURE: User selected zone "${manualZoneId}" in location "${effectiveLocationName}", but resolveLocationImages returned ZERO images`);
        console.error(`[regen] This means zone.image_urls is empty or all URLs are inaccessible`);
        console.error(`[regen] SYSTEM RULE: Cannot fall back to generic or different zone when user explicitly selected "${manualZoneId}"`);
        return Response.json({
          success: false,
          error: `Zone "${manualZoneId}" in "${effectiveLocationName}" has no reference images. Add photos to this zone before regenerating.`,
          location_id: manualLocationId,
          location_name: effectiveLocationName,
          zone_requested: manualZoneId,
          zone_has_images: false,
          environment_refs_count: 0,
        }, { status: 422 });
      }

      if (locationRefImages.length === 0) {
        console.error(`[regen] ⛔ HARD HALT: Manual location "${effectiveLocationName}" (${manualLocationId}) resolved ZERO accessible images`);
        console.error(`[regen] Zone requested: "${manualZoneId || 'none (auto-detect will use first zone with images)'}"`) ;
        console.error(`[regen] SYSTEM RULE: Cannot generate without environment reference images. This is a data issue with the location record.`);
        return Response.json({
          success: false,
          error: `Location "${effectiveLocationName}" has no accessible reference images. Add photos to this location's zones before generating from it.`,
          location_id: manualLocationId,
          location_name: effectiveLocationName,
          zone_requested: manualZoneId || null,
          environment_refs_count: 0,
        }, { status: 422 });
      } else {
        console.log(`[regen] ✓ MANUAL LOCATION RESOLVED: "${effectiveLocationName}" → zone="${effectiveZoneName || '(first auto-detected)'}" | ${locationRefImages.length} images loaded`);
        locationRefImages.slice(0, 3).forEach((url, i) => {
          console.log(`[regen]   Image[${i}]: ${url.substring(0, 80)}`);
        });
      }

    } else {
      // ── PATH B: NO MANUAL SELECTION — USE ORIGINAL CONTEXT OR CHARACTER FILE ─
      console.log(`[regen] ═══ PATH B: NO MANUAL LOCATION — using original context or character file ═══`);
      
      // Try original generation context location first
      const originalLocationId = ctx.location_id || null;
      const originalZoneName = ctx.zone_name || null;
      const originalLocationRefs = (ctx.location_reference_images || []).filter(isProviderAccessible);

      if (originalLocationRefs.length > 0 && originalLocationId) {
        // Use original context location refs
        locationRefImages = originalLocationRefs.slice(0, 6);
        effectiveLocationId = originalLocationId;
        effectiveZoneName = originalZoneName;
        effectiveLocationName = ctx.location_name || null;
        console.log(`[regen] ✓ Using original context location: "${effectiveLocationName}" | zone="${effectiveZoneName}" | ${locationRefImages.length} images`);
      } else {
        // No usable original refs — look up from character file
        let fallbackLocationId = null;
        if (character) {
          fallbackLocationId = character.resolved_current_location_id || character.current_home_location_id || character.home_location_id || null;
          if (!fallbackLocationId) {
            // Scan resident locations
            const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: message.created_by || user.email }, '-created_date', 100).catch(() => []);
            const residentHome = savedLocs.find(l =>
              l.category === 'home' &&
              ((l.resident_character_ids || []).includes(originalCharId) || (l.residents || []).some(r => r.character_id === originalCharId))
            );
            if (residentHome) fallbackLocationId = residentHome.id;
          }
        }

        if (fallbackLocationId) {
          // Derive zone hint from original prompt
          let zoneHint = null;
          const pLower = (originalPrompt || '').toLowerCase();
          if (/\b(kitchen|stove|fridge|counter|oven|pancake|breakfast)\b/.test(pLower)) zoneHint = 'kitchen';
          else if (/\b(bedroom|bed|sleeping|nightstand)\b/.test(pLower)) zoneHint = 'bedroom';
          else if (/\b(bathroom|shower|bathtub|toilet)\b/.test(pLower)) zoneHint = 'bathroom';
          else if (/\b(living room|couch|sofa|tv|lounge)\b/.test(pLower)) zoneHint = 'living room';
          else if (/\b(backyard|patio|deck|yard)\b/.test(pLower)) zoneHint = 'backyard';

          const resolved = await resolveLocationImages(base44, fallbackLocationId, zoneHint);
          locationRefImages = resolved.images;
          effectiveZoneName = resolved.zoneName;
          effectiveLocationName = resolved.locationName;
          effectiveLocationId = fallbackLocationId;
        }
      }
    }

    // ── HARD HALT: no location images resolved at all ─────────────────────────
    // If we reach here with zero location images, we have no environment authority.
    // Avatar background WILL fill the vacuum — this violates the core system rule.
    // STOP immediately instead of generating a generic room.
    if (locationRefImages.length === 0) {
      console.error(`[regen] ⛔ HARD HALT — zero location images resolved`);
      console.error(`[regen] PATH=${manualLocationId ? 'A (manual)' : 'B (auto)'} | char=${character?.name || 'unknown'} | effectiveLocationId=${effectiveLocationId || 'null'}`);
      console.error(`[regen] Without environment reference images, the provider has no room authority.`);
      console.error(`[regen] FIX: Add reference photos to the character's assigned location, or select a different location with images.`);
      return Response.json({
        success: false,
        error: 'No environment reference images could be found for this character. Assign a location with zone photos before regenerating.',
        location_name: effectiveLocationName || null,
        environment_refs_count: 0,
      }, { status: 422 });
    }

    const hasLocation = locationRefImages.length > 0;
    const locationLabel = [effectiveLocationName, effectiveZoneName].filter(Boolean).join(' → ');

    // Slot allocation — mirrors generateImageAsync strict role separation
    const LOC_SLOT  = Math.min(locationRefImages.length, 4);
    const CHAR_SLOT = Math.min(charRefImages.length, 2);
    const locIdxStart  = 1;
    const locIdxEnd    = LOC_SLOT;
    const charIdxStart = LOC_SLOT + 1;
    const charIdxEnd   = LOC_SLOT + CHAR_SLOT;

    console.log(`[regen] ═══ FINAL RESOLUTION ═══`);
    console.log(`[regen] hasLocation=${hasLocation} | locationLabel="${locationLabel}" | loc_images=${locationRefImages.length} (LOC_SLOT=${LOC_SLOT})`);
    console.log(`[regen] charRefImages=${charRefImages.length} (CHAR_SLOT=${CHAR_SLOT})`);
    console.log(`[regen] ref_roles: loc=idx${locIdxStart}-${locIdxEnd} | char=idx${charIdxStart}-${charIdxEnd}`);

    // ── ROLE PREAMBLE — must be the FIRST thing the model reads ──────────────
    // Explicit index-to-role assignment prevents avatar background from bleeding into environment.
    let rolePreamble = '';
    if (LOC_SLOT > 0 && CHAR_SLOT > 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST:
Images 1-${LOC_SLOT}: ROOM ENVIRONMENT ONLY — photographs of the ACTUAL ROOM ("${locationLabel}"). Authority: 80% on the physical room. Use ONLY for: flooring, walls, furniture pieces and colors, layout, windows, curtains, lighting fixtures, decor. This room must appear IDENTICAL in the output — same sofa color, same rug, same shelves, same artwork, same lamps. Do NOT redesign it.
Images ${charIdxStart}-${charIdxEnd}: CHARACTER IDENTITY ONLY — photos of the person. Authority: 90-100% on the person. Use ONLY for: face, skin, hair, body type, markings.
⛔ AVATAR BACKGROUND = 0%: Any room, wall, furniture, or scenery visible BEHIND the person in images ${charIdxStart}-${charIdxEnd} is COMPLETELY IRRELEVANT. The room comes from images 1-${LOC_SLOT} only.
⛔ DO NOT blend these two image sets. They serve entirely separate roles.

`;
    } else if (LOC_SLOT === 0 && CHAR_SLOT > 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT:
Images 1-${CHAR_SLOT}: CHARACTER IDENTITY ONLY. Use only for: face, skin, hair, body type. The background behind the person in these photos is unrelated to this scene - ignore it completely. Build the environment from the text prompt.

`;
    } else if (LOC_SLOT > 0 && CHAR_SLOT === 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT:
Images 1-${LOC_SLOT}: SCENE ENVIRONMENT ONLY (${locationLabel}). Use for: flooring, walls, furniture, layout, windows. No character identity images provided - render the character from the text description.

`;
    }

    const qualityFooter = `\nABSOLUTE RULES: No floating text, no overlays, no watermarks. Photorealistic photograph only.`;

    // ── ROOM CONTINUITY LOCK ──────────────────────────────────────────────────
    const roomLock = hasLocation ? `

════════════════════════════════════════════════════════════
ROOM CONTINUITY LOCK — "${locationLabel}"
════════════════════════════════════════════════════════════
Reference images 1-${LOC_SLOT} are PHOTOGRAPHS OF THIS EXACT ROOM. This is NOT inspiration. This is NOT a style reference. This IS the actual room.

MANDATORY — these must match the reference images exactly:
  ✅ Sofa/couch: same color, type, shape, placement — DO NOT change color
  ✅ Coffee table: same type, material, placement
  ✅ Rug: same pattern, tone, size relationship
  ✅ Curtains/blinds: same type, color, position
  ✅ Wall art: same placement, count, frames
  ✅ Shelving: same type, placement, structure
  ✅ Lighting fixtures: same ceiling lights, same lamps, same positions
  ✅ Room layout: same furniture arrangement and spacing
  ✅ Decor objects: same vases, books, plants, ornaments

ONLY these may vary:
  ✓ Camera angle and framing
  ✓ Subject position within the room
  ✓ Natural lighting intensity

ABSOLUTE BANS:
  ⛔ DO NOT change the sofa color or replace it with a different sofa
  ⛔ DO NOT redesign the rug
  ⛔ DO NOT change curtain style or replace window treatments
  ⛔ DO NOT remove or replace shelving
  ⛔ DO NOT swap artwork
  ⛔ DO NOT change lighting fixtures
  ⛔ DO NOT rearrange the room layout
  ⛔ DO NOT rebuild a new room around the character — place the character into THIS room
  ⛔ DO NOT use the background from character identity photos as the room

SUCCESS: A viewer must look at the reference image and the generated image and recognize THE SAME ROOM.
FAILURE: If any furniture, decor, or layout element changed — it is a continuity failure, not a creative liberty.` : '';

    // ── BUILD PROMPT BY REASON ────────────────────────────────────────────────
    let corePrompt = '';

    if (reason === 'flawed') {
      // FLAWED = maximum fidelity re-render. Something fundamental broke — body morphing,
      // wrong room, incorrect furniture, texture glitches, or both environment and character
      // were corrupted simultaneously. This is a hard restart with every fidelity constraint
      // cranked to maximum. Keep the original scene intent but enforce everything strictly.
      const sceneDesc = originalPrompt || `${charName} in a natural candid scene`;

      corePrompt = `${sceneDesc}${roomLock}

════════════════════════════════════════════════════════════
MAXIMUM FIDELITY RE-RENDER — FLAWED IMAGE CORRECTION
════════════════════════════════════════════════════════════
The previous image had fundamental rendering failures (body morphing, incorrect room layout,
furniture in wrong positions, texture glitches, or mixed environment/character corruption).
This is a HARD RESTART. Every constraint below is NON-NEGOTIABLE.

ROOM FIDELITY — ZERO TOLERANCE FOR DRIFT:
  ⛔ Every piece of furniture must match the reference photos in color, shape, and position
  ⛔ No floating objects, no warped geometry, no merged surfaces
  ⛔ Walls, floor, and ceiling must be flat, clean, and consistent
  ⛔ No duplicate furniture elements or impossible room geometry
  ⛔ Lighting must be coherent — no impossible shadows or multiple conflicting light sources

CHARACTER FIDELITY — EXACT MATCH REQUIRED:
  ⛔ Body proportions must be anatomically correct — no extra limbs, no fused fingers, no elongated necks
  ⛔ Face must match the identity reference exactly — same bone structure, skin tone, eye shape, hair
  ⛔ Clothing must sit naturally on the body — no texture bleeding, no clipping
  ⛔ Hands and feet must have correct finger/toe counts and natural proportions
  ⛔ No body parts merged with furniture or environment

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
Ultra high-resolution photorealistic photograph. No artifacts, no distortion, no rendering errors.${qualityFooter}`;

    } else if (reason === 'wrong_location') {
      // WRONG LOCATION: rebuild scene from the correct location reference images.
      const sceneDesc = hasLocation
        ? `${charName} in the ${effectiveZoneName || effectiveLocationName || 'room'}.`
        : (originalPrompt || `${charName} in a natural candid scene`);

      const locationOverride = hasLocation ? `

LOCATION CORRECTION: The environment is "${locationLabel}". Reference images 1-${LOC_SLOT} are photographs of this exact room. Reproduce those exact walls, floor, furniture, lighting, and decor. Do not use any room or background visible in the character identity photos.` : '';

      corePrompt = `${sceneDesc}${roomLock}${locationOverride}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
Ultra high-resolution photorealistic photograph.${qualityFooter}`;

    } else if (reason === 'no_avatar') {
      const isMultiPerson = originalSubjectType === 'joint';
      corePrompt = `${originalPrompt || `${charName} in a natural candid scene`}${roomLock}

EXTREME CHARACTER LIKENESS REQUIREMENT for ${charName}:
Match exactly: face structure, eyes, nose, mouth, skin tone, hair (color/texture/LENGTH/style), body type.
Do NOT invent or approximate. The reference photos ARE this person.${isMultiPerson ? '\nMULTI-PERSON: Each person must have a distinctly different face from the reference photos.' : ''}
Photorealistic photograph. Natural lighting.${qualityFooter}`;

    } else if ((reason === 'dont_like' || reason === 'custom_prompt') && customPrompt) {
      corePrompt = `${customPrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `Environment authority: reference images 1–${LOC_SLOT} (80% on room). Character identity: reference images ${charIdxStart}–${charIdxEnd} (person only).` : `Character identity: ${charName}. Avatar background = 0% scene influence.`}
Photorealistic photograph.${qualityFooter}`;

    } else {
      corePrompt = `${originalPrompt || `${charName} in a natural candid scene`}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `Environment: images 1–${LOC_SLOT}. Character identity: images ${charIdxStart}–${charIdxEnd} (person only, background ignored).` : `Character identity only. Avatar background = 0% scene influence.`}
Photorealistic photograph.${qualityFooter}`;
    }

    // Role preamble goes FIRST — model must read role assignments before anything else
    const prompt = rolePreamble + corePrompt;
    
    console.log(`[regen] DEBUG-BEFORE-CONCAT: locationRefImages=${locationRefImages.length} (LOC_SLOT=${LOC_SLOT}) | charRefImages=${charRefImages.length} (CHAR_SLOT=${CHAR_SLOT})`);
    locationRefImages.slice(0, LOC_SLOT).forEach((u, i) => console.log(`[regen]   locRef[${i}]: ${u}`));
    charRefImages.slice(0, CHAR_SLOT).forEach((u, i) => console.log(`[regen]   charRef[${i}]: ${u}`));
    
    const referenceImages = [...locationRefImages.slice(0, LOC_SLOT), ...charRefImages.slice(0, CHAR_SLOT)].filter(Boolean);

    console.log(`[regen] ▶ GENERATING: reason=${reason} | refs=${referenceImages.length} (loc=${Math.min(locationRefImages.length,4)}, char=${Math.min(charRefImages.length,2)}) | locationLabel="${locationLabel}"`);

    // ── GENERATE ──────────────────────────────────────────────────────────────
    console.log(`[regen] ═══ FINAL PAYLOAD TO PROVIDER ═══`);
    console.log(`[regen] Prompt (first 200 chars): ${prompt.substring(0, 200)}`);
    console.log(`[regen] Reference images (count=${referenceImages.length}):`);
    referenceImages.forEach((url, i) => {
      console.log(`[regen]   [${i}] ${url}`);
    });
    
    let genRes;
    try {
      genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });
    } catch (genErr) {
      const msg = genErr?.message || '';
      if (msg.includes('filtered') || msg.includes('guidelines') || msg.includes('blocked') || msg.includes('violated')) {
        return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
      }
      throw genErr;
    }

    if (!genRes?.url) return Response.json({ success: false, error: 'Generation returned no URL' }, { status: 500 });

    // Write result back to the exact message
    const targetMsg = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!targetMsg || targetMsg.id !== messageId) {
      console.error(`[regen] ⛔ ID MISMATCH: requested=${messageId} got=${targetMsg?.id || 'null'}`);
      return Response.json({ success: false, error: 'Message ID mismatch — aborting write' }, { status: 400 });
    }
    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });
    console.log(`[regen] ✓ SUCCESS: message ${messageId} updated with new image`);

    if (character?.id) {
      base44.asServiceRole.entities.Memory.create({
        character_id: character.id,
        title: `Sent a regenerated photo`,
        description: `The user regenerated a photo (reason: ${reason}).`,
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