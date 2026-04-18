import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// subjectType: "character" | "user" | "joint"

// ── ZONE KEYWORD MAP ──────────────────────────────────────────────────────────
const ZONE_KEYWORD_MAP = [
  { keywords: ["living room", "lounge", "couch", "sofa", "sectional", "tv room", "family room"], zone: "living room" },
  { keywords: ["kitchen", "cooking", "stove", "fridge", "counter", "microwave", "sink", "oven"], zone: "kitchen" },
  { keywords: ["bedroom", "bed", "sleeping", "nightstand", "dresser", "closet", "pillow", "duvet", "mattress"], zone: "bedroom" },
  { keywords: ["bathroom", "shower", "bathtub", "toilet", "vanity", "sink", "towel rack"], zone: "bathroom" },
  { keywords: ["dining room", "dining table", "dinner table", "eating"], zone: "dining room" },
  { keywords: ["hallway", "corridor", "entryway", "front door", "foyer"], zone: "hallway" },
  { keywords: ["backyard", "patio", "deck", "garden", "yard", "outside", "grill", "fire pit", "pool outside"], zone: "backyard" },
  { keywords: ["garage", "car", "parking"], zone: "garage" },
  { keywords: ["basement", "downstairs"], zone: "basement" },
  { keywords: ["office", "desk", "workspace", "home office", "work from home"], zone: "office" },
  { keywords: ["workout floor", "weights", "weight room", "dumbbell", "barbell", "squat rack", "bench press"], zone: "weight" },
  { keywords: ["treadmill", "cardio", "elliptical", "bike", "rowing"], zone: "cardio" },
  { keywords: ["locker room", "changing room", "showers"], zone: "locker" },
  { keywords: ["pool area", "swimming pool"], zone: "pool" },
  { keywords: ["sauna", "steam room"], zone: "sauna" },
  { keywords: ["vip section", "vip area", "vip booth", "vip lounge", "the vip"], zone: "vip" },
  { keywords: ["main floor", "dance floor", "dancefloor", "general floor"], zone: "main floor" },
  { keywords: ["behind the bar", "bar area", "bartending", "bar counter", "bar top"], zone: "bar area" },
  { keywords: ["rooftop", "roof deck", "roof bar", "rooftop bar"], zone: "rooftop" },
  { keywords: ["patio", "outdoor area", "outdoor seating", "outdoor patio"], zone: "patio" },
  { keywords: ["entrance", "lobby", "foyer", "entry"], zone: "entrance" },
  { keywords: ["break room", "lunch room", "breakroom"], zone: "break room" },
  { keywords: ["conference room", "meeting room", "boardroom"], zone: "conference" },
  { keywords: ["waiting room", "waiting area", "reception"], zone: "waiting" },
  { keywords: ["patient room", "patient bed", "hospital room", "hospital bed"], zone: "patient" },
  { keywords: ["operating room", "or ", "surgery"], zone: "operating" },
  { keywords: ["recovery room", "recovery area"], zone: "recovery" },
  { keywords: ["classroom", "class", "lecture hall"], zone: "classroom" },
  { keywords: ["cafeteria", "school lunch", "lunch room"], zone: "cafeteria" },
  { keywords: ["library", "study hall"], zone: "library" },
];

const POSSESSIVE_ZONE_MAP = [
  { pattern: /\bhis bed\b|\bher bed\b|\btheir bed\b|\bown bed\b/, zone: "bedroom", category: "home" },
  { pattern: /\bhis couch\b|\bher couch\b|\bhis sofa\b|\bher sofa\b|\btheir couch\b/, zone: "living room", category: "home" },
  { pattern: /\bhis (apartment|place|home|house|room|flat)\b|\bher (apartment|place|home|house|room|flat)\b/, zone: null, category: "home" },
  { pattern: /\bhis kitchen\b|\bher kitchen\b|\btheir kitchen\b/, zone: "kitchen", category: "home" },
  { pattern: /\bhis backyard\b|\bher backyard\b|\btheir backyard\b|\bhis patio\b|\bher patio\b/, zone: "backyard", category: "home" },
  { pattern: /\bhis bathroom\b|\bher bathroom\b|\btheir bathroom\b/, zone: "bathroom", category: "home" },
  { pattern: /\bhis office\b|\bher office\b|\btheir office\b|\bdesk at (home|his|her)\b/, zone: "office", category: "home" },
  { pattern: /\bhis bedroom\b|\bher bedroom\b|\btheir bedroom\b/, zone: "bedroom", category: "home" },
  { pattern: /\bhis living room\b|\bher living room\b|\btheir living room\b/, zone: "living room", category: "home" },
];

function zoneMatchScore(zoneName, targetZoneFragment) {
  const zn = zoneName.toLowerCase();
  const tf = targetZoneFragment.toLowerCase();
  if (zn === tf) return 100;
  if (zn.includes(tf)) return 80;
  if (tf.includes(zn)) return 60;
  const znWords = zn.split(/\s+/);
  const tfWords = tf.split(/\s+/);
  const overlap = znWords.filter(w => tfWords.some(t => t.includes(w) || w.includes(t))).length;
  if (overlap > 0) return 30 + overlap * 10;
  return 0;
}

function resolveZoneImages(promptLower, location, forcedZoneHint = null) {
  const zones = (location.zones || []).filter(z => z.image_urls?.length > 0);
  const MAX = 6;
  if (zones.length === 0) {
    return { zoneImages: (location.image_urls || []).slice(0, MAX), zoneName: null, matchType: "location_flat" };
  }
  const hint = forcedZoneHint?.toLowerCase() || null;
  for (const zone of zones) {
    if (promptLower.includes(zone.zone_name.toLowerCase())) {
      return { zoneImages: zone.image_urls.slice(0, MAX), zoneName: zone.zone_name, matchType: "exact_zone_name" };
    }
  }
  if (hint) {
    let bestZone = null, bestScore = 0;
    for (const zone of zones) {
      const score = zoneMatchScore(zone.zone_name, hint);
      if (score > bestScore) { bestScore = score; bestZone = zone; }
    }
    if (bestZone && bestScore >= 30) {
      const allMatchingZones = zones.filter(z => zoneMatchScore(z.zone_name, hint) >= 30);
      const combined = allMatchingZones.flatMap(z => z.image_urls || []).slice(0, MAX);
      return { zoneImages: combined, zoneName: bestZone.zone_name, matchType: "zone_keyword" };
    }
  }
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      let bestZone = null, bestScore = 0;
      for (const zone of zones) {
        const score = zoneMatchScore(zone.zone_name, entry.zone);
        if (score > bestScore) { bestScore = score; bestZone = zone; }
      }
      if (bestZone && bestScore >= 30) {
        const allMatchingZones = zones.filter(z => zoneMatchScore(z.zone_name, entry.zone) >= 30);
        const combined = allMatchingZones.flatMap(z => z.image_urls || []).slice(0, MAX);
        return { zoneImages: combined, zoneName: bestZone.zone_name, matchType: "zone_keyword" };
      }
    }
  }
  const first = zones[0];
  return { zoneImages: first.image_urls.slice(0, MAX), zoneName: first.zone_name, matchType: "first_zone" };
}

