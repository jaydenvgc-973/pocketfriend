/**
 * regenerateImageWithReason — "Why Regenerate" handler.
 *
 * PIPELINE:
 *   - Reads generation_context saved on the message (set by generateImageAsync / mediaGridGenerate)
 *   - Uses that context as the source of truth: same character, same location, same zone
 *   - User corrections (wrong_location) update ONLY the environment refs
 *   - User corrections (dont_like, custom_prompt) update ONLY the prompt
 *   - Identity is NEVER discarded unless there are no refs
 *
 * RULES:
 *   - Never generate a random person
 *   - Never redesign the room
 *   - Never cross accounts
 *   - Avatar background = 0% influence on environment
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

// ── CAMERA POSITION DETECTION ─────────────────────────────────────────────────
// MUST stay in sync with selectCameraPosition in generateImageAsync.js
// Both generation and regeneration paths share the same camera logic.

function selectCameraPosition(prompt = '') {
   const promptLower = (prompt || '').toLowerCase();

   const isSelfie = /selfie|self-?portrait|phone selfie|smartphone selfie|cell phone|taken.*phone|phone.*photo/.test(promptLower);
   const isSittingAtTable = /sitting at.*table|at.*table.*eating|seated at.*table|at the table|dining.*table|wooden.*table/.test(promptLower);
   const isSittingOnCouch = /sitting on.*couch|on the couch|lounging on.*sofa|couch/.test(promptLower);
   const isStandingAtCounter = /standing at.*counter|at the counter/.test(promptLower);

   if (isSelfie) {
     // Compound: selfie + seated — character holds phone at face level while seated
     // CRITICAL: Use EXISTING table in the zone, do NOT create a new one
     if (isSittingAtTable) {
       return 'selfie perspective — character is SEATED at the EXISTING table in this room holding the phone at arm\'s length toward the camera. Face and upper chest dominate the frame. The existing table and any food/place settings are partially visible below. Character is NOT standing. Phone is in the character\'s hand extended toward viewer. CAMERA MUST adjust angle to show the existing table structure.';
     }
     return 'extreme close-up selfie — character holds phone at arm\'s length directly toward camera. Face fills most of the frame. Personal and intimate framing. Character is NOT standing in a wide shot.';
   }

   if (isSittingAtTable) {
     return 'tight medium shot, seated eye-level at the EXISTING table, character is the primary subject, existing table surface and place settings in frame — do NOT invent a new table, use the one in the zone';
   }

   if (isSittingOnCouch) {
     return 'seated eye-level from the EXISTING couch, character is the primary subject, close and personal framing — use the couch that exists in this room';
   }

   if (isStandingAtCounter) {
     return 'close-up at counter-level, character standing at the EXISTING counter are the primary subjects — do NOT create a replacement counter, use the one in the zone';
   }

   return 'from a closer standing position';
 }

// ── OUTFIT RESOLVER — inlined (Deno cannot import local lib files) ────────────
// Source of truth: lib/outfitRotationEngine.js. Keep in sync with generateImageAsync.

function buildOutfitTextRegen(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (outfit.full_description) {
    return outfit.full_description
      .replace(/^in [^,.]+(,|\.) ?/i, '')
      .replace(/^a (man|woman|person)[^,.]*(,|\.) ?/i, '')
      .replace(/^[^,.]+(stands|sits|lounges|poses)[^,.]*(,|\.) ?/i, '')
      .trim() || outfit.full_description;
  }
  return null;
}

const OUTFIT_FALLBACK_CHAINS_REGEN = {
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

function resolveOutfitCategoryRegen(character) {
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

function resolveOutfitTextFromCharacterRegen(character) {
  if (!character) return null;
  const closet = character.character_closet || [];
  const outfits = closet.filter(item => item.outfit_id);
  if (outfits.length === 0) return buildOutfitTextRegen(character.current_outfit) || null;
  const targetCategory = resolveOutfitCategoryRegen(character);
  const chain = OUTFIT_FALLBACK_CHAINS_REGEN[targetCategory] || ['daily_casual', 'lounge'];
  const currentOutfitId = character.current_outfit?.outfit_id || null;
  for (const cat of chain) {
    const pool = outfits.filter(o => o.category === cat);
    if (pool.length === 0) continue;
    if (pool.length === 1) return buildOutfitTextRegen(pool[0]);
    const now = new Date();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    let idx = (dayOfYear + idHash) % pool.length;
    if (pool[idx]?.outfit_id === currentOutfitId && pool.length > 1) idx = (idx + 1) % pool.length;
    return buildOutfitTextRegen(pool[idx]);
  }
  return null;
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────

function buildRegenPrompt({ scenePrompt, charName, charDesc, locationName, zoneName, envRefs, charRefs, userRefs, includeUser, reason }) {
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

   const hasEnv  = envRefs.length > 0;
   const hasChar = charRefs.length > 0;
   const hasUser = (userRefs || []).length > 0;

   const ENV_SLOTS  = Math.min(envRefs.length, 4);
   const CHAR_SLOTS = Math.min(charRefs.length, 2);
   const USER_SLOTS = Math.min((userRefs || []).length, 3);

   const envEnd    = ENV_SLOTS;
   const charStart = ENV_SLOTS + 1;
   const charEnd   = ENV_SLOTS + CHAR_SLOTS;
   const userStart = ENV_SLOTS + CHAR_SLOTS + 1;
   const userEnd   = ENV_SLOTS + CHAR_SLOTS + USER_SLOTS;

   const cameraPos = selectCameraPosition(scenePrompt);

   let preamble = `════════════════════════════════════════════════════════════
STRUCTURAL TRUTH & DYNAMIC FLEXIBILITY — CAMERA ADAPTS TO ROOM
════════════════════════════════════════════════════════════

CAMERA POSITION (MANDATORY — MUST DIFFER FROM REFERENCE):
${cameraPos}

This camera angle MUST be visibly different from reference images.

CRITICAL: If the character's requested action requires an existing object (table, couch, bed, counter, stove):
✅ Use THAT existing object from images 1–${envEnd}
✅ Move the camera to frame the object correctly
⛔ Do NOT duplicate, invent, or replace the object

REFERENCE HIERARCHY:
- 70–80% STRUCTURAL TRUTH: room layout, furniture identity, materials, zone identity
- 20–30% DYNAMIC FLEXIBILITY: camera angle, framing, lighting (time-based)

`;

  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    preamble += `Images 1–${envEnd}: ROOM ENVIRONMENT — 70–80% STRUCTURAL TRUTH
Photographs of "${place}". PRESERVE: walls, floor, furniture identity, rug, curtains, lighting fixtures, decor, layout.
The room structure is TRUE — the viewpoint and lighting will change with new camera position.

`;
  }
  if (hasChar) {
     preamble += `Images ${charStart}–${charEnd}: FACE-CROP IDENTITY PHOTOS — FACE ONLY — "${charName}".
  Match ONLY: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/style, body type.
  ⛔ ABSOLUTE PROHIBITION: Background, room, walls, lighting, furniture, pose, clothing in these photos MUST BE COMPLETELY IGNORED.
  ⛔ DO NOT USE AS SCENE BACKGROUND — room comes from zone images only.
  ⛔ Treat as face texture samples ONLY.

  `;
  }
  if (hasUser && includeUser) {
    preamble += `Images ${userStart}–${userEnd}: FACE-CROP IDENTITY PHOTOS — FACE ONLY — USER / MY PERSONA.
  These are photos of the user (the person who owns this app). Match ONLY: face structure, skin tone, hair, body type.
  ⛔ ABSOLUTE PROHIBITION: Background, pose, clothing, lighting from these photos MUST BE COMPLETELY IGNORED.
  ⛔ DO NOT treat these as a scene template — face identity ONLY transfers.
  The user must appear as a distinct person from "${charName}" — do NOT merge their appearances.

  `;
  }
  preamble += '════════════════════════════════════════════════════════════\n\n';

  let envLock = '';
  if (hasEnv) {
    const place = [locationName, zoneName].filter(Boolean).join(' → ');
    envLock = `

  ════════════════════════════════════════════════════════════
  STRUCTURAL TRUTH — "${place}" — 70–80% IDENTITY, 20–30% DYNAMIC
  ════════════════════════════════════════════════════════════

  PRESERVE (70–80% structural truth):
   ✅ Furniture types, colors, shapes, structural placement
   ✅ Wall color, floor type, rug, curtains
   ✅ All lighting fixtures and lamps
   ✅ Wall art and shelves in relative positions
   ✅ Room layout, windows, doors, architecture

  REGENERATE (20–30% dynamic flexibility):
   ✓ Camera position (MUST differ from reference image viewpoint)
   ✓ Camera angle (MUST be new perspective)
   ✓ Lighting (NO light source from reference images — generate fresh)
   ✓ Composition (MUST be reframed from new camera viewpoint)
   ✓ Depth of field and focus

  ════════════════════════════════════════════════════════════
  EXISTING OBJECTS FIRST — NO DUPLICATION
  ════════════════════════════════════════════════════════════
  CRITICAL: Use EXISTING furniture from images 1–${envEnd} FIRST.
  If an object needs framing, MOVE THE CAMERA — do NOT invent or duplicate.
  NEVER create a second table, couch, bed, stove, or counter when one exists.
  If unframed, adjust camera angle/placement/position. Room truth stays fixed.

  NO OBJECT INVENTION — Every object must come from images 1–${envEnd}.
  NO STATIC BACKGROUND LOCK — Recompose the entire scene from the new camera position.`;
  }

  // Reason-specific enforcement
  let reasonBlock = '';
  if (reason === 'dont_like' || reason === 'custom_prompt') {
    // ── SUBJECT + ELEMENT FIDELITY BLOCK ─────────────────────────────────────
    // When the user says "Don't like it", they are asking for a re-render of THIS scene
    // with THIS character doing EXACTLY what was described — not a generic redo.
    // The system MUST faithfully reproduce every element the user asked for:
    //   - WHO is the subject (the character named above — NOT a generic person)
    //   - WHAT they are doing (action, pose, activity as described in the prompt)
    //   - WHERE it is happening (location/zone as already resolved)
    //   - WHAT elements appear (objects, clothing, props explicitly mentioned)
    //
    // This block enforces "closer attention to prompt" — every noun, verb, and adjective
    // in the scene description is treated as a mandatory visual requirement.

    // Extract key scene elements from the prompt for explicit enforcement
    const promptLowerCheck = scenePrompt.toLowerCase();

    // Detect subject type from prompt to enforce identity
    const hasExplicitSubjectName = charName && charName !== 'the character' && scenePrompt.toLowerCase().includes(charName.toLowerCase().split(' ')[0].toLowerCase());

    // Clothing/accessories explicitly named in prompt
    const clothingMatches = scenePrompt.match(/\b(wearing|dressed in|has on|in a|with a)\s+([^,.!?]+)/gi) || [];
    const clothingNote = clothingMatches.length > 0
      ? `CLOTHING/ACCESSORIES LOCK — MANDATORY:\n  The prompt explicitly describes: "${clothingMatches.slice(0, 3).join('; ')}"\n  ⛔ You MUST render exactly what is described above — no substitutions, no omissions.`
      : '';

    // Actions explicitly requested
    const actionMatches = scenePrompt.match(/\b(sitting|standing|lying|holding|eating|drinking|laughing|smiling|looking|walking|running|leaning|reaching|cooking|reading|typing|sleeping|hugging|kissing|posing)[^\s,]*/gi) || [];
    const actionNote = actionMatches.length > 0
      ? `ACTION LOCK — MANDATORY:\n  The prompt explicitly describes these actions: ${actionMatches.slice(0, 4).join(', ')}\n  ⛔ The character MUST be performing these exact actions — do not substitute or ignore them.`
      : '';

    // Props/objects explicitly mentioned
    const propMatches = scenePrompt.match(/\b(phone|coffee|cup|glass|book|bag|hat|sunglasses|umbrella|laptop|headphones|camera|food|drink|bottle|plate|chair|table|couch|bed|mirror|door|window)[s]?\b/gi) || [];
    const propNote = propMatches.length > 0
      ? `PROPS/OBJECTS LOCK — MANDATORY:\n  The prompt explicitly mentions: ${[...new Set(propMatches.map(p => p.toLowerCase()))].slice(0, 5).join(', ')}\n  ⛔ These objects MUST appear in the image — do not omit them.`
      : '';

    reasonBlock = `

  DONT_LIKE RE-RENDER — STRICT PROMPT FIDELITY MODE:
  The user is not satisfied with the previous result and wants a better version.
  This is NOT a license to make a completely different image.
  This IS an instruction to render the EXACT same scene MORE faithfully.

  ════════════════════════════════════════════════════════════
  SUBJECT IDENTITY LOCK — WHO IS IN THIS IMAGE
  ════════════════════════════════════════════════════════════
  The PRIMARY SUBJECT of this image is: "${charName}"
  ${hasExplicitSubjectName ? `✅ The prompt explicitly names "${charName.split(' ')[0]}" — this person is the focus.` : `✅ "${charName}" is the character this scene was generated for — they are the subject.`}
  ⛔ Do NOT generate a generic or random person as the subject
  ⛔ Do NOT substitute a different person
  ⛔ "${charName}"'s appearance lock (hair, skin tone, face, body) is ABSOLUTE and IMMUTABLE
  ⛔ Every identity trait from the reference photos and description above is NON-NEGOTIABLE

  ════════════════════════════════════════════════════════════
  SCENE PROMPT — READ EVERY WORD AS A MANDATORY VISUAL REQUIREMENT
  ════════════════════════════════════════════════════════════
  The scene prompt below describes EXACTLY what must appear in this image.
  Every noun, verb, adjective, and descriptor is a MANDATORY element.
  Do NOT:
  ⛔ Ignore any element that was explicitly described
  ⛔ Substitute different clothing, objects, or settings
  ⛔ Skip described actions or poses
  ⛔ Omit described props or items
  ⛔ Change the described mood, lighting, or environment tone

  ${clothingNote ? clothingNote + '\n\n  ' : ''}${actionNote ? actionNote + '\n\n  ' : ''}${propNote ? propNote + '\n\n  ' : ''}
  ════════════════════════════════════════════════════════════
  LOCATION LOCK — WHERE THIS SCENE TAKES PLACE
  ════════════════════════════════════════════════════════════
  ${hasEnv
    ? `The environment reference images (Images 1–${Math.min(envRefs.length, 4)}) show the CORRECT location: "${[locationName, zoneName].filter(Boolean).join(' → ')}".
  ⛔ You MUST render this exact location — NOT a generic or invented room/setting.
  ⛔ The walls, floor, furniture, decor, and spatial layout MUST match the reference images.
  ⛔ Do NOT invent a new environment — use the reference images as the spatial blueprint.`
    : `No location reference images are available. Render an environment consistent with what the scene prompt describes.`
  }

  ════════════════════════════════════════════════════════════
  WHAT "DON'T LIKE IT" MEANS:
  ════════════════════════════════════════════════════════════
  The user wants the SAME scene rendered with better quality/accuracy.
  Common reasons include: wrong camera angle, character looks off, lighting issues, scene elements missing.
  FIX these issues while keeping EVERYTHING ELSE identical to what was described.
  The scene prompt is the AUTHORITY — follow it precisely.`;
  } else if (reason === 'flawed') {
    reasonBlock = `

  FLAWED IMAGE CORRECTION:
  The previous image had rendering failures (body morphing, wrong room, furniture errors, texture glitches, object duplication).
  Re-render with MAXIMUM fidelity. Every constraint above is non-negotiable.
  Correct: body proportions, furniture exact match (no duplication), correct face/hair/skin tone, anatomically correct hands/fingers, existing objects only.`;
  } else if (reason === 'no_avatar') {
     const subjectList = [];
     if (hasChar) subjectList.push(`"${charName}" (Images ${charStart}–${charEnd})`);
     if (hasUser && includeUser) subjectList.push(`User / My Persona (Images ${userStart}–${userEnd})`);
     reasonBlock = `

  IDENTITY CORRECTION — ${subjectList.length > 0 ? subjectList.join(' and ') : `"${charName}"`}:
  The previous image did not look like the correct person(s). Fix all identity references with MAXIMUM PRECISION.
  ${hasChar ? `"${charName}" reference images: ${charStart}–${charEnd}. Match face structure, skin tone, hair, body type PRECISELY.` : ''}
  ${hasUser && includeUser ? `User persona reference images: ${userStart}–${userEnd}. Match face structure, skin tone, hair, body type PRECISELY.` : ''}
  Each person's appearance traits are ABSOLUTE TRUTH — NEVER approximate or substitute.
  ⛔ Do NOT generate a generic, approximate, or randomly generated person for ANY subject.
  ⛔ Do NOT let one subject's appearance bleed into or overwrite the other.`;
  } else if (reason === 'wrong_location') {
    reasonBlock = `

  LOCATION CORRECTION:
  The environment has been corrected. Reference images 1–${envEnd} show the CORRECT room.
  Reproduce this room with EXACT fidelity. Use EXISTING furniture only — NO DUPLICATION or INVENTION.
  The previous room was wrong — do NOT replicate it. Preserve all furniture from images 1–${envEnd}.`;
  }

  let identityLock = '';
  // Identity lock fires for ALL saved-character images — with OR without reference photos.
  // charDesc (appearance_lock text) is the fallback identity source when no photos exist.
  if (hasChar || charDesc) {
    const refBlock = hasChar
      ? `Images ${charStart}–${charEnd} are FACE-CROP REFERENCE PHOTOS. Use them for face structure and features ONLY.
  Match PRECISELY: face bone structure, eyes, skin tone, hair color/length/style, body type.`
      : `No reference photos available. Generate "${charName}" EXCLUSIVELY from the text description below.
  The text description is the AUTHORITATIVE identity source — treat every trait as absolute truth.`;

    const descBlock = charDesc
      ? `\n  TEXT DESCRIPTION (ABSOLUTE IDENTITY — IMMUTABLE):
  ${charDesc}
  Every trait above is non-negotiable. Do NOT substitute, approximate, or invent any appearance trait.`
      : '';

    identityLock = `

  CHARACTER IDENTITY — "${charName}":
  ${refBlock}${descBlock}

  APPEARANCE LOCK (100% ABSOLUTE TRUTH):
  ✅ Hair: Match hairstyle, length, texture, and color exactly — from photos if available, from text description otherwise
  ✅ Facial hair: Match exact facial hair state (clean-shaven, stubble, beard, etc.) — non-negotiable
  ✅ Skin tone: Match exact skin tone — non-negotiable
  ✅ Body type: Match exact body structure and proportions — non-negotiable
  ✅ Ethnicity and gender: Match exactly as described — non-negotiable

  ⛔ Do NOT generate a generic, approximate, or random person
  ⛔ Do NOT invent appearance traits not present in photos or description
  ⛔ Do NOT override appearance traits from the character record
  ⛔ THESE ARE NON-NEGOTIABLE IMMUTABLE TRUTHS
  ⛔ CRITICAL: The character must look PHYSICALLY PRESENT inside the room — integrated with the room's perspective, depth, and lighting. NOT cut out. NOT composited. NOT overlaid on a background. ONE UNIFIED SCENE.
  ⛔ If the character looks pasted or floating — the generation has FAILED. Redo with full integration.`;
  }

  // User identity lock — added when user is a subject in the regenerated image
  if (hasUser && includeUser) {
    identityLock += `

  USER IDENTITY — "My Persona / Me":
  ${hasUser
    ? `Images ${userStart}–${userEnd} are FACE-CROP REFERENCE PHOTOS of the user (the app owner).
  Match PRECISELY: face bone structure, eyes, skin tone, hair color/length/style, body type.
  ⛔ ABSOLUTE PROHIBITION: Background, pose, clothing, lighting from these photos MUST BE COMPLETELY IGNORED.
  ⛔ DO NOT use these photos as a scene template — only face identity transfers.`
    : `No user reference photos available. Generate the user as a realistic person consistent with scene context.`
  }

  ✅ The user must appear as a DISTINCT person from "${charName}" — different face, different identity
  ⛔ Do NOT merge or blend the user's appearance with the character's appearance
  ⛔ Do NOT generate a generic placeholder for the user when reference photos exist
  ⛔ BOTH subjects must be physically integrated into the same scene — same lighting, same floor plane, same perspective`;
  }

  return `${preamble}${scenePrompt}\n\nPhotorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.${envLock}${reasonBlock}${identityLock}`;
}

