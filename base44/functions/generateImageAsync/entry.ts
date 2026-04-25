/**
 * generateImageAsync — Chat-triggered image generation.
 *
 * PIPELINE (strict, no guessing):
 *   1. character record → identity refs (avatar + reference_image_urls)
 *   2. character location fields → LocationReference → zone images → environment refs
 *   3. prompt → action, pose, camera, expression only
 *
 * RULES:
 *   - Identity refs control ONLY: face, skin, hair, body, markings
 *   - Avatar background → 0% influence on environment
 *   - Zone images control ONLY: room, furniture, decor, layout
 *   - No cross-account data. No guessing rooms. No avatar-as-background.
 *   - Hard fail only if required data is truly missing after all checks.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── URL UTILITIES ─────────────────────────────────────────────────────────────

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

// ── ZONE RESOLUTION ────────────────────────────────────────────────────────────
// STRICT ZONE ISOLATION: only the matched zone's images are ever used.
// No cross-zone fallback. No "first available zone" fallback.
// If a zone cannot be identified from the prompt, returns the single first zone (if only one exists),
// or null images (forcing no environment rather than wrong environment).

const ZONE_KEYWORD_MAP = [
  { keywords: ['bedroom', 'in bed', 'on the bed', 'sleeping', 'woke up', 'waking up', 'nightstand', 'duvet', 'pillow', 'mattress', 'my room', 'her room', 'his room'], zone: 'bedroom' },
  { keywords: ['kitchen', 'cooking', 'stove', 'fridge', 'oven', 'microwave', 'counter', 'pancake', 'breakfast', 'making food', 'grabbing food'], zone: 'kitchen' },
  { keywords: ['bathroom', 'shower', 'bathtub', 'toilet', 'vanity', 'brushing teeth', 'getting ready'], zone: 'bathroom' },
  { keywords: ['living room', 'couch', 'sofa', 'tv ', 'on the couch', 'lounge', 'sectional', 'watching tv', 'watching a movie'], zone: 'living room' },
  { keywords: ['backyard', 'patio', 'deck', 'yard', 'garden', 'grill', 'fire pit', 'outside at home'], zone: 'backyard' },
  { keywords: ['dining room', 'dining table', 'dinner table', 'eating at the table'], zone: 'dining room' },
  { keywords: ['office', 'desk', 'home office', 'workspace', 'working from home'], zone: 'office' },
  { keywords: ['gym', 'workout', 'weights', 'treadmill', 'lifting', 'training', 'exercise'], zone: 'gym' },
  { keywords: ['vip', 'vip section', 'vip lounge', 'vip area'], zone: 'vip' },
  { keywords: ['bar area', 'behind the bar', 'bartending', 'bar counter'], zone: 'bar area' },
  { keywords: ['dance floor', 'main floor', 'dancefloor', 'on the floor'], zone: 'main floor' },
  { keywords: ['rooftop', 'roof deck', 'rooftop bar', 'on the roof'], zone: 'rooftop' },
  { keywords: ['hallway', 'corridor', 'entryway', 'front door', 'foyer'], zone: 'hallway' },
  { keywords: ['balcony', 'on the balcony', 'balcony view'], zone: 'balcony' },
  { keywords: ['laundry', 'laundry room', 'washer', 'dryer'], zone: 'laundry' },
];

function resolveZoneFromLocation(location, promptLower) {
  const zones = (location.zones || []).filter(z => cdnFilter(z.image_urls || []).length > 0);

  if (zones.length === 0) {
    // No zones with images at all — use flat image_urls (last resort, no zone name)
    const flat = cdnFilter(location.image_urls || []).slice(0, 4);
    return { images: flat, zoneName: null };
  }

  // 1. Exact zone name match in prompt — highest priority
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilter(zone.image_urls).slice(0, 4);
      if (imgs.length > 0) {
        console.log(`[resolveZone] Exact zone name match: "${zone.zone_name}"`);
        return { images: imgs, zoneName: zone.zone_name };
      }
    }
  }

  // 2. Keyword-based zone match
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z =>
        z.zone_name && z.zone_name.toLowerCase().includes(entry.zone)
      );
      if (matched) {
        const imgs = cdnFilter(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) {
          console.log(`[resolveZone] Keyword match: prompt→"${entry.zone}" matched zone "${matched.zone_name}"`);
          return { images: imgs, zoneName: matched.zone_name };
        }
      }
    }
  }

  // 3. STRICT RULE: if only one zone exists, use it (unambiguous)
  if (zones.length === 1) {
    const imgs = cdnFilter(zones[0].image_urls).slice(0, 4);
    console.log(`[resolveZone] Only one zone exists — using "${zones[0].zone_name}"`);
    return { images: imgs, zoneName: zones[0].zone_name };
  }

  // 4. STRICT RULE: multiple zones, no match — do NOT guess. Return no images.
  // This prevents cross-zone contamination. The generation will proceed without env refs.
  console.warn(`[resolveZone] Multiple zones found but none matched prompt — returning NO env refs to avoid cross-zone contamination`);
  return { images: [], zoneName: null };
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────

function buildPrompt({ prompt, charName, charDesc, locationName, zoneName, envRefCount, charRefCount, userRefCount, userRefStart, charRefStart, envRefStart }) {
  const hasEnv  = envRefCount > 0;
  const hasChar = charRefCount > 0;
  const hasUser = userRefCount > 0;

  const envEnd    = envRefStart + envRefCount - 1;
  const charEnd   = charRefStart + charRefCount - 1;
  const userEnd   = userRefStart + userRefCount - 1;

  // Role preamble — model must read this first
  let preamble = '════════════════════════════════════════════════════════════\nREFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST\n════════════════════════════════════════════════════════════\n';

  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    preamble += `Images ${envRefStart}–${envEnd}: ROOM ENVIRONMENT — 90% AUTHORITY\nPhotographs of the "${zoneName || place}" ONLY. Use ONLY for: walls, floor, furniture, rug, curtains, lighting, decor, layout.\nYou MUST replicate this exact room. This is not inspiration. This is the room.\n\n`;
  }
  if (hasChar) {
    preamble += `Images ${charRefStart}–${charEnd}: CHARACTER IDENTITY — 90-100% AUTHORITY ON THE PERSON\n"${charName}" — Use ONLY for: face structure, skin tone, hair color/texture/length, body type, markings.\n\n⛔ BACKGROUND IN THESE PHOTOS = 0% INFLUENCE. Completely ignore: walls, windows, rooms, furniture, lighting behind the person.\n⛔ PROPS IN THESE PHOTOS = 0% INFLUENCE. Ignore any objects the person holds or wears (mugs, cups, hats, phones, bags) UNLESS the scene prompt specifically calls for them.\n⛔ POSE IN THESE PHOTOS = 0% INFLUENCE. Generate a new pose matching the scene prompt. Do NOT copy the pose from the reference photo.\n⛔ CLOTHING IN THESE PHOTOS = 0% INFLUENCE unless no outfit is specified. Generate contextually appropriate clothing.\n⛔ FACIAL HAIR STATE = match the reference, but do NOT fuse headwear or accessories into the hair.\n\n`;
  }
  if (hasUser) {
    preamble += `Images ${userRefStart}–${userEnd}: USER IDENTITY — 90-100% AUTHORITY ON THIS PERSON\nUse ONLY for: face, skin tone, hair, body type. Background = 0%.\n\n`;
  }
  preamble += '⛔ DO NOT blend image sets. Each set has one exclusive role.\n════════════════════════════════════════════════════════════\n\n';

  // Environment lock block
  let envLock = '';
  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    envLock = `

════════════════════════════════════════════════════════════
ENVIRONMENT LOCK — "${place}" — 90% VISUAL AUTHORITY
════════════════════════════════════════════════════════════
Reference images ${envRefStart}–${envEnd} are PHOTOGRAPHS of this exact room. REPLICATE it.
Insert the character into it. Do NOT redesign it.

MUST MATCH EXACTLY:
  ✅ Furniture types, colors, shapes, placement
  ✅ Wall color, floor type, rug color/pattern/placement
  ✅ Curtains and window treatments
  ✅ All lighting fixtures and lamps
  ✅ Wall art — same pieces, same positions
  ✅ Shelves, decor objects, room layout

ZERO OBJECT DRIFT:
  ⛔ No replaced, recolored, removed, or added objects
  ⛔ No "similar looking" substitutions
  ⛔ No generic room generation

STRICT ZONE ISOLATION — CROSS-ZONE CONTAMINATION IS FORBIDDEN:
  ⛔ Do NOT use furniture, decor, art, lighting, rugs, shelves, or objects from ANY other room
  ⛔ If the zone is "${zoneName || 'this room'}", only objects visible in images ${envRefStart}–${envEnd} may appear
  ⛔ A sofa from the living room must NOT appear in the bedroom
  ⛔ A shelf from the office must NOT appear in the kitchen
  ⛔ Wall art from the hallway must NOT appear in the living room
  ⛔ Every object in the output must come from these reference images — nothing else

10% FLEXIBILITY (only):
  ✓ Camera angle and framing
  ✓ Lighting intensity and softness
  ✓ Depth of field

FAILURE: Any furniture, decor, or layout element from a different room = CONTAMINATION FAILURE.
SUCCESS: Side-by-side comparison must show THE IDENTICAL ROOM with only objects from images ${envRefStart}–${envEnd}.`;
  }

  // Identity lock block
  let identityLock = '';
  if (hasChar) {
    identityLock += `

CHARACTER IDENTITY — "${charName}":
${charRefCount > 0
  ? `Images ${charRefStart}–${charEnd} are face/identity reference photographs of this person.${charDesc ? ` Physical description: ${charDesc}.` : ''}
Match ONLY: face structure, eyes, nose, mouth, skin tone, hair color/length/texture/style, body type.`
  : `No reference photos provided. Generate this person from text description ONLY: ${charDesc || 'no description available — generate a realistic human'}.`
}

CRITICAL GENERATION RULES FOR THIS PERSON:
✅ Generate a new, original pose appropriate to the scene described above
✅ Render natural, anatomically correct hands with exactly 5 fingers per hand
${charRefCount > 0 ? `✅ Reproduce their face and hair from the reference photos` : `✅ Render a realistic human face consistent with the text description`}
⛔ Do NOT copy the background or room from any reference photos — place the person in the environment specified by the scene prompt
⛔ Do NOT copy props from any reference photos (no mugs, cups, phones, bags) unless the scene prompt explicitly calls for them
⛔ Do NOT copy the pose from any reference photos — generate a fresh pose matching the scene
⛔ Do NOT fuse hats, headbands, or accessories INTO the hair — they must be physically separate objects sitting ON top of the hair
⛔ Do NOT generate extra, missing, or malformed fingers — exactly 5 fingers per visible hand
⛔ Do NOT generate a floating, composite, or physically impossible scene
⛔ Do NOT invent objects or furniture not present in the environment reference images`;
  }
  if (hasUser) {
    identityLock += `

USER IDENTITY:
Images ${userRefStart}–${userEnd} are photographs of this exact person.
Match: face structure, skin tone, hair, body type.
⛔ Do NOT generate a generic or random person.`;
  }

  return `${preamble}${prompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.${envLock}${identityLock}`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      prompt,
      subjectType,        // "character" | "user" | "joint"
      characterId,
      characterName,
      characterReferenceImages,   // UI-provided fallback refs
      userReferenceImages,
      userWorldName,
      characterEmotionalState,
      // manualLocationId is NOT used — location resolved from character record
    } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt are required' }, { status: 400 });
    }

    console.log(`[generateImageAsync] ▶ messageId=${messageId} | char=${characterId || 'none'} | subjectType=${subjectType}`);

    // ── 1. VERIFY MESSAGE ─────────────────────────────────────────────────────
    const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const message = msgList?.[0];
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }
    const requestingUser = message.created_by || user.email;

    // ── 2. RESOLVE CHARACTER ──────────────────────────────────────────────────
    let charRecord = null;
    let charRefs = [];
    let charDesc = '';

    if (characterId && (subjectType === 'character' || subjectType === 'joint')) {
      // Try user-scoped first, then service role with ownership check
      const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      charRecord = charListUser?.[0] || null;

      if (!charRecord) {
        const charListSR = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
        const candidate = charListSR?.[0] || null;
        if (candidate) {
          const owner = candidate.owner_email || candidate.created_by;
          if (owner && owner !== requestingUser) {
            console.error(`[generateImageAsync] ⛔ Cross-account character: ${characterId} owned by ${owner}, request from ${requestingUser}`);
            await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
            return Response.json({ error: 'Character does not belong to your account.' }, { status: 403 });
          }
          charRecord = candidate;
        }
      }

      if (charRecord) {
        // Build identity refs: prefer reference_image_urls ONLY (not avatar).
        // The avatar is often a raw uploaded photo — passing it as a reference causes the AI to
        // copy its pose, background, props, and lighting directly into generated scenes.
        // reference_image_urls are the canonical face/identity sources.
        // Only fall back to avatar if no reference images exist at all.
        const refUrls = cdnFilter(charRecord.reference_image_urls || []);
        if (refUrls.length > 0) {
          // Use reference images only — skip avatar to prevent pose/background bleed
          charRefs = refUrls.slice(0, 3);
        } else if (charRecord.avatar_url) {
          // No reference images — use avatar as last resort, capped at 1
          const avatarCdn = toPublicCDN(charRecord.avatar_url);
          if (isAccessible(avatarCdn)) charRefs = [avatarCdn];
        }
        console.log(`[generateImageAsync] Character "${charRecord.name}" — identity refs: ${charRefs.length} (from ${(charRecord.reference_image_urls || []).length} ref images, avatar as fallback: ${charRefs.length > 0 && (charRecord.reference_image_urls || []).length === 0})`);

        // Build appearance descriptor — rich text description used when no reference photos exist
        // This is the PRIMARY identity source for characters without reference_image_urls
        const parts = [
          charRecord.age_range ? `${charRecord.age_range} years old` : null,
          charRecord.gender,
          charRecord.ethnicities?.length > 0 ? charRecord.ethnicities.join('/') + ' ethnicity' : null,
          charRecord.appearance_notes || null,
          charRecord.avatar_description_text || null, // text description from photo uploader
        ].filter(Boolean);
        charDesc = parts.join(', ');
      }

      // Fallback to UI-provided refs if DB had none (only reference_image_urls — NOT avatar)
      // Note: Chat.jsx now only passes reference_image_urls (not avatar) as characterReferenceImages
      if (charRefs.length === 0 && characterReferenceImages?.length > 0) {
        charRefs = cdnFilter(characterReferenceImages).slice(0, 3);
        console.log(`[generateImageAsync] Using UI-provided charRefs (reference images only): ${charRefs.length}`);
      }

      // If still no refs: generate using text description ONLY — do NOT fall back to avatar_url.
      // Avatar photos (selfies, mirror shots) contaminate the entire scene with their background,
      // pose, props, and lighting. Text-only generation produces a clean, correct scene.
      if (charRefs.length === 0) {
        console.log(`[generateImageAsync] ℹ️ No reference images for "${characterName || characterId}" — will generate from text description only (no avatar fallback to prevent scene contamination)`);
        // charRefs stays empty — buildPrompt will omit identity ref block, charDesc carries the description
      }
    }

    // ── 3. RESOLVE USER IDENTITY ──────────────────────────────────────────────
    let userRefs = [];
    if (subjectType === 'user' || subjectType === 'joint') {
      // Try DB first
      if (requestingUser) {
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: requestingUser }, null, 1).catch(() => []);
        const sett = settingsList?.[0] || {};
        const dbUserRefs = [
          ...(sett.reference_image_urls || []),
          ...(sett.generated_avatar_urls || []),
        ];
        userRefs = cdnFilter(dbUserRefs).slice(0, 3);
      }
      // Fallback to UI-provided
      if (userRefs.length === 0 && userReferenceImages?.length > 0) {
        userRefs = cdnFilter(userReferenceImages).slice(0, 3);
      }
      console.log(`[generateImageAsync] User identity refs: ${userRefs.length}`);
    }

    // ── 4. RESOLVE ENVIRONMENT (location → zone → images) ────────────────────
    // Source of truth: character record location fields, in strict priority order.
    // No manual override. No guessing. No cross-account.
    let envRefs = [];
    let resolvedLocationName = null;
    let resolvedZoneName = null;

    if (charRecord) {
      // Priority order for location ID
      const locationId =
        charRecord.resolved_current_location_id ||
        charRecord.current_home_location_id ||
        charRecord.home_location_id ||
        charRecord.current_work_location_id ||
        charRecord.occupation_location_id ||
        null;

      console.log(`[generateImageAsync] Location ID from character record: ${locationId || 'NOT FOUND'}`);

      if (locationId) {
        // Verify location belongs to this user
        let locRecord = null;
        const locListUser = await base44.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
        locRecord = locListUser?.[0] || null;

        if (!locRecord) {
          const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
          const candidate = locListSR?.[0] || null;
          if (candidate) {
            const locOwner = candidate.owner_email || candidate.created_by;
            const isShared = candidate.scope === 'shared' || candidate.location_type === 'shared';
            if (locOwner && locOwner !== requestingUser && !isShared) {
              console.error(`[generateImageAsync] ⛔ Cross-account location: ${locationId} owned by ${locOwner}`);
              locRecord = null;
            } else {
              locRecord = candidate;
            }
          }
        }

        if (locRecord) {
          resolvedLocationName = locRecord.name;
          const promptLower = (prompt || '').toLowerCase();
          const { images, zoneName } = resolveZoneFromLocation(locRecord, promptLower);
          envRefs = images;
          resolvedZoneName = zoneName;
          console.log(`[generateImageAsync] ✓ Location "${locRecord.name}" → zone "${zoneName || 'none'}" → ${envRefs.length} env refs`);
        } else {
          console.warn(`[generateImageAsync] ⚠️ Location ${locationId} not found or access denied — proceeding without environment`);
        }
      } else {
        // No location on character — scan LocationReference records for resident match
        const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: requestingUser }, '-created_date', 50).catch(() => []);
        const residentHome = savedLocs.find(l =>
          l.category === 'home' &&
          ((l.resident_character_ids || []).includes(characterId) ||
           (l.residents || []).some(r => r.character_id === characterId))
        );
        if (residentHome) {
          resolvedLocationName = residentHome.name;
          const promptLower = (prompt || '').toLowerCase();
          const { images, zoneName } = resolveZoneFromLocation(residentHome, promptLower);
          envRefs = images;
          resolvedZoneName = zoneName;
          console.log(`[generateImageAsync] ✓ Resident scan found "${residentHome.name}" → zone "${zoneName || 'none'}" → ${envRefs.length} env refs`);
        } else {
          console.warn(`[generateImageAsync] ⚠️ No location found for character ${characterId} — proceeding without environment refs`);
        }
      }
    }

    // ── 5. ASSEMBLE REFS — env first (scene anchor), then identity ────────────
    const ENV_SLOTS  = Math.min(envRefs.length, 4);
    const CHAR_SLOTS = Math.min(charRefs.length, 2);
    const USER_SLOTS = Math.min(userRefs.length, 2);

    const envRefStart  = 1;
    const charRefStart = ENV_SLOTS + 1;
    const userRefStart = ENV_SLOTS + CHAR_SLOTS + 1;

    const referenceImages = [
      ...envRefs.slice(0, ENV_SLOTS),
      ...charRefs.slice(0, CHAR_SLOTS),
      ...userRefs.slice(0, USER_SLOTS),
    ].filter(Boolean);

    console.log(`[generateImageAsync] DISPATCH: env=${ENV_SLOTS} char=${CHAR_SLOTS} user=${USER_SLOTS} total=${referenceImages.length}`);

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    const finalPrompt = buildPrompt({
      prompt,
      charName: charRecord?.name || characterName || 'the character',
      charDesc,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
      envRefCount: ENV_SLOTS,
      charRefCount: CHAR_SLOTS,
      userRefCount: USER_SLOTS,
      envRefStart,
      charRefStart,
      userRefStart,
    });

    // ── 7. GENERATE ───────────────────────────────────────────────────────────
    let genRes;
    try {
      genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
        prompt: finalPrompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });
    } catch (genErr) {
      const msg = genErr?.message || '';
      if (/filter|guideline|block|violat/i.test(msg)) {
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
      }
      throw genErr;
    }

    if (!genRes?.url) {
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    // ── 8. SAVE ───────────────────────────────────────────────────────────────
    const generationContext = {
      prompt,
      character_id: characterId || null,
      character_reference_images: charRefs,
      location_id: charRecord?.resolved_current_location_id || charRecord?.current_home_location_id || null,
      zone_name: resolvedZoneName,
      location_name: resolvedLocationName,
      location_reference_images: envRefs.slice(0, 4),
      subject_type: subjectType,
      generated_at: new Date().toISOString(),
    };

    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      generation_context: generationContext,
    });

    console.log(`[generateImageAsync] ✓ SUCCESS: ${messageId} → ${genRes.url.substring(0, 60)}`);

    return Response.json({
      success: true,
      imageUrl: genRes.url,
      messageId,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
    });

  } catch (error) {
    console.error('[generateImageAsync] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});