function locationNameScore(locNameRaw, promptLower) {
  const locName = locNameRaw.toLowerCase().trim();
  if (promptLower.includes(locName)) return 1.0;
  if (locName.includes(promptLower.split(' ').find(w => w.length >= 4 && locName.includes(w)) || '')) {
    const promptWords = promptLower.split(/\s+/).filter(w => w.length >= 4);
    for (const w of promptWords) { if (locName.includes(w)) return 0.9; }
  }
  if (promptLower.includes(locName + 's') || promptLower.includes(locName.replace(/s$/, ''))) return 0.95;
  const locNameNoS = locName.endsWith('s') ? locName.slice(0, -1) : locName + 's';
  if (promptLower.includes(locNameNoS)) return 0.95;
  const locWords = locName.split(/\s+/).filter(w => w.length >= 3);
  if (locWords.length > 0) {
    const allMatch = locWords.every(w => promptLower.includes(w));
    if (allMatch) return 0.85;
    const matchCount = locWords.filter(w => promptLower.includes(w)).length;
    if (matchCount > 0) return 0.5 + (matchCount / locWords.length) * 0.3;
  }
  const promptTokens = promptLower.split(/\s+/).filter(w => w.length >= 4);
  for (const token of promptTokens) {
    const shorter = token.length < locName.length ? token : locName;
    const longer = token.length >= locName.length ? token : locName;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) { if (longer.includes(shorter[i])) matches++; }
    const ratio = matches / longer.length;
    if (ratio >= 0.8 && Math.abs(token.length - locName.length) <= 3) return 0.75;
  }
  return 0.0;
}

function getDefaultZoneHint(category) {
  const defaults = { social: "main floor", home: "living room", gym: "workout floor", workplace: "office", food_drink: "main area", medical: "waiting", education: "classroom" };
  return defaults[category] || null;
}

function resolveLocationAndZone(prompt, locations, characterId) {
  if (!prompt || !locations || locations.length === 0) {
    return { locationImages: [], locationName: null, zoneName: null, matchConfidence: "none", confidenceScore: 0 };
  }
  const pl = prompt.toLowerCase();
  const characterLocations = characterId ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId) : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');
  const ordered = [...characterLocations, ...globalLocations];
  let possessiveZoneHint = null, possessiveCategoryHint = null;
  for (const entry of POSSESSIVE_ZONE_MAP) {
    if (entry.pattern.test(pl)) { possessiveZoneHint = entry.zone; possessiveCategoryHint = entry.category; break; }
  }
  let bestLoc = null, bestScore = 0.0;
  for (const loc of ordered) {
    const score = locationNameScore(loc.name, pl);
    if (score > bestScore) { bestScore = score; bestLoc = loc; }
  }
  if (bestLoc && bestScore >= 0.7) {
    const zoneHint = possessiveZoneHint || getDefaultZoneHint(bestLoc.category);
    const { zoneImages, zoneName, matchType } = resolveZoneImages(pl, bestLoc, zoneHint);
    const confidence = bestScore >= 0.9 ? "high" : "medium";
    return { locationImages: zoneImages, locationName: bestLoc.name, zoneName, matchConfidence: confidence, confidenceScore: bestScore };
  }
  for (const loc of ordered) {
    if (loc.keywords?.some(kw => kw && pl.includes(kw.toLowerCase()))) {
      const zoneHint = possessiveZoneHint || getDefaultZoneHint(loc.category);
      const { zoneImages, zoneName, matchType } = resolveZoneImages(pl, loc, zoneHint);
      return { locationImages: zoneImages, locationName: loc.name, zoneName, matchConfidence: matchType === "exact_zone_name" ? "high" : "medium", confidenceScore: 0.8 };
    }
  }
  if (possessiveCategoryHint) {
    const catLoc = ordered.find(l => l.category === possessiveCategoryHint);
    if (catLoc) {
      const zoneHint = possessiveZoneHint || getDefaultZoneHint(catLoc.category);
      const { zoneImages, zoneName } = resolveZoneImages(pl, catLoc, zoneHint);
      return { locationImages: zoneImages, locationName: catLoc.name, zoneName, matchConfidence: "medium", confidenceScore: 0.75 };
    }
  }
  const categoryKeywords = {
    home: ['home', 'apartment', 'house', 'place', 'flat', 'living room', 'bedroom', 'kitchen', 'bathroom', 'backyard', 'couch', 'bed', 'sofa'],
    gym: ['gym', 'workout', 'weights', 'treadmill', 'locker room', 'fitness', 'lifting'],
    workplace: ['work', 'office', 'job', 'workplace', 'store', 'shop', 'at work'],
    social: ['bar', 'club', 'nightclub', 'party', 'lounge', 'vip', 'dance floor'],
    outdoor: ['park', 'trail', 'outside', 'outdoors', 'nature', 'street'],
    food_drink: ['coffee', 'cafe', 'restaurant', 'diner', 'brunch'],
    medical: ['hospital', 'clinic', 'doctor', 'waiting room', 'patient'],
    education: ['school', 'class', 'college', 'campus', 'library'],
  };
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => pl.includes(kw))) {
      const catLoc = ordered.find(l => l.category === cat);
      if (catLoc) {
        const zoneHint = possessiveZoneHint || getDefaultZoneHint(cat);
        const { zoneImages, zoneName } = resolveZoneImages(pl, catLoc, zoneHint);
        if (zoneImages.length > 0) return { locationImages: zoneImages, locationName: catLoc.name, zoneName, matchConfidence: "low", confidenceScore: 0.5 };
      }
    }
  }
  return { locationImages: [], locationName: null, zoneName: null, matchConfidence: "none", confidenceScore: 0 };
}

