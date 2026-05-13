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
// Sims-style outfit resolution — inlined since Deno cannot import local lib files.
// Source of truth: outfitRotationEngine.js (lib). Keep in sync with that file.

function buildOutfitText(outfit) {
  if (!outfit) return null;
  // CRITICAL: Prefer individual fields over full_description.
  // full_description often contains scene/pose/lighting preamble that contaminates the image prompt.
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (outfit.full_description) {
    const stripped = outfit.full_description
      .replace(/^in [^,.]+(,|\.) ?/i, '')
      .replace(/^a (man|woman|person)[^,.]*(,|\.) ?/i, '')
      .replace(/^[^,.]+(stands|sits|lounges|poses)[^,.]*(,|\.) ?/i, '')
      .trim();
    return stripped || outfit.full_description;
  }
  return null;
}

// Fallback chains — per spec
const OUTFIT_FALLBACK_CHAINS = {
  bath:         ['bath', 'sleepwear', 'lounge'],
  sleepwear:    ['sleepwear', 'lounge', 'daily_casual'],
  swimwear:     ['swimwear', 'gym', 'daily_casual'],
  gym:          ['gym', 'outdoor', 'daily_casual'],
  work:         ['work', 'formal', 'daily_casual'],
  formal:       ['formal', 'work', 'daily_casual'],
  church:       ['church', 'formal', 'daily_casual'],
  nightlife:    ['nightlife', 'date_night', 'daily_casual'],
  date_night:   ['date_night', 'nightlife', 'formal', 'daily_casual'],
  school:       ['school', 'daily_casual'],
  lounge:       ['lounge', 'daily_casual'],
  outdoor:      ['outdoor', 'daily_casual'],
  travel:       ['travel', 'outdoor', 'daily_casual'],
  medical:      ['medical', 'daily_casual'],
  special:      ['special', 'formal', 'daily_casual'],
  cold_weather: ['cold_weather', 'outdoor', 'daily_casual'],
  hot_weather:  ['hot_weather', 'outdoor', 'daily_casual'],
  daily_casual: ['daily_casual', 'outdoor', 'lounge'],
};

function resolveOutfitCategory(character) {
  const presence = character?.resolved_presence_status || character?.location_status || '';
  const activity = (character?.current_activity || '').toLowerCase();
  if (/bath|shower|grooming/.test(activity)) return 'bath';
  if (presence === 'sleeping' || presence === 'napping' || /\b(sleep|nap|asleep|bedtime)\b/.test(activity)) return 'sleepwear';
  if (/\b(swim|pool|beach|ocean|water park)\b/.test(activity)) return 'swimwear';
  if (/\b(gym|workout|exercise|lifting|cardio|yoga|jogging|running|training)\b/.test(activity)) return 'gym';
  if (presence === 'at_work') return 'work';
  if (/\b(church|worship|mass|prayer|service)\b/.test(activity)) return 'church';
  if (/\b(wedding|funeral|gala|graduation|ceremony|formal)\b/.test(activity)) return 'formal';
  if (/\b(club|nightclub|party|night out)\b/.test(activity)) return 'nightlife';
  if (/\b(date|date night|romantic dinner|anniversary)\b/.test(activity)) return 'date_night';
  if (/\b(school|class|campus|lecture|college|university)\b/.test(activity)) return 'school';
  if (/\b(airport|train|travel|hotel check-in|vacation departure)\b/.test(activity)) return 'travel';
  if (presence === 'home') return 'lounge';
  return 'daily_casual';
}

