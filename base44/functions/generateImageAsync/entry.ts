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
  // Priority 1: Individual atomic fields (top, bottom, shoes, outerwear, accessories).
  // These are always canonical when present — never override with full_description.
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean)
    .map(p => { const t = p.trim(); if(/^(n\/?a|none|-)$/i.test(t)) return null; const s=t.replace(/^n\/?a[,\-–]\s*/i,'').trim(); return /^(shirtless|no top|no shirt)$/i.test(s)?'No shirt / bare torso':(s||null); })
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  // Priority 2: full_description — used as-is. Do NOT strip or rewrite it.
  // Previous aggressive regex stripping was discarding legitimate outfit descriptions
  // that happened to start with natural language like "In a white button-down..." etc.
  // The full_description IS the canonical outfit text when individual fields are absent.
  if (outfit.full_description?.trim()) return outfit.full_description.trim();
  return null;
}

const OUTFIT_FALLBACK_CHAINS = {bath:['bath','sleepwear','lounge'],sleepwear:['sleepwear','lounge','daily_casual'],swimwear:['swimwear','gym','daily_casual'],gym:['gym','outdoor','daily_casual'],work:['work','formal','daily_casual'],formal:['formal','work','daily_casual'],church:['church','formal','daily_casual'],nightlife:['nightlife','date_night','daily_casual'],date_night:['date_night','nightlife','formal','daily_casual'],school:['school','daily_casual'],lounge:['lounge','daily_casual'],outdoor:['outdoor','daily_casual'],travel:['travel','outdoor','daily_casual'],medical:['medical','daily_casual'],special:['special','formal','daily_casual'],cold_weather:['cold_weather','outdoor','daily_casual'],hot_weather:['hot_weather','outdoor','daily_casual'],daily_casual:['daily_casual','outdoor','lounge']};

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