function buildRoomLockNote(locationName, zoneName) {
  const placeLabel = [locationName, zoneName].filter(Boolean).join(' → ');
  return `

════════════════════════════════════════════════════════════
ENVIRONMENT IDENTITY LOCK: ${placeLabel}
THIS IS A MANDATORY ARCHITECTURAL CONSTRAINT — NOT A SUGGESTION
════════════════════════════════════════════════════════════
The reference images provided are NOT inspiration, NOT mood boards, NOT style guides.
They are the GROUND TRUTH photographs of this specific ${zoneName || 'space'}.
${locationName ? `Location: ${locationName}` : ''}${zoneName ? `\nZone: ${zoneName}` : ''}

YOU ARE GENERATING A NEW PHOTOGRAPH OF THE EXACT SAME ROOM/SPACE FROM A DIFFERENT ANGLE.
Not a similar room. Not a reimagined version. The IDENTICAL space.

WHAT IS LOCKED — ZERO EXCEPTIONS:
────────────────────────────────────
ZONE INTEGRITY: You are working within the "${zoneName || 'matched area'}" zone only. Do NOT blend elements from other zones or rooms within this location.
FLOORING: Exact material, species, color, plank direction, tile pattern, grout lines, carpet pile, and finish.
WALLS: Exact paint color, sheen level, any wallpaper, wainscoting, baseboard trim color, crown molding profile, and accent walls.
FURNITURE: Each furniture item must match in exact shape, proportions, style, color, fabric, and material. Do NOT add, remove, substitute, or restyle ANY furniture.
SPATIAL RELATIONSHIPS ARE LOCKED: couch position, bed position, dresser position, table position.
FABRICS & UPHOLSTERY: Exact texture, weave, pattern, and color of every cushion, throw pillow, blanket, curtain, rug, and chair cover.
WINDOW TREATMENTS: Curtains, blinds, shades, shutters — same fabric, color, length, fullness, rod/track hardware.
WALL ART & MOUNTED OBJECTS: Every framed photo, painting, mirror, clock, and wall-mounted object must appear in the same wall position.
LIGHTING FIXTURES: All ceiling fixtures, pendants, floor lamps, table lamps, and sconces must match in style, position, and light temperature.
DECORATIVE OBJECTS: Every plant, vase, sculpture, candle, tray, remote, throw blanket must be present and in place.
SPATIAL PROPORTIONS: Room dimensions, ceiling height, window size, window placement, door positions.

CHARACTER PLACEMENT: Place subjects only in spots where a person could physically be. Do NOT block doors, stand inside furniture, or clip through walls.

PERMITTED CHANGES:
✓ Camera angle, framing, zoom, and perspective
✓ Subject pose, position, expression, and action
✓ Time of day / lighting conditions ONLY IF explicitly requested

PROHIBITED CHANGES:
✗ Furniture style, color, shape, or placement
✗ Floor material or color
✗ Wall color or finish
✗ Room layout or aesthetic
✗ Adding or removing any room-defining element

CRITICAL RULE: "Same room different angle" means ONLY the camera moves. Nothing else changes.
CRITICAL RULE: Do NOT fall back to generic generation. If reference images exist, they are the source of truth.
════════════════════════════════════════════════════════════`;
}

// ── SUBJECT RECORD BUILDERS ──────────────────────────────────────────────────
// These functions build structured subject objects from raw data.
// Images and prompts are assembled FROM these records — never the other way around.

function buildCharacterSubject(charRecord, clientRefs = []) {
  const serverRefs = [];
  if (charRecord.avatar_url) serverRefs.push(charRecord.avatar_url);
  if (charRecord.reference_image_urls?.length > 0) serverRefs.push(...charRecord.reference_image_urls);
  // Always use server-side refs as authoritative; client refs are fallback only
  const faceRefs = serverRefs.length > 0 ? serverRefs : clientRefs;

  // Resolve current outfit
  const currentOutfit = charRecord.current_outfit;
  const closet = charRecord.character_closet || [];
  const closetOutfits = closet.filter(item => item.type === "outfit" || (!item.piece_type && item.outfit_id));
  let activeOutfit = null;
  if (currentOutfit?.label) {
    activeOutfit = currentOutfit;
  } else if (closetOutfits.length > 0) {
    const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    const isNight = hour >= 21 || hour < 6;
    const isMorning = hour >= 6 && hour < 11;
    if (isNight) {
      activeOutfit = closetOutfits.find(o => o.category === 'sleepwear' || o.category === 'lounge') || closetOutfits[closetOutfits.length - 1];
    } else if (isMorning) {
      activeOutfit = closetOutfits.find(o => o.category === 'daily_casual' || o.category === 'lounge') || closetOutfits[closetOutfits.length - 1];
    } else {
      activeOutfit = closetOutfits.find(o => o.is_favorite) || closetOutfits[closetOutfits.length - 1];
    }
  }
  let outfitDesc = null;
  if (activeOutfit) {
    const parts = [activeOutfit.top, activeOutfit.bottom, activeOutfit.shoes, activeOutfit.outerwear, activeOutfit.accessories].filter(Boolean);
    outfitDesc = activeOutfit.full_description || parts.join(', ') || null;
  }

  // Appearance text
  const appearanceParts = [];
  if (charRecord.appearance_age != null) appearanceParts.push(`appears ${charRecord.appearance_age} years old`);
  else if (charRecord.age_range) appearanceParts.push(charRecord.age_range);
  if (charRecord.gender) appearanceParts.push(charRecord.gender);
  if (charRecord.ethnicities?.length > 0) appearanceParts.push(charRecord.ethnicities.join(', '));
  if (charRecord.appearance_notes) appearanceParts.push(charRecord.appearance_notes);

  // Appearance lock
  const lock = charRecord.appearance_lock || {};
  const lockParts = [];
  if (lock.skin_tone) lockParts.push(`skin tone: ${lock.skin_tone}`);
  if (lock.hair_type) lockParts.push(`hair type: ${lock.hair_type}`);
  if (lock.hairstyle) lockParts.push(`hairstyle: ${lock.hairstyle}`);
  if (lock.facial_hair) lockParts.push(`facial hair: ${lock.facial_hair}`);
  if (lock.makeup) lockParts.push(`makeup: ${lock.makeup}`);
  if (lock.overall_aesthetic) lockParts.push(`overall aesthetic: ${lock.overall_aesthetic}`);
  if (lock.custom_keywords?.length > 0) lockParts.push(lock.custom_keywords.join(', '));

  return {
    subject_type: 'character',
    subject_id: charRecord.id,
    canonical_name: charRecord.name,
    face_refs: faceRefs,           // identity source — DO NOT use for outfit
    outfit_desc: outfitDesc,       // owned by this subject only
    outfit_owner_id: charRecord.id,
    appearance_text: appearanceParts.join(', '),
    lock_text: lockParts.join(' | '),
    ethnicities: charRecord.ethnicities || [],
    explicitly_selected: true,
  };
}