// ── ZONE RESOLUTION — STRICT ZONE ISOLATION ────────────────────────────────────
// Only the exact matched zone's images are returned.
// No cross-zone fallback. Multiple zones with no match → no images (prevents contamination).

const ZONE_KEYWORD_MAP = [
  { keywords: ['bedroom', 'in bed', 'on the bed', 'sleeping', 'woke up', 'waking up', 'nightstand', 'duvet', 'pillow', 'mattress', 'my room', 'her room', 'his room'], zone: 'bedroom' },
  { keywords: ['kitchen', 'cooking', 'stove', 'fridge', 'oven', 'microwave', 'counter', 'pancake', 'breakfast', 'making food'], zone: 'kitchen' },
  { keywords: ['bathroom', 'shower', 'bathtub', 'toilet', 'vanity', 'brushing teeth', 'getting ready'], zone: 'bathroom' },
  { keywords: ['living room', 'couch', 'sofa', 'tv ', 'on the couch', 'lounge', 'sectional', 'watching tv'], zone: 'living room' },
  { keywords: ['backyard', 'patio', 'deck', 'yard', 'garden', 'grill', 'outside at home'], zone: 'backyard' },
  { keywords: ['dining room', 'dining table', 'dinner table', 'eating at the table'], zone: 'dining room' },
  { keywords: ['office', 'desk', 'home office', 'workspace', 'working from home'], zone: 'office' },
  { keywords: ['gym', 'workout', 'weights', 'treadmill', 'lifting', 'training'], zone: 'gym' },
  { keywords: ['vip', 'vip section', 'vip lounge'], zone: 'vip' },
  { keywords: ['bar area', 'behind the bar', 'bartending'], zone: 'bar area' },
  { keywords: ['dance floor', 'main floor', 'dancefloor'], zone: 'main floor' },
  { keywords: ['rooftop', 'roof deck', 'rooftop bar'], zone: 'rooftop' },
  { keywords: ['hallway', 'corridor', 'entryway', 'front door', 'foyer'], zone: 'hallway' },
  { keywords: ['balcony', 'on the balcony'], zone: 'balcony' },
];

