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
    // ── STANDARD SCENE MODE ──
    // The SINGLE most important concept: character + background are ONE unified scene.
    // The camera angle defines BOTH what the character looks like AND what the background looks like.
    // They cannot be separated. The background is not static. It shifts perspective with the camera.

    const place = hasEnv ? [locationName, zoneName].filter(Boolean).join(' → ') : null;

    preamble = `════════════════════════════════════════════════════════════
UNIFIED SCENE RENDER — CHARACTER AND BACKGROUND SHARE ONE CAMERA
════════════════════════════════════════════════════════════

FUNDAMENTAL RULE: The background is NOT a static backdrop. It is a 3D space.
When the camera moves, EVERYTHING moves — the character, the furniture, the walls, the floor.
The background perspective shifts in sync with the camera angle. They are ONE image, not two layers.

CAMERA POSITION FOR THIS RENDER: ${cameraPos}
This is the position from which the ENTIRE scene — character AND environment — is rendered.

⛔ DO NOT render the background from one angle and place the character on top of it.
⛔ DO NOT use any reference image as a flat background.
⛔ DO NOT composite a character onto a photo.
✅ Build ONE unified image where character and room share the same perspective, vanishing points, lighting, and depth.

════════════════════════════════════════════════════════════
REFERENCE IMAGE INSTRUCTIONS
════════════════════════════════════════════════════════════
`;

    if (hasEnv) {
      preamble += `Images ${envRefStart}–${envEnd}: ROOM SPATIAL DATA — READ THE SPACE, DO NOT COPY THE PHOTO.
These photos of "${place}" tell you what EXISTS in this room:
  • Floor type, color, texture
  • Wall color and finish
  • What furniture is present, what color and shape it is
  • Window/door positions
  • Rugs, art, lighting fixtures, shelves, decor

FROM THIS DATA you will construct the room fresh in 3D from camera position: ${cameraPos}
The room as seen from THIS camera angle will look DIFFERENT than the reference photos — different perspective, different visible surfaces, different depth.

⛔ Do NOT reproduce the reference photo's camera angle.
⛔ Do NOT use the reference photo as the background layer.
⛔ Do NOT copy the reference photo's lighting — lighting comes from: ${timeLighting.period} (${timeLighting.desc})
✅ Use the reference photos ONLY to know what objects are in the room and what they look like.
✅ Then RE-RENDER the entire room from ${cameraPos} as if you placed your own camera there.

`;
    }

    if (hasChar) {
      preamble += `Images ${charRefStart}–${charEnd}: FACE IDENTITY ONLY for "${charName}".
Extract: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/texture, facial hair.
⛔ DISCARD everything else: pose, clothing, background, lighting, camera angle from these photos.
The character's face is the ONLY data. Their body, pose, and position in the scene are rendered fresh.

`;
    }

    if (hasUser) {
      preamble += `Images ${userRefStart}–${userEnd}: FACE/IDENTITY ONLY — User appearance.
Extract: face, skin tone, hair, body type. Discard: background, lighting, camera angle.

`;
    }

    preamble += `════════════════════════════════════════════════════════════
HOW TO BUILD THIS IMAGE
════════════════════════════════════════════════════════════
1. PLACE THE CAMERA at: ${cameraPos}
2. CONSTRUCT THE ROOM from the reference data in images ${envRefStart > 0 ? `${envRefStart}–${envEnd}` : '(no env refs — use a contextually appropriate setting)'}, seen from that camera position.
   The room has perspective, depth, vanishing points — it is a 3D space, not a flat photo.
3. PLACE THE CHARACTER inside the room at the correct position for the scene action.
   They are physically inside the space — same floor plane, same lighting, same perspective.
4. APPLY LIGHTING: ${timeLighting.period} — ${timeLighting.desc}
   Both character and room are lit from the same light source. No exceptions.

════════════════════════════════════════════════════════════
WHAT MAKES THIS LOOK REAL vs FAKE
════════════════════════════════════════════════════════════
FAKE (common failures):
🚫 Character appears cut-out or pasted on top of a photo background
🚫 Background looks like a flat photograph while character looks 3D
🚫 Background perspective does not match the camera angle
🚫 Character's shadow/lighting direction differs from the room's
🚫 Background is a copy of the reference photo at its original angle

REAL (what to do):
✅ Character and background share identical perspective lines and vanishing points
✅ Character casts shadows onto floor/furniture that match the time-of-day light source direction
✅ Character's skin tone highlights and shadows match the room's ambient light color temperature
✅ The room recedes naturally in 3D behind and around the character from the chosen camera angle
✅ Both character and environment look like they were photographed together in the same space at the same moment

════════════════════════════════════════════════════════════
FAIL CONDITIONS
════════════════════════════════════════════════════════════
🚫 Background camera angle matches reference images instead of: ${cameraPos}
🚫 Character looks composited, pasted, or cut out
🚫 Character lighting doesn't match room lighting
🚫 Background appears flat/2D while character appears 3D
🚫 Wrong time-of-day lighting (daylight at night, etc.)
🚫 Duplicate furniture created
🚫 Character appearance contradicts appearance lock

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

  FINAL REMINDER — UNIFIED SCENE: "${place}"
  The background and the character are ONE render. Same camera (${cameraPos}), same lighting (${timeLighting.period}), same perspective.
  The room does NOT look like the reference photos — it looks like the same room from a fresh angle.
  If the scene action requires a specific object (table, bed, couch), move the camera to frame it — do NOT duplicate or invent furniture.`;
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
    // Selfie mode: the character holds the phone — but the ROOM must still be re-rendered
    // from that selfie camera angle. The environment reference images are a blueprint.
    // The background visible BEHIND the subject must match the actual room structure
    // recomposed from the selfie camera's position and angle.

    let selfieEnvBlock = '';
    if (hasEnv) {
      const place = [locationName, zoneName].filter(Boolean).join(' → ');
      selfieEnvBlock = `

════════════════════════════════════════════════════════════
ROOM BLUEPRINT FOR SELFIE BACKGROUND — CRITICAL
════════════════════════════════════════════════════════════
Reference images ${envRefStart}–${envEnd} are photographs of the "${zoneName || place}".

The background of this selfie MUST show the real room — not a generic or invented space.

YOUR JOB:
1. READ the room blueprint: extract floor, walls, furniture types, colors, window positions, decor.
2. DETERMINE what would be VISIBLE directly behind the subject given the selfie camera angle and body position described in the prompt (e.g. lying in bed → pillows, headboard, wall behind them; seated at desk → wall, shelving, window beside them).
3. RE-RENDER only the portion of the room that appears in that angle as the background.

RULES:
✅ Background must show real elements from images ${envRefStart}–${envEnd} (correct wall color, correct furniture, correct materials)
✅ Perspective and depth of background must match the selfie camera angle exactly — close-up selfie = compressed background, overhead selfie = ceiling/bedding visible
✅ The room background adapts to the camera angle — it is NOT a flat copy of the reference photo
✅ Time-of-day lighting: ${timeLighting.desc} — apply to background too
⛔ Do NOT copy the reference photo camera angle as the background
⛔ Do NOT invent a generic room — use what's in images ${envRefStart}–${envEnd}
⛔ Do NOT show parts of the room that wouldn't be visible from this selfie angle`;
    }

    let selfieLightingBlock = `

════════════════════════════════════════════════════════════
LIGHTING — ${promptHasExplicitTime ? 'PROMPT-SPECIFIED TIME' : timeLighting.period}
════════════════════════════════════════════════════════════
${promptHasExplicitTime
  ? 'Apply lighting that matches the time of day described in the prompt.'
  : `Current time: ${serverHour}:00 → ${timeLighting.period}. Lighting: ${timeLighting.desc}.`}
Both the subject AND the background must be lit consistently from the same light source.`;

    return `${preamble}${selfieEnvBlock}${selfieLightingBlock}

${prompt}

Photorealistic smartphone photograph. Ultra-detailed. Real human proportions. Not an illustration.${identityLock}`;
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
      userUploadedReferenceUrl,   // optional: user-uploaded image for visual guidance (from Media Grid)
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
    // CLASSIFICATION-FIRST APPROACH:
    // Before making any replacements, classify the scene's intent and context.
    // Only apply heavy sanitization to genuinely explicit content.
    // Lifestyle, emotional, and comfort scenes must NOT be over-restricted.

    function classifySceneContext(p) {
      const lower = p.toLowerCase();

      // ── EXPLICIT SIGNALS — only these warrant aggressive sanitization ──
      // These signals define actual sexual content, independent of character gender/orientation.
      // Explicit classification is BASED ONLY on sexual behavior, not on gender pairing.
      const explicitSignals = [
        /\bsex(ual)?\b/, /\bporn\b/, /\berotic\b/, /\bgenitals?\b/, /\bpenis\b/, /\bvagina\b/,
        /\bnipples?\b/, /\bsexually\b/, /\barouse[d]?\b/, /\borgasm\b/, /\bintercourse\b/,
        /\bprivate parts?\b/, /\bexplicit(ly)?\b/, /\bsuggestive pose\b/, /\bseductive\b/,
        /\bsex act\b/, /\bsexualize[d]?\b/,
      ];
      const isExplicit = explicitSignals.some(r => r.test(lower));

      // ── SAFE LIFESTYLE SIGNALS — these override aggressive sanitization ──
      // A scene matching these patterns is SAFE by context, not by character gender/orientation.
      // LGBTQ+ intimacy (same-gender, queer, transgender, nonbinary) is treated with equal respect
      // and applies the SAME safety rules as heterosexual intimacy.
      // Emotional closeness between any pairing is not inherently sexual or unsafe.
      const isSleepContext = /\b(sleep(ing)?|asleep|woke up|waking up|bed|bedroom|lying|laid down|resting|nap(ping)?|pillow|duvet|blanket|sheets?)\b/.test(lower);
      const isComfortContext = /\b(comfort(ing)?|support(ing|ive)?|emotional|vulnerable|safe|holding|hugging|close|beside|next to|shoulder|arms? around|snuggle|cuddle|warm|peaceful|quiet moment|calming|soothing|affection(ate)?|tender(ness)?|intimate|love)\b/.test(lower);
      const isLifestyleContext = /\b(beach|gym|workout|fitness|pool|vacation|home|apartment|mirror|selfie|casual|morning|routine|everyday|relaxing|chill(ing)?|hanging out)\b/.test(lower);
      const isNonSexualBodyContext = /\b(no shirt|without (a )?shirt|shirtless|without (a )?top|no top)\b/.test(lower) && !isExplicit;

      // Determine scene category based ONLY on behavior, context, and setting — NOT on character gender/orientation
      if (isExplicit) return 'explicit';
      if (isSleepContext && isComfortContext) return 'emotional_comfort';
      if (isSleepContext) return 'sleep_lifestyle';
      if (isComfortContext) return 'comfort';
      if (isLifestyleContext) return 'lifestyle';
      if (isNonSexualBodyContext) return 'casual_body';
      return 'neutral';
    }

    function sanitizePrompt(p) {
      // Strip routing tag
      let s = p.replace(/^\[CHARACTER\]\s*/i, '').trim();

      const sceneClass = classifySceneContext(s);
      console.log(`[generateImageAsync] Scene classification: "${sceneClass}"`);

      // ── SAFE SCENES: minimal sanitization, preserve emotional/lifestyle intent ──
      // For emotional_comfort, sleep, lifestyle, casual_body — do NOT rewrite the core scene.
      // Only remove genuinely explicit terms if any slipped through.
      const isSafeScene = ['emotional_comfort', 'sleep_lifestyle', 'comfort', 'lifestyle', 'casual_body', 'neutral'].includes(sceneClass);

      if (isSafeScene) {
        // Only replace genuinely explicit anatomy/act terms — leave body/clothing context alone
        s = s.replace(/\bnaked\b/gi, 'not fully dressed');
        s = s.replace(/\bnude\b/gi, 'not fully dressed');
        s = s.replace(/\bfully nude\b/gi, 'not fully dressed');
        s = s.replace(/\bfully naked\b/gi, 'not fully dressed');
        s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
        s = s.replace(/\blingerie\b/gi, 'sleepwear');
        s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
        s = s.replace(/\bpanties\b/gi, 'underwear');
        s = s.replace(/\bthong\b/gi, 'underwear');
        // Do NOT replace: shirtless, no shirt, chest, torso, bedroom, lying together, intimate, vulnerable
        // These are SAFE in lifestyle/comfort/sleep context
        return s.trim();
      }

      // ── EXPLICIT SCENES: full sanitization pipeline ──
      // Upper body
      s = s.replace(/\bshirtless\b/gi, 'with no shirt on');
      s = s.replace(/\btopless\b/gi, 'with no shirt on');
      s = s.replace(/\bbarechested\b/gi, 'with no shirt on');
      s = s.replace(/\bbare[- ]?chest(ed)?\b/gi, 'with no shirt on');

      // Lower body
      s = s.replace(/\bin (his|her|their) underwear\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin underwear\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin boxers\b/gi, 'in comfortable shorts');
      s = s.replace(/\bin briefs\b/gi, 'in comfortable shorts');
      s = s.replace(/\bonly in (his|her|their) underwear\b/gi, 'in comfortable shorts at home');
      s = s.replace(/\bunderwear\b/gi, 'shorts');

      // Lingerie-style
      s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
      s = s.replace(/\blingerie\b/gi, 'sleepwear');
      s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
      s = s.replace(/\bpanties\b/gi, 'shorts');
      s = s.replace(/\bthong\b/gi, 'shorts');

      // Anatomy-focused
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
      // User-uploaded visual reference (from Media Grid) — appended last so it guides without overriding identity
      ...(userUploadedReferenceUrl && cdnFilter([userUploadedReferenceUrl]).length > 0 ? [cdnFilter([userUploadedReferenceUrl])[0]] : []),
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

    // ── 7. CAMERA ENFORCEMENT — EXTRACT PREVIOUS CAMERA STATE ────────────────
    // Read previous generation context from the message to compare camera variables.
    // This is how we detect "same frame reuse" and force movement.
    const previousCtx = message?.generation_context || null;
    const previousCameraVars = previousCtx?.camera_variables || null;

    // ── CAMERA VARIABLE EXTRACTOR (inlined — no local imports in Deno) ────────
    function extractCameraVarsFromPrompt(p) {
      const lower = (p || '').toLowerCase();
      return {
        distance: /wide shot|establishing shot|full body/.test(lower) ? 'wide' : /close-up|tight shot|face shot/.test(lower) ? 'close' : 'medium',
        angle: /high-?angle|overhead|from above|top-?down/.test(lower) ? 'high' : /low-?angle|from below|looking up/.test(lower) ? 'low' : /over-?shoulder/.test(lower) ? 'over-shoulder' : /side angle|from the side/.test(lower) ? 'side' : 'straight',
        height: /seated|sitting at|sat down/.test(lower) ? 'seated' : /crouching|crouched/.test(lower) ? 'crouched' : 'standing',
        framing: /off-?center|asymmetric/.test(lower) ? 'off-center' : /cropped|partial body/.test(lower) ? 'cropped' : /environmental|full scene/.test(lower) ? 'environmental' : 'standard',
        lens_style: /selfie|phone selfie/.test(lower) ? 'phone' : /wide-?angle|fisheye/.test(lower) ? 'wide-angle' : /cinematic/.test(lower) ? 'cinematic' : 'standard',
      };
    }

    function countCameraDiffs(prev, next) {
      if (!prev || !next) return 5; // no previous = always valid
      let diffs = 0;
      if (prev.distance !== next.distance) diffs++;
      if (prev.angle !== next.angle) diffs++;
      if (prev.height !== next.height) diffs++;
      if (prev.framing !== next.framing) diffs++;
      if (prev.lens_style !== next.lens_style) diffs++;
      return diffs;
    }

    // Forced camera override presets — escalate randomness on retry
    const CAMERA_FORCE_PRESETS = [
      // Attempt 1: strong directional shift
      `\n\n════ MANDATORY CAMERA OVERRIDE (validation retry 1) ════\nThe previous image reused the same camera position. You MUST physically move the camera.\nREQUIRED: wide shot from the far corner of the room, camera at LOW angle (below waist height), subject in right third of frame — asymmetric, off-center. Strong foreground element in lower-left. Background recedes into depth.\nThis camera position MUST be visibly different from any previous framing. Centered or eye-level framing = automatic fail.\n════════════════════════════════════════════════`,
      // Attempt 2: escalated — completely different preset
      `\n\n════ MANDATORY CAMERA OVERRIDE (validation retry 2 — ESCALATED) ════\nTwo consecutive generations used the same camera frame. Maximum variation required.\nREQUIRED: OVERHEAD / TOP-DOWN angle, camera directly above subject looking straight down. Subject centered but slightly offset to one side. Environmental context fully visible from above. No standard eye-level framing whatsoever.\nAlternatively if overhead is not contextually possible: EXTREME LOW ANGLE from floor level, camera tilted sharply upward. Subject fills upper portion of frame. Floor in foreground.\n════════════════════════════════════════════════`,
    ];

    // ── 8. GENERATE + VALIDATE LOOP (max 3 attempts) ─────────────────────────
    let genRes = null;
    let acceptedCameraVars = null;
    let attemptPrompt = finalPrompt;
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let attemptGenRes = null;
      try {
        attemptGenRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: attemptPrompt,
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

      if (!attemptGenRes?.url) {
        console.warn(`[generateImageAsync] Attempt ${attempt}: no URL returned`);
        continue;
      }

      // Extract camera variables from the PROMPT used (best proxy we have without image analysis)
      const thisCameraVars = extractCameraVarsFromPrompt(attemptPrompt);
      const diffCount = countCameraDiffs(previousCameraVars, thisCameraVars);

      console.log(`[generateImageAsync] Attempt ${attempt}: camera diffs vs previous = ${diffCount} | dist=${thisCameraVars.distance} angle=${thisCameraVars.angle} framing=${thisCameraVars.framing}`);

      // FIRST GENERATION (no previous): always valid — no prior camera to compare against
      if (!previousCameraVars) {
        console.log(`[generateImageAsync] No previous camera state — accepting first generation`);
        genRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
        break;
      }

      if (diffCount >= 2) {
        console.log(`[generateImageAsync] ✅ Camera validation PASSED (${diffCount} variables changed)`);
        genRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
        break;
      }

      // FAILED — camera didn't move enough
      console.warn(`[generateImageAsync] ⚠️ Camera validation FAILED attempt ${attempt}: only ${diffCount} variable(s) changed. Forcing camera shift.`);

      if (attempt < MAX_ATTEMPTS) {
        // Inject forced camera override into prompt for next attempt
        const overrideBlock = CAMERA_FORCE_PRESETS[Math.min(attempt - 1, CAMERA_FORCE_PRESETS.length - 1)];
        attemptPrompt = attemptPrompt + overrideBlock;
      } else {
        // All attempts exhausted — accept last result with a warning rather than failing completely
        console.warn(`[generateImageAsync] ⚠️ Max attempts reached — accepting last image (camera validation could not be enforced)`);
        genRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
      }
    }

    if (!genRes?.url) {
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    // ── 9. SAVE — only reached after validation passed (or max attempts) ──────
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
      camera_variables: acceptedCameraVars,
    };

    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      generation_context: generationContext,
      content: "",
    });

    console.log(`[generateImageAsync] ✓ SUCCESS: ${messageId} | camera: ${acceptedCameraVars?.distance} ${acceptedCameraVars?.angle} ${acceptedCameraVars?.framing}`);

    return Response.json({
      success: true,
      imageUrl: genRes.url,
      messageId,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
      cameraVariables: acceptedCameraVars,
    });

  } catch (error) {
    console.error('[generateImageAsync] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});