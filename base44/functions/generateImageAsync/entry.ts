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

// ── FUTURE-INTENT STRIPPER ────────────────────────────────────────────────────
// Removes place references that are future plans, destinations, or conversation topics
// from any string before it is used for location/zone/outfit keyword matching.
//
// RULE: Mentioning a place is NOT being there.
// "I have to go to the restaurant" → restaurant is a future destination, NOT current scene.
// "I was at the bar earlier" → bar is a past place, NOT current scene.
// "I need to stop by the hospital" → hospital is a future plan, NOT current scene.
//
// These patterns are stripped so keyword matchers cannot relocate the scene.
function stripFutureAndPastIntentPhrases(text) {
  if (!text) return text;
  // Remove future-intent phrases: "have to go to X", "need to go to X", "heading to X", etc.
  const stripped = text
    // Future destination patterns
    .replace(/\b(have to|need to|gotta|going to|gonna|heading to|heading over to|on my way to|on the way to|stop by|stop at|swinging by|swing by|drop by|drop off at|pick up (from|at)|drive to|walk to|run over to|shoot over to|pop over to|pop by|get to|get over to|rush to|run to)\s+(the\s+)?[a-z '"-]+/gi, '')
    // "I'll be at X later/soon/tonight/tomorrow"
    .replace(/\b(i'?ll?\s+be\s+at|i'?m\s+going\s+to)\s+(the\s+)?[a-z '"-]+\s+(later|soon|tonight|tomorrow|after|in a bit|in a minute|shortly)/gi, '')
    // "before I go to X"
    .replace(/\bbefore\s+i\s+(go|get|head|leave|run)\s+(to|over to)?\s+(the\s+)?[a-z '"-]+/gi, '')
    // Past-place patterns: "I was at X", "I came from X", "just left X", "earlier at X"
    .replace(/\b(was\s+at|came\s+from|just\s+left|left\s+the|earlier\s+at|just\s+came\s+from|been\s+at)\s+(the\s+)?[a-z '"-]+/gi, '')
    // "deal with X" / "deal with the restaurant/bar/etc."
    .replace(/\bdeal\s+with\s+(the\s+)?[a-z '"-]+/gi, '')
    // "at X later", "at the X tonight"
    .replace(/\bat\s+(the\s+)?[a-z '"-]+\s+(later|soon|tonight|tomorrow|after|in a bit)/gi, '');

  return stripped;
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
The scene is set in the ${zoneName || 'space'} of ${locationName}.
Use the reference photographs to match: flooring material and color, wall color and finish, furniture pieces and positions, lighting fixtures, window treatments, and decorative objects.
Generate the scene from a different camera angle. Only the viewpoint changes—all architectural and furnishing elements remain identical.
Place the subject naturally within the space.`;
}

// ── SUBJECT RECORD BUILDERS ──────────────────────────────────────────────────
// These functions build structured subject objects from raw data.
// Images and prompts are assembled FROM these records — never the other way around.

function buildCharacterSubject(charRecord, clientRefs = [], clientPromptContext = '') {
  const serverRefs = [];
  if (charRecord.avatar_url) serverRefs.push(charRecord.avatar_url);
  if (charRecord.reference_image_urls?.length > 0) serverRefs.push(...charRecord.reference_image_urls);
  // Always use server-side refs as authoritative; client refs are fallback only
  const faceRefs = serverRefs.length > 0 ? serverRefs : clientRefs;

  // ── OUTFIT ROTATION ENGINE ───────────────────────────────────────────────
  // Resolves the contextually correct outfit using presence, activity, location,
  // time of day, and daily rotation logic — NOT just the static current_outfit field.
  const currentOutfit = charRecord.current_outfit;
  const closet = charRecord.character_closet || [];
  const closetOutfits = closet.filter(item => item.type === "outfit" || (!item.piece_type && item.outfit_id));

  // ── PRIORITY RESOLUTION ─────────────────────────────────────────────────────
  // 1. Manual selection made today (same calendar day) → respect it
  // 2. Otherwise → resolve contextually using presence/activity/time
  const currentOutfitId = currentOutfit?.outfit_id || null;
  const manualToday = currentOutfit?.change_reason === 'manual_selection' && currentOutfit?.last_changed_at
    ? new Date(currentOutfit.last_changed_at).toDateString() === new Date().toDateString()
    : false;

  let activeOutfit = null;

  if (manualToday && currentOutfit?.label) {
    // User manually picked today — respect it exactly
    activeOutfit = currentOutfit;
    console.log(`[OUTFIT] Manual selection today: "${activeOutfit.label}" (${activeOutfit.category})`);
  } else if (closetOutfits.length > 0) {
    // ── Full contextual resolution ───────────────────────────────────────────
    const presenceStatus = charRecord.resolved_presence_status || charRecord.location_status || 'home';
    const currentActivity = (charRecord.current_activity || '').toLowerCase();
    // Use the image prompt as the activity/context text
    const activityText = (clientPromptContext || currentActivity).toLowerCase();
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();

    // ── Step 1: Determine target category ────────────────────────────────────
    let targetCategory = 'daily_casual'; // fallback default

    const combined = `${activityText} ${currentActivity}`;

    // Priority 1: Bath/grooming state
    if (/\b(bath|shower|bathing|showering|tub|robe|towel|grooming)\b/.test(combined)) {
      targetCategory = 'bath';
    }
    // Priority 2: Sleep state or approaching bedtime
    else if (presenceStatus === 'sleeping' || presenceStatus === 'napping' || /\b(sleep|asleep|nap|napping|bedtime|bed time)\b/.test(combined)) {
      targetCategory = 'sleepwear';
    }
    else if (charRecord.sleep_start_time) {
      const [sh, sm] = charRecord.sleep_start_time.split(':').map(Number);
      const sleepMin = sh * 60 + sm;
      const nowMin = hour * 60 + minute;
      const diff = sleepMin > nowMin ? sleepMin - nowMin : (sleepMin + 1440) - nowMin;
      if (diff <= 60) targetCategory = 'sleepwear';
    }
    // Priority 3: Swimwear — pool, beach, water
    else if (/\b(swim|swimming|pool|beach|ocean|lake|water park|sunbath|snorkel|surf)\b/.test(combined)) {
      targetCategory = 'swimwear';
    }
    // Priority 4: Gym/workout
    else if (/\b(gym|workout|working out|lifting|cardio|yoga|jogging|running|training|exercise|rehearsal|dance rehearsal|choreography)\b/.test(combined) || presenceStatus === 'at_gym') {
      targetCategory = 'gym';
    }
    // Priority 5: Work
    else if (presenceStatus === 'at_work' || /\b(working|at work|on shift|office|clocked in)\b/.test(combined)) {
      targetCategory = 'work';
    }
    // Priority 6: Formal/event
    else if (/\b(wedding|funeral|gala|graduation|ceremony|black tie|formal event)\b/.test(combined)) {
      targetCategory = 'formal';
    }
    // Priority 7: Church
    else if (/\b(church|service|worship|mass|prayer|praying)\b/.test(combined)) {
      targetCategory = 'church';
    }
    // Priority 8: Nightlife
    else if (/\b(club|nightclub|party|night out|going out|bar hop)\b/.test(combined)) {
      targetCategory = 'nightlife';
    }
    // Priority 9: Date night
    else if (/\b(date|date night|romantic dinner|anniversary)\b/.test(combined)) {
      targetCategory = 'date_night';
    }
    // Priority 10: Lounge (home relaxing)
    else if (presenceStatus === 'home' && (hour >= 19 || hour < 7 || /\b(relax|relaxing|chilling|lounge|lounging|home|couch|tv)\b/.test(combined))) {
      targetCategory = 'lounge';
    }
    // Default: daily casual
    else {
      targetCategory = 'daily_casual';
    }

    // ── Step 2: Fallback chain ────────────────────────────────────────────────
    const fallbackChains = {
      bath:         ['bath', 'sleepwear', 'lounge'],
      sleepwear:    ['sleepwear', 'lounge', 'daily_casual'],
      swimwear:     ['swimwear', 'gym', 'daily_casual'],
      gym:          ['gym', 'outdoor', 'daily_casual'],
      work:         ['work', 'formal', 'daily_casual'],
      formal:       ['formal', 'work', 'daily_casual'],
      church:       ['church', 'formal', 'work', 'daily_casual'],
      nightlife:    ['nightlife', 'date_night', 'special', 'daily_casual'],
      date_night:   ['date_night', 'nightlife', 'formal', 'daily_casual'],
      lounge:       ['lounge', 'daily_casual', 'sleepwear'],
      daily_casual: ['daily_casual', 'outdoor', 'lounge'],
    };
    const chain = fallbackChains[targetCategory] || ['daily_casual', 'lounge'];

    // ── Step 3: Pick from pool with daily rotation ───────────────────────────
    const getDailyRotationIndex = (pool) => {
      if (pool.length <= 1) return 0;
      const now = new Date();
      const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
      const idHash = (charRecord.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return (dayOfYear + idHash) % pool.length;
    };

    const pickFromPool = (pool) => {
      if (pool.length === 0) return null;
      if (pool.length === 1) return pool[0];
      const favorites = pool.filter(o => o.is_favorite);
      const candidates = favorites.length > 0 ? favorites : pool;
      if (candidates.length === 1) return candidates[0];
      const idx = getDailyRotationIndex(candidates);
      const picked = candidates[idx];
      // Avoid same as current if alternatives exist
      if (picked?.outfit_id === currentOutfitId && candidates.length > 1) {
        return candidates[(idx + 1) % candidates.length];
      }
      return picked;
    };

    for (const cat of chain) {
      const pool = closetOutfits.filter(o => o.category === cat);
      if (pool.length > 0) {
        activeOutfit = pickFromPool(pool);
        console.log(`[OUTFIT] Resolved category="${cat}" (target="${targetCategory}") | pool=${pool.length} | picked="${activeOutfit?.label}" | presence="${presenceStatus}"`);
        break;
      }
    }

    // Last resort — any outfit
    if (!activeOutfit) {
      activeOutfit = pickFromPool(closetOutfits);
      if (activeOutfit) console.log(`[OUTFIT] Last-resort pick: "${activeOutfit.label}"`);
    }
  } else if (currentOutfit?.label) {
    // No closet but a current_outfit exists — use it
    activeOutfit = currentOutfit;
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
  let outfitDesc = subject.outfit_desc;
  const sensitivePatterns = [
    /wearing only\s+/gi,
    /shirtless/gi,
    /topless/gi,
    /no (shirt|top|clothes)/gi,
    /bare (chest|torso|skin|body)/gi,
    /slight sheen of moisture on (his|her) skin/gi,
  ];
  const isSensitive = sensitivePatterns.some(p => p.test(outfitDesc));
  if (isSensitive) {
    return `\n${name} is wearing casual everyday clothing suitable for the scene.\n`;
  }
  return `\n${name}'s clothing: ${outfitDesc}\n`;
}

function buildSubjectIdentityBlock(subject, imageIndexStart, imageIndexEnd) {
  const name = subject.canonical_name;
  const lockDesc = subject.lock_text ? `Appearance details: ${subject.lock_text}.` : '';
  const ethnicityWarning = subject.ethnicities?.length > 0
    ? `Ethnicity: ${subject.ethnicities.join(', ')}.`
    : '';
  return `\nSubject: ${name} (reference images ${imageIndexStart}–${imageIndexEnd}). Match facial features, skin tone, hair, and body type from reference photos. ${ethnicityWarning} ${subject.appearance_text ? `Additional context: ${subject.appearance_text}.` : ''} ${lockDesc}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const {
      messageId, prompt, characterReferenceImages, userReferenceImages, locationReferenceImages,
      characterName, userWorldName, subjectType, characterId,
      manualLocationId, manualZoneId, isUserIdentityLocked, userIdentityStrictMode,
      userAppearanceData, includesUser,
      liveLocationContext, // authoritative location truth string from buildLiveLocationContext()
      isCreativeGeneration, // true = media grid / user-directed creative; false/absent = presence-based scene
      characterEmotionalState // current emotional state to influence expression in image
    } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    console.log(`[generateImageAsync] ▶ REQUEST: messageId=${messageId} | characterId=${characterId || 'none'} | subjectType=${subjectType || 'none'} | isCreativeGeneration=${isCreativeGeneration} | promptStart="${(prompt || '').substring(0, 100)}"`);

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }
    if (message.id !== messageId) {
      console.error(`[generateImageAsync] ⛔ ID MISMATCH: requested=${messageId} got=${message.id} — aborting to prevent wrong-asset linkage`);
      return Response.json({ error: 'Message ID mismatch' }, { status: 400 });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // IMAGE MODE BRANCHING — master decision tree
    // Every image request is classified BEFORE any location logic runs.
    //
    // MODES:
    //   presence_scene   — represents where the character currently is
    //                      → must obey live location truth (built / real-world / rabbit hole)
    //                      → home fallback BANNED unless character is actually home
    //
    //   creative         — user-directed from media grid, prompt, or concept
    //                      → must NOT be blocked by unresolved location
    //                      → location used only if user explicitly selected one
    //
    // The flag `isCreativeGeneration` is passed by the media grid caller.
    // Chat-based scene images (no flag) default to presence_scene.
    // ══════════════════════════════════════════════════════════════════════════
    const imageMode = isCreativeGeneration === true ? 'creative' : 'presence_scene';
    console.log(`[IMAGE_MODE] mode="${imageMode}" | manualLocationId=${manualLocationId || 'none'} | isCreativeGeneration=${isCreativeGeneration}`);

    // ── PARSE SUBJECT TYPE ──────────────────────────────────────────────────
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) resolvedSubjectType = tagMatch[1].toLowerCase();
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    // ── PAST-EVENT LOCATION INTENT DETECTOR ──────────────────────────────────
    // BEFORE stripping future/past intent phrases, scan the raw prompt for explicit
    // past-tense references to a named saved location.
    // If detected, this location will be used as the image scene instead of livePresence.
    //
    // Examples that qualify:
    //   "yesterday at Jay's apartment"     → past location → use Jay's apartment images
    //   "when we were at the bar last night" → past location → use bar images
    //   "from the party at the club"        → past location → use club images
    //
    // Examples that DO NOT qualify (future — must default to livePresence):
    //   "I'm going to the gym later"        → future → NO override
    //   "we should hang at the coffee shop" → hypothetical → NO override
    //
    // This is intentionally permissive for past events and strict for future events.
    const PAST_LOCATION_PATTERNS = [
      /\b(yesterday|last night|earlier|the other day|a few days ago|last week|the night|that night|that time|when we were|remember when|from when|after (the|our)|during (the|our)|at the time|at that|back at|i was at|we were at|i had been at|we had been at|from (the|our))\b/i,
    ];
    const FUTURE_INTENT_PATTERNS = [
      /\b(later|tonight|tomorrow|soon|going to|gonna|will be|planning to|about to|heading to|on my way|before i go|after i leave|next time|maybe we can|we should|let's go|we could)\b/i,
    ];
    const promptLowerForIntent = cleanPrompt.toLowerCase();
    const hasPastIntent = PAST_LOCATION_PATTERNS.some(p => p.test(cleanPrompt));
    const hasFutureIntent = FUTURE_INTENT_PATTERNS.some(p => p.test(cleanPrompt));
    // Only flag as a past-event image if it clearly references the past AND has no future intent
    const isPastEventImage = hasPastIntent && !hasFutureIntent;

    // scenePrompt = cleanPrompt with future/past intent phrases stripped.
    // Used for ALL location/zone/outfit keyword matching so that mentioned places
    // cannot override the character's actual current scene truth.
    const scenePrompt = stripFutureAndPastIntentPhrases(cleanPrompt);

    // ── STEP 1: BUILD LOCKED SUBJECT RECORDS ────────────────────────────────
    // Always resolve subjects first from their authoritative records.
    // Never infer identity from scene text.
    let characterSubject = null;
    let userSubject = null;

    // Resolve character subject — use filter fallback if .get() throws (RLS / cross-account)
    if (characterId) {
      try {
        let charRecord = null;
        try {
          charRecord = await base44.asServiceRole.entities.Character.get(characterId);
        } catch (getErr) {
          console.warn(`[SUBJECT] Character.get(${characterId}) threw (${getErr.message}) — trying filter fallback`);
          const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
          charRecord = charList?.[0] || null;
        }
        if (charRecord) {
          characterSubject = buildCharacterSubject(charRecord, characterReferenceImages || [], scenePrompt);
          console.log(`[SUBJECT] Character locked: "${characterSubject.canonical_name}" | refs: ${characterSubject.face_refs.length} | outfit: ${characterSubject.outfit_desc ? 'yes' : 'none'}`);
        } else {
          console.warn(`[SUBJECT] Character ${characterId} not found — proceeding without identity lock. Client refs: ${(characterReferenceImages || []).length}`);
          // Fall back to client-provided refs so generation still has identity signal
          if (characterReferenceImages?.length > 0) {
            characterSubject = {
              subject_type: 'character',
              subject_id: characterId,
              canonical_name: characterName || 'the character',
              face_refs: characterReferenceImages.slice(0, 3),
              outfit_desc: null,
              outfit_owner_id: characterId,
              appearance_text: '',
              lock_text: '',
              ethnicities: [],
              explicitly_selected: true,
            };
          }
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
        // ══════════════════════════════════════════════════════════════════════
        // LOCATION RESOLUTION BRANCHING
        //
        // CREATIVE MODE: only resolve if the user explicitly passed a manualLocationId.
        //   → skip all presence-based logic
        //   → skip rabbit hole detection
        //   → skip home enforcement
        //   → generate from prompt alone if no location selected
        //
        // PRESENCE SCENE MODE: full truth chain
        //   1. rabbit hole → context-true AI-generated scene, NO home fallback
        //   2. manual location override → built or real-world reference imagery
        //   3. live presence gate → authoritative location from character state
        //   4. unresolved → text-based parse against saved locations
        //   5. home with no images → residential text lock (never a venue fallback)
        // ══════════════════════════════════════════════════════════════════════

        if (imageMode === 'creative' && !manualLocationId) {
          // CREATIVE MODE — the user's prompt is the scene truth.
          // Do NOT force character presence/home location onto a user-directed creative generation.
          // Only use passed locationReferenceImages if explicitly provided by the caller.
          if (locationReferenceImages?.length > 0) {
            locationImages = locationReferenceImages.slice(0, 6);
            console.log(`[LOCATION] 🎨 CREATIVE MODE — using caller-provided location reference images: ${locationImages.length}`);
          } else {
            console.log(`[LOCATION] 🎨 CREATIVE MODE — no location override. User prompt is scene authority.`);
          }
        } else {

        // ── RABBIT HOLE GATE (PRIORITY OVERRIDE) ──────────────────────────────
        // Reuse the already-fetched character record — no second DB call needed.
        // characterSubject was built from the same record; use it directly.
        let charForRabbitCheck = null;
        if (characterId) {
          try {
            charForRabbitCheck = await base44.asServiceRole.entities.Character.get(characterId);
          } catch (_) {
            const list = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
            charForRabbitCheck = list?.[0] || null;
          }
        }
        console.log(`[generateImageAsync] Character for rabbit/location check: id=${charForRabbitCheck?.id || 'none'} | name=${charForRabbitCheck?.name || 'none'} | presence=${charForRabbitCheck?.resolved_presence_status || 'unknown'}`);

        const isRabbitHole = charForRabbitCheck?.resolved_presence_status === 'rabbit_hole'
          || charForRabbitCheck?.is_rabbit_hole === true;

        if (isRabbitHole && !manualLocationId) {
          const rhLabel = charForRabbitCheck.rabbit_hole_label
            || charForRabbitCheck.resolved_current_location_name
            || 'off-screen location';

          // Infer rabbit hole type from label + activity in prompt
          const RABBIT_HOLE_TYPE_MAP = [
            {
              type: 'dance_studio',
              labelKeywords: ['studio', 'set', 'rehearsal', 'dance'],
              activityKeywords: ['choreo', 'choreography', 'rehearse', 'rehearsing', 'run-through', 'run through', 'moves', 'dance', 'practice'],
              environmentDesc: 'professional dance rehearsal studio, open practice floor with sprung hardwood, mirrored walls, rehearsal lighting, speaker system, water bottles and bags on the side, movement-ready space',
              exclusions: ['not residential', 'not a bedroom', 'not home interior', 'not an apartment', 'no bed', 'no nightstands', 'no domestic furniture', 'no living room', 'no home decor'],
            },
            {
              type: 'music_studio',
              labelKeywords: ['studio', 'booth', 'recording', 'session'],
              activityKeywords: ['recording', 'vocals', 'laying down', 'track', 'mixing', 'in the booth', 'session'],
              environmentDesc: 'professional music recording studio, mixing console, acoustic foam panels, studio monitors, recording booth glass, dimmed mood lighting',
              exclusions: ['not residential', 'not a bedroom', 'not home interior', 'no bed', 'no domestic furniture'],
            },
            {
              type: 'production_set',
              labelKeywords: ['set', 'shoot', 'film', 'stage', 'production'],
              activityKeywords: ['filming', 'shooting', 'camera blocking', 'on set', 'scene', 'director'],
              environmentDesc: 'professional film or TV production set, camera equipment, c-stands and lighting rigs, reflectors, crew atmosphere',
              exclusions: ['not residential', 'not a bedroom', 'not home interior', 'no bed', 'no domestic furniture'],
            },
            {
              type: 'backstage',
              labelKeywords: ['backstage', 'green room', 'dressing room', 'wings'],
              activityKeywords: ['before show', 'pre-show', 'getting ready', 'warming up', 'waiting'],
              environmentDesc: 'backstage dressing room or green room, vanity mirrors with bulb lighting, costume racks, theatrical atmosphere',
              exclusions: ['not residential', 'not a bedroom at home', 'no home decor'],
            },
            {
              type: 'gym_studio',
              labelKeywords: ['gym', 'fitness', 'training'],
              activityKeywords: ['workout', 'training', 'lifting', 'exercise', 'conditioning', 'cardio', 'sweat'],
              environmentDesc: 'commercial gym or fitness training facility, weight racks, training equipment, athletic environment',
              exclusions: ['not residential', 'not a bedroom', 'not home interior', 'no bed'],
            },
            {
              type: 'office',
              labelKeywords: ['office', 'meeting', 'conference', 'boardroom'],
              activityKeywords: ['meeting', 'conference', 'presentation', 'call', 'zoom', 'work'],
              environmentDesc: 'professional office or conference room, desk environment, business atmosphere',
              exclusions: ['not residential', 'not a bedroom', 'not home interior', 'no bed'],
            },
          ];

          const labelLower = rhLabel.toLowerCase();
          const activityLower = scenePrompt.toLowerCase();
          let matchedType = null;

          for (const entry of RABBIT_HOLE_TYPE_MAP) {
            const labelHit = entry.labelKeywords.some(k => labelLower.includes(k));
            const activityHit = entry.activityKeywords.some(k => activityLower.includes(k));
            if (labelHit && activityHit) { matchedType = entry; break; }
            if (activityHit && labelLower.length < 20) { matchedType = entry; break; }
            if (labelHit) { matchedType = entry; break; }
          }

          const envDesc = matchedType?.environmentDesc || `${rhLabel} — functional non-residential off-screen location`;
          const exclusions = (matchedType?.exclusions || ['not residential', 'not a bedroom', 'not home interior', 'no bed', 'no domestic furniture']).join(', ');

          locationNote = `

════════════════════════════════════════════════════════════
RABBIT HOLE LOCATION — CONTEXT-TRUE, CREATIVELY GENERATED
════════════════════════════════════════════════════════════
The character's current location is: "${rhLabel}"
This is an OFF-SCREEN location (rabbit hole) — not a saved location with reference images.
Generate an ORIGINAL, CINEMATIC, context-accurate scene for this environment type.

MANDATORY ENVIRONMENT: ${envDesc}

GENERATION APPROACH — GUIDED WORLDBUILDING:
This is NOT a photo retrieval. This is NOT a room-lock render.
You have creative freedom to synthesize a believable, visually rich environment that:
  • Matches the place type (${matchedType?.type || 'general off-screen location'})
  • Reflects the character's current activity
  • Feels like an original photograph of a real place of this type
  • Has authentic props, layout, lighting, and atmosphere consistent with this environment
  • Reads clearly as: "this is clearly where the character is right now"

ABSOLUTE BANS — ZERO EXCEPTIONS:
${exclusions}

⛔ DO NOT use any saved location imagery (especially home/residential).
⛔ DO NOT fall back to bedroom, apartment, or home interior under any circumstances.
⛔ The character is NOT home. They are at "${rhLabel}".
⛔ DO NOT reuse unrelated saved residential imagery.
⛔ DO NOT generate a generic room with no connection to the place type.

ENVIRONMENT EXAMPLES FOR THIS TYPE:
dance studio → sprung hardwood, full-length mirrors, rehearsal lighting, speaker stands
music studio → mixing console, acoustic foam, booth glass, studio monitors, dim ambient light
production set → camera rigs, c-stands, lighting gels, crew equipment, set dressing
backstage → vanity mirrors with bulbs, costume racks, green room sofa, show atmosphere
gym/training → weight racks, rubber floors, athletic equipment, high-ceiling training space
office/meeting → desk environment, whiteboards, conference table, professional atmosphere

The environment must feel real, functional, and original.
════════════════════════════════════════════════════════════`;

          locationImages = []; // No saved location images for rabbit holes
          resolvedLocationName = rhLabel;
          resolvedZoneName = matchedType?.type || null;

          console.log(`[RABBIT_HOLE] 🐇 Locked environment: "${rhLabel}" → type: "${matchedType?.type || 'generic'}" | Activity: "${activityLower.substring(0, 60)}"`);
        }

        if (isRabbitHole && !manualLocationId) {
          // Already handled above — skip all other location resolution
        } else if (manualLocationId) {
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

            // ── PAST-EVENT LOCATION OVERRIDE ─────────────────────────────────────
            // If the prompt clearly references a PAST event at a named location (e.g.
            // "send me a pic from yesterday at Jay's"), resolve that location and use it.
            // Future events (going to, later, tonight, etc.) are BLOCKED — they fall
            // through to the livePresence gate so the image shows current location only.
            if (isPastEventImage) {
              const { locationImages: pastImgs, locationName: pastLocName, zoneName: pastZoneName, confidenceScore: pastScore } = resolveLocationAndZone(cleanPrompt, savedLocations, characterId);
              if (pastImgs.length > 0 && pastScore >= 0.7) {
                locationImages = pastImgs;
                resolvedLocationName = pastLocName;
                resolvedZoneName = pastZoneName;
                locationNote = buildRoomLockNote(pastLocName, pastZoneName);
                console.log(`[LOCATION] 📸 PAST-EVENT OVERRIDE: "${pastLocName}" → Zone: "${pastZoneName}" | Score: ${pastScore.toFixed(2)}`);
              }
            }

            if (locationImages.length === 0) {
              // ── AUTHORITATIVE PRESENCE GATE ─────────────────────────────────────
              // No past-event override resolved — use live presence as the scene truth.
              // Future-intent phrases in the prompt DO NOT relocate the scene.
              const livePresence = charRecord?.resolved_presence_status || 'home';
              const isHome = ['home', 'sleeping', 'napping'].includes(livePresence);
              const isAtWork = livePresence === 'at_work';
              const isTraveling = livePresence === 'traveling';

              let authorizedLocId = null;
              if (isHome || (!isAtWork && !isTraveling)) {
                authorizedLocId = charRecord?.current_home_location_id || charRecord?.resolved_current_location_id;
                if (isHome) console.log(`[LOCATION] 🏠 PRESENCE GATE: Character is "${livePresence}" — forcing home location`);
              } else if (isAtWork) {
                authorizedLocId = charRecord?.resolved_current_location_id || charRecord?.occupation_location_id;
                console.log(`[LOCATION] 💼 PRESENCE GATE: Character is at_work — using work location`);
              } else if (isTraveling) {
                authorizedLocId = charRecord?.travel_destination_location_id || charRecord?.resolved_current_location_id;
                console.log(`[LOCATION] 🚗 PRESENCE GATE: Character is traveling`);
              }

              let liveZoneHint = null;
              if (livePresence === 'sleeping' || livePresence === 'napping') liveZoneHint = 'bedroom';
              else if (isHome) liveZoneHint = 'living room';

              let realTimeLoc = authorizedLocId
                ? await base44.asServiceRole.entities.LocationReference.get(authorizedLocId).catch(() => null)
                : null;

              // SAFETY: reject venue location when character is home
              if (realTimeLoc && isHome) {
                const cat = (realTimeLoc.category || '').toLowerCase();
                const isVenueCategory = ['social', 'food_drink', 'workplace', 'gym', 'medical', 'education', 'school', 'community', 'business', 'public'].includes(cat);
                if (isVenueCategory) {
                  console.warn(`[LOCATION] ⛔ MISMATCH: Character is "${livePresence}" but loc is "${cat}". Falling back to home.`);
                  const homeLoc = savedLocations.find(l => l.category === 'home' && (l.resident_character_ids || []).includes(characterId));
                  realTimeLoc = homeLoc || null;
                }
              }

              if (realTimeLoc) {
                // ALWAYS try to resolve zone images first, using sensible defaults
                const defaultZoneHint = liveZoneHint || getDefaultZoneHint(realTimeLoc.category);
                const { zoneImages, zoneName, matchType } = resolveZoneImages(scenePrompt.toLowerCase(), realTimeLoc, defaultZoneHint);
                const imgs = zoneImages.length > 0 ? zoneImages : (realTimeLoc.image_urls || []).slice(0, 6);
                if (imgs.length > 0) {
                  locationImages = imgs;
                  resolvedLocationName = realTimeLoc.name;
                  resolvedZoneName = zoneName || defaultZoneHint;
                  locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
                  const locCat = (realTimeLoc.category || '').toLowerCase();
                  if (locCat === 'home') {
                    const residentNames = [...(realTimeLoc.resident_character_names || []), ...(realTimeLoc.resident_family_members || []).map(r => r.name)].filter(Boolean);
                    const residentList = residentNames.length > 0 ? `Only the following people may appear: ${residentNames.join(', ')}${finalUserSubject?.canonical_name ? `, and ${finalUserSubject.canonical_name}` : ''}. ` : '';
                    locationNote += `\n\n🏠 RESIDENTIAL LOCATION RULE:\nThis is a PRIVATE HOME.\n${residentList}\nNO random strangers, background extras, or unnamed people.`;
                    if (livePresence === 'sleeping' || livePresence === 'napping') {
                      locationNote += `\n\n🔒 SLEEP STATE LOCK:\nThe character is currently SLEEPING at home. The environment MUST be a RESIDENTIAL BEDROOM.\nABSOLUTELY NO commercial, bar, workplace, club, restaurant, gym, or hospital elements.\nNo liquor bottles. No bar stools. No commercial lighting. No venue signage. No bar counters.\nOnly: bed, bedroom furniture, residential walls, home lighting.`;
                    }
                  } else if (['social','food_drink','gym','medical','education','workplace','school','community','outdoor','public','business'].includes(locCat)) {
                    locationNote += `\n\n📍 PUBLIC/COMMERCIAL LOCATION: Background NPCs and ambient crowd are ALLOWED and ENCOURAGED. Diversity in background people is required.`;
                  }
                  console.log(`[LOCATION] ✓ REALTIME: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Presence: "${livePresence}" | Images: ${imgs.length}`);
                } else if (isHome) {
                  locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT (NO REFERENCE IMAGES):\nThis scene takes place inside a private residential home. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. The character is sleeping. Show a bedroom environment ONLY.' : 'Zone: living room or common area.'}\nABSOLUTELY NO commercial elements. No bar. No workplace. No venue. Only home interior.`;
                  resolvedLocationName = realTimeLoc.name;
                  resolvedZoneName = liveZoneHint;
                } else {
                  // Home with a location record but no images
                  resolvedLocationName = realTimeLoc.name;
                  resolvedZoneName = liveZoneHint;
                  locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT (NO REFERENCE IMAGES):\nThis scene takes place inside a private residential home — specifically ${realTimeLoc.name}. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. The character is sleeping. Show a bedroom environment ONLY.' : 'Zone: living room or common area.'}\nABSOLUTELY NO commercial elements. No bar. No workplace. No venue. Only home interior.`;
                }
              } else if (!isHome) {
                // No authorized location found and not home — parse from scene text
                const { locationImages: imgs, locationName, zoneName, confidenceScore } = resolveLocationAndZone(scenePrompt, savedLocations, characterId);
                if (imgs.length > 0 && confidenceScore >= 0.7) {
                  locationImages = imgs;
                  resolvedLocationName = locationName;
                  resolvedZoneName = zoneName;
                  locationNote = buildRoomLockNote(locationName, zoneName);
                  console.log(`[LOCATION] ✓ TEXT PARSE: "${locationName}" → Zone: "${zoneName}" | Score: ${confidenceScore.toFixed(2)}`);
                }
              } else if (isHome && realTimeLoc) {
                // Home with a location but no images — still try zone resolution
                const defaultZoneHint = liveZoneHint || 'living room';
                const { zoneImages, zoneName } = resolveZoneImages(scenePrompt.toLowerCase(), realTimeLoc, defaultZoneHint);
                if (zoneImages.length > 0) {
                  locationImages = zoneImages;
                  resolvedZoneName = zoneName || defaultZoneHint;
                  resolvedLocationName = realTimeLoc.name;
                  locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
                } else {
                  locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT (NO REFERENCE IMAGES):\nThis scene takes place inside a private residential home — specifically ${realTimeLoc.name}. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. The character is sleeping. Show a bedroom environment ONLY.' : 'Zone: living room or common area.'}\nABSOLUTELY NO commercial elements. No bar. No workplace. No venue. Only home interior.`;
                }
              } else {
                // Home with no location record at all
                locationNote = `\n\n🏠 RESIDENTIAL HOME ENVIRONMENT:\nThis scene takes place inside a private residential home. Generate a realistic, lived-in home interior.\n${livePresence === 'sleeping' || livePresence === 'napping' ? 'Zone: BEDROOM. Character is sleeping. Bedroom environment ONLY. NO commercial elements whatsoever.' : ''}\nABSOLUTELY NO bar, club, workplace, restaurant, gym, or any commercial environment.`;
              }
            }
          }
        }
        } // end else (non-creative / presence-scene branch)
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
      // Order: char face refs (2) → user face refs (2) → location (2)
      const charSlice = finalCharSubject.face_refs.slice(0, 2);
      const userSlice = finalUserSubject.face_refs.slice(0, 2);
      const locSlice = locationImages.slice(0, 2);
      referenceImages = [...charSlice, ...userSlice, ...locSlice].filter(Boolean);
      console.log(`[REFS] Multi-subject: char=${charSlice.length} + user=${userSlice.length} + loc=${locSlice.length} = ${referenceImages.length} total`);
    } else if (finalUserSubject && !finalCharSubject) {
      // USER-ONLY MODE
      referenceImages = finalUserSubject.face_refs.slice(0, 2);
      console.log(`[REFS] User-only: ${referenceImages.length} refs`);
    } else if (finalCharSubject) {
      // CHARACTER-ONLY MODE
      // CRITICAL ORDERING: Location images FIRST (environment lock), then character (identity lock)
      // Avatar background is ignored for scenery by virtue of being AFTER location images in the sequence.
      const locSlice = locationImages.slice(0, 3);  // Location images first — environment lock
      const charSlice = finalCharSubject.face_refs.slice(0, 2);  // Max 2 char refs to avoid filter triggers
      referenceImages = [...locSlice, ...charSlice].filter(Boolean);
      console.log(`[REFS] Character-only (location-first): loc=${locSlice.length} + char=${charSlice.length} = ${referenceImages.length} total`);
    } else {
      referenceImages = locationImages.slice(0, 5);
    }

    // ── STEP 5: BUILD PROMPT FROM SUBJECT RECORDS ────────────────────────────
    // Outfit overrides FIRST (highest priority), then scene, then identity locks.
    // This order ensures the model processes outfit constraints before rendering.
    
    // ── PRISON/JAIL SCENE DETECTION ─────────────────────────────────────────
    // AI models refuse to generate images of prison/jail settings
    const isPrisonScene = /\b(prison|jail|jailed|incarcerated|visitation|visiting|cell|inmate)\b/i.test(cleanPrompt);
    if (isPrisonScene) {
      console.log(`[PRISON_SCENE] Blocked: AI cannot generate prison/jail imagery`);
      return Response.json({ success: false, error: 'Image generation is not available for prison or jail settings. Try a different scene or location.' }, { status: 400 });
    }
    
    let promptForGeneration = cleanPrompt;
    
    // ── EMOTIONAL EXPRESSION DIRECTIVE ────────────────────────────────────────
    const emotionalStateMap = {
      calm: 'neutral, serene expression',
      irritated: 'slightly annoyed expression, subtle frown',
      defensive: 'guarded expression, tensed jaw',
      reflective: 'thoughtful, distant gaze, contemplative expression',
      'closed-off': 'withdrawn expression, minimal emotion',
      flirtatious: 'playful smile, warm eyes',
      bored: 'disengaged expression, blank stare',
      'burnt out': 'tired, weary expression, exhausted look',
      joyful: 'genuine smile, warm expression',
      anxious: 'tense expression, worried eyes',
      sad: 'downturned mouth, melancholic expression',
      excited: 'big smile, bright eyes, animated expression',
      overwhelmed: 'stressed expression, wide eyes',
      content: 'subtle smile, relaxed expression',
      frustrated: 'tightened jaw, furrowed brow, irritated eyes',
      angry: 'intense frown, sharp eyes, aggressive expression',
      confused: 'raised eyebrows, uncertain expression',
      hopeful: 'slight smile, bright eyes, optimistic expression',
      depressed: 'blank stare, downturned mouth, lifeless expression',
      neutral: 'neutral, expressionless face',
    };
    
    const emotionalExpression = emotionalStateMap[characterEmotionalState?.toLowerCase()] || 'natural, neutral expression';
    const expressionNote = `\nFacial Expression: ${emotionalExpression}. Ensure the expression and body language reflect this emotional state.`;
    
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

      const refOrderNote = `Two subjects: ${charName} and ${userName}. Keep their appearances and outfits distinct.`;

      enhancedPrompt = `${charOutfitBlock}${userOutfitBlock}\n\n${promptForGeneration}${expressionNote}${locationNote}${charIdentityBlock}${userIdentityBlock}\n\n${refOrderNote}`;

    } else if (finalUserSubject && !finalCharSubject) {
      // ── USER-ONLY PROMPT ────────────────────────────────────────────────────
      const userName = finalUserSubject.canonical_name;
      const userOutfitBlock = buildSubjectOutfitBlock(finalUserSubject);
      const userIdentityBlock = finalUserSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalUserSubject, 1, Math.min(finalUserSubject.face_refs.length, 4))
        : '';
      enhancedPrompt = `${userOutfitBlock}\n\n${promptForGeneration}${expressionNote}${locationNote}${userIdentityBlock}`;

    } else if (finalCharSubject) {
      // ── CHARACTER-ONLY PROMPT ───────────────────────────────────────────────
      const charName = finalCharSubject.canonical_name;
      const charOutfitBlock = buildSubjectOutfitBlock(finalCharSubject);
      // If no outfit block (sensitive outfit filtered out), add a safe clothing note
      // so the model doesn't pick up nudity cues from reference images
      const safeClothingNote = !charOutfitBlock && !cleanPrompt.toLowerCase().includes('shirt') && !cleanPrompt.toLowerCase().includes('wear') && !cleanPrompt.toLowerCase().includes('outfit')
        ? `\nNote: Ensure the subject is wearing appropriate casual clothing suitable for the scene.\n`
        : '';
      const locRefEnd = Math.min(locationImages.length, 3);
      const charRefStart = locRefEnd + 1;
      const charRefEnd = locRefEnd + Math.min(finalCharSubject.face_refs.length, 4);
      const charIdentityBlock = finalCharSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalCharSubject, charRefStart, charRefEnd)
        : '';

      const roomInstruction = '';
      enhancedPrompt = `${charOutfitBlock}${safeClothingNote}\n\n${promptForGeneration}${expressionNote}${locationNote}${charIdentityBlock}`;

    } else {
      // No subjects resolved — pure environment/text render
      enhancedPrompt = `${promptForGeneration}${locationNote}`;
    }

    // ── LIVE LOCATION TRUTH INJECTION ────────────────────────────────────────
    // Inject authoritative live location context for presence-based scenes ONLY.
    // Creative generations skip this — the user's prompt is the source of truth there.
    if (imageMode === 'presence_scene' && liveLocationContext && liveLocationContext.trim()) {
      enhancedPrompt = `${liveLocationContext}\n\n${enhancedPrompt}`;
      console.log(`[LOCATION_SYNC] Live location context injected into prompt.`);
    }

    const finalPrompt = enhancedPrompt;

    // ── PRE-GENERATION VALIDATION (log only — no early exit) ─────────────────
    // Log location truth for traceability. If location name not in prompt, inject it.
    // CRITICAL: Do NOT branch into a separate generation here — use a single code path only.
    console.log(`[GENERATION_GATE] messageId=${messageId} | character_id=${characterId || 'none'} | subject_type=${resolvedSubjectType} | imageMode=${imageMode}`);
    console.log(`[GENERATION_GATE] Location truth: resolved="${resolvedLocationName}" | zone="${resolvedZoneName}" | hasLocationImages=${hasLocationImages}`);
    console.log(`[GENERATION_GATE] Reference images (${referenceImages.length}): ${referenceImages.map(r => r.substring(0, 60)).join(' | ')}`);

    let activeFinalPrompt = finalPrompt;
    if (hasLocationImages && resolvedLocationName) {
      const locLower = resolvedLocationName.toLowerCase();
      const zoneLower = (resolvedZoneName || '').toLowerCase();
      const promptLower = finalPrompt.toLowerCase();
      if (!promptLower.includes(locLower) && !promptLower.includes(zoneLower)) {
        console.warn(`[GENERATION_GATE] ⚠️ Location not referenced in prompt — injecting location lock`);
        activeFinalPrompt = finalPrompt + `\n\nSCENE LOCATION (LOCKED): ${resolvedLocationName}${resolvedZoneName ? ` → ${resolvedZoneName}` : ''}. The image MUST depict this exact location.`;
      }
    }

    // ── STEP 6.5: SANITIZE REFERENCE IMAGES ─────────────────────────────────
    // Strip any private/internal URLs — the generation provider only accepts public HTTPS CDN URLs.
    // Private app file URLs (/api/apps/... or non-https) will cause "None of the provided image URLs
    // contained valid image data" errors (400/500). Filter them out before sending.
    const isPublicImageUrl = (url) => {
      if (!url || typeof url !== 'string') return false;
      if (!url.startsWith('https://')) return false;
      // Reject internal Base44 app file URLs — the generation provider cannot access these
      // Pattern: https://base44.app/api/apps/{id}/files/...
      if (url.includes('base44.app/api/apps/')) return false;
      // Also reject any other /api/apps/ internal path patterns
      if (url.includes('/api/apps/') && url.includes('/files/')) return false;
      return true;
    };
    const sanitizedReferenceImages = referenceImages.filter(isPublicImageUrl);
    if (sanitizedReferenceImages.length !== referenceImages.length) {
      console.warn(`[generateImageAsync] ⚠ Stripped ${referenceImages.length - sanitizedReferenceImages.length} non-public URLs from referenceImages. Remaining: ${sanitizedReferenceImages.length}`);
    }

    // ── STEP 7: GENERATE IMAGE (SINGLE CODE PATH) ────────────────────────────
    console.log(`[generateImageAsync] SENDING TO GENERATOR | messageId=${messageId} | promptLength=${activeFinalPrompt.length} | refs=${sanitizedReferenceImages.length}`);
    
    const response = await base44.integrations.Core.GenerateImage({
      prompt: activeFinalPrompt,
      existing_image_urls: sanitizedReferenceImages.length > 0 ? sanitizedReferenceImages : undefined,
    });

    if (response?.url) {
      const generationContext = {
        message_id: messageId, // explicit lineage — this context belongs to THIS message only
        prompt: cleanPrompt,
        character_id: characterId || null,
        character_name: finalCharSubject?.canonical_name || null,
        character_reference_images: finalCharSubject?.face_refs.slice(0, 4) || [],
        location_id: manualLocationId || null,
        zone_name: resolvedZoneName || null,
        location_name: resolvedLocationName || null,
        location_reference_images: locationImages.slice(0, 3),
        subject_type: resolvedSubjectType,
        image_mode: imageMode,
        user_reference_images: finalUserSubject?.face_refs.slice(0, 4) || [],
        user_appearance_data: finalUserSubject ? { appearance_text: finalUserSubject.appearance_text, lock_text: finalUserSubject.lock_text } : null,
        is_user_identity_locked: needsUserSubject,
        subjects_rendered: subjects.map(s => ({ id: s.subject_id, name: s.canonical_name, type: s.subject_type, ref_count: s.face_refs.length, has_outfit: !!s.outfit_desc })),
        generated_at: new Date().toISOString(),
      };
      console.log(`[generateImageAsync] ✓ SUCCESS: messageId=${messageId} | character="${generationContext.character_name}" | imageUrl=${response.url.substring(0, 60)}...`);
      await base44.entities.Message.update(messageId, {
        image_url: response.url,
        generation_context: generationContext,
      });
      return Response.json({
        success: true,
        imageUrl: response.url,
        messageId, // echo back for frontend verification
        locationMatched: hasLocationImages,
        locationName: resolvedLocationName,
        zoneName: resolvedZoneName,
      });
    }

    // No image URL returned — mark the message so the frontend knows generation failed
    console.error(`[generateImageAsync] Generation returned no URL for message ${messageId}`);
    await base44.entities.Message.update(messageId, {
      content: '[IMAGE_FAILED]',
    }).catch(() => {});
    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    console.error('[generateImageAsync] Fatal error:', error.message);
    // Mark the message as failed so the real-time subscription fires and the UI can react
    try {
      await base44.entities.Message.update(messageId, {
        content: '[IMAGE_FAILED]',
      }).catch(() => {});
    } catch (_) {}
    return Response.json({ error: error.message }, { status: 500 });
  }
});