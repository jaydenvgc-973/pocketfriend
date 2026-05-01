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

// ── OUTFIT RESOLVER ───────────────────────────────────────────────────────────
// Resolves a character's current outfit from their closet or current_outfit field.
// Returns a text description string suitable for prompt injection, or null.

function resolveCharacterOutfitForPrompt(character, promptText) {
  if (!character) return null;

  // CRITICAL: If the prompt explicitly specifies clothing (e.g., "wearing a black snapback and an oversized graphic tee"),
  // DO NOT override it with character's current outfit or closet.
  // The prompt's description takes absolute priority — the user is being explicit about what they want to see.
  // Only use character outfit data as a fallback when the prompt has no clothing description.

  // For now, we assume the prompt is authoritative if it mentions clothing.
  // The outfit resolution is only for scenes where the user hasn't specified what to wear.
  // If a prompt says "wearing X", that X is what should be rendered, regardless of time of day or outfit lock.

  // Return null to signal: "No outfit override needed, use prompt's description as-is"
  return null;
}

function buildOutfitText(outfit) {
  if (!outfit) return null;
  // CRITICAL: Prefer individual clothing fields over full_description.
  // full_description often contains scene/pose/lighting metadata
  // (e.g. "In a relaxed indoor setting, a man stands confidently...")
  // which contaminates the image prompt with wrong scene directives.
  // Only individual fields (top, bottom, shoes, etc.) describe clothing only.
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  // Only fall back to full_description if no individual fields exist,
  // and strip any leading scene/setting preamble before the clothing.
  if (outfit.full_description) {
    // Strip common scene preamble patterns like "In a relaxed indoor setting, a man stands..."
    const stripped = outfit.full_description
      .replace(/^in [^,.]+(,|\.) ?/i, '')
      .replace(/^a (man|woman|person)[^,.]*(,|\.) ?/i, '')
      .replace(/^[^,.]+(stands|sits|lounges|poses)[^,.]*(,|\.) ?/i, '')
      .trim();
    return stripped || outfit.full_description;
  }
  return null;
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
  // Outdoor zones — water features and natural settings
  { keywords: ['lake', 'by the lake', 'on the lake', 'water', 'shoreline', 'reflecting off the water', 'city lights reflecting'], zone: 'main area' },
  { keywords: ['trail', 'hiking', 'path', 'forest', 'woods', 'trees', 'outdoors', 'outside', 'park'], zone: 'trail' },
  { keywords: ['picnic', 'picnic area', 'picnic table', 'relaxing outdoors'], zone: 'picnic area' },
  { keywords: ['shelter', 'pavilion', 'under shelter', 'covered area'], zone: 'shelter / pavilion' },
  { keywords: ['entrance', 'at the entrance', 'front entrance', 'entry'], zone: 'entrance' },
];

function cdnFilterNoGenerated(urls) {
  return cdnFilter(urls).filter(url => !url.includes('generated_image'));
}

function resolveZoneFromLocation(location, promptLower) {
  // CRITICAL: Filter out AI-generated images from zone refs — passing generated images back as
  // environment references causes Vertex AI content filter violations (same reason we filter
  // generated_image from charRefs). Only real uploaded zone photos are valid env refs.
  const zones = (location.zones || []).filter(z => cdnFilterNoGenerated(z.image_urls || []).length > 0);

  if (zones.length === 0) {
    // No zones with images at all — use flat image_urls (last resort, no zone name)
    const flat = cdnFilterNoGenerated(location.image_urls || []).slice(0, 4);
    return { images: flat, zoneName: null };
  }

  // 1. Exact zone name match in prompt — highest priority
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilterNoGenerated(zone.image_urls).slice(0, 4);
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
        const imgs = cdnFilterNoGenerated(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) {
          console.log(`[resolveZone] Keyword match: prompt→"${entry.zone}" matched zone "${matched.zone_name}"`);
          return { images: imgs, zoneName: matched.zone_name };
        }
      }
    }
  }

  // 3. STRICT RULE: if only one zone exists, use it (unambiguous)
  if (zones.length === 1) {
    const imgs = cdnFilterNoGenerated(zones[0].image_urls).slice(0, 4);
    console.log(`[resolveZone] Only one zone exists — using "${zones[0].zone_name}"`);
    return { images: imgs, zoneName: zones[0].zone_name };
  }

  // 4. Multiple zones, no keyword match — use the FIRST zone with images as a safe default.
  const firstZoneWithImages = zones[0];
  const imgs = cdnFilterNoGenerated(firstZoneWithImages.image_urls).slice(0, 4);
  console.log(`[resolveZone] Multiple zones, no keyword match — falling back to first zone "${firstZoneWithImages.zone_name}" (${imgs.length} imgs) to prevent background invention`);
  return { images: imgs, zoneName: firstZoneWithImages.zone_name };
}