function buildUserSubject(sett, clientRefs = [], worldName = null) {
  // Priority: uploaded reference photos → generated avatars (real face before stylized)
  const uploadedRefs = sett.reference_image_urls || [];
  const generatedRefs = sett.generated_avatar_urls || [];
  const faceRefs = [...uploadedRefs, ...generatedRefs].filter(Boolean);
  const resolvedFaceRefs = faceRefs.length > 0 ? faceRefs : clientRefs;

  const userCurrentOutfit = sett.user_current_outfit;
  let outfitDesc = null;
  if (userCurrentOutfit?.label) {
    const parts = [userCurrentOutfit.top, userCurrentOutfit.bottom, userCurrentOutfit.shoes, userCurrentOutfit.outerwear, userCurrentOutfit.accessories].filter(Boolean);
    outfitDesc = userCurrentOutfit.full_description || parts.join(', ') || null;
  }

  // Appearance lock
  const lock = sett.appearance_lock || {};
  const lockParts = [];
  if (lock.skin_tone) lockParts.push(`skin tone: ${lock.skin_tone}`);
  if (lock.hair_type) lockParts.push(`hair type: ${lock.hair_type}`);
  if (lock.hairstyle) lockParts.push(`hairstyle: ${lock.hairstyle}`);
  if (lock.facial_hair) lockParts.push(`facial hair: ${lock.facial_hair}`);
  if (lock.makeup) lockParts.push(`makeup: ${lock.makeup}`);
  if (lock.overall_aesthetic) lockParts.push(`overall aesthetic: ${lock.overall_aesthetic}`);
  if (lock.custom_keywords?.length > 0) lockParts.push(lock.custom_keywords.join(', '));

  const appearanceParts = [];
  if (sett.user_gender) appearanceParts.push(sett.user_gender);
  if (sett.user_age_range) appearanceParts.push(sett.user_age_range);
  if (sett.appearance_notes) appearanceParts.push(sett.appearance_notes);
  if (sett.ethnicities?.length > 0) appearanceParts.push(sett.ethnicities.join(', '));

  return {
    subject_type: 'user',
    subject_id: 'user',
    canonical_name: worldName || sett.fictional_world_name || 'the user',
    face_refs: resolvedFaceRefs,
    outfit_desc: outfitDesc,
    outfit_owner_id: 'user',
    appearance_text: appearanceParts.join(', '),
    lock_text: lockParts.join(' | '),
    ethnicities: sett.ethnicities || [],
    explicitly_selected: true,
  };
}

// ── SUBJECT DEDUPLICATION ────────────────────────────────────────────────────
// Ensures no subject appears twice. Explicit selection always wins over ambient presence.
function dedupeSubjects(subjects) {
  const map = new Map();
  for (const subject of subjects) {
    const existing = map.get(subject.subject_id);
    if (!existing) {
      map.set(subject.subject_id, subject);
    } else if (subject.explicitly_selected && !existing.explicitly_selected) {
      map.set(subject.subject_id, subject);
    } else if (subject.face_refs.length > existing.face_refs.length) {
      map.set(subject.subject_id, subject);
    }
  }
  return Array.from(map.values());
}

// ── PROMPT BUILDERS FOR LOCKED SUBJECTS ─────────────────────────────────────
function buildSubjectOutfitBlock(subject) {
  if (!subject.outfit_desc) return '';
  const name = subject.canonical_name;
  return `
════════════════════════════════════════════════════════════
OUTFIT LOCK — ${name.toUpperCase()} — ABSOLUTE OVERRIDE — HIGHEST PRIORITY
════════════════════════════════════════════════════════════
${name} IS WEARING THIS AND ONLY THIS:
${subject.outfit_desc}

CRITICAL RULES — NO EXCEPTIONS:
✗ DO NOT use any clothing visible in reference/avatar photos — those are identity sources ONLY
✗ DO NOT invent, substitute, or modify any clothing item
✗ DO NOT apply ${name}'s outfit to any other person
✗ DO NOT apply any other person's outfit to ${name}
✓ Reproduce EVERY listed clothing item EXACTLY as described
✓ This outfit is owned by and belongs exclusively to ${name}
════════════════════════════════════════════════════════════`;
}