function resolveZoneFromLocation(location, promptLower, preferredZoneName) {
  const zones = (location.zones || []).filter(z => cdnFilter(z.image_urls || []).length > 0);
  if (zones.length === 0) {
    return { images: cdnFilter(location.image_urls || []).slice(0, 4), zoneName: null };
  }

  // 0. Preferred zone name (from stored generation_context.zone_name) — highest priority
  if (preferredZoneName) {
    const preferred = zones.find(z => z.zone_name && z.zone_name.toLowerCase() === preferredZoneName.toLowerCase());
    if (preferred) {
      const imgs = cdnFilter(preferred.image_urls).slice(0, 4);
      if (imgs.length > 0) {
        console.log(`[resolveZone] Preferred zone match: "${preferred.zone_name}"`);
        return { images: imgs, zoneName: preferred.zone_name };
      }
    }
  }

  // 1. Exact zone name in prompt
  for (const zone of zones) {
    if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
      const imgs = cdnFilter(zone.image_urls).slice(0, 4);
      if (imgs.length > 0) {
        console.log(`[resolveZone] Exact name match: "${zone.zone_name}"`);
        return { images: imgs, zoneName: zone.zone_name };
      }
    }
  }

  // 2. Keyword match
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
      if (matched) {
        const imgs = cdnFilter(matched.image_urls).slice(0, 4);
        if (imgs.length > 0) {
          console.log(`[resolveZone] Keyword match: "${matched.zone_name}"`);
          return { images: imgs, zoneName: matched.zone_name };
        }
      }
    }
  }

  // 3. Only one zone — use it (unambiguous)
  if (zones.length === 1) {
    console.log(`[resolveZone] Single zone — using "${zones[0].zone_name}"`);
    return { images: cdnFilter(zones[0].image_urls).slice(0, 4), zoneName: zones[0].zone_name };
  }

  // 4. Multiple zones, no match — no images to avoid cross-zone contamination
  console.warn(`[resolveZone] Multiple zones, no match — returning no env refs`);
  return { images: [], zoneName: null };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      messageId,
      reason,          // 'flawed' | 'no_avatar' | 'wrong_location' | 'dont_like' | 'custom_prompt'
      customPrompt,    // for dont_like / custom_prompt
      manualLocationId, // for wrong_location
      manualZoneId,     // for wrong_location
      directLocationImages, // pre-resolved zone images from UI (optional)
      directZoneName,
      directLocationName,
      // For no_avatar: user-selected intended subjects (override auto-resolved identity)
      intendedSubjectIds,   // array of character IDs the user said the image was supposed to show
      includeUserSubject,   // true if the user said "me/my persona" was supposed to be in it
    } = await req.json();

    if (!messageId || !reason) {
      return Response.json({ error: 'messageId and reason are required' }, { status: 400 });
    }

    console.log(`[regenerateImageWithReason] ▶ messageId=${messageId} | reason=${reason} | manualLocationId=${manualLocationId || 'none'}`);

    // ── 1. LOAD MESSAGE AND CONTEXT ───────────────────────────────────────────
    const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const message = msgList?.[0];
    if (!message) return Response.json({ error: 'Message not found' }, { status: 404 });

    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const requestingUser = user.email;
    const ctx = message.generation_context || {};

    // CRITICAL: ctx.character_id may be null if the original image was generated via an
    // autonomous character photo where resolvePhotoSubject incorrectly classified the sender
    // as a described_third_party, writing null into generation_context.character_id.
    // The Message entity itself ALWAYS has character_id stamped (set at message creation),
    // so it is the authoritative identity fallback when the context was corrupted.
    const originalCharId    = ctx.character_id || message.character_id || null;
    const originalPrompt    = ctx.prompt || '';
    const originalLocId     = ctx.location_id || null;
    const originalZoneName  = ctx.zone_name || null;
    const originalLocName   = ctx.location_name || null;
    const originalLocRefs   = ctx.location_reference_images || [];

    if (!ctx.character_id && message.character_id) {
      console.warn(`[regenerateImageWithReason] ⚠️ generation_context.character_id was null — recovered from message.character_id: ${message.character_id}. This indicates the original generation used a broken autonomous photo subject classification. Regenerating with correct identity.`);
    }

    // ── 2. RESOLVE CHARACTER IDENTITY REFS ───────────────────────────────────
    let charRefs = [];
    let charDesc = '';  // text-based identity fallback — passed to buildRegenPrompt
    let charName = ctx.character_name || 'the character';

    // ── 3a. DETERMINE SCENE PROMPT (needed for prompt-name scan and zone resolution) ──
    // Must be declared BEFORE any code that references scenePromptRaw.
    let scenePromptRaw = originalPrompt;
    if (reason === 'dont_like' && customPrompt?.trim()) {
      scenePromptRaw = customPrompt.trim();
    } else if (reason === 'custom_prompt' && customPrompt?.trim()) {
      scenePromptRaw = customPrompt.trim();
    }
    if (!scenePromptRaw) scenePromptRaw = 'candid natural moment, everyday life';

    // ── PROMPT-NAMED SUBJECT RESOLUTION ──────────────────────────────────────
    // For dont_like / custom_prompt: the prompt is the AUTHORITY on who the subject is.
    // If the prompt explicitly names a character (e.g. "Ethan at the gym"), we must load
    // THAT character's identity — not blindly use whoever was the sender.
    // This prevents the sender's identity from overriding the actual named subject.
    let promptNamedCharId = null;
    if ((reason === 'dont_like' || reason === 'custom_prompt') && scenePromptRaw) {
      try {
        const allChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: requestingUser }, null, 100
        ).catch(() => []);
        const promptLowerForName = scenePromptRaw.toLowerCase();
        // Sort by name length descending so "Jordan Smith" matches before "Jordan"
        const sortedChars = [...allChars].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
        // Phase 1: exact full-name match (most collision-safe)
        for (const c of sortedChars) {
          if (!c.name || c.status === 'deleted' || c.status === 'soft_deleted') continue;
          if (promptLowerForName.includes(c.name.toLowerCase())) {
            promptNamedCharId = c.id;
            console.log(`[regenerateImageWithReason] ✅ Prompt names character (full name): "${c.name}" (id=${c.id})`);
            break;
          }
        }
        // Phase 2: first-name match (fallback — 4+ chars to avoid short-name false positives)
        if (!promptNamedCharId) {
          for (const c of sortedChars) {
            if (!c.name || c.status === 'deleted' || c.status === 'soft_deleted') continue;
            const firstName = c.name.split(' ')[0].toLowerCase();
            if (firstName.length >= 4 && promptLowerForName.includes(firstName)) {
              promptNamedCharId = c.id;
              console.log(`[regenerateImageWithReason] ✅ Prompt names character (first name, 4+ chars): "${c.name}" via "${firstName}" (id=${c.id})`);
              break;
            }
          }
        }
      } catch (nameErr) {
        console.warn(`[regenerateImageWithReason] Prompt name scan failed (non-blocking): ${nameErr?.message}`);
      }
    }

    // For no_avatar: user explicitly selected who the image was supposed to show.
    // For dont_like/custom_prompt: use prompt-named character if found, else original.
    const effectiveCharId = (reason === 'no_avatar' && intendedSubjectIds?.length > 0)
      ? intendedSubjectIds[0]
      : (promptNamedCharId || originalCharId);

    if (reason === 'no_avatar' && intendedSubjectIds?.length > 0) {
      console.log(`[regenerateImageWithReason] no_avatar — user-selected intended subjects: ${intendedSubjectIds.join(', ')} | includeUser: ${includeUserSubject}`);
    }

    if (effectiveCharId) {
      const charListUser = await base44.entities.Character.filter({ id: effectiveCharId }, null, 1).catch(() => []);
      let charRecord = charListUser?.[0] || null;

      if (!charRecord) {
        const charListSR = await base44.asServiceRole.entities.Character.filter({ id: effectiveCharId }, null, 1).catch(() => []);
        const candidate = charListSR?.[0] || null;
        if (candidate) {
          const owner = candidate.owner_email;
          if (owner && owner !== requestingUser) {
            console.error(`[regenerateImageWithReason] ⛔ Cross-account: char ${effectiveCharId} owned by ${owner}`);
            return Response.json({ success: false, error: 'Character does not belong to your account.' }, { status: 403 });
          }
          charRecord = candidate;
        }
      }

      if (charRecord) {
        charName = charRecord.name;
        // CRITICAL: Only use reference_image_urls, NOT avatar.
        // Avatar is typically a raw selfie/mirror shot — when passed as a reference, the AI copies its entire visual context
        // (background, pose, props, lighting), causing scene contamination. This is the ROOT CAUSE of "pasted character" failures.
        // If no reference images exist, generate from text description only.
        const refUrls = cdnFilter(charRecord.reference_image_urls || []);
        // CRITICAL: Filter generated images + cap at 2. More refs = more background contamination bleed-through.
        const validRefUrls = refUrls.filter(url => !url.includes('generated_image'));
        charRefs = validRefUrls.slice(0, 2);
        console.log(`[regenerateImageWithReason] Character "${charName}" — identity refs: ${charRefs.length} (max 2, no generated images, no avatar)`);
        
        // Build appearance descriptor for text-based generation — CRITICAL: include appearance_lock traits as immutable truth
        const charDescParts = [
          charRecord.age_range ? `${charRecord.age_range} years old` : null,
          charRecord.gender,
          charRecord.ethnicities?.length > 0 ? charRecord.ethnicities.join('/') + ' ethnicity' : null,
          charRecord.appearance_lock?.skin_tone ? `${charRecord.appearance_lock.skin_tone} skin tone` : null,
          charRecord.appearance_lock?.hairstyle ? `${charRecord.appearance_lock.hairstyle} hairstyle` : null,
          charRecord.appearance_lock?.hair_type ? `${charRecord.appearance_lock.hair_type} hair` : null,
          charRecord.appearance_lock?.facial_hair ? `${charRecord.appearance_lock.facial_hair}` : null,
          charRecord.appearance_notes || null,
          charRecord.avatar_description_text || null,
        ].filter(Boolean);
        // Wire charDesc to outer scope so buildRegenPrompt can use it for text-only identity lock
        charDesc = charDescParts.join(', ');
        console.log(`[regenerateImageWithReason] charDesc built: "${charDesc.substring(0, 120)}"`);

        // ── OUTFIT INJECTION — only when prompt doesn't already specify clothing ──
        // For 'no_avatar' and 'flawed' reasons, the prompt is the stored original.
        // For 'dont_like' / 'custom_prompt', the user may have described clothing.
        // Either way: if prompt has explicit clothing description, skip closet.
        const regenPromptForClothingCheck = reason === 'dont_like' || reason === 'custom_prompt'
          ? (customPrompt || originalPrompt || '')
          : (originalPrompt || '');
        const regenPromptHasClothing = /\b(wearing|dressed|clothed|outfit|shirt|pants|shorts|dress|jacket|coat|sweater|t[- ]?shirt|shoes|hat|cap|snapback|hoodie|jeans|skirt|blouse|suit|tie|scarf|vest)\b/i.test(regenPromptForClothingCheck);
        if (!regenPromptHasClothing) {
          const outfitText = resolveOutfitTextFromCharacterRegen(charRecord);
          if (outfitText) {
            charDesc = charDesc ? `${charDesc}. Currently wearing: ${outfitText}` : `Currently wearing: ${outfitText}`;
            console.log(`[regenerateImageWithReason] Outfit resolved from closet: "${outfitText.substring(0, 80)}"`);
          }
        } else {
          console.log(`[regenerateImageWithReason] Prompt specifies clothing — closet outfit skipped`);
        }
      }

      // Fallback: use refs stored in generation_context (which should also be reference images only, not avatar)
      if (charRefs.length === 0 && ctx.character_reference_images?.length > 0) {
        charRefs = cdnFilter(ctx.character_reference_images).slice(0, 3);
        console.log(`[regenerateImageWithReason] Using stored charRefs: ${charRefs.length}`);
      }

      // For dont_like / custom_prompt / flawed: use avatar as controlled fallback when no reference_image_urls exist.
      // The user expects the correct face to appear — avatar is better than generating a random person.
      // Avatar is stripped of background contamination by the face-only extraction instructions in the prompt.
      if (charRefs.length === 0 && (reason === 'dont_like' || reason === 'custom_prompt' || reason === 'flawed')) {
        const charRecordForAvatar = (await base44.asServiceRole.entities.Character.filter({ id: effectiveCharId }, null, 1).catch(() => []))?.[0];
        if (charRecordForAvatar?.avatar_url) {
          const avatarPublic = toPublicCDN(charRecordForAvatar.avatar_url);
          if (isAccessible(avatarPublic) && !avatarPublic.includes('generated_image')) {
            charRefs = [avatarPublic];
            console.log(`[regenerateImageWithReason] Avatar fallback for dont_like/flawed: using avatar_url for "${charName}" (face-only extraction enforced in prompt)`);
          }
        }
      }

      if (charRefs.length === 0) {
        console.log(`[regenerateImageWithReason] ℹ️ No reference images for "${charName}" — generating from text description only`);
      }
    }

    // ── 2b. RESOLVE USER IDENTITY REFS ───────────────────────────────────────
    let userRefs = [];
    const needsUserRefs = ctx.subject_type === 'user' || ctx.subject_type === 'joint' || (reason === 'no_avatar' && includeUserSubject);
    if (needsUserRefs) {
      // Use user refs from generation_context (the ORIGINAL saved refs)
      if (ctx.user_reference_images?.length > 0) {
        userRefs = cdnFilter(ctx.user_reference_images).slice(0, 3);
        console.log(`[regenerateImageWithReason] Using saved user refs from context: ${userRefs.length}`);
      }
      // If no saved refs, try fetching from UserSettings
      if (userRefs.length === 0) {
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: requestingUser }, null, 1).catch(() => []);
        const sett = settingsList?.[0] || {};
        const dbUserRefs = [...(sett.reference_image_urls || []), ...(sett.generated_avatar_urls || [])];
        userRefs = cdnFilter(dbUserRefs).slice(0, 3);
        if (userRefs.length > 0) console.log(`[regenerateImageWithReason] User refs fetched from UserSettings: ${userRefs.length}`);
      }
      // CRITICAL FALLBACK: If all UserSettings sources are empty, check the world-self Character avatar_url.
      // This is the same image displayed in the Media Grid selector — if the UI shows it, the generator must use it.
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
              console.log(`[regenerateImageWithReason] User identity fallback: world-self Character avatar_url used (matches selector display)`);
            }
          }
        } catch (fallbackErr) {
          console.warn(`[regenerateImageWithReason] World-self Character fallback lookup failed: ${fallbackErr?.message}`);
        }
      }
    }

    // ── CLASSIFICATION-FIRST SANITIZER ────────────────────────────────────────
    // SYNC NOTE: This sanitizer logic is intentionally identical to the one in
    // generateImageAsync. Since Deno functions cannot share local imports, both
    // functions inline this code. If you change one, you MUST change the other.
    // The authoritative copy lives in generateImageAsync (classifySceneContext +
    // sanitizePrompt). Any drift between the two is a bug.

    function classifySceneContext(p) {
      const lower = p.toLowerCase();
      const explicitSignals = [
        /\bsex(ual)?\b/, /\bporn\b/, /\berotic\b/, /\bgenitals?\b/, /\bpenis\b/, /\bvagina\b/,
        /\bnipples?\b/, /\bsexually\b/, /\barouse[d]?\b/, /\borgasm\b/, /\bintercourse\b/,
        /\bprivate parts?\b/, /\bexplicit(ly)?\b/, /\bsuggestive pose\b/, /\bseductive\b/,
        /\bsex act\b/, /\bsexualize[d]?\b/,
      ];
      const isExplicit = explicitSignals.some(r => r.test(lower));
      const isSleepContext = /\b(sleep(ing)?|asleep|woke up|waking up|bed|bedroom|lying|laid down|resting|nap(ping)?|pillow|duvet|blanket|sheets?)\b/.test(lower);
      const isComfortContext = /\b(comfort(ing)?|support(ing|ive)?|emotional|vulnerable|safe|holding|hugging|close|beside|next to|shoulder|arms? around|snuggle|cuddle|warm|peaceful|quiet moment|calming|soothing|affection(ate)?|tender(ness)?|intimate|love)\b/.test(lower);
      const isLifestyleContext = /\b(beach|gym|workout|fitness|pool|vacation|home|apartment|mirror|selfie|casual|morning|routine|everyday|relaxing|chill(ing)?|hanging out)\b/.test(lower);
      const isNonSexualBodyContext = /\b(no shirt|without (a )?shirt|shirtless|without (a )?top|no top)\b/.test(lower) && !isExplicit;
      if (isExplicit) return 'explicit';
      if (isSleepContext && isComfortContext) return 'emotional_comfort';
      if (isSleepContext) return 'sleep_lifestyle';
      if (isComfortContext) return 'comfort';
      if (isLifestyleContext) return 'lifestyle';
      if (isNonSexualBodyContext) return 'casual_body';
      return 'neutral';
    }

    function sanitizeImagePrompt(p) {
      if (!p) return p;
      let s = p.replace(/^\[CHARACTER\]\s*/i, '').trim();
      const sceneClass = classifySceneContext(s);
      console.log(`[regenerateImageWithReason] Scene classification: "${sceneClass}"`);

      const isSafeScene = ['emotional_comfort', 'sleep_lifestyle', 'comfort', 'lifestyle', 'casual_body', 'neutral'].includes(sceneClass);

      if (isSafeScene) {
        // Only replace genuinely explicit anatomy/act terms — preserve safe lifestyle/comfort wording
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
        return s.trim();
      }

      // Explicit scenes: full sanitization pipeline
      s = s.replace(/\bshirtless\b/gi, 'with no shirt on');
      s = s.replace(/\btopless\b/gi, 'with no shirt on');
      s = s.replace(/\bbarechested\b/gi, 'with no shirt on');
      s = s.replace(/\bbare[- ]?chest(ed)?\b/gi, 'with no shirt on');
      // NOTE: "underwear", "boxers", "briefs" are NOT rewritten even in explicit scenes.
      // Underwear is ordinary clothing and must be evaluated by full scene context, not as an isolated word.
      // Only rewrite if the scene is sexually focused on the underwear itself (handled by explicit signals above).
      s = s.replace(/\bin lingerie\b/gi, 'in comfortable sleepwear');
      s = s.replace(/\blingerie\b/gi, 'sleepwear');
      s = s.replace(/\bin a bra( and panties)?\b/gi, 'getting dressed at home');
      s = s.replace(/\bpanties\b/gi, 'underwear');
      s = s.replace(/\bthong\b/gi, 'underwear');
      s = s.replace(/\bexposed (chest|abs|torso|stomach|midriff)\b/gi, 'no shirt on');
      s = s.replace(/\b(his|her|their) (bare )?(chest|abs|torso)\b/gi, '$1 relaxed build');
      s = s.replace(/\bnaked\b/gi, 'not fully dressed');
      s = s.replace(/\bnude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully nude\b/gi, 'not fully dressed');
      s = s.replace(/\bfully naked\b/gi, 'not fully dressed');
      return s.trim();
    }

    // scenePromptRaw was declared above before the prompt-name scan — no re-declaration here.

    // Apply sanitizer — uses the context-aware minimal-rewrite logic defined above.
    // For no_avatar / flawed / wrong_location: the prompt is the stored original — only
    // genuinely explicit terms are replaced. Lifestyle/comfort wording is preserved.
    const scenePrompt = sanitizeImagePrompt(scenePromptRaw);
    if (scenePrompt !== scenePromptRaw) {
      console.log(`[regenerateImageWithReason] ⚠️ PROMPT MUTATION DETECTED:`);
      console.log(`  BEFORE: ${scenePromptRaw}`);
      console.log(`  AFTER:  ${scenePrompt}`);
    } else {
      console.log(`[regenerateImageWithReason] ✓ Prompt passed sanitizer unchanged`);
    }

    // ── 3b. RESOLVE ENVIRONMENT REFS ─────────────────────────────────────────
    let envRefs = [];
    let resolvedLocationName = originalLocName;
    let resolvedZoneName = originalZoneName;

    // ── LOCATION NAME SCANNER (dont_like / custom_prompt only) ───────────────
    // When the user edits the prompt for "dont_like" or writes a "custom_prompt",
    // they may mention a different or specific location (e.g. "at the park", "in her kitchen").
    // 1. Scan the new scene prompt for location name matches against saved LocationReference records.
    // 2. If a match is found on the user's account, override the environment refs with that location's photos.
    // 3. This ensures the correct reference photos are used whenever a known location is mentioned.
    let promptOverrideLocationId = null;
    let promptOverrideLocationRecord = null;

    if ((reason === 'dont_like' || reason === 'custom_prompt') && scenePromptRaw) {
      try {
        // Fetch all locations for this user (scoped by owner_email)
        const allUserLocs = await base44.asServiceRole.entities.LocationReference.filter(
          { owner_email: requestingUser }, null, 100
        ).catch(() => []);

        if (allUserLocs.length > 0) {
          const promptLowerScan = scenePromptRaw.toLowerCase();
          // Find the longest-name match first (most specific) to avoid false positives
          const sortedLocs = [...allUserLocs].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0));
          for (const loc of sortedLocs) {
            if (!loc.name) continue;
            const locNameLower = loc.name.toLowerCase();
            // Match if the prompt contains the location name as a word boundary (not just substring)
            if (promptLowerScan.includes(locNameLower)) {
              promptOverrideLocationRecord = loc;
              promptOverrideLocationId = loc.id;
              console.log(`[regenerateImageWithReason] ✅ Prompt location match: "${loc.name}" (id=${loc.id}) found in edited prompt`);
              break;
            }
          }

          if (!promptOverrideLocationId) {
            console.log(`[regenerateImageWithReason] No location name match found in edited prompt — will use original location`);
          }
        }
      } catch (locScanErr) {
        console.warn(`[regenerateImageWithReason] Location name scan failed (non-blocking): ${locScanErr?.message}`);
      }
    }

    if (reason === 'wrong_location' && manualLocationId) {
      // USER SELECTED A NEW LOCATION — use it as the new environment
      if (directLocationImages?.length > 0) {
        // UI already resolved the zone images — use directly
        envRefs = cdnFilter(directLocationImages).slice(0, 4);
        resolvedZoneName = directZoneName || manualZoneId || null;
        resolvedLocationName = directLocationName || null;
        console.log(`[regenerateImageWithReason] wrong_location: using direct zone images — ${envRefs.length} refs`);
      } else {
        // Fetch location from DB
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: manualLocationId }, null, 1).catch(() => []);
        const locRecord = locListSR?.[0] || null;

        if (locRecord) {
          const locOwner = locRecord.owner_email;
          const isShared = locRecord.scope === 'shared' || locRecord.location_type === 'shared';
          if (locOwner && locOwner !== requestingUser && !isShared) {
            return Response.json({ success: false, error: 'Location does not belong to your account.' }, { status: 403 });
          }
          resolvedLocationName = locRecord.name;
          const { images, zoneName } = resolveZoneFromLocation(locRecord, originalPrompt.toLowerCase());
          envRefs = images;
          resolvedZoneName = manualZoneId || zoneName;
          console.log(`[regenerateImageWithReason] wrong_location DB: "${locRecord.name}" → zone "${resolvedZoneName}" → ${envRefs.length} refs`);
        }
      }

      if (envRefs.length === 0) {
        return Response.json({
          success: false,
          error: `The selected location "${resolvedLocationName || 'location'}" has no zone photos. Add photos to a zone first.`,
        }, { status: 422 });
      }

    } else {
      // ALL OTHER REASONS — resolve environment refs.
      // Priority for dont_like / custom_prompt:
      //   1. Location named in the edited prompt (promptOverrideLocationRecord) — highest priority
      //   2. Original location from generation_context (originalLocId)
      //   3. Stored refs from context as last resort

      const effectiveLocRecord = promptOverrideLocationRecord || null;
      const effectiveLocId = promptOverrideLocationId || originalLocId;

      if (effectiveLocRecord) {
        // Prompt explicitly mentioned a known saved location — use its reference photos
        const { images, zoneName } = resolveZoneFromLocation(effectiveLocRecord, scenePrompt.toLowerCase(), null);
        envRefs = images;
        resolvedLocationName = effectiveLocRecord.name;
        resolvedZoneName = zoneName;
        console.log(`[regenerateImageWithReason] Prompt-detected location override: "${effectiveLocRecord.name}" → zone "${zoneName}" → ${envRefs.length} refs`);
      } else if (effectiveLocId) {
        // No prompt override — re-fetch original location fresh from DB
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: effectiveLocId }, null, 1).catch(() => []);
        const locRecord = locListSR?.[0] || null;
        if (locRecord) {
          const { images, zoneName } = resolveZoneFromLocation(locRecord, scenePrompt.toLowerCase(), originalZoneName);
          envRefs = images;
          resolvedZoneName = zoneName || originalZoneName;
          console.log(`[regenerateImageWithReason] Fresh DB fetch: "${locRecord.name}" → zone "${resolvedZoneName}" → ${envRefs.length} refs`);
        }
      }

      // Only fall back to stored refs if DB fetch returned nothing (location deleted/inaccessible)
      if (envRefs.length === 0 && originalLocRefs.length > 0) {
        envRefs = cdnFilter(originalLocRefs).slice(0, 4);
        console.log(`[regenerateImageWithReason] Fallback to stored location refs: ${envRefs.length}`);
      }
    }

    // ── 5. ASSEMBLE REFS — env first, then identity ───────────────────────────
    const ENV_SLOTS  = Math.min(envRefs.length, 4);
    const CHAR_SLOTS = Math.min(charRefs.length, 3);
    const USER_SLOTS = Math.min(userRefs.length, 3);
    const needsUserRefsForRegen = needsUserRefs; // already resolved above

    const referenceImages = [
      ...envRefs.slice(0, ENV_SLOTS),
      ...charRefs.slice(0, CHAR_SLOTS),
      ...userRefs.slice(0, USER_SLOTS),
    ].filter(Boolean);

    console.log(`[regenerateImageWithReason] DISPATCH: env=${ENV_SLOTS} char=${CHAR_SLOTS} user=${USER_SLOTS} total=${referenceImages.length} | reason=${reason} | includeUser=${!!includeUserSubject}`);

    // ── 6. BUILD PROMPT ───────────────────────────────────────────────────────
    const finalPrompt = buildRegenPrompt({
      scenePrompt,
      charName,
      charDesc,
      locationName: resolvedLocationName,
      zoneName: resolvedZoneName,
      envRefs: envRefs.slice(0, ENV_SLOTS),
      charRefs: charRefs.slice(0, CHAR_SLOTS),
      userRefs: userRefs.slice(0, USER_SLOTS),
      includeUser: needsUserRefsForRegen && USER_SLOTS > 0,
      reason,
    });

    // ── 7. CAMERA ENFORCEMENT — INLINED HELPERS ───────────────────────────────
    // Cannot import local lib in Deno — inline camera validation logic
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
      if (!prev || !next) return 5;
      let diffs = 0;
      if (prev.distance !== next.distance) diffs++;
      if (prev.angle !== next.angle) diffs++;
      if (prev.height !== next.height) diffs++;
      if (prev.framing !== next.framing) diffs++;
      if (prev.lens_style !== next.lens_style) diffs++;
      return diffs;
    }

    // Previous camera state from the message's generation context
    const previousCameraVars = ctx.camera_variables || null;

    const CAMERA_FORCE_PRESETS = [
      `\n\n════ MANDATORY CAMERA OVERRIDE (regen validation retry 1) ════\nThe previous image reused the same camera position. You MUST physically move the camera.\nREQUIRED: wide shot from the far corner of the room, camera at LOW angle (below waist height), subject off-center in right third of frame. Strong foreground element in lower-left. Background recedes into depth.\n════════════════════════════════════════════════`,
      `\n\n════ MANDATORY CAMERA OVERRIDE (regen validation retry 2 — ESCALATED) ════\nTwo consecutive generations used the same camera frame. Maximum variation required.\nREQUIRED: OVERHEAD / TOP-DOWN angle, camera directly above subject looking straight down. Subject slightly offset. Full environmental context visible from above. No standard eye-level framing.\nAlternative if overhead not contextually possible: EXTREME LOW ANGLE from floor level, camera tilted sharply upward. Subject fills upper portion of frame.\n════════════════════════════════════════════════`,
    ];

    // ── DISPATCH LOG ─────────────────────────────────────────────────────────
    console.log(`[regenerateImageWithReason] ── PROVIDER DISPATCH ──`);
    console.log(`  reason:           ${reason}`);
    console.log(`  raw prompt:       ${scenePromptRaw.substring(0, 200)}${scenePromptRaw.length > 200 ? '…' : ''}`);
    console.log(`  sanitized prompt: ${scenePrompt.substring(0, 200)}${scenePrompt.length > 200 ? '…' : ''}`);
    console.log(`  char refs: ${CHAR_SLOTS} | env refs: ${ENV_SLOTS} | user refs: ${USER_SLOTS}`);

    // ── 8. GENERATE + VALIDATE LOOP (max 3 attempts) ─────────────────────────
    // For 'no_avatar' (likeness fix): skip camera validation entirely.
    // Camera variation is irrelevant when only correcting face/hair likeness.
    // Running the camera loop on no_avatar causes progressive shot-type escalation
    // across repeated clicks, drifting the scene away from the original.
    const skipCameraValidation = reason === 'no_avatar';

    let genRes = null;
    let acceptedCameraVars = null;
    let attemptPrompt = finalPrompt;
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[regenerateImageWithReason] Attempt ${attempt} — final provider prompt (first 400): ${attemptPrompt.substring(0, 400)}…`);
      let attemptGenRes = null;
      try {
        attemptGenRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: attemptPrompt,
          existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
        });
      } catch (genErr) {
        const msg = (genErr?.message || '').toLowerCase();
        const statusCode = genErr?.status || genErr?.statusCode || genErr?.code || null;

        // Only label as content policy block when the provider explicitly signals it.
        // Real content policy errors use specific phrases — NOT generic network/infra errors.
        const isRealContentPolicyBlock = (
          // Explicit policy violation phrases from providers (OpenAI, Google, etc.)
          msg.includes('content policy') ||
          msg.includes('safety system') ||
          msg.includes('violates our content') ||
          msg.includes('violates our usage') ||
          msg.includes('against our usage policies') ||
          msg.includes('policy violation') ||
          msg.includes('moderation') ||
          msg.includes('safety filter') ||
          msg.includes('flagged by our safety') ||
          msg.includes('cannot generate') && msg.includes('explicit') ||
          // HTTP 400 with specific safety/policy payload (not generic 400s)
          (statusCode === 400 && (msg.includes('safety') || msg.includes('policy') || msg.includes('blocked_by_safety')))
        );

        if (isRealContentPolicyBlock) {
          console.warn(`[regenerateImageWithReason] Content policy block on attempt ${attempt}: ${msg.substring(0, 200)}`);
          return Response.json({ success: false, filtered: true, error: 'Content policy block — the provider rejected this specific image content. Try a different scene description.' });
        }

        // All other errors: classify accurately rather than hiding behind "content filter"
        const isTimeout = msg.includes('timeout') || msg.includes('timed out') || statusCode === 408 || statusCode === 504;
        const isRateLimit = msg.includes('rate limit') || msg.includes('too many requests') || statusCode === 429;
        const isBadPrompt = msg.includes('invalid') && msg.includes('prompt') || msg.includes('prompt too long') || msg.includes('token');
        const isMissingRef = msg.includes('invalid image') || msg.includes('image url') || msg.includes('reference image');

        if (isTimeout) {
          return Response.json({ success: false, error: 'Image provider timeout — the generation took too long. Please try again.' }, { status: 504 });
        }
        if (isRateLimit) {
          return Response.json({ success: false, error: 'Rate limit hit — too many requests. Wait a moment and try again.' }, { status: 429 });
        }
        if (isBadPrompt) {
          return Response.json({ success: false, error: 'Prompt could not be processed — the scene description may be too long or contain unsupported content.' }, { status: 400 });
        }
        if (isMissingRef) {
          return Response.json({ success: false, error: 'Reference image missing or inaccessible — the character or location photo could not be loaded by the provider.' }, { status: 422 });
        }

        // Unknown provider error — log the real message, surface a generic but non-misleading label
        console.error(`[regenerateImageWithReason] Provider error attempt ${attempt}:`, genErr?.message || genErr);
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[regenerateImageWithReason] Retrying after provider error (attempt ${attempt}/${MAX_ATTEMPTS})`);
          continue;
        }
        return Response.json({ success: false, error: `Likeness regeneration failed — the image provider returned an error. Please try again.` }, { status: 500 });
      }

      if (!attemptGenRes?.url) {
        console.warn(`[regenerateImageWithReason] Attempt ${attempt}: no URL returned`);
        continue;
      }

      const thisCameraVars = extractCameraVarsFromPrompt(attemptPrompt);

      // no_avatar: skip camera validation — only likeness is being corrected, preserve scene as-is
      if (skipCameraValidation) {
        console.log(`[regenerateImageWithReason] ✅ no_avatar — camera validation skipped, accepting image`);
        genRes = attemptGenRes;
        acceptedCameraVars = previousCameraVars || thisCameraVars; // preserve existing camera state
        break;
      }

      const diffCount = countCameraDiffs(previousCameraVars, thisCameraVars);
      console.log(`[regenerateImageWithReason] Attempt ${attempt}: camera diffs = ${diffCount} | dist=${thisCameraVars.distance} angle=${thisCameraVars.angle} framing=${thisCameraVars.framing}`);

      if (!previousCameraVars || diffCount >= 2) {
        console.log(`[regenerateImageWithReason] ✅ Camera validation PASSED`);
        genRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
        break;
      }

      console.warn(`[regenerateImageWithReason] ⚠️ Camera FAILED attempt ${attempt}: only ${diffCount} variable(s) changed. Injecting forced override.`);

      if (attempt < MAX_ATTEMPTS) {
        const overrideBlock = CAMERA_FORCE_PRESETS[Math.min(attempt - 1, CAMERA_FORCE_PRESETS.length - 1)];
        attemptPrompt = attemptPrompt + overrideBlock;
      } else {
        console.warn(`[regenerateImageWithReason] ⚠️ Max attempts reached — accepting last image`);
        genRes = attemptGenRes;
        acceptedCameraVars = thisCameraVars;
      }
    }

    if (!genRes?.url) {
      return Response.json({ success: false, error: 'No image URL returned from generator.' }, { status: 500 });
    }

    // ── 9. VERIFY AND SAVE — only after validation passed ────────────────────
    const targetMsg = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!targetMsg || targetMsg.id !== messageId) {
      console.error(`[regenerateImageWithReason] ⛔ ID mismatch: requested=${messageId} got=${targetMsg?.id}`);
      return Response.json({ success: false, error: 'Message ID mismatch — aborting write.' }, { status: 400 });
    }

    // Persist updated camera variables so the NEXT regeneration can compare against this one
    const updatedContext = {
      ...(ctx || {}),
      camera_variables: acceptedCameraVars,
    };

    await base44.asServiceRole.entities.Message.update(messageId, {
      image_url: genRes.url,
      generation_context: updatedContext,
    });

    console.log(`[regenerateImageWithReason] ✓ SUCCESS: ${messageId} | camera: ${acceptedCameraVars?.distance} ${acceptedCameraVars?.angle}`);

    return Response.json({
      success: true,
      image_url: genRes.url,
      messageId,
      reason,
      cameraVariables: acceptedCameraVars,
    });

  } catch (error) {
    // CRITICAL: Always produce a string message — never return undefined/null as error
    // error.message may be undefined for non-Error throws (plain objects, network errors, etc.)
    const safeMsg = (typeof error?.message === 'string' && error.message)
      ? error.message
      : (typeof error === 'string' ? error : 'An unexpected error occurred in regeneration. Check backend logs for details.');
    console.error('[regenerateImageWithReason] Fatal error:', safeMsg);
    console.error('[regenerateImageWithReason] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error || {})));
    return Response.json({ success: false, error: safeMsg }, { status: 500 });
  }
});