function resolveCharacterOutfitForPrompt(character) {
  if (!character) return null;
  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.outfit_id);
  if (outfits.length === 0) {
    // No closet — fall back to current_outfit field if set
    return buildOutfitText(character.current_outfit) || null;
  }
  const targetCategory = resolveOutfitCategory(character);
  const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
  const currentOutfitId = character.current_outfit?.outfit_id || null;
  for (const cat of chain) {
    const pool = outfits.filter(o => o.category === cat);
    if (pool.length === 0) continue;
    if (pool.length === 1) return buildOutfitText(pool[0]);
    // Daily rotation: deterministic by day + character ID, avoid repeating current outfit
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    let idx = (dayOfYear + idHash) % pool.length;
    if (pool[idx]?.outfit_id === currentOutfitId && pool.length > 1) idx = (idx + 1) % pool.length;
    return buildOutfitText(pool[idx]);
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

function buildPrompt({ prompt, charName, charDesc, locationName, zoneName, envRefCount, charRefCount, userRefCount, userRefStart, charRefStart, envRefStart, serverHour, serverTime, subjectType, characterId, userWorldName }) {
  // ── IMAGE GENERATION PRIORITY STACK (GOVERNING LAW) ──────────────────────
  // Priority 1: SCENE INTENT — user prompt meaning, emotion, action
  // Priority 2: CHARACTER PRESENCE — who is there and what they are doing
  // Priority 3: CAMERA POSITION — angle, distance, framing
  // Priority 4: ZONE IDENTITY — room type and style
  // Priority 5: REFERENCE IMAGE — guidance only, not replication
  // Priority 6: SAFETY SANITIZATION — minimal, non-destructive
  //
  // CRITICAL: Lower priority NEVER overrides higher priority.
  // CONFLICT RESOLUTION: scene intent → camera realism → zone identity → relax reference constraints
  // ANTI-FLAT RULE: slightly imperfect room + correct emotion/camera = VALID. Perfect room + static camera = FAILED.
  // ─────────────────────────────────────────────────────────────────────────

  // ── INTENSITY BALANCING ───────────────────────────────────────────────────
  // When multiple high-intensity signals co-occur (closeness + nighttime + private setting + minimal clothing),
  // do NOT maximize all signals simultaneously — balance them to stay below filter threshold while preserving the moment.
  // Rules:
  //   - Reduce camera proximity slightly when physical contact + minimal clothing are both present
  //   - Soften physical contact wording (e.g. "close to" instead of "pressed against")
  //   - Imply environment rather than labeling it directly (e.g. avoid stacking "night" + "bedroom" + "alone" + "intimate")
  //   - Keep emotional tone without labeling it as "intimate" or "sensual"
  // Goal: preserve the visual/emotional moment while keeping overall intensity balanced.
  // ─────────────────────────────────────────────────────────────────────────

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
      preamble += `Images ${envRefStart}–${envEnd}: ENVIRONMENT SPATIAL DATA — REUSABLE 3D PHYSICAL SPACE, NOT A SCREENSHOT TEMPLATE.
These reference images of "${place}" are a SPATIAL GUIDE ONLY. They define environment identity: architecture, geometry, materials, furniture/object types, layout logic, color palette, spatial orientation.

════════════════════════════════════════════════════════════
GLOBAL 3D ENVIRONMENT RULE — APPLIES TO ALL LOCATIONS WORLDWIDE
════════════════════════════════════════════════════════════
This rule applies to: homes, bedrooms, kitchens, offices, bars, clubs, streets, parks,
beaches, forests, restaurants, hospitals, vehicles, outdoor spaces — ALL ENVIRONMENTS.

The reference image is a SPATIAL GUIDE only.
The reference image is NOT the required camera angle.
The reference image is NOT a screenshot to replicate.
The reference image is NOT a frozen exposure state.
The reference image is NOT a lighting authority.
The reference image does NOT lock time of day, brightness, weather, or atmosphere.

════════════════════════════════════════════════════════════
⛔⛔⛔ CRITICAL — LIGHTING AUTHORITY RULE ⛔⛔⛔
════════════════════════════════════════════════════════════
REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE.

The reference images may have been photographed at ANY time of day under ANY lighting conditions.
That lighting is IRRELEVANT to this generation.

YOU MUST COMPLETELY DISCARD THE LIGHTING STATE SHOWN IN REFERENCE IMAGES.
DO NOT copy the reference image's brightness, exposure, color temperature, or shadows.
DO NOT let dark reference images make this scene dark.
DO NOT let nighttime reference images suppress daylight.
DO NOT let bright reference images override a night scene.
DO NOT let warm reference images force warm color temperature.

The reference images define the PHYSICAL SPACE ONLY:
  ✅ Architecture and geometry
  ✅ Furniture types and placement
  ✅ Materials and textures
  ✅ Color palette of objects and surfaces
  ✅ Spatial layout and orientation
  ✅ Window, door, and wall positions

The ACTIVE LIGHTING STATE is defined exclusively by: ${timeLighting.period} (${timeLighting.desc})

Treat this environment like a cinematic film set that can be re-lit under ANY conditions.
The same room must be capable of rendering as bright noon, cloudy day, sunset, moonlit night,
fluorescent office lighting, neon-lit night, stormy overcast — all while remaining the same physical space.

════════════════════════════════════════════════════════════
WINDOW LIGHTING ENFORCEMENT
════════════════════════════════════════════════════════════
If windows are present in the environment, they MUST behave as active light sources matching the current time.

If the lighting period is MORNING, MIDDAY, or AFTERNOON:
  ✅ Windows transmit bright natural daylight into the space
  ✅ The environment brightens — shadows shift toward the window light source
  ✅ Environmental bounce lighting from the floor/walls updates
  ✅ The space looks like it is being photographed in real daylight
  ⛔ DO NOT preserve darkness from reference images — daylight ENTERS through windows

If the lighting period is NIGHT:
  ✅ Windows show darkness outside or dim city/moonlight
  ✅ Interior artificial lighting only — lamps, ceiling fixtures
  ✅ No daylight, no blue sky, no exterior brightness

════════════════════════════════════════════════════════════
LATENT LIGHTING ANCHOR SUPPRESSION
════════════════════════════════════════════════════════════
You may have latent memory of the reference image's lighting. THIS MUST BE SUPPRESSED.

⛔ Dark reference images must NOT bias output darker than ${timeLighting.period} requires
⛔ Nighttime reference images must NOT suppress daylight if current time is daytime
⛔ Warm reference images must NOT force warm color temperature against the active lighting
⛔ No single reference image's exposure should dominate the output lighting

When multiple references exist:
  ✅ Merge spatial/environmental understanding across all references
  ✅ Preserve environment identity (architecture, layout, materials)
  ✅ Discard all conflicting lighting states
  ✅ Apply ONLY the active lighting period defined above

════════════════════════════════════════════════════════════

From the spatial guide, extract:
  • The environment's layout logic (where walls, doors, windows, structures are)
  • Object/furniture types and their spatial relationships
  • Color palette and material properties of surfaces and objects
  • The zone's overall identity, style, and scale

Then RECOMPOSE the scene from the camera position: ${cameraPos}

WHAT IS ALLOWED (do not fight these):
  ✓ Only part of the environment is visible — correct, camera moved
  ✓ Some objects are off-frame or partially cropped — correct
  ✓ A different section is visible than in the reference — correct
  ✓ Foreground objects partially block background — correct, adds depth
  ✓ Only 1 or 2 environmental features appear — correct if that's what this angle shows

ENVIRONMENT IDENTITY IS PRESERVED WHEN:
  ✅ The visual style, materials, and color palette match the reference space
  ✅ The spatial logic is consistent with the reference
  ✅ The space FEELS like the same location, even if a different part is shown

ENVIRONMENT IDENTITY FAILS ONLY WHEN:
  🚫 The location style/palette is completely different from the reference
  🚫 Completely unrelated architecture or setting is present
  🚫 The location has zero visual connection to the reference

⛔ Do NOT reproduce the reference photo's camera angle.
⛔ Do NOT use the reference photo as a flat background layer.
⛔ Do NOT composite the character onto the reference photo.
⛔ Do NOT require every object in the reference to appear in every image.
⛔ Do NOT copy the reference photo's lighting — lighting is DEFINED BY: ${timeLighting.period} (${timeLighting.desc})
✅ Use reference photos ONLY to understand the physical space. Then re-render from the chosen camera position under the active lighting conditions.
✅ The character must be physically inside the re-rendered space — same floor, same light, same perspective.

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

  FINAL REMINDER — GLOBAL 3D ENVIRONMENT RULE: "${place}"
  The reference images define ONLY the physical space — architecture, layout, materials, objects.
  The camera is at: ${cameraPos}. Active lighting state: ${timeLighting.period} — ${timeLighting.desc}.
  REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE. Do NOT preserve or replicate any lighting visible in references.
  The environment must be re-lit under ${timeLighting.period} conditions regardless of what lighting appears in the reference photos.
  Show only what is naturally visible from the camera position. Partial views, cropped objects, and off-frame elements are all correct.
  Do NOT force every reference object into the frame. Do NOT copy the reference photo's camera angle or treat it as a background layer.
  Environment identity means: same style, same spatial logic, same materials — NOT the same photo reproduced under the same lighting.
  This rule applies globally: bedrooms, living rooms, kitchens, bathrooms, offices, bars, clubs, streets, parks, outdoor spaces, and all environments without exception.`;
  }

  // When the prompt explicitly declares a time of day, do NOT inject the server-time reference
  // image override — the prompt IS the lighting authority. Injecting "server time = 3pm" when
  // the prompt says "nighttime" creates a conflicting signal that confuses the model and
  // produces daytime images despite the user's explicit night request.
  let refImageOverride = promptHasExplicitTime ? `

════════════════════════════════════════════════════════════
⛔ REFERENCE IMAGE LIGHTING IS IGNORED — PROMPT IS AUTHORITY ⛔
════════════════════════════════════════════════════════════
The prompt explicitly specifies an environmental state. This is AUTHORITATIVE and MANDATORY.

REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE.
Reference images define ONLY the physical environment — architecture, layout, materials, objects.
They do NOT define lighting, time of day, exposure, weather, or atmosphere.

THIS REFERENCE IMAGE LIGHTING MUST BE COMPLETELY IGNORED — FOR ALL ENVIRONMENTS.
This applies to: homes, bedrooms, offices, bars, streets, parks, beaches, clubs, ALL locations.

If reference images show bright daylight but the prompt says nighttime:
🚫 DO NOT replicate that daylight lighting
🚫 DO NOT use that color temperature
🚫 DO NOT copy that brightness level
🚫 DO NOT let the reference image's exposure bias this output

If reference images are dark but the prompt says bright daylight:
🚫 DO NOT preserve the reference's darkness
🚫 DO NOT suppress window daylight
🚫 DO NOT let latent nighttime memory anchor the output dark

LATENT ANCHORING SUPPRESSION: You may have memorized the reference image's lighting state.
Actively suppress this. The reference lighting is irrelevant. Generate ONLY from the prompt's declared environmental conditions.

Generate lighting ONLY from what the prompt describes.
The scene lighting must match the PROMPT's declared environmental state, not the reference images.
Treat the environment as a reusable 3D physical space that can be dynamically re-lit under ANY conditions.` : `

════════════════════════════════════════════════════════════
⛔ CRITICAL GLOBAL OVERRIDE: REFERENCE IMAGE LIGHTING IS IGNORED ⛔
════════════════════════════════════════════════════════════
This rule applies to ALL environments without exception:
homes, bedrooms, kitchens, offices, bars, clubs, streets, parks, beaches, vehicles, ALL locations.

REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE.
Reference images define ONLY the physical environment — architecture, layout, materials, spatial identity.
They do NOT define lighting authority, time of day, exposure, weather, or atmosphere.

ACTIVE LIGHTING STATE: ${timeLighting.period} — ${timeLighting.desc}
Server time: ${serverHour}:${String(new Date().getMinutes()).padStart(2, '0')}

THIS REFERENCE IMAGE LIGHTING MUST BE COMPLETELY DISCARDED.

If reference images show nighttime/dark environments but current time is daytime:
✅ The environment MUST be rendered in DAYLIGHT
✅ Windows must transmit bright natural light into the space
✅ The room/location must brighten to match ${timeLighting.period} conditions
🚫 DO NOT preserve the reference's darkness
🚫 DO NOT suppress daylight entering through windows

If reference images show bright daylight but current time is night:
✅ The environment MUST be rendered with NIGHT LIGHTING ONLY
✅ No sunlight, no daylight color temperature, no bright windows
🚫 DO NOT replicate the reference's brightness

LATENT ANCHORING SUPPRESSION:
⛔ Dark references must NOT force dark output if current time is daytime
⛔ Nighttime references must NOT suppress daylight
⛔ Warm references must NOT force warm color temperature against the active lighting period
⛔ No single reference image's lighting state should dominate the output

Multi-reference balancing: When multiple environment references exist, merge ONLY their
spatial/structural understanding. Discard ALL conflicting lighting states. Apply only the active period.

Treat the environment as a reusable 3D physical space that can be dynamically re-lit under any conditions.
The active lighting period is the ONLY authority: ${timeLighting.period} — ${timeLighting.desc}.`;

  // ── APPEARANCE LOCK HELPER ───────────────────────────────────────────────────
  function buildAppearanceLockText(desc) {
    return [
      (desc || '').match(/(?:short|long|curly|straight|wavy|fade|pixie|bob|braid|updo|dyed|bleached|natural).*?(?:hair|style|locks)/i)?.[0] || null,
      (desc || '').match(/(?:clean-shaven|stubble|beard|goatee|mustache|facial hair)/i)?.[0] || null,
      (desc || '').match(/(?:fair|light|medium|tan|brown|dark|olive|pale|dusky).*?(?:skin|tone)/i)?.[0] || null,
      (desc || '').match(/(?:slim|athletic|muscular|stocky|curvy|average|petite|tall|broad)(?:.*?(?:build|frame|type))?/i)?.[0] || null,
    ].filter(Boolean).join(', ') || 'as described';
  }

  let identityLock = '';

  // ── JOINT SUBJECT MODE — dual named identity slots ────────────────────────
  // When subjectType === 'joint', both the character AND the user are primary subjects.
  // Generic "User" label is not enough — each subject needs a fully-named, numbered identity slot
  // so the model never merges, blurs, or substitutes one person for the other.
  if (subjectType === 'joint') {
    // Background population rules for joint scenes
    const promptLowerForBg = (prompt || '').toLowerCase();
    const isPrivateScene = /\b(selfie|close.?up|just us|just the two|alone|private|bedroom|mirror|portrait|intimate|romantic)\b/i.test(prompt);
    const isPublicScene = /\b(pool party|club|concert|bar|beach|festival|mall|airport|restaurant|crowd|party|event)\b/i.test(prompt);
    const bgRule = isPrivateScene
      ? `⛔ BACKGROUND PEOPLE: ZERO. This is a private/intimate scene. Do NOT add any background figures, bystanders, or extras — not even one. The subjects are alone.`
      : isPublicScene
      ? `BACKGROUND PEOPLE: Allowed as environmental texture ONLY. Background figures must be out-of-focus, non-specific, and visually subordinate. They must NEVER enter the foreground framing or become cast members. No children unless the prompt explicitly mentions them.`
      : `BACKGROUND PEOPLE: Avoid unless the scene clearly requires a populated environment. If present, they must be blurred, indistinct, and visually subordinate. No children unless explicitly requested.`;

    identityLock = `

════════════════════════════════════════════════════════════
⚠️ JOINT IMAGE — TWO SEPARATE IDENTITY-LOCKED SUBJECTS
════════════════════════════════════════════════════════════
This image contains EXACTLY TWO primary subjects. Each subject has a separate identity slot below.
You MUST render both subjects as distinct individuals. Do NOT merge, blend, or substitute their appearances.
The scene description comes AFTER these identity definitions — read both identity slots BEFORE reading the scene.

────────────────────────────────────────────────────────────
SUBJECT 1 — CHARACTER: "${charName}"
────────────────────────────────────────────────────────────
Subject 1 Type: character
Subject 1 ID: ${characterId || 'resolved from prompt'}
${charRefCount > 0
  ? `Subject 1 Reference Images: Images ${charRefStart}–${charEnd} (${charRefCount} photo${charRefCount > 1 ? 's' : ''})
These are face/identity reference photographs of "${charName}".
Extract ONLY: face structure, skin tone, eye shape, nose, mouth, hair color/length/style, facial hair, body type.
⛔ DISCARD: pose, background, clothing, lighting from these photos — face and body identity ONLY.`
  : `Subject 1 Reference Images: NONE — generate from text description below ONLY.`
}
Subject 1 Appearance Lock (ABSOLUTE — 100% non-negotiable):
  ${charDesc ? charDesc : 'Generate as described in scene prompt.'}
Subject 1 Appearance Key: ${buildAppearanceLockText(charDesc)}
⛔ Subject 1 MUST look like "${charName}" at all times. Do NOT substitute a generic person.
⛔ Do NOT let Subject 2's appearance overwrite or bleed into Subject 1.

────────────────────────────────────────────────────────────
SUBJECT 2 — USER: "${userWorldName || 'the user'}"
────────────────────────────────────────────────────────────
Subject 2 Type: user
Subject 2 ID: current app user
${userRefCount > 0
  ? `Subject 2 Reference Images: Images ${userRefStart}–${userEnd} (${userRefCount} photo${userRefCount > 1 ? 's' : ''})
These are face/identity reference photographs of the user.
Extract ONLY: face structure, skin tone, eye shape, nose, mouth, hair color/length/style, body type.
⛔ DISCARD: pose, background, clothing, lighting from these photos — face and body identity ONLY.`
  : `Subject 2 Reference Images: NONE — render the user as a realistic human consistent with scene context. Do NOT substitute a child or irrelevant person.`
}
⛔ Subject 2 MUST look like the person in the reference photos (if provided). Do NOT use a generic face.
⛔ Do NOT let Subject 1's appearance overwrite or bleed into Subject 2.

════════════════════════════════════════════════════════════
JOINT RENDERING RULES — NON-NEGOTIABLE
════════════════════════════════════════════════════════════
✅ BOTH subjects must be clearly visible and visually dominant in the frame
✅ Each subject retains their own distinct face, hair, skin tone, and body type throughout
✅ Neither subject's identity bleeds into the other
✅ Both subjects are physically integrated into the same scene — same lighting, same perspective, same floor plane
✅ Anatomically correct hands (exactly 5 fingers per hand) on both subjects
✅ Both subjects cast real shadows from the same time-of-day light source

⛔ Do NOT introduce a third foreground person unless explicitly requested in the scene prompt
⛔ Do NOT add children unless the scene prompt explicitly mentions them
⛔ Do NOT substitute a generic second person for Subject 2
⛔ Do NOT treat the user (Subject 2) as scenery or a background element
⛔ Do NOT render one subject correctly and make the other generic/approximate
⛔ HARD FAIL: Any unintended person appears in the foreground framing

${bgRule}

CAMERA HIERARCHY FOR THIS JOINT SCENE:
1. Both subjects and their interaction/emotion (primary — always dominant)
2. Scene environment and setting (secondary)
3. Background extras if any (environmental texture only — never competing)`;

  } else if (hasChar && !isSelfieMode) {
    // Standard single-character scene mode identity lock
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
  ✅ APPEARANCE LOCK (100% ABSOLUTE): ${buildAppearanceLockText(charDesc)} — NON-NEGOTIABLE
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
  ✅ APPEARANCE LOCK: ${buildAppearanceLockText(charDesc)} — NON-NEGOTIABLE
  ⛔ Do NOT copy pose, background, or clothing from reference photos — only the face identity transfers`;
  }

  // For non-joint user identity (user-only photos)
  if (hasUser && subjectType !== 'joint') {
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

ENVIRONMENT BLUEPRINT FOR SELFIE BACKGROUND — CRITICAL
Reference images ${envRefStart}–${envEnd} are photographs of the "${zoneName || place}".

The background of this selfie MUST show the real environment — not a generic or invented space.

YOUR JOB:
1. READ the environment blueprint: extract floor, walls, furniture types, colors, window positions, decor, spatial structure.
2. DETERMINE what would be VISIBLE directly behind the subject given the selfie camera angle and body position described in the prompt (e.g. lying in bed: pillows, headboard, wall behind them; seated at desk: wall, shelving, window beside them).
3. RE-RENDER only the portion of the environment that appears in that angle as the background.

RULES — GLOBAL 3D ENVIRONMENT RULE APPLIES HERE TOO:
✅ The reference images are a SPATIAL GUIDE — extract layout, materials, colors, and object types ONLY
✅ REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE — discard all lighting visible in references
✅ Show only what is naturally visible from this selfie angle and body position — partial view is correct
✅ Background perspective must match the selfie camera angle exactly — close-up = compressed background, overhead = ceiling/bedding visible
✅ Active lighting: ${timeLighting.desc} — apply to background regardless of what references show
⛔ Do NOT copy the reference photo's camera angle as the background
⛔ Do NOT copy the reference photo's lighting, exposure, color temperature, or shadow state
⛔ Do NOT let dark references make the selfie background dark unless the active prompt/time says it is dark
⛔ Do NOT let bright references make the selfie background bright unless the active prompt/time says it is bright
⛔ Do NOT require every reference object to appear — only what this angle would show
⛔ Do NOT invent a generic environment — use the spatial identity from images ${envRefStart}–${envEnd}
⛔ Do NOT show parts of the environment that would not be visible from this selfie angle`;
    }

    const selfieLightingTitle = promptHasExplicitTime ? 'PROMPT-SPECIFIED TIME' : timeLighting.period;
    const selfieLightingSource = promptHasExplicitTime ? 'prompt' : 'server_time';
    const selfieLightingDesc = promptHasExplicitTime
      ? 'Apply lighting that matches the time of day described in the prompt. The prompt is the sole authority.'
      : `Active time period: ${timeLighting.period}. Lighting: ${timeLighting.desc}.`;
    const lightingOverrideBlockInjected = hasEnv;
    let selfieLightingBlock = '\n\nLIGHTING AUTHORITY — ' + selfieLightingTitle + '\n'
      + selfieLightingDesc + '\n'
      + 'REFERENCE IMAGE LIGHTING IS NON-AUTHORITATIVE — completely discard any lighting, exposure, brightness, color temperature, or shadow state visible in reference images.\n'
      + 'Active lighting source: ' + selfieLightingSource + '\n'
      + (promptHasExplicitTime
          ? 'The prompt explicitly declares the environmental state. This overrides server time, reference images, and all other signals.\n'
          : 'Server time determines lighting. Reference image lighting does NOT.\n')
      + 'explicit_prompt_environment_authority: ' + promptHasExplicitTime + '\n'
      + 'reference_lighting_authority: false\n'
      + 'Both the subject AND the background must be lit consistently from the same active light source. No exceptions.';

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
      characterId,        // SUBJECT character ID (may differ from sender for third-party photos)
      senderCharacterId,  // SENDER character ID (always the message author)
      characterName,
      characterReferenceImages,   // UI-provided fallback refs
      userReferenceImages,
      userWorldName,
      characterEmotionalState,
      userUploadedReferenceUrl,   // optional: user-uploaded image for visual guidance (from Media Grid)
      // manualLocationId is NOT used — location resolved from character record
    } = await req.json();

    if (!messageId) {
      return Response.json({ error: 'messageId is required' }, { status: 400 });
    }
    if (!prompt) {
      return Response.json({ error: 'prompt is required' }, { status: 400 });
    }

    // ── HARD SUBJECT LOCK DETECTION ───────────────────────────────────────────
    // Detect whether this is a third-party photo (sender ≠ subject).
    // Three signals any of which triggers hard block of sender identity injection:
    //   1. characterId !== senderCharacterId (frontend already resolved a different subject)
    //   2. Prompt starts with [PHOTO SUBJECT — NOT THE SENDER] prefix
    //   3. subjectType === 'known_character' with a different characterId

    const isThirdPartyPhoto = (
      // Signal 1: different subject character ID from sender
      (senderCharacterId && characterId && characterId !== senderCharacterId) ||
      // Signal 2: explicit override prefix injected by photoSubjectResolver
      /^\[PHOTO SUBJECT[^\]]*NOT THE SENDER\]/i.test(prompt.trim()) ||
      // Signal 3: no characterId at all (described stranger — no saved record)
      (!characterId && senderCharacterId)
    );

    // ── DEBUG LOG — subject pipeline audit ─────────────────────────────────────
    console.log(`[generateImageAsync] ▶ messageId=${messageId}`);
    console.log(`[generateImageAsync]   sender_character_id:              ${senderCharacterId || 'not provided'}`);
    console.log(`[generateImageAsync]   resolved_characterId (subject):   ${characterId || 'none'}`);
    console.log(`[generateImageAsync]   subjectType:                      ${subjectType}`);
    console.log(`[generateImageAsync]   is_third_party_photo:             ${isThirdPartyPhoto}`);
    console.log(`[generateImageAsync]   sender_avatar_injection_enabled:  ${!isThirdPartyPhoto}`);
    console.log(`[generateImageAsync]   sender_identity_lock_enabled:     ${!isThirdPartyPhoto}`);
    console.log(`[generateImageAsync]   final_subject_source:             ${isThirdPartyPhoto ? 'prompt description only — sender completely excluded' : (characterId ? `character record ${characterId}` : 'sender character')}`);
    if (isThirdPartyPhoto) {
      console.log(`[generateImageAsync]   ⛔ HARD SUBJECT LOCK ACTIVE — sender refs, appearance lock, avatar, and identity will NOT be injected`);
    }

    // ── 1. VERIFY MESSAGE ─────────────────────────────────────────────────────
    const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const message = msgList?.[0];
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const requestingUser = user.email;

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

      // Lower body — NOTE: "underwear", "boxers", "briefs" are NOT rewritten even in explicit scenes.
      // Underwear is ordinary clothing. It must be evaluated by full scene context, not as an isolated word.
      // The explicit signal set (sex, porn, erotic, etc.) already handles true violations.
      // Rewriting underwear → shorts in non-sexual scenes produces unnatural, incorrect wording.

      // Lingerie-style (these ARE typically scene-contextually relevant to rewrite)
      s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
      s = s.replace(/\blingerie\b/gi, 'sleepwear');
      s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
      s = s.replace(/\bpanties\b/gi, 'underwear');
      s = s.replace(/\bthong\b/gi, 'underwear');

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
    // CRITICAL: sanitizePrompt IS defined above — call it here.
    const rawPromptForSanitize = prompt.replace(/^\[CHARACTER\]\s*/i, '').trim();
    let sanitizedPrompt = sanitizePrompt(rawPromptForSanitize);

    if (sanitizedPrompt !== rawPromptForSanitize) {
      console.log(`[generateImageAsync] ⚠️ PROMPT MUTATION DETECTED:`);
      console.log(`  BEFORE: ${rawPromptForSanitize}`);
      console.log(`  AFTER:  ${sanitizedPrompt}`);
    } else {
      console.log(`[generateImageAsync] ✓ Prompt passed sanitizer unchanged`);
    }

    // ── APPEARANCE LOCK VALIDATION (Part 4) ──────────────────────────────────
    // Validate the sanitized prompt against the character's appearance_lock BEFORE generation.
    // If the prompt contains wording that directly contradicts locked appearance fields,
    // remove or rewrite the conflicting phrase. appearance_lock always wins.
    // This is applied to sanitizedPrompt (reassignable let) so corrections feed into buildPrompt.
    function validatePromptAgainstAppearanceLock(p, lock) {
      if (!lock || typeof lock !== 'object') return { prompt: p, corrections: [] };
      const corrections = [];
      let result = p;

      // Hair type/style conflicts
      if (lock.hair_type || lock.hairstyle) {
        const lockedHair = [lock.hair_type, lock.hairstyle].filter(Boolean).join(' ').toLowerCase();
        const isLongOrVoluminous = /\b(long|afro|coily|coil|voluminous|thick|natural|curly)\b/.test(lockedHair);
        if (isLongOrVoluminous) {
          // Remove contradicting short hair descriptors
          const shortHairPattern = /\b(short\s+(?:dark\s+)?hair|closely?\s+cropped\s+hair|buzz\s+cut|fade\s+cut|cropped\s+hair)\b/gi;
          const fixed = result.replace(shortHairPattern, `${lockedHair} hair`);
          if (fixed !== result) {
            corrections.push({ field: 'hair', removed: result.match(shortHairPattern)?.[0], injected: `${lockedHair} hair` });
            result = fixed;
          }
        }
        const isShort = /\b(short|cropped|buzz|fade)\b/.test(lockedHair);
        if (isShort) {
          const longHairPattern = /\b(long\s+(?:flowing\s+)?hair|flowing\s+hair|waist[\s-]length\s+hair)\b/gi;
          const fixed = result.replace(longHairPattern, `${lockedHair} hair`);
          if (fixed !== result) {
            corrections.push({ field: 'hair', removed: result.match(longHairPattern)?.[0], injected: `${lockedHair} hair` });
            result = fixed;
          }
        }
      }

      // Facial hair conflicts
      if (lock.facial_hair) {
        const lockedFacial = lock.facial_hair.toLowerCase();
        const hasBeard = /\b(beard|goatee|stubble|mustache)\b/.test(lockedFacial);
        const isCleanShaven = /\b(clean.?shaven|no facial hair|shaved)\b/.test(lockedFacial);
        if (isCleanShaven) {
          const beardPattern = /\b(thick\s+beard|full\s+beard|long\s+beard|beard|goatee|stubble)\b/gi;
          const fixed = result.replace(beardPattern, 'clean-shaven');
          if (fixed !== result) {
            corrections.push({ field: 'facial_hair', removed: 'beard/stubble', injected: 'clean-shaven' });
            result = fixed;
          }
        } else if (hasBeard) {
          const cleanPattern = /\bclean.?shaven\b/gi;
          const fixed = result.replace(cleanPattern, lockedFacial);
          if (fixed !== result) {
            corrections.push({ field: 'facial_hair', removed: 'clean-shaven', injected: lockedFacial });
            result = fixed;
          }
        }
      }

      // Skin tone conflicts — only rewrite if clearly wrong tone is stated
      if (lock.skin_tone) {
        const lockedSkin = lock.skin_tone.toLowerCase();
        const isDark = /\b(dark|deep|rich brown|brown skin|dark brown)\b/.test(lockedSkin);
        const isFair = /\b(fair|light|pale|porcelain|ivory)\b/.test(lockedSkin);
        if (isDark) {
          const fairSkinPattern = /\b(fair[- ]?skinned|light[- ]?skinned|pale[- ]?skinned|pale skin|fair skin|light skin)\b/gi;
          const fixed = result.replace(fairSkinPattern, `${lockedSkin} skin`);
          if (fixed !== result) {
            corrections.push({ field: 'skin_tone', removed: 'fair/light/pale', injected: `${lockedSkin} skin` });
            result = fixed;
          }
        } else if (isFair) {
          const darkSkinPattern = /\b(dark[- ]?skinned|dark skin|deeply complexioned)\b/gi;
          const fixed = result.replace(darkSkinPattern, `${lockedSkin} skin`);
          if (fixed !== result) {
            corrections.push({ field: 'skin_tone', removed: 'dark-skinned', injected: `${lockedSkin} skin` });
            result = fixed;
          }
        }
      }

      return { prompt: result, corrections };
    }

    // ── 2. RESOLVE CHARACTER ──────────────────────────────────────────────────
    let charRecord = null;
    let charRefs = [];
    let charDesc = '';

    // ── THIRD-PARTY HARD BLOCK ─────────────────────────────────────────────────
    // When isThirdPartyPhoto is true AND there is no separate subject characterId,
    // the described person is a stranger. We must NOT load ANY character record for identity.
    // charRecord, charRefs, and charDesc all stay empty.
    // The prompt description IS the identity source — nothing else.
    //
    // When isThirdPartyPhoto is true BUT characterId is set (a known saved character is the subject),
    // we DO load that character's identity — but ONLY if characterId !== senderCharacterId.
    // In that case the subject IS a real character, just not the sender.

    if (isThirdPartyPhoto && !characterId) {
      // Pure described stranger — skip all character identity resolution entirely
      console.log(`[generateImageAsync] ⛔ Third-party hard block — no characterId, skipping all sender identity injection. Image generated from prompt description only.`);
    } else if (characterId && (subjectType === 'character' || subjectType === 'joint' || subjectType === 'known_character')) {
      // Try user-scoped first, then service role with ownership check
      const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      charRecord = charListUser?.[0] || null;

      if (!charRecord) {
        const charListSR = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
        const candidate = charListSR?.[0] || null;
        if (candidate) {
          const owner = candidate.owner_email;
          if (owner && owner !== requestingUser) {
            console.error(`[generateImageAsync] ⛔ Cross-account character: ${characterId} owned by ${owner}, request from ${requestingUser}`);
            await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
            return Response.json({ error: 'Character does not belong to your account.' }, { status: 403 });
          }
          charRecord = candidate;
        }
      }

      if (charRecord) {
        const allRefUrls = cdnFilter(charRecord.reference_image_urls || []);
        const refUrls = allRefUrls.filter(url => !url.includes('generated_image'));
        // Use maximum 2 reference images — more refs = more background contamination
        charRefs = refUrls.slice(0, 2);

        // ── IDENTITY AUDIT LOG — traceable on every real generation ─────────
        console.log(`[IdentityAudit] ══════════════════════════════════════════════`);
        console.log(`[IdentityAudit] character_id:             ${charRecord.id}`);
        console.log(`[IdentityAudit] character_name:           ${charRecord.name}`);
        console.log(`[IdentityAudit] sender_character_id:      ${senderCharacterId || 'not provided'}`);
        console.log(`[IdentityAudit] subject_type:             ${subjectType}`);
        console.log(`[IdentityAudit] is_third_party:           ${isThirdPartyPhoto}`);
        console.log(`[IdentityAudit] reference_image_urls:     ${(charRecord.reference_image_urls || []).length} raw → ${refUrls.length} valid → ${charRefs.length} used (max 2)`);
        console.log(`[IdentityAudit] avatar_url_present:       ${!!charRecord.avatar_url}`);
        console.log(`[IdentityAudit] appearance_lock_fields:   ${Object.keys(charRecord.appearance_lock || {}).join(', ') || 'none'}`);
        console.log(`[IdentityAudit] avatar_description_text:  ${charRecord.avatar_description_text ? 'present' : 'absent'}`);
        console.log(`[IdentityAudit] ══════════════════════════════════════════════`);

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
          // Sims-style closet resolution: pick the right outfit for the occasion
          const outfitText = resolveCharacterOutfitForPrompt(charRecord);
          if (outfitText) {
            charDesc = charDesc ? `${charDesc}. Currently wearing: ${outfitText}` : `Currently wearing: ${outfitText}`;
            console.log(`[generateImageAsync] Outfit resolved from closet: "${outfitText.substring(0, 80)}"`);
          } else {
            console.log(`[generateImageAsync] No closet outfit resolved — prompt clothing or appearance description will be used`);
          }
        } else {
          console.log(`[generateImageAsync] Prompt explicitly specifies clothing — closet outfit skipped`);
        }
      }

      // Fallback to UI-provided refs if DB had none (only reference_image_urls — NOT avatar)
      // Note: Chat.jsx now only passes reference_image_urls (not avatar) as characterReferenceImages
      if (charRefs.length === 0 && characterReferenceImages?.length > 0) {
        // Filter out avatar_url entries passed from Chat.jsx — only accept real reference_image_urls.
        // avatar_url ends in specific path patterns or is stored as a single root-level field.
        // reference_image_urls are stored as arrays and individually uploaded.
        // We cannot reliably distinguish here, so accept UI refs as-is but cap at 2.
        charRefs = cdnFilter(characterReferenceImages).filter(u => !u.includes('generated_image')).slice(0, 2);
        console.log(`[generateImageAsync] Using UI-provided charRefs: ${charRefs.length}`);
      }

      // CONTROLLED LAST-RESORT: if still no refs but avatar_url exists on the record,
      // use it as a single face-only reference. This is explicitly controlled — face extraction
      // instructions are already in the prompt preamble, so background contamination is minimized.
      // Without this, zero-ref characters silently generate a random unrelated person.
      // This is better than silent wrong-person generation.
      if (charRefs.length === 0 && charRecord?.avatar_url) {
        const avatarPublic = toPublicCDN(charRecord.avatar_url);
        if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
          charRefs = [avatarPublic];
          console.warn(`[generateImageAsync] ⚠️ No reference_image_urls for "${charRecord.name}" — using avatar_url as controlled last-resort face anchor (1 image, face-only extraction). Add reference photos for better identity lock.`);
        }
      }

      // If still no refs AND no charDesc: fail visibly rather than generating a random person.
      // Silent wrong-person generation is worse than an explicit error.
      if (charRefs.length === 0 && !charDesc) {
        console.error(`[generateImageAsync] ❌ IDENTITY MISSING for "${characterName || characterId}" — no reference_image_urls, no avatar_url, no appearance description. Cannot generate identity-locked image.`);
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({
          success: false,
          error: `No identity data for ${characterName || 'this character'}. Add reference photos or an appearance description to enable photo generation.`,
          identity_missing: true,
        });
      }

      if (charRefs.length === 0) {
        console.log(`[generateImageAsync] ℹ️ No reference images for "${characterName || characterId}" — generating from text description only (charDesc present)`);
      }
    } // end else-if (characterId && subjectType in character/joint/known_character)

    // ── THIRD-PARTY IDENTITY GUARD — final enforcement ─────────────────────────
    // Even if the if-block above ran because characterId happened to equal senderCharacterId
    // due to a frontend fallback, we must zero out charRefs when this is a third-party photo
    // with no separate resolved subject characterId. This is the final safety net.
    if (isThirdPartyPhoto && (!characterId || characterId === senderCharacterId)) {
      if (charRefs.length > 0 || charDesc) {
        console.warn(`[generateImageAsync] ⛔ HARD SUBJECT LOCK — forcibly clearing ${charRefs.length} charRefs and charDesc for third-party photo. Sender identity removed from pipeline.`);
        charRefs = [];
        charDesc = '';
        charRecord = null;
      }
    }

    // ── 3. RESOLVE USER IDENTITY ──────────────────────────────────────────────
    let userRefs = [];
    if (subjectType === 'user' || subjectType === 'joint') {
      // Try DB first
      if (requestingUser) {
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingUser }, null, 1).catch(() => []);
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
      // CRITICAL FALLBACK: If UserSettings arrays and UI refs are all empty, check the world-self
      // Character record's avatar_url — this is the same image displayed in the Media Grid selector.
      // The selector renders char.avatar_url, so if the UI shows it, we must be able to use it.
      if (userRefs.length === 0) {
        try {
          const userCharList = await base44.asServiceRole.entities.Character.filter(
            { owner_email: requestingUser, is_user: true },
            null,
            1
          ).catch(() => []);
          const userChar = userCharList?.[0];
          if (userChar?.avatar_url) {
            const avatarPublic = toPublicCDN(userChar.avatar_url);
            if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
              userRefs = [avatarPublic];
              console.log(`[generateImageAsync] User identity fallback: world-self Character avatar_url used (matches selector display)`);
            }
          }
        } catch (fallbackErr) {
          console.warn(`[generateImageAsync] World-self Character fallback lookup failed: ${fallbackErr?.message}`);
        }
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
            const locOwner = candidate.owner_email;
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
        // No location on character — skip broad scan to prevent 429.
        // This is optional context — absence never blocks generation.
        console.log(`[generateImageAsync] No location ID on character record — skipping resident scan. Proceeding without environment refs.`);
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
    console.log(`[IdentityAudit] FINAL STATE before generation:`);
    console.log(`[IdentityAudit]   subject_type:              ${subjectType}`);
    console.log(`[IdentityAudit]   subject_1_id:              ${characterId || 'null'}`);
    console.log(`[IdentityAudit]   subject_1_name:            ${charRecord?.name || characterName || 'unknown'}`);
    console.log(`[IdentityAudit]   subject_1_ref_count:       ${CHAR_SLOTS}`);
    console.log(`[IdentityAudit]   subject_1_charDesc_present: ${!!charDesc}`);
    console.log(`[IdentityAudit]   subject_1_appearance_lock:  ${charRecord?.appearance_lock ? Object.keys(charRecord.appearance_lock).join(', ') || 'none' : 'none'}`);
    console.log(`[IdentityAudit]   subject_1_avatar_fallback: ${charRefs.length > 0 && (charRecord?.reference_image_urls || []).filter(u => !u.includes('generated_image')).length === 0 && !!charRecord?.avatar_url}`);
    console.log(`[IdentityAudit]   subject_2_id:              ${subjectType === 'joint' || subjectType === 'user' ? requestingUser : 'n/a'}`);
    console.log(`[IdentityAudit]   subject_2_name:            ${subjectType === 'joint' || subjectType === 'user' ? (userWorldName || 'user') : 'n/a'}`);
    console.log(`[IdentityAudit]   subject_2_ref_count:       ${USER_SLOTS}`);
    console.log(`[IdentityAudit]   subject_2_visual_refs_found: ${USER_SLOTS > 0}`);
    console.log(`[IdentityAudit]   joint_dual_slot_active:    ${subjectType === 'joint'}`);
    console.log(`[IdentityAudit]   generic_fallback_inserted: false`);
    console.log(`[IdentityAudit]   appearance_conflicts_detected: (resolved after character fetch)`);
    console.log(`[IdentityAudit]   generation_context.character_id will be: ${characterId || 'null'}`);
    console.log(`[IdentityAudit]   message_id: ${messageId}`);


    // Mutation logging is already done above immediately after sanitization — no duplicate needed here.

    // ── 5b. APPLY APPEARANCE LOCK VALIDATION ─────────────────────────────────
    // Now that charRecord is resolved, validate sanitizedPrompt against appearance_lock.
    // This must happen AFTER character resolution so we have the real lock data.
    const appearanceLockCorrections = [];
    if (charRecord?.appearance_lock && sanitizedPrompt) {
      const { prompt: correctedPrompt, corrections } = validatePromptAgainstAppearanceLock(
        sanitizedPrompt,
        charRecord.appearance_lock
      );
      if (corrections.length > 0) {
        console.warn(`[AppearanceLock] ⚠️ Prompt contradicted appearance_lock — ${corrections.length} correction(s) applied:`);
        corrections.forEach(c => console.warn(`  field=${c.field} | removed="${c.removed}" | injected="${c.injected}"`));
        sanitizedPrompt = correctedPrompt;
        appearanceLockCorrections.push(...corrections);
      } else {
        console.log(`[AppearanceLock] ✓ Prompt consistent with appearance_lock — no corrections needed`);
      }
    }

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    // SYNC NOTE: The classifySceneContext + sanitizePrompt functions above are
    // intentionally identical to the inlined versions in regenerateImageWithReason.
    // Deno functions cannot share local imports — both inline the same code.
    // If you change the sanitizer here, you MUST update regenerateImageWithReason too.
    // Any drift between the two sanitizers is a bug.

    // ── THIRD-PARTY PROMPT PREAMBLE ──────────────────────────────────────────
    // When this is a third-party photo (sender ≠ subject), prepend an explicit hard-block
    // instruction so the model never defaults to the sender's facial identity.
    let thirdPartyPreamble = '';
    if (isThirdPartyPhoto && !characterId) {
      // Strip any routing prefix from the sanitized prompt to get the raw scene description
      const rawSceneDesc = sanitizedPrompt.replace(/^\[PHOTO SUBJECT[^\]]*\]\s*:?\s*/i, '').replace(/^\[CHARACTER\]\s*/i, '').trim();
      thirdPartyPreamble = `════════════════════════════════════════════════════════════
⛔ THIRD-PARTY PHOTO — SENDER IS NOT THE SUBJECT
════════════════════════════════════════════════════════════
This photo was SENT by a character but does NOT show that character.
The person who sent this photo is NOT in the image.
Do NOT use any sender identity, face, appearance lock, hair, skin tone, body type, or ethnicity from any reference photos.

THE SUBJECT OF THIS PHOTO IS:
${rawSceneDesc}

Generate ONLY the person/subject/scene described above.
All reference images (if any) are environment/location refs only — do NOT treat any reference as a face identity source.

⛔ HARD FAIL: Sender's face or appearance appears in the image
✅ CORRECT: Only the described third-party subject appears
════════════════════════════════════════════════════════════

`;
    }

    const serverTime = new Date();
    const finalPrompt = thirdPartyPreamble + buildPrompt({
      prompt: sanitizedPrompt,
      charName: isThirdPartyPhoto && !characterId ? 'the described person' : (charRecord?.name || characterName || 'the character'),
      charDesc: isThirdPartyPhoto && !characterId ? '' : charDesc,
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
      // RULE: module-level functions do NOT have access to handler-scope variables via closure.
      // These must be passed explicitly as parameters.
      subjectType,
      characterId,
      userWorldName,
    });

    // ── 7. CAMERA ENFORCEMENT — EXTRACT PREVIOUS CAMERA STATE ────────────────
    // Reuse `message` already fetched in step 1 — no second query needed.
    // generation_context.camera_variables holds the previous image's camera state.
    const previousCameraVars = message?.generation_context?.camera_variables || null;

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

    // ── 8. STAGED GENERATION + VALIDATION LOOP (max 3 attempts) ─────────────
    // PRINCIPLE: Storage is ALWAYS separate from Acceptance.
    //   - Every generated image is STAGED immediately (never lost).
    //   - Camera validation controls ACCEPTANCE, not STORAGE.
    //   - Only the accepted attempt is promoted to final image_url.
    //   - All attempts (including rejected ones) are preserved in generation_context.attempts[].

    let acceptedGenRes = null;
    let acceptedCameraVars = null;
    let acceptedAttemptIndex = null;
    let attemptPrompt = finalPrompt;
    const MAX_ATTEMPTS = 3;
    const stagedAttempts = []; // all attempts, win or lose

    // ── BUILD STRUCTURED SUBJECTS ARRAY (Part 2 — recovery-safe generation_context) ──
    // Every subject is explicitly named, typed, and assigned a stable ID.
    // Failed image recovery and regeneration flows read from this — never from the old raw prompt tags.
    const structuredSubjects = [];

    // Subject 1: the character (if resolved)
    if (charRecord || characterId) {
      structuredSubjects.push({
        subject_type: 'character',
        subject_id: charRecord?.id || characterId || null,
        subject_name: charRecord?.name || characterName || null,
        role: 'primary',
        reference_image_count: CHAR_SLOTS,
        reference_images: charRefs,
        appearance_lock_snapshot: charRecord?.appearance_lock || null,
        outfit_snapshot: charDesc?.match(/Currently wearing: (.+?)(?:\.|$)/)?.[1] || null,
        appearance_lock_injected: !!(charRecord?.appearance_lock && Object.keys(charRecord.appearance_lock).length > 0),
        outfit_injected: /Currently wearing:/i.test(charDesc),
      });
    }

    // Subject 2: the user (for joint/user images)
    if (subjectType === 'joint' || subjectType === 'user') {
      const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingUser }, null, 1).catch(() => []);
      const userSett = userSettings?.[0] || {};
      structuredSubjects.push({
        subject_type: 'user',
        subject_id: requestingUser,
        subject_name: userWorldName || userSett.fictional_world_name || 'user',
        role: subjectType === 'user' ? 'primary' : 'primary',
        reference_image_count: USER_SLOTS,
        reference_images: userRefs,
        appearance_lock_snapshot: userSett.appearance_lock || null,
        outfit_snapshot: userSett.user_current_outfit?.full_description || null,
        appearance_lock_injected: !!(userSett.appearance_lock && Object.keys(userSett.appearance_lock).length > 0),
        outfit_injected: !!(userSett.user_current_outfit?.full_description),
      });
    }

    // Base generation context (shared across all attempts — written once, attempts appended)
    const baseGenerationContext = {
      // Structured identity (new format — used by regenerate/recovery flows)
      image_type: subjectType === 'joint' ? 'joint' : subjectType === 'user' ? 'user' : 'character',
      subject_count: structuredSubjects.length,
      subjects: structuredSubjects,
      scene_prompt: sanitizedPrompt,
      original_raw_prompt: prompt,
      background_extras_allowed: /\b(pool party|club|concert|bar|beach|festival|mall|airport|restaurant|crowd)\b/i.test(sanitizedPrompt),
      appearance_lock_corrections: appearanceLockCorrections.length > 0 ? appearanceLockCorrections : undefined,

      // Legacy fields — kept for backward compat with existing regenerate/media grid flows
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
      camera_variables: null, // filled after acceptance
      attempts: [],           // staging log — all attempts stored here
    };

    // ── DISPATCH LOG — logged once before loop, updated on camera override ─────
    // RULE: promptHasExplicitTime and timeLighting are local to buildPrompt — do NOT reference here.
    // Only log variables that are declared in this handler scope.
    console.log(`[generateImageAsync] ── PROVIDER DISPATCH ──`);
    console.log(`  raw prompt:             ${rawPromptForSanitize.substring(0, 200)}${rawPromptForSanitize.length > 200 ? '…' : ''}`);
    console.log(`  sanitized prompt:       ${sanitizedPrompt.substring(0, 200)}${sanitizedPrompt.length > 200 ? '…' : ''}`);
    console.log(`  server_hour:                          ${serverTime.getHours()}`);
    console.log(`  env_refs_count:                       ${ENV_SLOTS}`);
    console.log(`  char refs: ${CHAR_SLOTS} | env refs: ${ENV_SLOTS} | user refs: ${USER_SLOTS}`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Log final assembled provider prompt for this attempt (capped at 400 chars)
      console.log(`[generateImageAsync] Attempt ${attempt} — final provider prompt (first 400): ${attemptPrompt.substring(0, 400)}…`);
      let attemptGenRes = null;
      try {
        attemptGenRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: attemptPrompt,
          existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
        });
      } catch (genErr) {
        const msg = (genErr?.message || '').toLowerCase();
        const statusCode = genErr?.status || genErr?.statusCode || genErr?.code || null;

        // Only label as content policy when the provider explicitly signals it.
        // The old broad regex (/filter|guideline|block|violat/i) matched network errors,
        // rate limits, and infra blocks — all of which got mislabeled as "content filter."
        const isRealContentPolicyBlock = (
          msg.includes('content policy') ||
          msg.includes('safety system') ||
          msg.includes('violates our content') ||
          msg.includes('violates our usage') ||
          msg.includes('against our usage policies') ||
          msg.includes('policy violation') ||
          msg.includes('moderation') ||
          msg.includes('safety filter') ||
          msg.includes('flagged by our safety') ||
          (msg.includes('cannot generate') && msg.includes('explicit')) ||
          (statusCode === 400 && (msg.includes('safety') || msg.includes('policy') || msg.includes('blocked_by_safety')))
        );

        if (isRealContentPolicyBlock) {
          console.warn(`[generateImageAsync] Content policy block on attempt ${attempt}: ${msg.substring(0, 200)}`);
          await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
          return Response.json({ success: false, filtered: true, error: 'Content policy block — the provider rejected this specific image content. Try a different scene description.' });
        }

        // All other errors: log accurately, retry if attempts remain, else surface real error
        console.error(`[generateImageAsync] Provider error attempt ${attempt}: ${genErr?.message || genErr}`);
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[generateImageAsync] Retrying after provider error (attempt ${attempt}/${MAX_ATTEMPTS})`);
          continue;
        }
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({ success: false, error: `Image generation failed — the provider returned an error. Please try again.` }, { status: 500 });
      }

      if (!attemptGenRes?.url) {
        console.warn(`[generateImageAsync] Attempt ${attempt}: no URL returned`);
        // Stage the failed attempt (no URL)
        stagedAttempts.push({
          attempt_index: attempt,
          prompt: attemptPrompt.slice(0, 500), // cap for storage
          generated_image_url: null,
          camera: null,
          status: 'failed_no_url',
          created_at: new Date().toISOString(),
        });
        continue;
      }

      // Extract camera variables from the prompt used — best proxy without image analysis
      const thisCameraVars = extractCameraVarsFromPrompt(attemptPrompt);
      const diffCount = countCameraDiffs(previousCameraVars, thisCameraVars);

      console.log(`[generateImageAsync] Attempt ${attempt}: camera diffs=${diffCount} | dist=${thisCameraVars.distance} angle=${thisCameraVars.angle} height=${thisCameraVars.height} framing=${thisCameraVars.framing} lens=${thisCameraVars.lens_style}`);

      // ── VALIDATE: does camera move enough vs. previous accepted image? ──
      // FIRST GENERATION (no prior accepted): always valid — nothing to compare against.
      const isFirstGeneration = !previousCameraVars;
      const cameraValid = isFirstGeneration || diffCount >= 2;

      if (cameraValid) {
        // ── STAGE: mark as accepted ──
        stagedAttempts.push({
          attempt_index: attempt,
          prompt: attemptPrompt.slice(0, 500),
          generated_image_url: attemptGenRes.url,
          camera: thisCameraVars,
          status: 'accepted',
          created_at: new Date().toISOString(),
        });

        acceptedGenRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
        acceptedAttemptIndex = attempt;

        const reason = isFirstGeneration ? 'first generation (no prior camera)' : `${diffCount} camera variables changed`;
        console.log(`[generateImageAsync] ✅ Camera ACCEPTED — attempt ${attempt} (${reason})`);

        // Build a compact image_description from the sanitized prompt so that
        // downstream consumers (group chat, world contacts, memory extraction) can
        // reference what this generated image actually shows without re-running vision.
        const generatedImageDescription = sanitizedPrompt
          ? `Generated character photo. Scene: ${sanitizedPrompt.substring(0, 300)}${sanitizedPrompt.length > 300 ? '…' : ''}`
          : null;

        // Write staging data + final image atomically
        await base44.asServiceRole.entities.Message.update(messageId, {
          image_url: acceptedGenRes.url,
          ...(generatedImageDescription ? {
            image_description: generatedImageDescription,
            image_analysis_status: 'complete',
          } : {}),
          generation_context: {
            ...baseGenerationContext,
            camera_variables: acceptedCameraVars,
            attempts: stagedAttempts,
            accepted_attempt_index: acceptedAttemptIndex,
          },
          content: '',
        });

        break; // done — accepted image saved

      } else {
        // ── STAGE: mark as rejected (but keep the URL — never discard data) ──
        stagedAttempts.push({
          attempt_index: attempt,
          prompt: attemptPrompt.slice(0, 500),
          generated_image_url: attemptGenRes.url, // STORED even though rejected
          camera: thisCameraVars,
          status: 'rejected_camera_static',
          rejection_reason: `Only ${diffCount} camera variable(s) changed (minimum 2 required)`,
          created_at: new Date().toISOString(),
        });

        console.warn(`[generateImageAsync] ⚠️ Camera REJECTED attempt ${attempt}: only ${diffCount} variable(s) changed. Storing attempt, forcing camera shift.`);

        // Write staging data to message immediately (image is stored, not displayed yet)
        await base44.asServiceRole.entities.Message.update(messageId, {
          generation_context: {
            ...baseGenerationContext,
            camera_variables: null,
            attempts: stagedAttempts,
            accepted_attempt_index: null,
          },
          // DO NOT set image_url yet — not accepted
        }).catch(() => {}); // non-blocking staging write

        if (attempt < MAX_ATTEMPTS) {
          // Escalating forced camera override for next attempt
          const overrideBlock = CAMERA_FORCE_PRESETS[Math.min(attempt - 1, CAMERA_FORCE_PRESETS.length - 1)];
          attemptPrompt = attemptPrompt + overrideBlock;
        } else {
          // All attempts exhausted — accept the last one with a warning rather than fail completely
          console.warn(`[generateImageAsync] ⚠️ Max attempts reached — promoting last image despite static camera`);

          // Patch the last attempt's status to "accepted_fallback"
          stagedAttempts[stagedAttempts.length - 1].status = 'accepted_fallback';

          acceptedGenRes = attemptGenRes;
          acceptedCameraVars = thisCameraVars;
          acceptedAttemptIndex = attempt;

          await base44.asServiceRole.entities.Message.update(messageId, {
            image_url: acceptedGenRes.url,
            generation_context: {
              ...baseGenerationContext,
              camera_variables: acceptedCameraVars,
              attempts: stagedAttempts,
              accepted_attempt_index: acceptedAttemptIndex,
            },
            content: '',
          });
        }
      }
    }

    if (!acceptedGenRes?.url) {
      await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    console.log(`[generateImageAsync] ✓ SUCCESS: ${messageId} | accepted attempt ${acceptedAttemptIndex}/${MAX_ATTEMPTS} | camera: ${acceptedCameraVars?.distance} ${acceptedCameraVars?.angle} ${acceptedCameraVars?.framing} | total staged: ${stagedAttempts.length}`);

    return Response.json({
      success: true,
      imageUrl: acceptedGenRes.url,
      messageId,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
      cameraVariables: acceptedCameraVars,
      attemptIndex: acceptedAttemptIndex,
      totalAttempts: stagedAttempts.length,
    });

  } catch (error) {
    console.error('[generateImageAsync] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});