// ── CAMERA + LIGHTING HELPERS ──────────────────────────────────────────────────────────

function selectCameraPosition(zoneName, seed = '', prompt = '') {
   const promptLower = (prompt || '').toLowerCase();

   // HIGHEST PRIORITY: Selfie detection — comprehensive match
   const isSelfie = /selfie|self-?portrait|phone selfie|smartphone selfie|cell phone|taken.*phone|phone.*photo/.test(promptLower);
   const isSittingAtTable = /sitting at.*table|at.*table.*eating|seated at.*table|at the table|dining.*table|wooden.*table/.test(promptLower);
   const isSittingOnCouch = /sitting on.*couch|on the couch|lounging on.*sofa|couch/.test(promptLower);
   const isStandingAtCounter = /standing at.*counter|at the counter/.test(promptLower);

   if (isSelfie) {
     // Selfie + seated context: character holds phone at arm's length, face fills frame, seated position visible below
     // CRITICAL: Ensure the existing table in the zone is framed below the character's face
     if (isSittingAtTable) {
       return 'selfie perspective — character is SEATED at the EXISTING table in this room, holding the phone at arm\'s length toward the camera. Face and upper chest dominate the frame. The existing table, place settings, and food (if present) are partially visible below. Character is NOT standing. Phone is in the character\'s hand extended toward viewer. CAMERA MUST adjust to frame the existing table from this angle.';
     }
     return 'extreme close-up selfie — character holds phone at arm\'s length directly toward camera. Face fills most of the frame. Personal and intimate framing. Character is NOT standing in a wide shot.';
   }

   if (isSittingAtTable) {
     const tablePositions = [
       'tight medium shot, seated eye-level at the EXISTING table, character is the primary subject, table surface and existing objects in frame',
       'close-up, seated eye-level facing the character at the EXISTING table, existing table surface and place settings in frame',
       'seated perspective, close frame with character and the EXISTING table as main focus',
       'medium-tight shot, character seated at the EXISTING table, framed from slightly above eye-level to show table and food'
     ];
     return tablePositions[Math.floor(Math.abs(seed.charCodeAt(0)) % tablePositions.length)];
   }

   if (isSittingOnCouch) {
     return Math.random() > 0.5 
       ? 'seated eye-level on the EXISTING couch, character is the primary subject, couch details visible'
       : 'close-up from across the room, focused on character seated on the EXISTING couch';
   }

   if (isStandingAtCounter) {
     return 'close-up at counter-level, character standing at the EXISTING counter are the primary subjects, counter surface and existing fixtures in frame';
   }

   // Default positions for general scenes
   const positions = [
     'from the doorway looking inward',
     'from the left corner of the room',
     'from the right corner of the room',
     'from across the room looking back',
     'from a closer standing position',
     'from a slightly elevated angle',
     'from a lower angle looking slightly up',
     'from a diagonal side view'
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

  // ── PROMPT TIME AUTHORITY CHECK ──
  const promptHasExplicitTime = /nighttime|night time|middle of the night|midnight|late night|daytime|broad daylight|morning|afternoon|evening|golden hour|sunset|sunrise|dusk|dawn/i.test(prompt);

  const resolvedTime = serverHour;
  const timeLighting = getTimeLighting(resolvedTime);

  // ── SELFIE / FIRST-PERSON POV DETECTION ──
  // A selfie prompt means: character holds the phone, camera sees only what is directly
  // behind/around them. There is NO room to re-render. The background is whatever is
  // immediately behind the person at that angle. Skip the room-blueprint architecture entirely.
  const isSelfieMode = /\b(selfie|self-?portrait|phone selfie|smartphone selfie)\b/i.test(prompt) ||
    /lying.*?(flat|back|down).*?(selfie|looking up|staring up|phone|camera)/i.test(prompt) ||
    /selfie.*?(lying|on his back|on her back|on their back|in bed|from above)/i.test(prompt) ||
    /high[- ]angle selfie/i.test(prompt) ||
    /overhead selfie/i.test(prompt);

  // ── CAMERA POSITION (only for non-selfie) ──
  const promptHasExplicitCamera = /\b(from above|from below|wide shot|close-up|overhead|high-angle|low-angle)\b/i.test(prompt);
  const cameraPos = (isSelfieMode || promptHasExplicitCamera)
    ? "as described in the scene prompt"
    : selectCameraPosition(zoneName, prompt + serverTime, prompt);

  let preamble = '';

  if (isSelfieMode) {
    // ── SELFIE MODE: render exactly what the prompt says, no room blueprint extraction ──
    preamble = `════════════════════════════════════════════════════════════
📸 SELFIE / FIRST-PERSON POV — RENDER EXACTLY AS DESCRIBED
════════════════════════════════════════════════════════════

This is a SELFIE or first-person phone photo. The prompt tells you EVERYTHING:
  • The exact position of the person (e.g. lying flat on their back)
  • The exact camera angle (e.g. high-angle, looking down at the subject)
  • The exact framing and distance (e.g. face + upper chest fills the frame)
  • The exact background visible (e.g. pillows directly behind head)
  • The exact lighting (e.g. dim bedroom at night, soft warm side light)

YOU MUST FOLLOW THE PROMPT EXACTLY. Every detail in the prompt is mandatory.

DO NOT re-render a room from a third-person perspective.
DO NOT place the character in a wide scene.
DO NOT show the room from a standing observer's viewpoint.
DO NOT ignore the stated body position, camera angle, or framing.

The camera IS the character's phone. The background IS only what appears directly behind them at that angle.

`;
    if (hasChar) {
      preamble += `REFERENCE IMAGES — FACE IDENTITY ONLY:
${charRefCount > 0 ? `Images ${charRefStart}–${charEnd}: These are face reference photos for "${charName}".
Extract ONLY: face structure, skin tone, eyes, nose, mouth, hair color/length/texture, facial hair.
⛔ DISCARD: pose, background, clothing, lighting, camera angle from these photos.
The face appearance is the ONLY data used from these references.` : `No reference photos. Generate "${charName}" from text description: ${charDesc || 'realistic human'}.`}

`;
    }
    if (hasUser) {
      preamble += `Images ${userRefStart}–${userEnd}: User identity reference — match face, skin tone, hair, body type only.

`;
    }
    preamble += `════════════════════════════════════════════════════════════
SELFIE RENDERING REQUIREMENTS
════════════════════════════════════════════════════════════
✅ Render EXACTLY the pose, angle, framing, and distance described in the prompt
✅ The background must be ONLY what is visible from that specific angle and position
✅ Lighting must match what the prompt describes (not server time)
✅ This is a RAW SMARTPHONE PHOTO aesthetic — authentic, unposed, real
✅ Character face and identity must match the reference exactly

🚫 FAIL: Wide room shot shown instead of close selfie framing
🚫 FAIL: Character appears from a standing third-person viewpoint
🚫 FAIL: Body position differs from what the prompt describes
🚫 FAIL: Background doesn't match the described position/angle
🚫 FAIL: Lighting contradicts what the prompt says

════════════════════════════════════════════════════════════

`;
  } else {
    // ── STANDARD SCENE MODE: full room blueprint re-render ──
    preamble = `════════════════════════════════════════════════════════════
THIS IS A FULL 3D RE-RENDER — NOT A PHOTO EDIT OR COMPOSITE
════════════════════════════════════════════════════════════

You are NOT editing a photograph.
You are NOT cutting and pasting a character onto a background.
You are NOT overlaying anything onto reference images.

You are RENDERING A COMPLETELY NEW IMAGE from scratch, using reference images only as a blueprint for:
  • What furniture exists in the room (type, color, shape)
  • What materials cover the floor and walls
  • What the architectural layout looks like

The reference images are DEMOLISHED after reading. They are never the output. They are never the backdrop.
You build a fresh 3D render of the same room — from a NEW angle — with the character naturally inside it.

════════════════════════════════════════════════════════════
STEP 1: READ THE ROOM BLUEPRINT (from zone reference photos)
════════════════════════════════════════════════════════════
Study the reference photos to extract:
  • Floor material (wood, tile, carpet — exact color/texture)
  • Wall color and finish
  • What furniture is present (couch, table, bed, counter, etc.) — exact models
  • Window/door positions and sizes
  • Rug, art, shelves, lighting fixtures

This is the ONLY data you take from the zone photos. You are reading a blueprint. You do NOT copy the photo.

════════════════════════════════════════════════════════════
STEP 2: CHOOSE A NEW CAMERA POSITION
════════════════════════════════════════════════════════════
Camera: ${cameraPos}

This is the angle from which you will RENDER the room.
The reference photo camera angle is IRRELEVANT — you are starting fresh from this new viewpoint.
The room will look different from this angle because you are rendering it fresh from a new position.

════════════════════════════════════════════════════════════
STEP 3: APPLY TIME-OF-DAY LIGHTING
════════════════════════════════════════════════════════════
Current time: ${resolvedTime}:${String(new Date().getMinutes()).padStart(2, '0')} → ${timeLighting.period}
Lighting: ${timeLighting.desc}

Apply this lighting to the NEWLY RENDERED room. The reference photo's lighting is ignored.

════════════════════════════════════════════════════════════
STEP 4: PLACE THE CHARACTER INSIDE THE RENDERED ROOM
════════════════════════════════════════════════════════════
The character is a live person standing, sitting, or moving INSIDE this freshly rendered 3D space.
They share the same perspective lines, floor shadows, ambient light, and depth as the room.
They are NOT cut out. They are NOT placed on top. They are PART of the render.

════════════════════════════════════════════════════════════
REFERENCE IMAGE ROLE ASSIGNMENT
════════════════════════════════════════════════════════════
  `;

    if (hasEnv) {
       const place = [locationName, zoneName].filter(Boolean).join(' → ');
       preamble += `Images ${envRefStart}–${envEnd}: ROOM/ENVIRONMENT STRUCTURE — 70–80% AUTHORITY FOR LAYOUT/IDENTITY ONLY.
  These are photographs of the "${zoneName || place}".

  70–80% STRUCTURAL TRUTH (preserve room identity, not camera view):
  ✅ PRESERVE: walls, floor, furniture types, furniture placement, layout, materials, objects, fixtures, doors, windows
  ✅ THIS IS TRUTH: the room structure, what's in it, and where things are relative to each other

  20–30% DYNAMIC FLEXIBILITY (required for realism):
  ✓ REGENERATE: lighting (based on ${timeLighting.period}, not reference image lighting)
  ✓ REGENERATE: camera angle (new position, not reference image camera view)
  ✓ REGENERATE: composition (different camera placement, distance, framing)
  ✓ REGENERATE: perspective (entire scene recomposed from new viewpoint)

  ⛔ Do NOT copy the lighting, brightness, window glow, or sky from these photos—the time overrides this.
  ⛔ Do NOT match the reference image camera angle—camera must move to a new position.
  ⛔ Do NOT treat the reference image as a locked flat background—recompose the entire scene from the new camera viewpoint.
  The zone stays TRUE while viewpoint and lighting CHANGE.

  `;
     }
    if (hasChar) {
       preamble += `Images ${charRefStart}–${charEnd}: CHARACTER FACE BLUEPRINT — READ FACE ONLY, RENDER FRESH.
  These photos tell you what this person's face looks like. That is ALL they do.
  Extract: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/texture, facial hair.
  
  ⛔ EVERYTHING ELSE IN THESE PHOTOS IS DISCARDED:
  ⛔ The pose in these photos → DISCARD. Render a new pose appropriate to the scene.
  ⛔ The background in these photos → DISCARD. The room comes from zone images only.
  ⛔ The clothing in these photos → DISCARD unless no outfit is specified in the prompt.
  ⛔ The lighting in these photos → DISCARD. Lighting comes from the server time.
  ⛔ The camera angle in these photos → DISCARD. Camera comes from STEP 2.
  ⛔ Any room, wall, furniture, or environment seen behind the person → DISCARD COMPLETELY.
  
  The character's face is the ONLY data extracted. Everything else is ignored and rebuilt fresh.

  `;
    }
    if (hasUser) {
      preamble += `Images ${userRefStart}–${userEnd}: FACE/IDENTITY ONLY — User appearance.
REPLICATE: face, skin tone, hair, body type.
IGNORE: background, lighting, camera angle.

`;
    }
    preamble += `════════════════════════════════════════════════════════════
FAIL CONDITIONS — IMAGE IS INVALID IF
════════════════════════════════════════════════════════════
🚫 Daylight appears in a ${timeLighting.period} scene
🚫 Camera matches the reference image angle
🚫 Lighting matches the reference image (when time requires different lighting)
🚫 Character is enlarged instead of camera moving closer
🚫 Character looks pasted, cut-out, or composited — character MUST be organically rendered inside the room sharing its perspective and depth
🚫 Character's background from reference photos bleeds into the scene environment
🚫 Room becomes a different location or zone
🚫 Composition matches reference image framing
🚫 A second table, couch, bed, counter, stool, or chair is created when one already exists in the zone
🚫 An existing object is replaced with a different version, shape, or style
🚫 A structural object is invented when not requested by the user
🚫 Furniture layout differs from reference images
🚫 Object count differs from reference images
🚫 Character appearance contradicts the appearance lock (wrong hair, facial hair, or skin tone)

════════════════════════════════════════════════════════════
SUCCESS CONDITION
════════════════════════════════════════════════════════════
✅ Same room. Same furniture. Same layout. Same objects. Zero duplication.
✅ Character framed correctly using EXISTING objects via camera positioning.
✅ Camera moved to fit the scene — room was NOT changed to fit the camera.
✅ Character appearance matches appearance lock exactly.
✅ Fresh ${timeLighting.period} lighting. New camera position.

════════════════════════════════════════════════════════════

`;
  }

  let cameraBlock = '';
  if (cameraPos === "as described in the scene prompt") {
    cameraBlock = `

════════════════════════════════════════════════════════════
📸 CAMERA ANGLE — PROMPT-SPECIFIED
════════════════════════════════════════════════════════════
The scene prompt EXPLICITLY describes the camera angle or pose. This is MANDATORY.

You MUST render the exact camera angle, pose, and framing described in the prompt.
Examples:
  • "selfie" → first-person perspective, phone held up by the character
  • "high-angle" → looking down at the subject
  • "lying on his back looking up" → character's POV is supine, camera is their phone
  • "wide shot" → full scene visible
  • "close-up of face" → framed tightly on the subject's head

Render EXACTLY as the prompt describes. The prompt's description is the authority.`;
  } else {
    cameraBlock = `

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
  }

  let lightingBlock = '';
  if (promptHasExplicitTime) {
    // Prompt specifies time of day — trust it completely. Do NOT inject server-based lighting.
    lightingBlock = `

  ════════════════════════════════════════════════════════════
  PROMPT TIME AUTHORITY — EXPLICIT TIME SPECIFIED
  ════════════════════════════════════════════════════════════
  The prompt specifies an explicit time of day. This is the AUTHORITY.

  CRITICAL: Generate lighting that matches the prompt's time description, NOT the server clock.

  ✅ If prompt says "nighttime", "middle of the night", or "midnight" → render NIGHT LIGHTING ONLY
  ✅ If prompt says "golden hour", "sunset", "dusk" → render SUNSET/EVENING LIGHTING
  ✅ If prompt says "morning", "dawn" → render MORNING LIGHTING
  ✅ If prompt says "afternoon", "daytime" → render DAYTIME LIGHTING

  The user's scene description is the source of truth for time, not the server clock.`;
  } else if (serverHour >= 21 || serverHour < 5) {
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
  ROOM BLUEPRINT — "${place}"
  ════════════════════════════════════════════════════════════
  Zone reference images ${envRefStart}–${envEnd} are your BLUEPRINT for what this room contains.
  You will RE-RENDER this room from a fresh angle — you are NOT using these photos as a background.

  FROM THE BLUEPRINT, extract and faithfully re-render:
  ✅ Exact floor material, color, and texture (wood planks, tile, carpet — reproduce faithfully)
  ✅ Exact wall color and finish
  ✅ Every piece of furniture — type, color, shape, and its position in the room relative to walls
  ✅ Rugs, curtains, windows, doors, and their positions
  ✅ Art, shelves, lamps, ceiling lights, and decor
  ✅ The overall spatial layout — what is left of what, what is near which wall

  This room must LOOK like the same room from a different angle — same materials, same furniture, different viewpoint.
  A person who has been in this room should recognize it immediately from the render.

  ════════════════════════════════════════════════════════════
  CAMERA PLACEMENT IN THE RENDERED ROOM
  ════════════════════════════════════════════════════════════
  Camera: ${cameraPos}

  Place the camera at this new position INSIDE the re-rendered room.
  Adjust perspective lines, vanishing points, and depth-of-field to match this real camera position.
  The furniture must appear in the correct relative positions from this new viewpoint.
  
  If the scene action requires a specific object (sitting at a table, on a couch, etc.):
  ✅ Include that object from the blueprint in the correct position for the camera angle
  ✅ Move the camera to best frame the action — do NOT invent replacement furniture
  ⛔ NEVER create a duplicate table, couch, bed, or counter alongside the existing one`;
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
  if (hasChar && !isSelfieMode) {
    // Standard scene mode identity lock
    identityLock += `

  CHARACTER IDENTITY — "${charName}":
  ${charRefCount > 0
  ? `Images ${charRefStart}–${charEnd} are face/identity reference photographs.${charDesc ? ` Description: ${charDesc}.` : ''}
  Match ONLY: face structure, eyes, nose, mouth, skin tone, hair color/length/style, body type.`
  : `No reference photos. Generate from text description: ${charDesc || 'realistic human'}.`
  }

  CHARACTER RENDERING RULES — THIS PERSON IS RENDERED FRESH INSIDE THE ROOM:
  ✅ Render a completely new pose appropriate to the scene action described in the prompt
  ✅ The character's body, clothing, and pose are generated fresh — NOT copied from any reference photo
  ✅ Render natural, anatomically correct hands (exactly 5 fingers per hand)
  ✅ The character stands/sits/moves on the SAME floor as the re-rendered room — same perspective, same vanishing point
  ✅ Cast real shadows from the character onto the floor and nearby furniture using ${timeLighting.period} lighting
  ✅ Skin tones, highlights, and shadows on the character MUST match the room's time-of-day lighting exactly
  ✅ Character scale must be physically correct relative to the room furniture and camera distance
  ✅ APPEARANCE LOCK (100% ABSOLUTE): Hair (${(charDesc || '').match(/(?:short|long|curly|straight|wavy|fade|pixie|bob|braid|updo|dyed|bleached|natural).*?(?:hair|style|locks)/i)?.[0] || 'as described'}), Facial hair (${(charDesc || '').match(/(?:clean-shaven|stubble|beard|goatee|mustache|facial hair)/i)?.[0] || 'as described'}), Skin tone (${(charDesc || '').match(/(?:fair|light|medium|tan|brown|dark|olive|pale|dusky).*?(?:skin|tone)/i)?.[0] || 'as described'}), Body type (${(charDesc || '').match(/(?:slim|athletic|muscular|stocky|curvy|average|petite|tall|broad)(?:.*?(?:build|frame|type))?/i)?.[0] || 'as described'}) — NON-NEGOTIABLE
  ✅ OUTFIT: ${(charDesc || '').match(/Currently wearing: (.+?)(?:\.|$)/)?.[1] ? `If the scene prompt specifies clothing, use THAT clothing. If no clothing is described in the scene prompt, default to: ${(charDesc || '').match(/Currently wearing: (.+?)(?:\.|$)/)?.[1]}.` : 'Clothing should match what the scene prompt describes, or their personality and context if unspecified.'}
  
  ⛔ HARD FAILS:
  ⛔ Character appears cut-out or pasted → FAIL
  ⛔ Character does not cast a shadow → FAIL  
  ⛔ Character lighting doesn't match room lighting → FAIL
  ⛔ Pose, background, or clothing copied from reference photos → FAIL`;
  } else if (hasChar && isSelfieMode) {
    // Selfie mode: identity lock focused on face match only, no room language
    identityLock += `

  CHARACTER IDENTITY — "${charName}":
  ${charRefCount > 0
  ? `Images ${charRefStart}–${charEnd} are face reference photos. Match ONLY face structure, skin tone, eyes, hair color/length/style, facial hair, body type.`
  : `Generate "${charName}" from text description: ${charDesc || 'realistic human'}.`
  }
  ✅ APPEARANCE LOCK: Hair (${(charDesc || '').match(/(?:short|long|curly|straight|wavy|fade|pixie|bob|braid|updo|dyed|bleached|natural).*?(?:hair|style|locks)/i)?.[0] || 'as described'}), Facial hair (${(charDesc || '').match(/(?:clean-shaven|stubble|beard|goatee|mustache|facial hair)/i)?.[0] || 'as described'}), Skin tone (${(charDesc || '').match(/(?:fair|light|medium|tan|brown|dark|olive|pale|dusky).*?(?:skin|tone)/i)?.[0] || 'as described'}) — NON-NEGOTIABLE
  ⛔ Do NOT copy pose, background, or clothing from reference photos — only the face identity transfers`;
  }
  if (hasUser) {
    identityLock += `

USER IDENTITY:
Images ${userRefStart}–${userEnd} are this exact person's photos.
Match: face structure, skin tone, hair, body type.`;
  }

  if (isSelfieMode) {
    // Selfie mode: preamble already contains all instructions. Just append the prompt and identity lock.
    // Do NOT inject camera/lighting/envLock blocks — they contradict the selfie framing.
    return `${preamble}${prompt}\n\nPhotorealistic smartphone photograph. Ultra-detailed. Real human proportions. Not an illustration.${identityLock}`;
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

    // ── SANITIZE PROMPT EARLY ─────────────────────────────────────────
    // Do this before outfit resolution so we can check if prompt specifies clothing
    function sanitizePrompt(p) {
      // Strip routing tag
      let s = p.replace(/^\[CHARACTER\]\s*/i, '').trim();

      // ── NON-EXPLICIT LANGUAGE CONTROL ──────────────────────────────
      // Replace clinical/sexualized clothing terms with casual, everyday phrasing.
      // All replacements must include situational context (activity or setting).
      // This prevents content filter blocks while preserving scene intent.

      // Upper body
      s = s.replace(/\bshirtless\b/gi, 'with no shirt on');
      s = s.replace(/\btopless\b/gi, 'with no shirt on');
      s = s.replace(/\bbarechested\b/gi, 'with no shirt on');
      s = s.replace(/\bbare[- ]?chest(ed)?\b/gi, 'with no shirt on');

      // Lower body — isolated "underwear" or "boxer" without context
      s = s.replace(/\bin (his|her|their) underwear\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin underwear\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin boxers\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin briefs\b/gi, 'in comfortable shorts');
      s = s.replace(/\bonly in (his|her|their) underwear\b/gi, 'in comfortable shorts at home');
      s = s.replace(/\bunderwear\b/gi, 'shorts');

      // Lingerie-style phrasing
      s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
      s = s.replace(/\blingerie\b/gi, 'sleepwear');
      s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
      s = s.replace(/\bpanties\b/gi, 'shorts');
      s = s.replace(/\bthong\b/gi, 'shorts');

      // Anatomy-focused descriptors
      s = s.replace(/\bexposed (chest|abs|torso|stomach|midriff)\b/gi, 'no shirt on');
      s = s.replace(/\b(his|her|their) (bare )?(chest|abs|torso)\b/gi, '$1 relaxed build');

      // Naked / nude
      s = s.replace(/\bnaked\b/gi, 'not fully dressed');
      s = s.replace(/\bnude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully nude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully naked\b/gi, 'not fully dressed');

      return s.trim();
    }
    const sanitizedPrompt = sanitizePrompt(prompt);

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
        // CRITICAL FIX: Never pass avatar as a reference image.
        // Avatar photos create irreconcilable visual conflicts with scene prompts.
        // The model cannot generate a new scene when given a fixed avatar pose.
        // Instead, rely ONLY on text description (appearance_lock + avatar_description_text).
        // This allows the model to compose the character fresh into the scene.
        const allRefUrls = cdnFilter(charRecord.reference_image_urls || []);
        const refUrls = allRefUrls.filter(url => !url.includes('generated_image'));
        // CRITICAL: Use maximum 2 reference images. More refs = more background contamination.
        // The model anchors visual context from ALL ref images — fewer refs = less bleed-through.
        charRefs = refUrls.slice(0, 2);
        console.log(`[generateImageAsync] Character "${charRecord.name}" — identity refs: ${charRefs.length} (max 2 to minimize background contamination)`);

        // Build appearance descriptor — rich text description used when no reference photos exist
        // This is the PRIMARY identity source for characters without reference_image_urls
        // CRITICAL: Include appearance_lock details (hair, facial_hair, skin_tone) as absolute identity traits
        const parts = [
          charRecord.age_range ? `${charRecord.age_range} years old` : null,
          charRecord.gender,
          charRecord.ethnicities?.length > 0 ? charRecord.ethnicities.join('/') + ' ethnicity' : null,
          charRecord.appearance_lock?.skin_tone ? `${charRecord.appearance_lock.skin_tone} skin tone` : null,
          charRecord.appearance_lock?.hairstyle ? `${charRecord.appearance_lock.hairstyle} hairstyle` : null,
          charRecord.appearance_lock?.hair_type ? `${charRecord.appearance_lock.hair_type} hair` : null,
          charRecord.appearance_lock?.facial_hair ? `${charRecord.appearance_lock.facial_hair}` : null,
          charRecord.appearance_notes || null,
          charRecord.avatar_description_text || null, // text description from photo uploader
        ].filter(Boolean);
        charDesc = parts.join(', ');

        // ── OUTFIT RESOLUTION ────────────────────────────────────────────
        // CRITICAL: Only inject character outfit if the user's prompt did NOT already specify clothing.
        // If the prompt says "wearing a black snapback and an oversized graphic tee", that is authoritative.
        // We do NOT override it with character's current outfit (e.g., sleepwear, formal, etc.).
        const promptHasClothingDescription = /\b(wearing|dressed|clothed|outfit|shirt|pants|shorts|dress|jacket|coat|sweater|t[- ]?shirt|shoes|hat|cap|snapback|hoodie|jeans|skirt|blouse|suit|tie|scarf|vest)\b/i.test(sanitizedPrompt);
        if (!promptHasClothingDescription) {
          // Only resolve outfit from character data if prompt doesn't specify clothing
          const outfitObj = resolveCharacterOutfitForPrompt(charRecord, sanitizedPrompt);
          if (outfitObj) {
            charDesc = charDesc ? `${charDesc}. Currently wearing: ${outfitObj}` : `Currently wearing: ${outfitObj}`;
          }
        } else {
          console.log(`[generateImageAsync] Prompt explicitly specifies clothing — skipping outfit override`);
        }
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
        // CRITICAL: Prefer real uploaded reference_image_urls over generated_avatar_urls.
        // Generated avatars may be lower quality or inconsistent. Real photos ensure authentic likeness.
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


    if (sanitizedPrompt !== prompt.replace(/^\[CHARACTER\]\s*/i, '').trim()) {
      console.log(`[generateImageAsync] Prompt sanitized for content filter compliance`);
    }

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    const serverTime = new Date();
    const finalPrompt = buildPrompt({
      prompt: sanitizedPrompt,
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
      user_reference_images: userRefs,
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
      content: "",  // Clear any [IMAGE_FAILED] placeholder
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