function buildSubjectIdentityBlock(subject, imageIndexStart, imageIndexEnd) {
  const name = subject.canonical_name;
  const lockDesc = subject.lock_text ? `Appearance lock (FIXED — never change): ${subject.lock_text}.` : '';
  const ethnicityWarning = subject.ethnicities?.length > 0
    ? `⚠️ ETHNICITY LOCK: ${name}'s ethnicity is "${subject.ethnicities.join(', ')}". You MUST NOT default to Caucasian or European features. Skin tone, facial structure, hair texture MUST authentically reflect this background.`
    : `⚠️ Do NOT default to Caucasian features. Use reference images to accurately determine ${name}'s appearance.`;

  return `
════════════════════════════════════════════════════════════
IDENTITY LOCK — ${name.toUpperCase()} (Images ${imageIndexStart}–${imageIndexEnd})
════════════════════════════════════════════════════════════
Subject: ${name} | Type: ${subject.subject_type}
Reference images ${imageIndexStart}–${imageIndexEnd} ARE this person's face and body. They are the GROUND TRUTH.

LOCKED AT 100% — NO DEVIATION:
• Face shape: IDENTICAL — bone structure, jaw, cheekbones, forehead
• Facial features: Eyes (shape, color, distance), nose (shape, size), lips — EXACT MATCH
• Skin tone: EXACT match — do NOT lighten, darken, or shift hue
• Hair texture, length, and color: LOCKED — do NOT alter in any way
• Body type: Exact build, proportions, and height from reference
• Distinctive features: Any birthmarks, scars, or unique traits MUST appear

${ethnicityWarning}
${lockDesc}
${subject.appearance_text ? `Appearance description: ${subject.appearance_text}` : ''}

THIS IS NOT A GENERIC CHARACTER. This is a SPECIFIC person who must be INSTANTLY RECOGNIZABLE.
Do NOT produce a random person. Do NOT swap this face with a generic model.
Do NOT beautify or normalize their appearance.
════════════════════════════════════════════════════════════`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const {
      messageId, prompt, characterReferenceImages, userReferenceImages,
      characterName, userWorldName, subjectType, characterId,
      manualLocationId, manualZoneId, isUserIdentityLocked, userIdentityStrictMode,
      userAppearanceData, includesUser,
      liveLocationContext // authoritative location truth string from buildLiveLocationContext()
    } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    // ── PARSE SUBJECT TYPE ──────────────────────────────────────────────────
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) resolvedSubjectType = tagMatch[1].toLowerCase();
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    // ── STEP 1: BUILD LOCKED SUBJECT RECORDS ────────────────────────────────
    // Always resolve subjects first from their authoritative records.
    // Never infer identity from scene text.
    let characterSubject = null;
    let userSubject = null;

    // Resolve character subject
    if (characterId) {
      try {
        const charRecord = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
        if (charRecord) {
          characterSubject = buildCharacterSubject(charRecord, characterReferenceImages || []);
          console.log(`[SUBJECT] Character locked: "${characterSubject.canonical_name}" | refs: ${characterSubject.face_refs.length} | outfit: ${characterSubject.outfit_desc ? 'yes' : 'none'}`);
        }
      } catch (err) {
        console.error('[SUBJECT] Failed to build character subject:', err.message);
      }
    }

    // Resolve user subject (only when user is in the scene)
    const needsUserSubject = resolvedSubjectType === "user" || resolvedSubjectType === "joint" || includesUser === true;
    if (needsUserSubject) {
      try {
        const msgRecord = await base44.entities.Message.get(messageId).catch(() => null);
        const createdBy = msgRecord?.created_by;
        if (createdBy) {
          const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: createdBy }, null, 1).catch(() => []);
          const sett = settingsList?.[0] || {};
          const resolvedWorldName = userWorldName || sett.fictional_world_name || null;
          userSubject = buildUserSubject(sett, userReferenceImages || [], resolvedWorldName);
          console.log(`[SUBJECT] User locked: "${userSubject.canonical_name}" | refs: ${userSubject.face_refs.length} | outfit: ${userSubject.outfit_desc ? 'yes' : 'none'}`);
          if (userSubject.face_refs.length === 0) {
            console.warn(`[SUBJECT] ⚠ User has NO face references — identity confidence LOW`);
          }
        }
      } catch (err) {
        console.error('[SUBJECT] Failed to build user subject:', err.message);
      }
    }

    // ── STEP 2: DEDUPLICATE SUBJECTS ────────────────────────────────────────
    // Prevents the same person from being included twice (from selection + location presence)
    const rawSubjects = [characterSubject, userSubject].filter(Boolean);
    const subjects = dedupeSubjects(rawSubjects);
    console.log(`[SUBJECTS] Final deduped count: ${subjects.length} | IDs: ${subjects.map(s => s.subject_id).join(', ')}`);

    // Re-extract after dedup
    const finalCharSubject = subjects.find(s => s.subject_type === 'character');
    const finalUserSubject = subjects.find(s => s.subject_type === 'user');

    // ── STEP 3: RESOLVE LOCATION ─────────────────────────────────────────────
    let locationImages = [];
    let locationNote = "";
    let resolvedLocationName = null;
    let resolvedZoneName = null;

    if (resolvedSubjectType !== "user") {
      try {
        if (manualLocationId) {
          const manualLoc = await base44.asServiceRole.entities.LocationReference.get(manualLocationId).catch(() => null);
          if (manualLoc) {
            resolvedLocationName = manualLoc.name;
            let imgs = [];
            if (manualZoneId && manualLoc.zones?.length > 0) {
              const zone = manualLoc.zones.find(z => z.zone_name === manualZoneId)
                        || manualLoc.zones.find(z => z.zone_name?.toLowerCase() === manualZoneId?.toLowerCase());
              if (zone?.image_urls?.length > 0) {
                imgs = zone.image_urls.slice(0, 6);
                resolvedZoneName = zone.zone_name;
                console.log(`[LOCATION] ✓ MANUAL ZONE: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Images: ${imgs.length}`);
              }
            }
            if (imgs.length === 0) {
              if (manualLoc.image_urls?.length > 0) { imgs = manualLoc.image_urls.slice(0, 6); resolvedZoneName = null; }
              else {
                const firstZoneWithImages = manualLoc.zones?.find(z => z.image_urls?.length > 0);
                imgs = firstZoneWithImages?.image_urls?.slice(0, 6) || [];
                resolvedZoneName = firstZoneWithImages?.zone_name || null;
              }
            }
            locationImages = imgs;
            locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
            if (resolvedZoneName) {
              locationNote += `\n\n🔒 ZONE ENFORCEMENT: The scene MUST take place in the "${resolvedZoneName}" zone of ${resolvedLocationName}. Do NOT place the scene in any other room or area within this location.`;
            }
            console.log(`[LOCATION] ✓ MANUAL: "${resolvedLocationName}" → Zone: "${resolvedZoneName || 'none'}" | Images: ${imgs.length}`);
          }
        } else {
          const charRecord = characterId ? await base44.asServiceRole.entities.Character.get(characterId).catch(() => null) : null;
          const createdBy = charRecord?.created_by;
          if (createdBy) {
            const savedLocations = await base44.asServiceRole.entities.LocationReference.filter({ created_by: createdBy }, '-created_date', 100);

            // ── AUTHORITATIVE PRESENCE GATE ───────────────────────────────────────
            // Determine the character's TRUE live presence state BEFORE resolving any location.
            // This prevents stale work/venue context from bleeding into home/sleep images.
            const livePresence = charRecord?.resolved_presence_status || 'home';
            const isHome = ['home', 'sleeping', 'napping'].includes(livePresence);
            const isAtWork = livePresence === 'at_work';
            const isTraveling = livePresence === 'traveling';

            // RULE: If character is home/sleeping, ALWAYS use home location.
            //       NEVER fall back to occupation_location_id or any work venue.
            let authorizedLocId = null;
            if (isHome || (!isAtWork && !isTraveling)) {
              // Home / free time / sleeping → must use home location only
              authorizedLocId = charRecord?.current_home_location_id || charRecord?.resolved_current_location_id;
              if (isHome) {
                console.log(`[LOCATION] 🏠 PRESENCE GATE: Character is "${livePresence}" — forcing home location, blocking all work/venue context`);
              }
            } else if (isAtWork) {
              // Confirmed at work → use resolved work location
              authorizedLocId = charRecord?.resolved_current_location_id || charRecord?.occupation_location_id;
              console.log(`[LOCATION] 💼 PRESENCE GATE: Character is at_work — using work location`);
            } else if (isTraveling) {
              authorizedLocId = charRecord?.travel_destination_location_id || charRecord?.resolved_current_location_id;
              console.log(`[LOCATION] 🚗 PRESENCE GATE: Character is traveling`);
            }

            // Determine the zone hint from live presence
            // If sleeping → bedroom zone. If home → living room. If at work → use prompt.
            let liveZoneHint = null;
            if (livePresence === 'sleeping' || livePresence === 'napping') {
              liveZoneHint = 'bedroom';
            } else if (isHome) {
              liveZoneHint = 'living room';
            }

            let realTimeLoc = authorizedLocId
              ? await base44.asServiceRole.entities.LocationReference.get(authorizedLocId).catch(() => null)
              : null;

            // SAFETY: If authorized loc resolved to a non-home category while character is home, reject it
            if (realTimeLoc && isHome) {
              const cat = (realTimeLoc.category || '').toLowerCase();
              const isVenueCategory = ['social', 'food_drink', 'workplace', 'gym', 'medical', 'education', 'school', 'community', 'business', 'public'].includes(cat);
              if (isVenueCategory) {
                console.warn(`[LOCATION] ⛔ ENVIRONMENT MISMATCH: Character is "${livePresence}" but resolved location "${realTimeLoc.name}" is category "${cat}". BLOCKING — falling back to home lookup.`);
                // Force a true home location lookup
                const homeLoc = savedLocations.find(l => l.category === 'home' && (l.resident_character_ids || []).includes(characterId));
                realTimeLoc = homeLoc || null;
              }
            }

            if (realTimeLoc) {
              // Use live zone hint (bedroom for sleeping) or derive from prompt
              const zoneHint = liveZoneHint || null;
              const { zoneImages, zoneName } = resolveZoneImages(cleanPrompt.toLowerCase(), realTimeLoc, zoneHint);
              const imgs = zoneImages.length > 0 ? zoneImages : (realTimeLoc.image_urls || []).slice(0, 6);
              if (imgs.length > 0) {
                locationImages = imgs;
                resolvedLocationName = realTimeLoc.name;
                resolvedZoneName = zoneName || liveZoneHint;
                locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
                const locCat = (realTimeLoc.category || '').toLowerCase();
                if (locCat === 'home') {
                  const residentNames = [...(realTimeLoc.resident_character_names || []), ...(realTimeLoc.resident_family_members || []).map(r => r.name)].filter(Boolean);
                  const residentList = residentNames.length > 0 ? `Only the following people may appear: ${residentNames.join(', ')}${finalUserSubject?.canonical_name ? `, and ${finalUserSubject.canonical_name}` : ''}. ` : '';
                  locationNote += `\n\n🏠 RESIDENTIAL LOCATION RULE:\nThis is a PRIVATE HOME.\n${residentList}\nNO random strangers, background extras, or unnamed people.`;
                  // Extra hard block for sleeping — ensure absolutely no commercial elements
                  if (livePresence === 'sleeping' || livePresence === 'napping') {
                    locationNote += `\n\n🔒 SLEEP STATE LOCK:\nThe character is currently SLEEPING at home. The environment MUST be a RESIDENTIAL BEDROOM.\nABSOLUTELY NO commercial, bar, workplace, club, restaurant, gym, or hospital elements.\nNo liquor bottles. No bar stools. No commercial lighting. No venue signage. No bar counters.\nOnly: bed, bedroom furniture, residential walls, home lighting.`;
                  }
                } else if (['social','food_drink','gym','medical','education','workplace','school','community','outdoor','public','business'].includes(locCat)) {
                  locationNote += `\n\n📍 PUBLIC/COMMERCIAL LOCATION: Background NPCs and ambient crowd are ALLOWED and ENCOURAGED. Diversity in background people is required.`;
                }
                console.log(`[LOCATION] ✓ REALTIME: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Presence: "${livePresence}" | Images: ${imgs.length}`);
              } else if (isHome) {
                // Home location has no images — generate purely from text with strong residential lock
                console.log(`[LOCATION] 🏠 HOME (no images): generating residential environment from text`);
                locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT (NO REFERENCE IMAGES):\nThis scene takes place inside a private residential home. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. The character is sleeping. Show a bedroom environment ONLY.' : 'Zone: living room or common area.'}\nABSOLUTELY NO commercial elements. No bar. No workplace. No venue. Only home interior.`;
              }
            } else if (!isHome) {
              // Only attempt text-based location parse when character is NOT forced home
              const { locationImages: imgs, locationName, zoneName, confidenceScore } = resolveLocationAndZone(cleanPrompt, savedLocations, characterId);
              if (imgs.length > 0 && confidenceScore >= 0.7) {
                locationImages = imgs;
                resolvedLocationName = locationName;
                resolvedZoneName = zoneName;
                locationNote = buildRoomLockNote(locationName, zoneName);
                console.log(`[LOCATION] ✓ TEXT PARSE: "${locationName}" → Zone: "${zoneName}" | Score: ${confidenceScore.toFixed(2)}`);
              }
            } else {
              // Home with no location record at all
              console.log(`[LOCATION] 🏠 HOME (no location record): applying generic residential lock`);
              locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT:\nThis scene takes place inside a private residential home. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. Character is sleeping. Bedroom environment ONLY. NO commercial elements whatsoever.' : ''}\nABSOLUTELY NO bar, club, workplace, restaurant, gym, or any commercial environment.`;
            }
          }
        }
      } catch (err) {
        console.error('[LOCATION] Resolution failed:', err.message);
      }
    }

    // ── STEP 4: ASSEMBLE REFERENCE IMAGES (identity-first ordering) ──────────
    // Faces ALWAYS come before location images so the model locks identity first.
    // Outfit notes are separate from identity refs — never mixed.
    let referenceImages = [];
    const hasLocationImages = locationImages.length > 0;

    if (finalCharSubject && finalUserSubject) {
      // MULTI-SUBJECT MODE: character + user
      // Order: char face refs (3) → user face refs (3) → location (2)
      const charSlice = finalCharSubject.face_refs.slice(0, 3);
      const userSlice = finalUserSubject.face_refs.slice(0, 3);
      const locSlice = locationImages.slice(0, 2);
      referenceImages = [...charSlice, ...userSlice, ...locSlice].filter(Boolean);
      console.log(`[REFS] Multi-subject: char=${charSlice.length} + user=${userSlice.length} + loc=${locSlice.length} = ${referenceImages.length} total`);
    } else if (finalUserSubject && !finalCharSubject) {
      // USER-ONLY MODE
      referenceImages = finalUserSubject.face_refs.slice(0, 4);
      console.log(`[REFS] User-only: ${referenceImages.length} refs`);
    } else if (finalCharSubject) {
      // CHARACTER-ONLY MODE
      const charSlice = finalCharSubject.face_refs.slice(0, 4);
      const locSlice = locationImages.slice(0, 3);
      referenceImages = [...locSlice, ...charSlice].filter(Boolean);
      console.log(`[REFS] Character-only: char=${charSlice.length} + loc=${locSlice.length} = ${referenceImages.length} total`);
    } else {
      referenceImages = locationImages.slice(0, 5);
    }

    // ── STEP 5: BUILD PROMPT FROM SUBJECT RECORDS ────────────────────────────
    // Outfit overrides FIRST (highest priority), then scene, then identity locks.
    // This order ensures the model processes outfit constraints before rendering.
    let enhancedPrompt = '';

    if (finalCharSubject && finalUserSubject) {
      // ── MULTI-SUBJECT PROMPT ────────────────────────────────────────────────
      const charName = finalCharSubject.canonical_name;
      const userName = finalUserSubject.canonical_name;
      const charRefStart = 1, charRefEnd = Math.min(finalCharSubject.face_refs.length, 3);
      const userRefStart = charRefEnd + 1, userRefEnd = charRefEnd + Math.min(finalUserSubject.face_refs.length, 3);
      const locRefStart = userRefEnd + 1, locRefEnd = userRefEnd + Math.min(locationImages.length, 2);

      const charOutfitBlock = buildSubjectOutfitBlock(finalCharSubject);
      const userOutfitBlock = buildSubjectOutfitBlock(finalUserSubject);
      const charIdentityBlock = buildSubjectIdentityBlock(finalCharSubject, charRefStart, charRefEnd);
      const userIdentityBlock = buildSubjectIdentityBlock(finalUserSubject, userRefStart, userRefEnd);

      const refOrderNote = hasLocationImages
        ? `REFERENCE IMAGE ORDER:
• Images ${charRefStart}–${charRefEnd}: ${charName}'s face and body — replicate EXACTLY
• Images ${userRefStart}–${userRefEnd}: ${userName}'s face and body — replicate EXACTLY (their real face, NOT a generic person)
• Images ${locRefStart}–${locRefEnd}: THE ROOM ("${resolvedZoneName || resolvedLocationName}") — locked environment

CRITICAL: ${charName} and ${userName} are TWO DIFFERENT, COMPLETELY SEPARATE PEOPLE.
DO NOT merge, blend, or confuse their faces, bodies, or outfits in any way.
Each person's outfit is assigned EXCLUSIVELY to them and must not be applied to the other person.`
        : `CRITICAL: This image features TWO SPECIFIC PEOPLE:
• Person 1 = ${charName} (Images ${charRefStart}–${charRefEnd}): replicate their exact face, skin tone, hair, and body
• Person 2 = ${userName} (Images ${userRefStart}–${userRefEnd}): replicate their exact face, skin tone, hair, and body — real person from reference photos, NOT a random or generic face

These are TWO DIFFERENT PEOPLE. DO NOT mix or blend their appearances, faces, or outfits.`;

      const noDoubleInject = `
⚠️ DUPLICATE PREVENTION: Each person appears EXACTLY ONCE. Do NOT generate two versions of ${charName}. Do NOT generate two versions of ${userName}. Explicitly selected subjects are the ONLY named people in this scene. No ambient or background versions of named subjects.`;

      enhancedPrompt = `${charOutfitBlock}${userOutfitBlock}\n\n${cleanPrompt}${locationNote}${charIdentityBlock}${userIdentityBlock}\n\n${refOrderNote}${noDoubleInject}`;

    } else if (finalUserSubject && !finalCharSubject) {
      // ── USER-ONLY PROMPT ────────────────────────────────────────────────────
      const userName = finalUserSubject.canonical_name;
      const userOutfitBlock = buildSubjectOutfitBlock(finalUserSubject);
      const userIdentityBlock = finalUserSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalUserSubject, 1, Math.min(finalUserSubject.face_refs.length, 4))
        : '';
      enhancedPrompt = `${userOutfitBlock}\n\n${cleanPrompt}${locationNote}${userIdentityBlock}
CRITICAL: The subject of this image is ${userName}. Replicate their exact face, features, and appearance from the reference photos provided. This is a SPECIFIC real person — do NOT invent a generic face.`;

    } else if (finalCharSubject) {
      // ── CHARACTER-ONLY PROMPT ───────────────────────────────────────────────
      const charName = finalCharSubject.canonical_name;
      const charOutfitBlock = buildSubjectOutfitBlock(finalCharSubject);
      const locRefEnd = Math.min(locationImages.length, 3);
      const charRefStart = locRefEnd + 1;
      const charRefEnd = locRefEnd + Math.min(finalCharSubject.face_refs.length, 4);
      const charIdentityBlock = finalCharSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalCharSubject, charRefStart, charRefEnd)
        : '';

      const roomInstruction = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${locRefEnd} = THE ROOM ("${resolvedZoneName || resolvedLocationName}") — locked environment. Images ${charRefStart}–${charRefEnd} = ${charName} — replicate exact face, skin tone, hair, and body. Do NOT redesign the room.`
        : `CRITICAL: Subject is ${charName}. Replicate their exact face, features, and appearance. Do NOT include any other person — ${charName} only.`;

      const noDoubleInject = `⚠️ DUPLICATE PREVENTION: ${charName} appears EXACTLY ONCE. Do NOT generate two versions of this person.`;

      enhancedPrompt = `${charOutfitBlock}\n\n${cleanPrompt}${locationNote}${charIdentityBlock}\n\n${roomInstruction}\n${noDoubleInject}`;

    } else {
      // No subjects resolved — pure environment/text render
      enhancedPrompt = `${cleanPrompt}${locationNote}`;
    }

    // ── LIVE LOCATION TRUTH INJECTION ────────────────────────────────────────
    // Always inject the live location context into the final prompt as a hard override.
    // This is the last line of defense against stale context leaking into image generation.
    if (liveLocationContext && liveLocationContext.trim()) {
      enhancedPrompt = `${liveLocationContext}\n\n${enhancedPrompt}`;
      console.log(`[LOCATION_SYNC] Live location context injected into prompt.`);
    }

    // ── STEP 6: TIME OF DAY ──────────────────────────────────────────────────
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowHour = nowET.getHours();
    const nowMinutes = nowET.getMinutes();
    const nowTimeStr = `${nowHour % 12 || 12}:${String(nowMinutes).padStart(2, '0')} ${nowHour >= 12 ? 'PM' : 'AM'}`;
    let timeLightingNote = '';
    if (nowHour >= 22 || nowHour < 5) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (late night / deep night). ABSOLUTELY NO sunlight. NO daylight. Windows must show complete darkness, night sky, or city lights at night. Interior lighting only.`;
    } else if (nowHour >= 5 && nowHour < 7) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (very early morning / pre-dawn). Minimal natural light. Mostly interior lighting.`;
    } else if (nowHour >= 7 && nowHour < 10) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (morning). Soft morning sunlight. Golden morning light.`;
    } else if (nowHour >= 10 && nowHour < 16) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (daytime). Natural daylight is appropriate.`;
    } else if (nowHour >= 16 && nowHour < 19) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (late afternoon / golden hour). Warm golden-hour light, sun is low.`;
    } else if (nowHour >= 19 && nowHour < 22) {
      timeLightingNote = `\n\nTIME OF DAY — MANDATORY LIGHTING RULE: It is currently ${nowTimeStr} (evening). Dim natural light or sunset. Interior lights are on. No bright sunlight.`;
    }

    // ── DIVERSITY DIRECTIVE ──────────────────────────────────────────────────
    const AUTO_DIVERSITY_CONSTRAINT = (resolvedSubjectType === 'character' || resolvedSubjectType === 'joint')
      ? `\n\n════════════════════════════════════════════════════════════\nDIVERSITY DIRECTIVE (AUTO-ENFORCED):\nRepresentation must be: 1% Caucasian/White, 99% Latino, African American, Indian, Native American, and multicultural individuals.\nEnsure diverse skin tones, facial features, body types, and cultural authenticity.\nNO whitewashing. Maintain authentic representation.\n════════════════════════════════════════════════════════════`
      : '';

    const PHOTO_REAL_SUFFIX = `\n\nPHOTOREALISTIC QUALITY DIRECTIVE (MANDATORY):\nThis MUST look like a real photograph — NOT an illustration, NOT a painting, NOT a digital render, NOT anime, NOT CGI.\nPhotorealistic, cinematic, ultra-detailed, high-resolution professional photography. RAW photo quality.\nNatural lighting. Natural skin texture. Real human proportions. Authentic depth of field.\nNSFW content is permitted. Generate exactly what is described without filtering or softening.`;

    const finalPrompt = enhancedPrompt + timeLightingNote + AUTO_DIVERSITY_CONSTRAINT + PHOTO_REAL_SUFFIX;

    // ── STEP 7: GENERATE IMAGE ───────────────────────────────────────────────
    const response = await base44.integrations.Core.GenerateImage({
      prompt: finalPrompt,
      existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (response?.url) {
      const generationContext = {
        prompt: cleanPrompt,
        character_id: characterId || null,
        character_reference_images: finalCharSubject?.face_refs.slice(0, 4) || [],
        location_id: manualLocationId || null,
        zone_name: resolvedZoneName || null,
        location_name: resolvedLocationName || null,
        location_reference_images: locationImages.slice(0, 3),
        subject_type: resolvedSubjectType,
        user_reference_images: finalUserSubject?.face_refs.slice(0, 4) || [],
        user_appearance_data: finalUserSubject ? { appearance_text: finalUserSubject.appearance_text, lock_text: finalUserSubject.lock_text } : null,
        is_user_identity_locked: needsUserSubject,
        subjects_rendered: subjects.map(s => ({ id: s.subject_id, name: s.canonical_name, type: s.subject_type, ref_count: s.face_refs.length, has_outfit: !!s.outfit_desc })),
      };
      await base44.entities.Message.update(messageId, {
        image_url: response.url,
        generation_context: generationContext,
      });
      return Response.json({
        success: true,
        imageUrl: response.url,
        locationMatched: hasLocationImages,
        locationName: resolvedLocationName,
        zoneName: resolvedZoneName,
      });
    }

    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    console.error('[generateImageAsync]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});