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

  // 4. Multiple zones, no keyword match — use the FIRST zone with images as a safe default.
  // This is far better than returning no environment at all, which causes the AI to invent
  // a background (or copy it from identity reference photos — the root cause of avatar bleed).
  // The first zone is typically the main living area (living room, lobby, etc).
  const firstZoneWithImages = zones[0];
  const imgs = cdnFilter(firstZoneWithImages.image_urls).slice(0, 4);
  console.log(`[resolveZone] Multiple zones, no keyword match — falling back to first zone "${firstZoneWithImages.zone_name}" (${imgs.length} imgs) to prevent background invention`);
  return { images: imgs, zoneName: firstZoneWithImages.zone_name };
}

// ── CAMERA + LIGHTING HELPERS ──────────────────────────────────────────────────────────

function selectCameraPosition(zoneName, seed = '') {
  const positions = [
    'from the doorway looking inward',
    'from the left corner of the room',
    'from the right corner of the room',
    'from across the room looking back',
    'at seated eye-level from center-left',
    'from a closer standing position',
    'from a slightly elevated angle',
    'from a lower angle looking slightly up',
    'from a diagonal side view',
    'positioned near the window looking inward'
  ];
  const idx = Math.abs(seed.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % positions.length;
  return positions[idx];
}

function getTimeLighting(hour = new Date().getHours()) {
  if (hour >= 5 && hour < 9) return { period: 'EARLY MORNING', desc: 'soft golden sunrise, warm golden hour light, long soft shadows' };
  if (hour >= 9 && hour < 12) return { period: 'MORNING', desc: 'bright natural daylight, neutral tones, moderate shadows' };
  if (hour >= 12 && hour < 15) return { period: 'MIDDAY', desc: 'bright overhead light, neutral, sharp shadows' };
  if (hour >= 15 && hour < 18) return { period: 'AFTERNOON', desc: 'warm golden light from angled sun, golden-orange tones' };
  if (hour >= 18 && hour < 21) return { period: 'EVENING', desc: 'deep golden-orange sunset glow, dimming warm light' };
  return { period: 'NIGHT', desc: 'dark interior, artificial light only, NO daylight, warm or cool lamp glow' };
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────

function buildPrompt({ prompt, charName, charDesc, locationName, zoneName, envRefCount, charRefCount, userRefCount, userRefStart, charRefStart, envRefStart, serverHour, serverTime }) {
  const hasEnv  = envRefCount > 0;
  const hasChar = charRefCount > 0;
  const hasUser = userRefCount > 0;

  const envEnd    = envRefStart + envRefCount - 1;
  const charEnd   = charRefStart + charRefCount - 1;
  const userEnd   = userRefStart + userRefCount - 1;

  const cameraPos = selectCameraPosition(zoneName, prompt + serverTime);
  const timeLighting = getTimeLighting(serverHour);

  let preamble = '════════════════════════════════════════════════════════════\nREFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST\n════════════════════════════════════════════════════════════\n';

  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    preamble += `Images ${envRefStart}–${envEnd}: ROOM/ENVIRONMENT — THIS IS THE SCENE BACKGROUND. 100% AUTHORITY.\nThese are photographs of the actual "${zoneName || place}". THIS IS THE ONLY ROOM ALLOWED IN THE OUTPUT.\nREPLICATE every detail: walls, floor, furniture, rug, curtains, decor, layout. Do NOT invent or substitute anything.\n⛔ Do NOT use any other room, background, or environment — not from identity photos, not from imagination.\n\n`;
  }
  if (hasChar) {
    preamble += `Images ${charRefStart}–${charEnd}: FACE/IDENTITY ONLY for "${charName}"\nExtract ONLY: face shape, eyes, nose, mouth, skin tone, hair color/texture/length, facial hair, body type.\n⚠️ CRITICAL — THE BACKGROUND IN THESE PHOTOS IS COMPLETELY IRRELEVANT AND MUST BE IGNORED 100%.\n⛔ Do NOT use, reference, copy, or be influenced by the room, walls, furniture, lighting, or any background visible behind the person in these photos.\n⛔ The ONLY background allowed is the one from the environment images above.\n\n`;
  }
  if (hasUser) {
    preamble += `Images ${userRefStart}–${userEnd}: FACE/IDENTITY ONLY for the user\nExtract ONLY: face, skin tone, hair, body type. Background in these photos = 0% influence.\n\n`;
  }
  preamble += '⛔ DO NOT blend image sets. Room comes from env images only. Face comes from identity images only.\n════════════════════════════════════════════════════════════\n\n';

  let cameraBlock = `

════════════════════════════════════════════════════════════
⛔ MANDATORY CAMERA OVERRIDE — CAMERA MUST MOVE ⛔
════════════════════════════════════════════════════════════
Camera viewpoint MUST be: ${cameraPos}

CRITICAL RULE: This camera angle MUST be VISIBLY DIFFERENT from reference images.

If reference images show:
  • Wide framing → Use closer perspective
  • Centered composition → Use side angle
  • Eye-level view → Use slightly elevated or lowered angle
  • Far distance → Move camera closer
  • Symmetric framing → Use offset/asymmetric framing

The room/environment is identical, but the CAMERA HAS PHYSICALLY MOVED to a new position.

REJECTION CRITERIA — IMAGE IS INVALID IF:
🚫 Composition matches the reference image framing
🚫 Camera appears to be in the same position as reference
🚫 Perspective shift is not visibly obvious
🚫 Framing looks like a reused angle

RENDER FROM THIS EXACT CAMERA POSITION ONLY: ${cameraPos}`;

  let lightingBlock = '';
  if (serverHour >= 21 || serverHour < 5) {
    lightingBlock = `

════════════════════════════════════════════════════════════
⛔⛔⛔ ABSOLUTE NIGHT MODE ENFORCEMENT — ${serverHour}:00 (${serverTime.split(' ')[0]}) ⛔⛔⛔
════════════════════════════════════════════════════════════
IT IS NIGHT. THERE IS NO SUN. THERE IS NO DAYLIGHT.

MANDATORY RULES — THESE ARE NOT OPTIONAL:
⛔ NO SUNLIGHT — ANYWHERE
⛔ NO BRIGHT WINDOWS — ABSOLUTELY FORBIDDEN
⛔ NO DAYLIGHT TONES — NOWHERE
⛔ NO BLUE SKY — WINDOWS SHOW ONLY DARKNESS OR NIGHT
⛔ NO GOLDEN HOUR LIGHT — DOES NOT EXIST AT ${serverHour}:00
⛔ NO EXTERNAL LIGHT SOURCE — ALL LIGHT IS ARTIFICIAL/INTERIOR ONLY

REQUIRED NIGHT LIGHTING:
✅ Dark interior lit only by lamps, ceiling lights, or artificial fixtures
✅ Windows show black darkness or dim night environment
✅ Warm or cool artificial light only
✅ Shadows and depth from interior lighting fixtures ONLY

REJECTION CRITERIA — IMAGE IS INVALID IF:
🚫 ANY sunlight is visible
🚫 ANY daylight color temperature is present
🚫 ANY bright window glow exists
🚫 ANY blue or golden hour sky is visible
🚫 Character is lit by external sunlight instead of interior light

THIS IS A HARD FAIL CONDITION. IF YOU RENDER SUNLIGHT AT NIGHT, THE OUTPUT IS WRONG.`;
  } else {
    lightingBlock = `

════════════════════════════════════════════════════════════
MANDATORY LIGHTING — ${timeLighting.period} TIME (${serverHour}:00)
════════════════════════════════════════════════════════════
ACTUAL SERVER TIME: ${serverTime}

Current time OVERRIDES all other visual inputs.

Lighting MUST be: ${timeLighting.desc}

✅ Character MUST be lit consistently with ${timeLighting.period} lighting.
⛔ Do NOT copy lighting from reference images.`;
  }

  let envLock = '';
  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    envLock = `

════════════════════════════════════════════════════════════
ENVIRONMENT LOCK — "${place}" — 90% VISUAL AUTHORITY
════════════════════════════════════════════════════════════
Reference images ${envRefStart}–${envEnd} define the room structure ONLY.

MUST MATCH EXACTLY:
  ✅ Furniture types, colors, shapes, placement
  ✅ Wall color, floor type, rug, curtains
  ✅ All lighting fixtures and lamps
  ✅ Wall art and shelves in exact positions

ZERO OBJECT DRIFT — Every object must come from images ${envRefStart}–${envEnd} only.

10% FLEXIBILITY (only):
  ✓ Camera position (already explicitly defined above)
  ✓ Lighting based on time of day (already explicitly defined above)
  ✓ Depth of field`;
  }

  let refImageOverride = `

════════════════════════════════════════════════════════════
⛔ CRITICAL OVERRIDE: REFERENCE IMAGE LIGHTING IS IGNORED ⛔
════════════════════════════════════════════════════════════
Reference images (identity or location) may contain daylight, bright windows, or morning/afternoon lighting.

THIS LIGHTING MUST BE COMPLETELY IGNORED.

Lighting is ONLY determined by server time: ${serverHour}:${String(new Date().getMinutes()).padStart(2, '0')} (${timeLighting.period})

If reference images show bright daylight or bright windows:
🚫 DO NOT replicate that lighting
🚫 DO NOT use that color temperature
🚫 DO NOT copy that brightness level

Generate ONLY from the server time lighting rules above.
The scene lighting must match the actual world time, not the reference images.`;

  let identityLock = '';
  if (hasChar) {
    identityLock += `

CHARACTER IDENTITY — "${charName}":
${charRefCount > 0
  ? `Images ${charRefStart}–${charEnd} are face/identity reference photographs.${charDesc ? ` Description: ${charDesc}.` : ''}
Match ONLY: face structure, eyes, nose, mouth, skin tone, hair color/length/style, body type.`
  : `No reference photos. Generate from text description: ${charDesc || 'realistic human'}.`
}

CRITICAL GENERATION RULES:
✅ Generate a new, original pose for this scene
✅ Render natural, anatomically correct hands (exactly 5 fingers per hand)
✅ Character MUST be lit consistently with the ${timeLighting.period} lighting defined above
✅ Shadows, highlights, and skin tones MUST match the time-of-day lighting, NOT reference image lighting
⛔ Do NOT copy background, room, or pose from reference photos
⛔ Do NOT scale the character over a static background — if larger, the camera moved closer and room responds
⛔ Do NOT paste the character in — integrate with matching depth, shadow, and light direction
⛔ Do NOT copy props or lighting from reference photos
⛔ LIGHTING COMES ONLY FROM SERVER TIME — NEVER FROM REFERENCE IMAGES`;
  }
  if (hasUser) {
    identityLock += `

USER IDENTITY:
Images ${userRefStart}–${userEnd} are this exact person's photos.
Match: face structure, skin tone, hair, body type.`;
  }

  return `${preamble}${cameraBlock}${lightingBlock}${refImageOverride}${prompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.${envLock}${identityLock}`;
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
        // Filter out AI-generated images (generated_image.png) — these are AI outputs, not face photos.
        // Using generated images as identity references causes the model to reproduce them verbatim
        // instead of generating a new scene. Only real uploaded photos should drive identity.
        const allRefUrls = cdnFilter(charRecord.reference_image_urls || []);
        const refUrls = allRefUrls.filter(url => !url.includes('generated_image'));
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

    // ── 4b. VALIDATE & CONVERT ENV REFS ───────────────────────────────────────
    // The AI model cannot read AVIF format images (common from iPhone uploads).
    // Detect AVIF by checking first 12 bytes for "ftyp avif" signature.
    // If AVIF detected, skip that image — log clearly so we know the real cause.
    // For other formats (jpeg, png, webp): pass through as-is if HTTP 200.
    if (envRefs.length > 0) {
      const validChecks = await Promise.all(
        envRefs.map(async url => {
          try {
            const r = await fetch(url, { method: 'GET' });
            if (!r.ok) { console.warn(`[validateEnv] ❌ HTTP ${r.status}: ${url}`); return null; }
            const ct = r.headers.get('content-type') || '';
            if (!ct.startsWith('image/')) { console.warn(`[validateEnv] ❌ Not an image (${ct}): ${url}`); return null; }
            // Read first 16 bytes to detect AVIF format
            const reader = r.body.getReader();
            const { value } = await reader.read();
            reader.cancel();
            if (!value || value.length === 0) { console.warn(`[validateEnv] ❌ Empty body: ${url}`); return null; }
            // AVIF detection: bytes 4-11 contain "ftyp" + "avif"/"avis"/"heic"/"heif"
            const header = Array.from(value.slice(4, 12)).map(b => String.fromCharCode(b)).join('');
            const isAvif = header.includes('avif') || header.includes('avis') || header.includes('heic') || header.includes('heif') || ct === 'image/avif';
            if (isAvif) {
              console.warn(`[validateEnv] ❌ AVIF format not supported by AI model — SKIPPING: ${url}`);
              console.warn(`[validateEnv] ⚠️ SOLUTION: Re-upload this zone photo as a JPEG or PNG (not from iPhone in HEIC/AVIF mode)`);
              return null;
            }
            console.log(`[validateEnv] ✅ Valid image (${ct}): ${url}`);
            return url;
          } catch (e) {
            console.warn(`[validateEnv] ❌ Fetch error for ${url}: ${e.message}`);
            return null;
          }
        })
      );
      const validEnvRefs = validChecks.filter(Boolean);
      console.log(`[generateImageAsync] Env validation: ${envRefs.length} attempted → ${validEnvRefs.length} valid (non-AVIF) images`);
      envRefs = validEnvRefs;
    }

    // ── 5. ASSEMBLE REFS — env FIRST (locks the room), then identity ─────────
    // Environment must come first so the model anchors the room before reading identity.
    // Identity refs (charRefs) must NEVER bleed their background into the scene.
    const ENV_SLOTS  = Math.min(envRefs.length, 4);
    const CHAR_SLOTS = Math.min(charRefs.length, 5);
    const USER_SLOTS = Math.min(userRefs.length, 3);

    const envRefStart  = 1;
    const charRefStart = ENV_SLOTS + 1;
    const userRefStart = ENV_SLOTS + CHAR_SLOTS + 1;

    const referenceImages = [
      ...envRefs.slice(0, ENV_SLOTS),
      ...charRefs.slice(0, CHAR_SLOTS),
      ...userRefs.slice(0, USER_SLOTS),
    ].filter(Boolean);

    console.log(`[generateImageAsync] FINAL REF URLS:`);
    referenceImages.forEach((url, i) => console.log(`  [${i+1}] ${url}`));

    console.log(`[generateImageAsync] DISPATCH: env=${ENV_SLOTS} char=${CHAR_SLOTS} user=${USER_SLOTS} total=${referenceImages.length}`);

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    const serverTime = new Date();
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
      serverHour: serverTime.getHours(),
      serverTime: serverTime.toLocaleTimeString(),
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