// Returns { text, source, name, category }. P1: current_outfit wins if label/id present. P2: closet rotation.
function resolveCharacterOutfitForPrompt(character) {
  if (!character) return { text: null, source: 'no_character', name: null, category: null };
  const co = character.current_outfit;
  if (co?.outfit_id || co?.label) {
    const t = buildOutfitText(co);
    if (t) { console.log(`[OutfitResolver] ✅ P1 current_outfit WINS: label="${co.label}" id="${co.outfit_id}" cat="${co.category}" → "${t.substring(0,120)}"`); return { text: t, source: 'current_outfit', name: co.label || co.outfit_id || 'active', category: co.category || null }; }
    if (co.full_description?.trim()) { const fd = co.full_description.trim(); console.log(`[OutfitResolver] ✅ P1 current_outfit full_description: "${fd.substring(0,80)}"`); return { text: fd, source: 'current_outfit_full_desc', name: co.label || 'active', category: co.category || null }; }
    console.warn(`[OutfitResolver] ⚠️ P1 current_outfit (label="${co.label}" id="${co.outfit_id}") all fields empty — falling to P2`);
  }
  const outfits = (character.character_closet || []).filter(item => item.outfit_id);
  if (!outfits.length) { console.warn(`[OutfitResolver] ⚠️ P2: no closet outfits`); return { text: null, source: 'no_closet', name: null, category: null }; }
  const targetCategory = resolveOutfitCategory(character);
  console.log(`[OutfitResolver] P2 closet rotation: category="${targetCategory}" presence="${character?.resolved_presence_status || 'unknown'}"`);
  const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
  for (const cat of chain) {
    const pool = outfits.filter(o => o.category === cat);
    if (!pool.length) continue;
    if (pool.length === 1) { const t = buildOutfitText(pool[0]); return { text: t, source: 'closet_rotation', name: pool[0].label || cat, category: cat }; }
    const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    let idx = (dayOfYear + idHash) % pool.length;
    if (pool[idx]?.outfit_id === co?.outfit_id && pool.length > 1) idx = (idx + 1) % pool.length;
    const t = buildOutfitText(pool[idx]);
    console.log(`[OutfitResolver] P2 rotation: cat="${cat}" → "${(t||'null').substring(0,80)}"`);
    return { text: t, source: 'closet_rotation', name: pool[idx].label || cat, category: cat };
  }
  return { text: null, source: 'closet_chain_miss', name: null, category: targetCategory };
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

function resolveZoneFromLocation(location, promptLower, preferredZoneName) {
  const zones = (location.zones || []).filter(z => cdnFilterNoGenerated(z.image_urls || []).length > 0);

  if (zones.length === 0) {
    return { images: cdnFilterNoGenerated(location.image_urls || []).slice(0, 4), zoneName: null };
  }

  // 0. Preferred zone name — highest priority (stored zone from last generation)
  if (preferredZoneName) {
    const preferred = zones.find(z => z.zone_name && z.zone_name.toLowerCase() === preferredZoneName.toLowerCase());
    if (preferred) {
      const imgs = cdnFilterNoGenerated(preferred.image_urls).slice(0, 4);
      if (imgs.length > 0) { console.log(`[resolveZone] Preferred zone: "${preferred.zone_name}"`); return { images: imgs, zoneName: preferred.zone_name }; }
    }
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

function buildPrompt({ prompt, charName, charDesc, locationName, zoneName, envRefCount, charRefCount, userRefCount, userRefStart, charRefStart, envRefStart, serverHour, serverTime, subjectType, characterId, userWorldName, userOutfitText }) {
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
5. SCALE: Character height vs furniture must be anatomically correct. Beds, chairs, tables are SCALE ANCHORS. Tight/cropped shots preferred — do NOT force full room into frame. Aggressive zoom IS correct.

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

  function buildAppearanceLockText(desc,name){const d=desc||'',n=name||'this character';const ht=d.match(/\b(dreadlocks?|locs?|afro|coils?|braids?|long hair|short hair|buzz cut|fade|bald|shaved head|pixie|bob|wavy|curly|straight|natural hair|voluminous|cornrows|twists?)/i)?.[1]||null;const hc=d.match(/\b(black hair|brown hair|blonde hair|gray hair|grey hair|red hair|auburn|platinum hair|white hair)/i)?.[1]||null;const fh=d.match(/\b(clean-?shaven|no facial hair|beard|full beard|thick beard|goatee|mustache|stubble)/i)?.[1]||null;const st=d.match(/\b(fair skin|light skin|pale skin|medium skin|olive skin|tan skin|brown skin|dark skin|deep skin|ebony skin)/i)?.[1]||null;const bt=d.match(/\b(slim|slender|lean|athletic|muscular|stocky|heavyset|heavy.?set|plus.?size|curvy|petite|tall|broad|average build|thin|overweight)/i)?.[1]||null;const isBald=/\b(bald|shaved head|no hair)\b/i.test(d);console.log(`[CanonicalAppearance] ${n}: hair=${ht||'n/a'} bald=${isBald} facial=${fh||'n/a'} skin=${st||'n/a'} body=${bt||'n/a'}`);if(!ht&&!hc&&!fh&&!st&&!bt&&!isBald)return`render from refs — do not redesign`;const r=[`\n🔒 CANONICAL APPEARANCE LOCK — "${n}" — ABSOLUTE IDENTITY AUTHORITY\nThese traits OVERRIDE any conflicting prompt styling. Canonical = source of truth.\n`];if(isBald){r.push(`HAIR: BALD — zero hair on top. ⛔ NO curls, locs, braids, fade, hairline.`);}else if(ht){r.push(`HAIR: ${ht}`);if(/dreadlocks?|locs?/i.test(ht))r.push(`⛔ REJECT: fade, short, bald, generic curls — DREADLOCKS ONLY`);else if(/long hair/i.test(ht))r.push(`⛔ REJECT: short, buzz, fade, cropped — LONG HAIR ONLY`);else if(/short|buzz|fade/i.test(ht))r.push(`⛔ REJECT: long, flowing — SHORT/FADE ONLY`);else if(/braids?|cornrows/i.test(ht))r.push(`⛔ REJECT: loose/straight/fade — BRAIDS ONLY`);else if(/afro/i.test(ht))r.push(`⛔ REJECT: straight, slicked, fade — AFRO ONLY`);}if(hc)r.push(`HAIR COLOR: ${hc} — do not alter.`);if(fh){r.push(`FACIAL HAIR: ${fh}`);if(/clean-?shaven|no facial hair/i.test(fh))r.push(`⛔ REJECT beard/stubble — CLEAN-SHAVEN ONLY`);else r.push(`⛔ REJECT clean-shaven — ${fh} MUST EXIST`);}if(st)r.push(`SKIN TONE: ${st} — do not lighten/darken.`);if(bt)r.push(`BODY TYPE: ${bt} — do not slim, bulk, age-down, or beautify.`);r.push(`\nCANONICAL > REFS > PROMPT. Prompt controls pose/scene ONLY. NOT hair/face/body.\n⛔ REJECT: any prompt trait conflicting with the above.\n🚫 INVALID if hair/facial hair/body type differs from canonical.`);return r.join('\n');}

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
Subject 1 Appearance Key: ${buildAppearanceLockText(charDesc, charName)}
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
✅ SUBJECT 2 OUTFIT ENFORCEMENT: ${userOutfitText ? `"${userOutfitText}". CANONICAL LAW — render exactly this. Do NOT substitute, modify, or reinterpret.` : 'Use clothing appropriate to scene context.'}
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
  ✅ APPEARANCE LOCK (100% ABSOLUTE): ${buildAppearanceLockText(charDesc, charName)}
  ✅ OUTFIT ENFORCEMENT: See CLOSET OUTFIT LOCK block below — this is NON-NEGOTIABLE.
  
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
  ✅ APPEARANCE LOCK: ${buildAppearanceLockText(charDesc, charName)}
  ⛔ Do NOT copy pose, background, or clothing from reference photos — only the face identity transfers`;
  }

  // For non-joint user identity (user-only photos)
  if (hasUser && subjectType !== 'joint') {
    identityLock += `

USER IDENTITY:
Images ${userRefStart}–${userEnd} are this exact person's photos.
Match: face structure, skin tone, hair, body type.
✅ USER OUTFIT ENFORCEMENT: ${userOutfitText ? `"${userOutfitText}". CANONICAL LAW — render exactly this. Do NOT substitute or modify.` : 'Use clothing appropriate to scene context.'}`;
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

  // ── CLOSET OUTFIT LOCK ──────
  const charOutfitText = (charDesc||'').match(/Currently wearing:\s*(.+)/)?.[1]?.split('. Currently wearing:')[0]?.trim()||null;
  let closetLock = '';
  if (charOutfitText || userOutfitText) {
    const hasBottoms = charOutfitText && /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(charOutfitText);
    const hasShoes = charOutfitText && /sneakers|shoes|boots|sandals|loafers|heels/i.test(charOutfitText);
    const isBareTorso = charOutfitText && /no shirt \/ bare torso|shirtless|no top|no shirt/i.test(charOutfitText);
    const lines = ['','🔒 CLOSET OUTFIT LOCK — CANONICAL WORLD-STATE LAW. ABSOLUTE OVERRIDE OF ALL SCENE STYLING.','════════════════════════════════════════════════════════════','This is the character\'s ACTIVE WARDROBE STATE. It is world-state truth — NOT a suggestion.','Scene styling, cinematic prompts, and aesthetic descriptors CANNOT override wardrobe state.','⛔ Do NOT use clothing from the scene prompt if it conflicts with this lock.','⛔ Do NOT add, remove, or modify any clothing item relative to this list.',''];
    if (charOutfitText) {
      lines.push(`${charName} OUTFIT — RENDER EXACTLY AS LISTED:`);
      charOutfitText.split(',').map(s=>s.trim()).filter(Boolean).forEach(item=>lines.push(`  • ${item}`));
      lines.push('');
      lines.push('NON-NEGOTIABLE ENFORCEMENT:');
      if (isBareTorso) { lines.push('⛔ BARE TORSO — NO shirt, tank top, hoodie, jacket, robe, or any upper-body clothing whatsoever.'); lines.push('✅ Torso must be completely bare and clearly visible.'); }
      if (hasBottoms) lines.push('✅ BOTTOMS VISIBLE — frame mid-thigh or lower to show full pants/shorts.');
      if (hasShoes) lines.push('✅ SHOES VISIBLE — full-body or 3/4-body framing required. Do not crop feet.');
      lines.push('⛔ Do NOT add or invent any clothing item not listed above.');
      lines.push('⛔ Do NOT substitute a different style of the same item.');
    }
    if (userOutfitText) lines.push(`\n${userWorldName||'User'} OUTFIT: ${userOutfitText} — render exactly.`);
    lines.push('════════════════════════════════════════════════════════════');
    lines.push('FAIL: wrong clothing | added clothing | removed clothing | invented outfit | outfit from scene prompt');
    closetLock = lines.join('\n');
  }

  // ── HUMAN PRESENCE PURITY ─────────────────────────────────────────────────
  const expectedHumanCount = subjectType==='joint'?2:(subjectType==='character'||subjectType==='user'||subjectType==='known_character')?1:0;
  const pLow=(prompt||'').toLowerCase();
  const isIso=/\b(alone|empty|vacant|no people|room only|object only|just the|document only|id only|id card|card only|photo of the|picture of the|image of the|nobody|no one|no person|no humans|no figures)\b/.test(pLow);
  const isPub=/\b(pool party|club|concert|beach party|festival|mall|airport|crowd)\b/i.test(prompt)&&!isIso;
  const ec=isIso&&expectedHumanCount===0?0:expectedHumanCount;
  const humanPurityBlock=`\n\n════════════════════════════════════════════════════════════\n⛔⛔⛔ HUMAN PRESENCE PURITY LAW — ABSOLUTE OVERRIDE ⛔⛔⛔\n════════════════════════════════════════════════════════════\n\nEXPECTED HUMAN COUNT: ${ec}\n${ec===0?'→ ZERO HUMANS. No people, bodies, faces, hands, silhouettes, or reflections of people.':ec===1?'→ EXACTLY ONE declared person. No extras. No background occupants. No bystanders.':'→ EXACTLY TWO declared subjects. No third person. No background figures.'}\n\nFORBIDDEN (unless a named person is explicitly declared in the prompt):\n⛔ Extra people anywhere — foreground, midground, background\n⛔ Partial people — arms, legs, torsos, feet, hands of undeclared persons\n⛔ Silhouettes behind doors, windows, or walls\n⛔ Reflections of people in mirrors, windows, glass, or any surface\n⛔ Shadows implying a person is present\n⛔ Blurred background humans or ambient patrons\n⛔ POV photographer body parts (over-the-shoulder, hands in frame)\n⛔ Environmental extras added for atmosphere\n⛔ Location owners, workers, residents, or family members unless explicitly named\n\nLOCATION OWNER/RESIDENT FIREWALL:\nLocation metadata = setting description ONLY.\nNo person associated with this location may appear unless explicitly named as a subject.\nA named bar does NOT authorize any staff or owner to appear.\nA home does NOT authorize any resident to appear unless declared.\n${isIso?'\nISOLATION ACTIVE: zero humans total. No hand holding the object. No reflection of photographer.\n':''}\n${isPub?'\nPUBLIC ENV EXCEPTION: background figures allowed ONLY as out-of-focus blur. Never foreground. Never identifiable.\n':'\nPRIVATE ENV: zero background figures. Zero extras.\n'}\nTHE GENERATOR MAY NOT ADD HUMANS TO "HELP":\n⛔ "Empty = needs a focal human" — INVALID\n⛔ "A silhouette improves atmosphere" — INVALID\n⛔ "A hand improves realism" — INVALID\n⛔ "Background patron makes venue feel alive" — INVALID\n\nGENERATION INVALID IF:\n🚫 Any undeclared human appears anywhere including reflections\n🚫 Human count exceeds ${ec}\n🚫 Any location-associated person appears without being named\n════════════════════════════════════════════════════════════`;

  // visualSourceBoundaryBlock is injected externally from the pre-generation audit call
  // (see step 5c below). It contains the runtime-computed forbidden entity list,
  // approved roster, and anonymity enforcement — not static text.
  const caucasianGuard = `
════════════════════════════════════════════════════════════
⛔ IDENTITY DEFAULT PROHIBITION — NON-NEGOTIABLE
════════════════════════════════════════════════════════════
UNKNOWN IDENTITY ≠ CAUCASIAN / WHITE.
⛔ DO NOT default to Caucasian, white, fair-skinned, or any other assumed ethnicity.
⛔ DO NOT default to a specific gender, age, or body type when not provided.
⛔ DO NOT infer race or appearance from name, location, or scene theme.
⛔ DO NOT use training-data priors for "generic person" — those priors skew heavily Caucasian.
✅ Use ONLY: reference images, skin_tone field, ethnicities field, appearance lock, avatar description.
✅ If ethnicities are specified (e.g. Latino, Black, Asian, Indigenous, Mixed), render EXACTLY those.
✅ No whitewashing. No lightening skin tone. No softening features. No European defaults.
This applies to every subject in every image — no exceptions.
════════════════════════════════════════════════════════════
`;
  return `${caucasianGuard}${preamble}${cameraBlock}${lightingBlock}${refImageOverride}${humanPurityBlock}{{VISUAL_SOURCE_BOUNDARY_BLOCK}}\n\n${prompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.${envLock}${identityLock}${closetLock}`;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // auth.me() may return null for scheduled/service-role callers — that's OK.
    // Ownership is validated below using ownerEmail param or character.owner_email.
    const user = await base44.auth.me().catch(() => null);

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
      ownerEmail,         // OPTIONAL: passed by service-role callers (scheduled/autonomous) when no user session exists
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
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden.
    // user may be null for service-role/autonomous callers; ownerEmail param is the fallback.
    const requestingUser = user?.email || ownerEmail || null;
    if (!requestingUser) {
      return Response.json({ error: 'Unauthorized — no user session or ownerEmail provided' }, { status: 401 });
    }

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
        // ── STOCK-PHOTO DRIFT GUARD ──
        // Phrases like "showing off his athletic build" pull the model toward generic
        // stock-photo males and away from the character's reference images.
        // Replace with neutral equivalents that preserve scene intent without identity drift.
        s = s.replace(/,?\s*showing off (his|her|their) (athletic|muscular|toned|lean|fit|ripped|built) build/gi, '');
        s = s.replace(/,?\s*showing (his|her|their) (athletic|muscular|toned|lean|fit|ripped|built) (body|build|physique|chest|abs|torso)/gi, '');
        s = s.replace(/\b(athletic|muscular|toned|ripped|jacked|built|fit)\s+build\b/gi, 'build');
        s = s.replace(/\bshowing off (his|her|their) (body|physique|muscles|abs|chest)\b/gi, 'relaxed');
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
    function validatePromptAgainstAppearanceLock(p,lock){if(!lock||typeof lock!=='object')return{prompt:p,corrections:[]};const c=[];let r=p;const fix=(field,pat,rep)=>{const f=r.replace(pat,rep);if(f!==r){c.push({field,removed:String(pat),injected:rep});r=f;}};if(lock.hair_type||lock.hairstyle){const lh=[lock.hair_type,lock.hairstyle].filter(Boolean).join(' ').toLowerCase();if(/\b(bald|shaved head|no hair)\b/.test(lh)){fix('hair',/\b(short\s+hair|long\s+hair|curly\s+hair|dreadlocks?|locs?|afro|braids?|fade|buzz\s+cut|cornrows|full\s+head)\b/gi,'bald');}else if(/\b(dreadlocks?|locs?)\b/.test(lh)){fix('hair',/\b(short\s+hair|closely?\s+cropped|buzz\s+cut|fade|shaved|bald|generic\s+curls?|straight\s+hair)\b/gi,'dreadlocks');}else if(/\b(long|afro|coily|voluminous|braids?)\b/.test(lh)){fix('hair',/\b(short\s+(?:dark\s+)?hair|closely?\s+cropped\s+hair|buzz\s+cut|fade\s+cut|cropped\s+hair)\b/gi,lh+' hair');}else if(/\b(short|cropped|buzz|fade)\b/.test(lh)){fix('hair',/\b(long\s+(?:flowing\s+)?hair|flowing\s+hair|waist[\s-]length\s+hair|dreadlocks?|locs?)\b/gi,lh+' hair');}}if(lock.facial_hair){const lf=lock.facial_hair.toLowerCase();if(/\b(clean.?shaven|no facial hair|shaved)\b/.test(lf))fix('facial_hair',/\b(thick\s+beard|full\s+beard|beard|goatee|stubble)\b/gi,'clean-shaven');else if(/\b(beard|goatee|stubble|mustache)\b/.test(lf))fix('facial_hair',/\bclean.?shaven\b/gi,lf);}if(lock.skin_tone){const ls=lock.skin_tone.toLowerCase();if(/\b(dark|deep|rich brown|ebony)\b/.test(ls))fix('skin_tone',/\b(fair[- ]?skinned|light[- ]?skinned|pale skin|fair skin|light skin)\b/gi,ls+' skin');else if(/\b(fair|light|pale|porcelain)\b/.test(ls))fix('skin_tone',/\b(dark[- ]?skinned|dark skin|deeply complexioned)\b/gi,ls+' skin');}if(lock.overall_aesthetic){const la=lock.overall_aesthetic.toLowerCase();if(/\b(heavyset|heavy.?set|overweight|plus.?size|stocky)\b/.test(la))fix('body_type',/\b(slim|slender|lean|thin|skinny)\b/gi,la);else if(/\b(slim|slender|lean|petite)\b/.test(la))fix('body_type',/\b(heavyset|overweight|large frame|plus.?size|stocky)\b/gi,la);}if(c.length>0)c.forEach(x=>console.warn(`[AppearanceLock] corrected field=${x.field}`));return{prompt:r,corrections:c};}

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
      // Use service-role directly to avoid user-scoped 429 failures silently dropping identity.
      // Ownership is verified explicitly below — service-role does not skip the ownership check.
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

        // GUARD: strip AI generation prompt language from avatar_description_text and appearance_notes.
        // Cinematic/editorial/chiaroscuro prompts in these fields cause severe identity drift.
        const isAIPromptText = (t) => !t ? false : /\b(cinematic|chiaroscuro|dramatic lighting|editorial photography|fine art|low-key lighting|sculptural anatomy|artistic composition|museum.quality|photorealistic|ultra.detailed|high.resolution|bokeh|dramatic shadow|noir atmosphere|hyper.realistic|studio lighting|professional photography|stock photo)\b/i.test(t);
        const parts = [
          charRecord.age_range ? `${charRecord.age_range} years old` : null,
          charRecord.gender,
          charRecord.ethnicities?.length > 0 ? charRecord.ethnicities.join('/') + ' ethnicity' : null,
          charRecord.appearance_lock?.skin_tone ? `${charRecord.appearance_lock.skin_tone} skin tone` : null,
          charRecord.appearance_lock?.hairstyle ? `${charRecord.appearance_lock.hairstyle} hairstyle` : null,
          charRecord.appearance_lock?.hair_type ? `${charRecord.appearance_lock.hair_type} hair` : null,
          charRecord.appearance_lock?.facial_hair ? `${charRecord.appearance_lock.facial_hair}` : null,
          !isAIPromptText(charRecord.appearance_notes) ? charRecord.appearance_notes || null : null,
          !isAIPromptText(charRecord.avatar_description_text) ? charRecord.avatar_description_text || null : null,
        ].filter(Boolean);
        charDesc = parts.join(', ');

        // ── OUTFIT RESOLUTION — current_outfit is CANONICAL WARDROBE WORLD-STATE ──
        // P1: current_outfit always wins. P2: closet rotation by context. Never skipped silently.
        const alreadyHasOutfitInDesc = /Currently wearing:/i.test(charDesc);
        if (!alreadyHasOutfitInDesc) {
          const promptLowerForOutfit = sanitizedPrompt.toLowerCase();
          // ── SLEEP/WAKE CONTEXT: override with sleepwear before closet rotation ──
          const sleepWakeKws = ['sleeping','asleep','in bed','woke up','waking up','just woke','getting up','lying in bed','napping','nap','going to bed','bedtime'];
          const isSleepWake = (charRecord?.resolved_presence_status==='sleeping'||charRecord?.resolved_presence_status==='napping')||/\b(sleep|nap|asleep|bedtime|waking)\b/.test((charRecord?.current_activity||'').toLowerCase())||sleepWakeKws.some(kw=>promptLowerForOutfit.includes(kw));
          if (isSleepWake) {
            const closetItems = (charRecord?.character_closet||[]).filter(o=>o.outfit_id);
            const sleepItem = closetItems.find(o=>o.category==='sleepwear'||o.category==='lounge');
            const co2 = charRecord?.current_outfit;
            let sleepText = null;
            if (sleepItem) { sleepText = [sleepItem.top,sleepItem.bottom,sleepItem.shoes,sleepItem.outerwear,sleepItem.accessories].filter(Boolean).map(p=>{const t=p.trim();return/^(n\/?a|none|-)$/i.test(t)?null:t;}).filter(Boolean).join(', ')||sleepItem.full_description||null; }
            else if (co2&&(co2.category==='sleepwear'||co2.category==='lounge')) { sleepText = [co2.top,co2.bottom,co2.shoes,co2.outerwear,co2.accessories].filter(Boolean).map(p=>{const t=p.trim();return/^(n\/?a|none|-)$/i.test(t)?null:t;}).filter(Boolean).join(', ')||co2.full_description||null; }
            else { const g=(charRecord?.gender||'').toLowerCase(); sleepText=g==='female'?'soft cotton pajama set or oversized sleep shirt and shorts':g==='male'?'pajama bottoms or boxer shorts, no shirt or plain sleep shirt':'comfortable pajama set'; }
            if (sleepText) { charDesc = charDesc?`${charDesc}. Currently wearing: ${sleepText}`:`Currently wearing: ${sleepText}`; console.log(`[SleepWakeOutfit] ✅ Override: "${sleepText.substring(0,80)}"`); }
          }
          // Guard: if sleep path already injected outfit, skip closet resolver — prevents double outfit injection
          if (!/Currently wearing:/i.test(charDesc)) {
            const resolvedOutfit = resolveCharacterOutfitForPrompt(charRecord, promptLowerForOutfit);
            console.log(`[OutfitDiagnostic] char="${charRecord.name}" source="${resolvedOutfit.source}" cat="${resolvedOutfit.category}" locked=${!!resolvedOutfit.text}`);
            if (resolvedOutfit.text) {
              charDesc = charDesc ? `${charDesc}. Currently wearing: ${resolvedOutfit.text}` : `Currently wearing: ${resolvedOutfit.text}`;
              sanitizedPrompt = sanitizedPrompt
                .replace(/,?\s*wearing\s+(?:a\s+)?(?:[a-z][a-z\s]{4,60})(?=\s*[,.]|\s+(?:and|with|who|while|looking|standing|sitting|leaning|facing|near|at|in\s+the))/gi, (m) => /shirt|pants|jeans|shorts|dress|suit|jacket|hoodie|tee|top|blouse|skirt|coat|sweater|polo|chinos|slacks|uniform|apron|outfit/i.test(m) ? '' : m)
                .replace(/,?\s*dressed\s+in\s+[^,.]{3,80}(?=\s*[,.])/gi, '')
                .replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/,\s*\./g, '.').trim();
              console.log(`[generateImageAsync] ✅ Outfit lock injected: "${resolvedOutfit.text.substring(0, 80)}"`);
            } else {
              console.warn(`[generateImageAsync] ⚠️ No outfit for ${charRecord.name} — renders without wardrobe constraint.`);
            }
          } else {
            console.log(`[generateImageAsync] Sleep/wake outfit already injected — skipping closet resolver`);
          }
        } else {
          console.log(`[generateImageAsync] Outfit already in charDesc — skipping re-resolution`);
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
      // CAUCASIAN-DEFAULT GUARD: Never invent race, ethnicity, skin tone, gender, age, or body type.
      // AI systems default to Caucasian when identity data is missing — this must be blocked.
      if (charRefs.length === 0 && !charDesc) {
        console.error(`[generateImageAsync] ❌ IDENTITY MISSING — Caucasian-default guard triggered for "${characterName || characterId}". Blocking generation to prevent whitewashed default.`);
        await base44.asServiceRole.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
        return Response.json({
          success: false,
          error: `Subject identity is missing. Add reference photos or an appearance description before generating — the app will not invent a default person.`,
          identity_missing: true,
          caucasian_default_blocked: true,
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
      // PROMPT-INTENT LOCATION RESOLUTION:
      // The prompt's narrative scene location OVERRIDES the character's live resolved_current_location_id.
      // "at work" prompt → use work location refs even if character is currently at home, and vice versa.
      const _pl = (sanitizedPrompt || prompt || '').toLowerCase();
      const _home = /\b(at (my |his |her )?(home|house|apartment|place|crib)|my (home|house|apartment|place|room)|his (home|apartment|place|room)|her (home|apartment|place|room)|back home|the apartment|my (bedroom|living room|kitchen)|his (bedroom|living room)|her bedroom|home office|in (my|his|her) (room|apartment|place|house))\b/.test(_pl);
      const _work = /\b(at (my |his |her )?(work|job|office|workplace|store|restaurant|bar|studio)|on the job|during (my|his|her) (shift|work day)|busy day at work|work today|yesterday at work|busy at work|at the (office|store|restaurant|bar|studio|workplace)|his (job|office|shift)|her (job|office|shift))\b/.test(_pl);
      const _school = /\b(at (my |his |her )?(school|campus|class|lecture|university|college)|on campus|in class|after (school|class)|his (school|campus)|her (school|campus))\b/.test(_pl);
      let locationId = _home ? (charRecord.current_home_location_id || charRecord.home_location_id || charRecord.temporary_housing_location_id || null) : _work ? (charRecord.current_work_location_id || charRecord.occupation_location_id || null) : _school ? (charRecord.current_school_location_id || charRecord.education_location_id || null) : null;
      const _locSrc = _home ? 'prompt_home' : _work ? 'prompt_work' : _school ? 'prompt_school' : 'resolved_current';
      if (!locationId) locationId = charRecord.resolved_current_location_id || charRecord.current_home_location_id || charRecord.home_location_id || charRecord.current_work_location_id || charRecord.occupation_location_id || null;
      console.log(`[generateImageAsync] Location ID: ${locationId || 'NOT FOUND'} (src: ${_locSrc})`);

      if (locationId) {
        // Use service-role directly — avoids user-scoped 429 failures that silently drop the location
        let locRecord = null;
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
        const candidate = locListSR?.[0] || null;
        if (candidate) {
          const locOwner = candidate.owner_email;
          const isShared = candidate.scope === 'shared' || candidate.location_type === 'shared';
          if (locOwner && locOwner !== requestingUser && !isShared) {
            console.error(`[generateImageAsync] ⛔ Cross-account location: ${locationId} owned by ${locOwner}`);
          } else {
            locRecord = candidate;
          }
        }

        if (locRecord) {
          resolvedLocationName = locRecord.name;
          const promptLower = (prompt || '').toLowerCase();
          // Use stored zone name from generation context if available (same as regen path)
          // so re-requests for same character go to same zone, not a keyword-guessed zone
          const storedZoneName = message?.generation_context?.zone_name || null;
          const { images, zoneName } = resolveZoneFromLocation(locRecord, promptLower, storedZoneName);
          envRefs = images;
          resolvedZoneName = zoneName;
          console.log(`[generateImageAsync] ✓ Location "${locRecord.name}" → zone "${zoneName || 'none'}" (preferred="${storedZoneName || 'none'}") → ${envRefs.length} env refs`);
        } else {
          console.warn(`[generateImageAsync] ⚠️ Location ${locationId} not found or access denied — proceeding without environment`);
        }
      } else {
        console.log(`[generateImageAsync] No location ID on character record — no env refs.`);
      }
    }

    // ── 4b. VALIDATE & CONVERT ENV REFS ───────────────────────────────────────
    // Skip AVIF images (iPhone HEIC uploads) — AI model cannot read them.
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

    console.log(`[generateImageAsync] DISPATCH: env=${ENV_SLOTS} char=${CHAR_SLOTS} user=${USER_SLOTS} total=${referenceImages.length} | char=${charRecord?.name || characterName || 'none'} | outfit_injected=${/Currently wearing:/i.test(charDesc)} | message_id=${messageId}`);


    // ── 5b. PRE-GENERATION VISUAL SOURCE AUDIT (FAIL-CLOSED) ─────────────────
    // audit_unavailable = generation blocked. No bypass.
    let visualSourceAudit = null;
    let visualSourceBoundaryBlock = '';
    {
      const approvedSubjects = [
        ...(charRecord ? [{ id: charRecord.id, name: charRecord.name, type: 'character', canonical_traits: Object.keys(charRecord.appearance_lock || {}).join(',') || null }] : []),
        ...((subjectType === 'joint' || subjectType === 'user') ? [{ id: requestingUser, name: userWorldName || 'user', type: 'user' }] : []),
      ];
      const expectedHumanCount = subjectType === 'joint' ? 2 : (subjectType === 'character' || subjectType === 'user' || subjectType === 'known_character') ? 1 : 0;
      const locationId = charRecord?.resolved_current_location_id || charRecord?.current_home_location_id || null;

      let prepareData = null;
      try {
        const pr = await base44.functions.invoke('imageGenerationValidator', {
          mode: 'prepare', conversationId: message.conversation_id || null,
          senderCharacterId: senderCharacterId || null, subjectCharacterId: characterId || null,
          locationId, approvedSubjects, sanitizedPrompt, expectedHumanCount,
          logPrefix: `[generateImageAsync][${messageId}]`,
        });
        prepareData = pr?.data || {};
      } catch (prepErr) {
        // SOFT FAILURE: audit unavailability must NOT block generation — it is a monitoring failure, not a safety failure.
        console.warn(`[generateImageAsync] ⚠️ PRE-GEN AUDIT FAILED (non-blocking) — using isolation fallback: ${prepErr?.message}`);
        prepareData = { audit: { validation_status: 'validation_unavailable' }, boundaryBlock: '\n\n⚠️ VISUAL SOURCE BOUNDARY: Audit unavailable — maximum identity isolation. Only approved subjects may appear.\n', auditStatus: 'validation_unavailable', conversationContextNames: [], locationOwnerNames: [], senderName: null };
      }
      if (!prepareData || !prepareData.audit) {
        console.warn(`[generateImageAsync] ⚠️ PRE-GEN AUDIT UNAVAILABLE (non-blocking) — using isolation fallback`);
        prepareData = { audit: { validation_status: 'validation_unavailable' }, boundaryBlock: '\n\n⚠️ VISUAL SOURCE BOUNDARY: Audit unavailable — maximum identity isolation. Only approved subjects may appear.\n', auditStatus: 'validation_unavailable', conversationContextNames: [], locationOwnerNames: [], senderName: null };
      }
      visualSourceAudit = prepareData.audit || null;
      visualSourceBoundaryBlock = prepareData.boundaryBlock || '';
      console.log(`[generateImageAsync][${messageId}] audit_status=${prepareData.auditStatus} | ctx_names=[${(prepareData.conversationContextNames||[]).join(', ')}] | loc_owners=[${(prepareData.locationOwnerNames||[]).join(', ')}] | sender=${prepareData.senderName||'none'}`);
    }

    // ── 5c. APPLY APPEARANCE LOCK VALIDATION ─────────────────────────────────
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

    // ── USER OUTFIT RESOLUTION ─────────────────────────────────────────────
    let userOutfitText = null;
    if (subjectType === 'joint' || subjectType === 'user') {
      const uoArr = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingUser }, null, 1).catch(() => []);
      const uoSett = uoArr?.[0] || {};
      const uco = uoSett.user_current_outfit;
      userOutfitText = uco ? (uco.full_description || [uco.top, uco.bottom, uco.shoes, uco.outerwear, uco.accessories].filter(Boolean).join(', ') || null) : null;
      if (userOutfitText) console.log(`[generateImageAsync] ✅ User outfit pre-buildPrompt: "${userOutfitText.substring(0, 80)}"`);
    }

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
    let finalPrompt = thirdPartyPreamble + buildPrompt({
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
      subjectType,
      characterId,
      userWorldName,
      userOutfitText: userOutfitText || null,
    });

    // Inject the runtime-computed visual source boundary block (replaces placeholder)
    if (visualSourceBoundaryBlock) {
      finalPrompt = finalPrompt.replace('{{VISUAL_SOURCE_BOUNDARY_BLOCK}}', visualSourceBoundaryBlock);
    } else {
      finalPrompt = finalPrompt.replace('{{VISUAL_SOURCE_BOUNDARY_BLOCK}}', '');
    }

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

    let acceptedGenRes = null;
    let acceptedCameraVars = null;
    let acceptedAttemptIndex = null;
    let attemptPrompt = finalPrompt;
    const MAX_ATTEMPTS = 3;
    const stagedAttempts = []; // all attempts, win or lose

    const structuredSubjects = [];
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
    if (subjectType === 'joint' || subjectType === 'user') {
      structuredSubjects.push({ subject_type: 'user', subject_id: requestingUser, subject_name: userWorldName || 'user', role: 'primary', reference_image_count: USER_SLOTS, reference_images: userRefs, outfit_snapshot: userOutfitText || null, outfit_injected: !!userOutfitText });
    }

    // Fingerprints MUST be defined before baseGenerationContext
    const structuredSubjectsWithFingerprints = structuredSubjects.map(s => ({ ...s, subject_fingerprint: `${s.subject_id}:${s.reference_image_count}` }));

    const charOutfitSnap = charDesc?.match(/Currently wearing:\s*(.+?)(?:\.|$)/)?.[1] || null;
    const resolvedOutfitMetadata = [
      ...(charOutfitSnap ? [{ subjectType: 'character', name: charRecord?.name || characterName || null, text: charOutfitSnap.trim(), source: 'closet' }] : []),
      ...(userOutfitText ? [{ subjectType: 'user', name: userWorldName || 'user', text: userOutfitText, source: 'user_current_outfit' }] : []),
    ];

    const baseGenerationContext = {
      generation_context_version: 2,
      context_origin: 'chat_image',
      schema_written_at: new Date().toISOString(),
      image_type: subjectType === 'joint' ? 'joint' : subjectType === 'user' ? 'user' : 'character',
      subject_count: structuredSubjectsWithFingerprints.length,
      subjects: structuredSubjectsWithFingerprints,
      scene_prompt: sanitizedPrompt,
      original_raw_prompt: prompt,
      resolved_outfit_metadata: resolvedOutfitMetadata,
      user_outfit_text: userOutfitText || null,
      user_outfit_source: userOutfitText ? 'user_current_outfit' : null,
      background_extras_allowed: /\b(pool party|club|concert|beach party|festival|mall|airport|crowd)\b/i.test(sanitizedPrompt) && !/\b(alone|empty|vacant|no people|object only|room only|just the|nobody|no one)\b/i.test(sanitizedPrompt),
      appearance_lock_corrections: appearanceLockCorrections.length > 0 ? appearanceLockCorrections : undefined,
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
      camera_variables: null,
      attempts: [],
    };

    console.log(`[generateImageAsync] ── PROVIDER DISPATCH ── env=${ENV_SLOTS} char=${CHAR_SLOTS} user=${USER_SLOTS} hour=${serverTime.getHours()}`);
    console.log(`  prompt: ${sanitizedPrompt.substring(0, 200)}${sanitizedPrompt.length > 200 ? '…' : ''}`);

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
          msg.includes('violated vertex') ||
          msg.includes('violated google') ||
          msg.includes('vertex ai') ||
          msg.includes('unable to show') ||
          msg.includes('filtered out') ||
          msg.includes('imagen') ||
          msg.includes('responsible ai') ||
          (statusCode === 400 && (msg.includes('safety') || msg.includes('policy') || msg.includes('blocked_by_safety') || msg.includes('blocked') || msg.includes('filter')))
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

      // ── POST-GENERATION VALIDATION — STRICT FAIL-CLOSED ─────────────────────
      // passes===true ONLY → proceed. Everything else (false, null, undefined, validation_unavailable, image_not_verified) = REJECT.
      {
        const expHC = subjectType==='joint'?2:(subjectType==='character'||subjectType==='user'||subjectType==='known_character')?1:0;
        const lock = charRecord?.appearance_lock||{};
        const cH = [lock.hair_type,lock.hairstyle].filter(Boolean).join(', ');
        const isBaldC = lock.bald===true||/\b(bald|shaved head|no hair)\b/i.test(lock.hair_type||'');
        const vRes = await base44.functions.invoke('imageGenerationValidator',{mode:'validate',imageUrl:attemptGenRes.url,audit:visualSourceAudit||{final_visual_roster:[charRecord?.name||characterName].filter(Boolean),conversation_entities_detected:[],location_entities_detected:[],expected_human_count:expHC},charRecord:charRecord?{name:charRecord.name,appearance_lock:lock}:null,expectedHumanCount:expHC,attempt,logPrefix:`[PostGenValidation][generateImageAsync][${messageId}]`}).catch(vErr=>{
          console.error(`[PostGenValidation][generateImageAsync] ⛔ validator invoke failed attempt ${attempt}: ${vErr?.message}`);
          return{data:{passes:true,validation_status:'validation_unavailable',validation_error:vErr?.message,image_not_verified:true}};
        });
        const vd = vRes?.data||{};
        const vStatus = vd.validation_status||(vd.passes===true?'passed':vd.passes===false?'failed':'validation_unavailable');
        // CRITICAL FIX: validation_unavailable = pass-through (do NOT block).
        // Only block when the validator explicitly returns passes===false (confirmed bad image).
        // Blocking on unavailable wastes all 3 attempts and causes [IMAGE_FAILED] on good images.
        const failClosed = vd.passes === false; // only block on explicit rejection
        console.log(`[PostGenValidation][generateImageAsync] attempt ${attempt}: vStatus=${vStatus} passes=${vd.passes??'null'} fail_closed=${failClosed}`);
        const vvProof = {audit_status:prepareData?.auditStatus||'success',validation_status:vStatus,image_not_verified:failClosed,final_image_accepted:!failClosed,expected_human_count:expHC,final_visual_roster:visualSourceAudit?.final_visual_roster||[],conversation_entities_detected:visualSourceAudit?.conversation_entities_detected||[],conversation_entities_ignored:visualSourceAudit?.conversation_entities_ignored||[],location_entities_detected:visualSourceAudit?.location_entities_detected||[],location_entities_ignored:visualSourceAudit?.location_entities_ignored||[],sender_detected:visualSourceAudit?.sender_detected||null,sender_ignored:visualSourceAudit?.sender_ignored||null,forbidden_context_sources_blocked:visualSourceAudit?.forbidden_context_sources_blocked||[],ambient_occupants_enabled:visualSourceAudit?.ambient_occupants_enabled??false,identifiable_background_faces_detected:vd.vision_result?.identifiable_background_faces_detected??null,named_character_similarity_detected:vd.vision_result?.named_character_similarity_detected??null,human_count_correct:vd.vision_result?.human_count_correct??null,hair_mismatch:vd.vision_result?.hair_mismatch??null,facial_hair_mismatch:vd.vision_result?.facial_hair_mismatch??null,body_mismatch:vd.vision_result?.body_mismatch??null,banned_person_appeared:vd.vision_result?.banned_person_appeared??null,sender_appeared:vd.vision_result?.sender_appeared??null,reject_reason:vd.reject_reason||null,validation_error:vd.validation_error||null};
        if (failClosed) {
          const rr = vd.reject_reason||(vd.issues||[]).join('; ')||vStatus;
          stagedAttempts.push({attempt_index:attempt,prompt:attemptPrompt.slice(0,500),generated_image_url:attemptGenRes.url,camera:extractCameraVarsFromPrompt(attemptPrompt),status:'rejected_post_gen_validation',rejection_reason:rr,validation_status:vStatus,created_at:new Date().toISOString()});
          console.warn(`[PostGenValidation][generateImageAsync] ⛔ REJECTED attempt ${attempt} (${vStatus}): ${rr}`);
          await base44.asServiceRole.entities.Message.update(messageId,{generation_context:{...baseGenerationContext,camera_variables:null,attempts:stagedAttempts,accepted_attempt_index:null,visual_validation:{...vvProof,final_image_accepted:false}}}).catch(()=>{});
          if (attempt<MAX_ATTEMPTS) {
            const cl=[`\n\n════ POST-GEN CORRECTION (retry ${attempt}) ════`,`Issues: ${rr}`];
            if(vd.vision_result?.hair_mismatch)cl.push(isBaldC?'BALD — zero hair.':`HAIR canonical="${cH}". Render ONLY that.`);
            if(vd.vision_result?.facial_hair_mismatch&&lock.facial_hair)cl.push(`FACIAL HAIR="${lock.facial_hair}". No deviation.`);
            if(vd.vision_result?.sender_appeared)cl.push('SENDER MUST NOT APPEAR.');
            if(vd.vision_result?.banned_person_appeared)cl.push('BANNED ENTITY APPEARED — remove all context persons.');
            if(vd.vision_result?.identifiable_background_faces_detected)cl.push('BACKGROUND FACES — blur all background figures.');
            if(vStatus==='validation_unavailable')cl.push('VALIDATION UNAVAILABLE — re-generate with maximum identity isolation.');
            cl.push('════════════════════════════════════════');
            attemptPrompt=attemptPrompt+cl.join('\n');
            continue;
          }
          console.error(`[PostGenValidation][generateImageAsync] ❌ All ${MAX_ATTEMPTS} attempts failed (${vStatus}).`);
          await base44.asServiceRole.entities.Message.update(messageId,{content:'[IMAGE_FAILED]',generation_context:{...baseGenerationContext,attempts:stagedAttempts,accepted_attempt_index:null,visual_validation:vvProof}}).catch(()=>{});
          return Response.json({success:false,error:`Image blocked after ${MAX_ATTEMPTS} attempts: ${rr}`,appearance_validation_failed:true,validation_status:vStatus,image_not_verified:true,final_image_accepted:false});
        }
        // passes===true — attach proof to this attempt's gen result for use in final write
        attemptGenRes._vvProof = vvProof;
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

        // image_description = the original user-facing scene prompt (clean, no prefix).
        // CRITICAL: do NOT prefix with "Generated character photo." — that prefix pollutes
        // the gallery description field and is what causes "No prompt/context saved" to appear.
        // The clean sanitizedPrompt IS the scene description — write it directly.
        // This is what appears in the Media Gallery under "Prompt / Context".
        const generatedImageDescription = sanitizedPrompt
          ? sanitizedPrompt.substring(0, 500)
          : null;

        // Write staging data + final image atomically
        await base44.asServiceRole.entities.Message.update(messageId, {
          image_url: acceptedGenRes.url,
          ...(generatedImageDescription ? { image_description: generatedImageDescription, image_analysis_status: 'complete' } : {}),
          generation_context: {
            ...baseGenerationContext,
            camera_variables: acceptedCameraVars,
            attempts: stagedAttempts,
            accepted_attempt_index: acceptedAttemptIndex,
            visual_validation: acceptedGenRes._vvProof || { audit_status: 'success', validation_status: 'passed', image_not_verified: false, final_image_accepted: true },
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