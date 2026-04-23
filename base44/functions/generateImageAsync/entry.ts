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
  return `
🔒 ENVIRONMENT LOCK — ${[locationName, zoneName].filter(Boolean).join(' → ')}:
Use the reference photographs to match EXACTLY: flooring material and color, wall color and finish, furniture pieces and positions, lighting fixtures, window treatments, and decorative objects.
Generate the scene from a natural camera angle. All architectural and furnishing elements must remain identical to the references.
The subject is placed naturally within this exact space.
⛔ Do NOT substitute a different room, background, or setting.`;
}

// ── SCENE ACTION LOCK EXTRACTOR ───────────────────────────────────────────────
// Extracts specific scene-critical actions and objects from the prompt and
// generates an explicit enforcement block that is prepended to the final prompt.
// This prevents the model from collapsing a detailed action scene into a generic portrait.
function buildSceneActionLockBlock(promptText) {
  const pl = promptText.toLowerCase();
  const mandatoryElements = [];

  // Food / eating actions
  if (/\b(pancake|waffle|toast|egg|bacon|cereal|oatmeal|breakfast|brunch)\b/.test(pl)) {
    const food = pl.match(/\b(stack of pancakes?|pancakes?|waffles?|toast|eggs?|bacon|cereal|oatmeal|breakfast food)\b/)?.[0] || 'breakfast food';
    mandatoryElements.push(`✅ FOOD OBJECT REQUIRED: ${food} must be visibly present in the scene`);
  }
  if (/\b(eating|mid.bite|biting into|chewing|taking a bite|fork|spoon|mug|coffee|drink|sip|drinking)\b/.test(pl)) {
    const action = pl.match(/\b(mid.bite|eating|biting into|taking a bite|sipping|drinking)\b/)?.[0] || 'eating/drinking';
    mandatoryElements.push(`✅ ACTION REQUIRED: character must be shown ${action}`);
  }
  if (/\b(syrup|sauce|drip|dripping|glaze)\b/.test(pl)) {
    mandatoryElements.push(`✅ DETAIL REQUIRED: syrup/sauce dripping or visible on food/lip/face as described`);
  }

  // Furniture / room-specific objects
  if (/\b(kitchen table|dining table|wooden table|table)\b/.test(pl)) {
    mandatoryElements.push(`✅ SETTING REQUIRED: character must be seated at a table`);
  }
  if (/\b(kitchen|stove|counter|refrigerator|fridge|microwave)\b/.test(pl)) {
    mandatoryElements.push(`✅ ROOM REQUIRED: scene must be set in a kitchen — not a living room, bedroom, or generic indoor space`);
  }
  if (/\b(couch|sofa|bed|floor)\b/.test(pl) && !/\b(kitchen|table|eating)\b/.test(pl)) {
    mandatoryElements.push(`✅ FURNITURE: character is on/near ${pl.match(/\b(couch|sofa|bed|floor)\b/)?.[0]}`);
  }

  // Lighting / time of day
  if (/\b(morning|sunrise|dawn|golden hour|afternoon|sunset|night|evening|sunlight|natural light)\b/.test(pl)) {
    const lighting = pl.match(/\b(morning sunlight|golden hour|afternoon light|evening light|soft natural light|bright morning|sunlight streaming)\b/)?.[0]
      || pl.match(/\b(morning|afternoon|evening|night|sunrise|sunset)\b/)?.[0];
    if (lighting) mandatoryElements.push(`✅ LIGHTING: scene lighting must reflect "${lighting}"`);
  }

  // Style directives
  if (/\b(smartphone|phone photo|candid|selfie|portrait mode)\b/.test(pl)) {
    mandatoryElements.push(`✅ STYLE: photorealistic smartphone-photo look — natural grain, real-world depth, NOT studio lighting`);
  }

  // Expressions
  if (/\b(smiling|laughing|playful|warm|serious|looking up|looking at camera|glancing)\b/.test(pl)) {
    const expr = pl.match(/\b(warm.*smile|playful.*expression|looking up at camera|glancing|laughing)\b/)?.[0]
      || pl.match(/\b(smiling|laughing|playful|warm|looking up|looking at camera)\b/)?.[0];
    if (expr) mandatoryElements.push(`✅ EXPRESSION: "${expr}" must be visible`);
  }

  if (mandatoryElements.length === 0) return '';

  return `\n\n🎬 SCENE ACTION LOCK — ALL ELEMENTS BELOW ARE MANDATORY. DO NOT OMIT ANY:\n${mandatoryElements.join('\n')}\nIf ANY of the above elements are missing from the generated image, the result is WRONG. Generate the complete scene as described.\n`;
}

// ── SUBJECT RECORD BUILDERS ──────────────────────────────────────────────────
// These functions build structured subject objects from raw data.
// Images and prompts are assembled FROM these records — never the other way around.

// ── PROVIDER ACCESSIBILITY FILTER ────────────────────────────────────────────
// CRITICAL: Generation provider can ONLY fetch:
// 1. media.base44.com CDN URLs (public storage, no auth required)
// 2. External HTTPS CDNs (public, no auth required)
//
// CANNOT fetch:
// 1. base44.app/api/apps/ paths — require API auth + session, provider has none
// 2. Signed/expiring URLs with ?token=, ?signed=, X-Amz-Signature — unstable
//
// /files/mp/public/ inside base44.app paths is still API-gated — provider cannot reach it.
// /files/mp/private/ is explicitly private storage — doubly inaccessible.
//
// This filter is applied at SUBJECT BUILD TIME (Step 1) and STEP 6.5 (safety net).
function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  // Truly private storage — requires authentication
  if (url.includes('/files/mp/private/')) return false;
  if (url.includes('/files/private/')) return false;
  // Signed / time-limited URLs — provider cannot use them
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  // base44 API paths — require session/auth, provider has neither
  // CRITICAL: even /files/mp/public/ inside base44.app is API-gated
  if (url.includes('base44.app/api/apps/')) return false;
  // media.base44.com CDN and all external HTTPS CDN URLs are provider-accessible
  return true;
}

/**
 * MANDATORY CHARACTER FILE RESOLUTION
 * Check character file fields in strict priority order.
 * Do NOT skip levels or use avatar background as fallback.
 */
async function resolveCharacterLocationFromFile(charRecord) {
  const result = {
    locationId: null,
    source: null,
    presence: charRecord?.resolved_presence_status || 'home',
  };

  // STRICT PRIORITY ORDER — do not skip or reorder
  if (charRecord?.resolved_current_location_id) {
    result.locationId = charRecord.resolved_current_location_id;
    result.source = 'character.resolved_current_location_id (PRIMARY)';
  } else if (charRecord?.current_home_location_id) {
    result.locationId = charRecord.current_home_location_id;
    result.source = 'character.current_home_location_id (SECONDARY)';
  } else if (charRecord?.home_location_id) {
    result.locationId = charRecord.home_location_id;
    result.source = 'character.home_location_id (TERTIARY)';
  } else if (charRecord?.current_work_location_id) {
    result.locationId = charRecord.current_work_location_id;
    result.source = 'character.current_work_location_id (WORK)';
  } else if (charRecord?.occupation_location_id) {
    result.locationId = charRecord.occupation_location_id;
    result.source = 'character.occupation_location_id (FALLBACK)';
  }

  console.log(`[LOC_RESOLVE] Character file: ${result.source || 'NOT FOUND'} | locId=${result.locationId || 'null'}`);
  return result;
}

function buildCharacterSubject(charRecord, clientRefs = [], clientPromptContext = '') {
  // Build server refs — filter to PUBLIC URLS ONLY at source
  // Private internal URLs (base44.app/api/apps/...) cannot be accessed by the generation provider
  // and would be silently stripped later, reducing identity ref count without warning.
  // By filtering here we know exactly how many valid identity refs we have BEFORE dispatch.
  const serverRefs = [];
  if (charRecord.avatar_url && isProviderAccessible(charRecord.avatar_url)) serverRefs.push(charRecord.avatar_url);
  else if (charRecord.avatar_url) console.warn(`[SUBJECT] avatar_url is inaccessible to provider — excluded: ${charRecord.avatar_url?.substring(0, 60)}`);
  if (charRecord.reference_image_urls?.length > 0) {
    for (const url of charRecord.reference_image_urls) {
      if (isProviderAccessible(url)) serverRefs.push(url);
      else console.warn(`[SUBJECT] reference_image_url inaccessible to provider — excluded: ${url?.substring(0, 60)}`);
    }
  }
  // Client refs are fallback only — also filter for provider-accessible URLs
  const publicClientRefs = (clientRefs || []).filter(isProviderAccessible);
  const faceRefs = serverRefs.length > 0 ? serverRefs : publicClientRefs;
  console.log(`[SUBJECT] Character identity refs: server=${serverRefs.length} | clientFallback=${publicClientRefs.length} | using=${faceRefs.length}`);

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
  // Priority: uploaded reference photos → generated avatars — public URLs only
  const uploadedRefs = (sett.reference_image_urls || []).filter(isProviderAccessible);
  const generatedRefs = (sett.generated_avatar_urls || []).filter(isProviderAccessible);
  const faceRefs = [...uploadedRefs, ...generatedRefs];
  const publicClientRefs = (clientRefs || []).filter(isProviderAccessible);
  const resolvedFaceRefs = faceRefs.length > 0 ? faceRefs : publicClientRefs;
  console.log(`[SUBJECT] User identity refs: uploaded=${uploadedRefs.length} | generated=${generatedRefs.length} | clientFallback=${publicClientRefs.length} | using=${resolvedFaceRefs.length}`);

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

// ── OUTFIT OVERRIDE DETECTOR ─────────────────────────────────────────────────
// If the prompt explicitly describes clothing worn by the character, the prompt
// takes priority over the character's closet outfit. This prevents the closet
// from overriding what the user explicitly asked for (e.g. "white tank top").
function promptExplicitlyDescribesOutfit(promptText) {
  const pl = promptText.toLowerCase();
  return /\b(wearing|dressed in|in a|has on|sports a|rocking a|wears)\b.{0,60}\b(shirt|tank|top|tee|hoodie|jacket|coat|dress|jeans|shorts|pants|sweat|suit|uniform|outfit|blouse|sweater|vest|cardigan)\b/i.test(pl)
    || /\b(white|black|grey|gray|blue|red|green|yellow|brown|navy|pink|purple|khaki|beige)\s+(ribbed|fitted|loose|oversized|slim|baggy)?\s*(tank|shirt|tee|top|hoodie|jacket|coat|dress|jeans|shorts|pants)\b/i.test(pl);
}

function buildSubjectOutfitBlock(subject, promptText = '') {
  // If the prompt already explicitly describes the outfit, do NOT inject closet outfit
  // This prevents the closet from overriding what the prompt already specified
  if (promptText && promptExplicitlyDescribesOutfit(promptText)) {
    console.log(`[OUTFIT] Prompt explicitly describes clothing — skipping closet outfit injection for ${subject.canonical_name}`);
    return '';
  }
  if (!subject.outfit_desc) return '';
  const name = subject.canonical_name;
  let outfitDesc = subject.outfit_desc;
  const sensitivePatterns = [
    /wearing only\s+/gi,
    /shirtless/gi,
    /topless/gi,
    /no (shirt|top|clothes)/gi,
    /bare (chest|torso|skin|body)/gi,
    /slight sheen of moisture/gi,
    /boxer/gi,
    /underwear/gi,
    /bra\b/gi,
    /naked/gi,
    /nude/gi,
    /lingerie/gi,
    /bikini/gi,
  ];
  const isSensitive = sensitivePatterns.some(p => p.test(outfitDesc));
  if (isSensitive) {
    return `\n${name} is wearing casual everyday clothing suitable for the scene.\n`;
  }
  return `\n${name}'s clothing: ${outfitDesc}\n`;
}

// ══════════════════════════════════════════════════════════════════════════════
// REFERENCE ROLE WEIGHTING RULES — DO NOT MODIFY
// These rules define the exact influence each reference source has.
//
// A. CHARACTER IDENTITY REFS (avatar + character_reference_images):
//    - Influence: 90–100% on the PERSON's physical identity ONLY
//    - Includes: face shape, skin tone, hair, body type, tattoos, markings
//    - EXCLUDES: background, room, environment, scenery, lighting setup
//
// B. AVATAR BACKGROUND / SCENERY:
//    - Influence: 0% — ZERO — NEVER used for environment
//    - Must be completely ignored as a scene/location signal
//
// C. LOCATION / ZONE REFERENCE IMAGES:
//    - Influence: 80% on the ENVIRONMENT — room, building, furniture, layout
//    - These images define the place: flooring, walls, furniture, windows, decor
//    - Camera angle and subject placement may vary; environment must not
//
// D. PROMPT SCENE DETAILS:
//    - Controls: action, pose, objects, expression, framing, room type keyword
//    - Examples: eating pancakes, syrup on lip, wooden kitchen table, morning sunlight
// ══════════════════════════════════════════════════════════════════════════════

function buildSubjectIdentityBlock(subject, imageIndexStart, imageIndexEnd, hasLocationImages = false) {
  const name = subject.canonical_name;
  const lockDesc = subject.lock_text ? `Appearance details: ${subject.lock_text}.` : '';
  const ethnicityWarning = subject.ethnicities?.length > 0
    ? `Ethnicity: ${subject.ethnicities.join(', ')}.`
    : '';

  // ALWAYS enforce hard 0% on avatar background — strength does not vary
  const bgSuppression = hasLocationImages
    ? `⛔ AVATAR BACKGROUND = 0% INFLUENCE: The room, walls, furniture, window, lighting, or any scenery visible BEHIND the person in these reference photos must be completely ignored. That background is IRRELEVANT. The scene environment is defined by the LOCATION REFERENCE IMAGES above, not by anything behind this person.`
    : `⛔⛔ AVATAR BACKGROUND = 0% INFLUENCE — NO LOCATION IMAGES PROVIDED: The background behind this person in the reference photos is RANDOM and COMPLETELY UNRELATED to this scene. It must be ENTIRELY IGNORED. DO NOT replicate any room, furniture, wall, window, or background element from these photos. Build the scene 100% from the text prompt above.`;

  return `\n\n════════════════════════════════════════════════════════════
CHARACTER IDENTITY LOCK — ${name}
Reference images ${imageIndexStart}–${imageIndexEnd} = PERSON IDENTITY ONLY (90–100% influence on the person)
════════════════════════════════════════════════════════════
USE THESE IMAGES FOR (person only):
  ✓ Face structure, jaw, cheekbones, forehead, chin
  ✓ Eye shape, size, spacing, color
  ✓ Nose shape, lip shape, mouth structure  
  ✓ Skin tone, complexion, texture, marks
  ✓ Hair color, texture, cut, length, style
  ✓ Body type, build, height proportions
  ✓ Facial hair, tattoos, markings

DO NOT USE THESE IMAGES FOR (0% influence):
  ✗ Room, background, scenery, furniture
  ✗ Walls, floor, ceiling, windows, curtains
  ✗ Lighting setup from avatar background
  ✗ Any environmental element

${bgSuppression}
${ethnicityWarning}${subject.appearance_text ? ` Additional identity context: ${subject.appearance_text}.` : ''}${lockDesc ? ` ${lockDesc}` : ''}`;
}

function buildEnvironmentLockBlock(locationName, zoneName, envImageIndexStart, envImageIndexEnd) {
  const place = zoneName ? `${locationName} → ${zoneName}` : locationName;
  return `\n\n════════════════════════════════════════════════════════════
SCENE ENVIRONMENT LOCK — "${place}"
Reference images ${envImageIndexStart}–${envImageIndexEnd} = ENVIRONMENT AUTHORITY (80% influence on room/location)
════════════════════════════════════════════════════════════
These images define the PHYSICAL ENVIRONMENT of the scene. Match from these references:
  ✓ Flooring type and material
  ✓ Wall color, texture, and finish
  ✓ Furniture pieces, positions, and style
  ✓ Lighting fixtures and natural light direction
  ✓ Windows, curtains, window treatments
  ✓ Decorative objects, plants, art
  ✓ Spatial layout and room proportions

Camera angle and subject placement may vary freely.
Environment (room structure, furniture, walls) must remain consistent with these references.
⛔ DO NOT use the background from any character reference image as the scene environment.
⛔ DO NOT substitute a different room, building, or setting.`;
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

    // Use asServiceRole so this works regardless of who created the message (RLS safe)
    let message = null;
    try {
      message = await base44.asServiceRole.entities.Message.get(messageId);
    } catch (_) {
      const list = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
      message = list?.[0] || null;
    }
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
    let _cachedCharRecord = null; // shared — avoids duplicate DB calls in rabbit hole + presence gates

    // Resolve character subject — RLS on Character entity blocks asServiceRole by id alone.
    // Use user-scoped client (base44.entities) as the primary method since the request
    // carries the user's auth token via createClientFromRequest(req).
    if (characterId) {
      try {
        let charRecord = null;
        // Primary: user-scoped filter (respects RLS naturally, finds chars owned by this user)
        const charListUser = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
        charRecord = charListUser?.[0] || null;
        if (charRecord) console.log(`[SUBJECT] ✓ Character found via user-scoped filter: "${charRecord.name}"`);

        // Fallback 1: asServiceRole .get()
        if (!charRecord) {
          charRecord = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
          if (charRecord) console.log(`[SUBJECT] ✓ Character found via asServiceRole.get(): "${charRecord.name}"`);
        }
        // Fallback 2: asServiceRole filter by id
        if (!charRecord) {
          const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
          charRecord = charList?.[0] || null;
          if (charRecord) console.log(`[SUBJECT] ✓ Character found via asServiceRole filter: "${charRecord.name}"`);
        }
        // Fallback 3: asServiceRole filter by id + created_by
        if (!charRecord && message?.created_by) {
          const charList2 = await base44.asServiceRole.entities.Character.filter({ id: characterId, created_by: message.created_by }, null, 1).catch(() => []);
          charRecord = charList2?.[0] || null;
          if (charRecord) console.log(`[SUBJECT] ✓ Character found via created_by filter: "${charRecord.name}"`);
        }

        _cachedCharRecord = charRecord; // cache for reuse below
        if (charRecord) {
          characterSubject = buildCharacterSubject(charRecord, characterReferenceImages || [], scenePrompt);
          console.log(`[SUBJECT] Character locked: "${characterSubject.canonical_name}" | refs: ${characterSubject.face_refs.length} | outfit: ${characterSubject.outfit_desc ? 'yes' : 'none'}`);
        } else {
          // Character record not found in DB — use client-provided refs as fallback
          const publicClientRefs = (characterReferenceImages || []).filter(isPublicUrl);
          console.warn(`[SUBJECT] Character ${characterId} not found in DB via any method | clientRefs total=${characterReferenceImages?.length || 0} | publicClientRefs=${publicClientRefs.length}`);
          const filteredClientRefs = (characterReferenceImages || []).filter(isProviderAccessible);
          if (filteredClientRefs.length > 0) {
            characterSubject = {
              subject_type: 'character',
              subject_id: characterId,
              canonical_name: characterName || 'the character',
              face_refs: filteredClientRefs.slice(0, 3),
              outfit_desc: null,
              outfit_owner_id: characterId,
              appearance_text: '',
              lock_text: '',
              ethnicities: [],
              explicitly_selected: true,
            };
            console.warn(`[SUBJECT] Using client-provided public refs only (${publicClientRefs.length}) — DB record unavailable`);
          } else {
            console.warn(`[SUBJECT] ⚠ CHARACTER IDENTITY: characterId=${characterId} not found via any DB method AND no public client refs. Generation proceeds with text-only identity.`);
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
        // Reuse already-fetched message record — avoids second DB call and RLS issues
        const createdBy = message?.created_by;
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
    // MANDATORY MULTI-SOURCE LOCATION RESOLUTION
    // Before any image generation, the system MUST resolve where the character is
    // by checking authoritative records in order:
    // 1. Character file location fields (primary truth)
    // 2. LocationReference records (zone/image authority)
    // 3. Manual user selections (override when provided)
    // 4. Live presence context (fallback to current state)
    //
    // CRITICAL: Do NOT infer room type from character avatar background.
    // Avatar images are for character identity only (face, skin, hair, body type).
    // Environment comes ONLY from location resources and location records.
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
        //   3. character file + location records → authoritative location truth
        //   4. unresolved → text-based parse against saved locations
        //   5. home with no images → HALT (do not use avatar background)
        // ══════════════════════════════════════════════════════════════════════

        if (imageMode === 'creative') {
          // ── CREATIVE MODE — user-directed generation (media grid, prompt, concept) ──
          // Priority: explicit manualLocationId selection → caller-provided locationReferenceImages → prompt only.
          // Never fall through to presence-based location logic in creative mode.
          if (manualLocationId) {
            // User explicitly selected a location (and optionally a zone) in Media Grid.
            // Resolve it directly — do NOT run rabbit hole / presence gate logic.
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
                  console.log(`[LOCATION] 🎨 CREATIVE+MANUAL ZONE: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Images: ${imgs.length}`);
                }
              }
              if (imgs.length === 0 && locationReferenceImages?.length > 0) {
                // Caller pre-fetched zone images — use them directly
                imgs = locationReferenceImages.slice(0, 6);
                resolvedZoneName = manualZoneId || null;
                console.log(`[LOCATION] 🎨 CREATIVE+MANUAL caller-provided zone refs: ${imgs.length}`);
              }
              if (imgs.length === 0) {
                const firstZoneWithImages = manualLoc.zones?.find(z => z.image_urls?.length > 0);
                imgs = firstZoneWithImages?.image_urls?.slice(0, 6) || manualLoc.image_urls?.slice(0, 6) || [];
                resolvedZoneName = firstZoneWithImages?.zone_name || null;
              }
              locationImages = imgs;
              locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
              if (resolvedZoneName) {
                locationNote += `\n\n🔒 ZONE LOCK: Scene MUST be in the "${resolvedZoneName}" zone of ${resolvedLocationName}. Do NOT place the scene anywhere else.`;
              }
              console.log(`[LOCATION] 🎨 CREATIVE MANUAL RESOLVED: "${resolvedLocationName}" → zone="${resolvedZoneName || 'none'}" | imgs=${locationImages.length}`);
            }
          } else if (locationReferenceImages?.length > 0) {
            locationImages = locationReferenceImages.slice(0, 6);
            console.log(`[LOCATION] 🎨 CREATIVE MODE — using caller-provided location reference images: ${locationImages.length}`);
          } else {
            console.log(`[LOCATION] 🎨 CREATIVE MODE — no location selected. User prompt is scene authority.`);
          }
        } else {

        // ── RABBIT HOLE GATE (PRIORITY OVERRIDE) ──────────────────────────────
        // Reuse the already-fetched character record from Step 1 — no second DB call needed.
        // _cachedCharRecord is set below from the same characterSubject lookup.
        const charForRabbitCheck = _cachedCharRecord;
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

            // ── ZONE RESOLUTION PRIORITY ──────────────────────────────────────────
            // 1. Explicit zone selected → use that zone's images
            // 2. No zone selected → use first zone with images
            // 3. No zones at all → use flat location image_urls
            // 4. Nothing found → use strong text-only environment lock (never avatar background)
            if (manualZoneId && manualLoc.zones?.length > 0) {
              const zone = manualLoc.zones.find(z => z.zone_name === manualZoneId)
                        || manualLoc.zones.find(z => z.zone_name?.toLowerCase() === manualZoneId?.toLowerCase());
              if (zone?.image_urls?.length > 0) {
                imgs = zone.image_urls.slice(0, 6);
                resolvedZoneName = zone.zone_name;
                console.log(`[LOCATION] ✓ MANUAL ZONE (explicit): "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Images: ${imgs.length}`);
              } else {
                console.warn(`[LOCATION] ⚠ MANUAL ZONE "${manualZoneId}" selected but has no images — falling back to first zone with images`);
              }
            }

            // No zone selected or zone had no images — use first zone with images
            if (imgs.length === 0 && manualLoc.zones?.length > 0) {
              const firstZoneWithImages = manualLoc.zones.find(z => z.image_urls?.length > 0);
              if (firstZoneWithImages) {
                imgs = firstZoneWithImages.image_urls.slice(0, 6);
                resolvedZoneName = firstZoneWithImages.zone_name;
                console.log(`[LOCATION] ✓ MANUAL first-zone fallback: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Images: ${imgs.length}`);
              }
            }

            // No zones at all — use flat location images
            if (imgs.length === 0 && manualLoc.image_urls?.length > 0) {
              imgs = manualLoc.image_urls.slice(0, 6);
              resolvedZoneName = null;
              console.log(`[LOCATION] ✓ MANUAL flat images: "${resolvedLocationName}" | Images: ${imgs.length}`);
            }

            locationImages = imgs;

            if (imgs.length > 0) {
              locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
              if (resolvedZoneName) {
                locationNote += `\n\n🔒 ZONE ENFORCEMENT: The scene MUST take place in the "${resolvedZoneName}" zone of ${resolvedLocationName}. Do NOT place the scene in any other room or area within this location.`;
              }
              console.log(`[LOCATION] ✓ MANUAL RESOLVED: "${resolvedLocationName}" → zone="${resolvedZoneName || 'none'}" | imgs=${locationImages.length}`);
            } else {
              // ── HARD HALT: manually selected location has NO reference images ──────────
              // This is the same failure as the presence_scene case: without real reference
              // images, the provider has no environment authority. Avatar background WILL
              // fill the vacuum. Text-only lock is not sufficient — it is not enforced.
              console.error(`[LOCATION] ⛔ HARD HALT — manually selected location "${resolvedLocationName}" (id=${manualLocationId}) has ZERO images.`);
              console.error(`[LOCATION] zones=${manualLoc.zones?.length || 0} | zones_with_images=${(manualLoc.zones || []).filter(z => z.image_urls?.length > 0).length} | flat_image_urls=${(manualLoc.image_urls || []).length}`);
              console.error(`[LOCATION] manualZoneId="${manualZoneId || 'none'}" | A text-only lock CANNOT enforce 80% environment authority.`);
              console.error(`[LOCATION] Without location reference images, the provider will anchor on avatar background. This is not acceptable.`);
              console.error(`[LOCATION] FIX: Add reference photos (zone images or flat images) to this location record.`);
              await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
              return Response.json({
                success: false,
                error: `Location "${resolvedLocationName}" has no reference images. Add photos to this location (or its zones) before generating images from it.`,
                location_id: manualLocationId,
                location_name: resolvedLocationName,
                zone_requested: manualZoneId || null,
                environment_refs_count: 0,
              }, { status: 422 });
            }
          } else {
            console.warn(`[LOCATION] ⚠ manualLocationId="${manualLocationId}" not found in DB — location resolution failed`);
          }
        } else {
          // Reuse the cached character record from Step 1 — no extra DB call needed
          const charRecord = _cachedCharRecord;
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
              // ── MANDATORY MULTI-SOURCE LOCATION RESOLUTION ───────────────────────
              // CRITICAL: Must check character file fields in strict priority order FIRST.
              // Do NOT infer room type from avatar background or prompt furniture hints.
              // Character file is the AUTHORITATIVE source of location truth.
              const livePresence = charRecord?.resolved_presence_status || 'home';
              const isHome = ['home', 'sleeping', 'napping'].includes(livePresence);
              const isAtWork = livePresence === 'at_work';
              const isTraveling = livePresence === 'traveling';

              // STRICT PRIORITY ORDER — all fields checked, do not skip levels
              let authorizedLocId = null;
              let authSource = null;
              if (charRecord?.resolved_current_location_id) {
                authorizedLocId = charRecord.resolved_current_location_id;
                authSource = 'character.resolved_current_location_id (PRIMARY)';
              } else if (charRecord?.current_home_location_id) {
                authorizedLocId = charRecord.current_home_location_id;
                authSource = 'character.current_home_location_id (SECONDARY)';
              } else if (charRecord?.home_location_id) {
                authorizedLocId = charRecord.home_location_id;
                authSource = 'character.home_location_id (TERTIARY)';
              } else if (isAtWork && charRecord?.current_work_location_id) {
                authorizedLocId = charRecord.current_work_location_id;
                authSource = 'character.current_work_location_id (WORK)';
              } else if (charRecord?.occupation_location_id) {
                authorizedLocId = charRecord.occupation_location_id;
                authSource = 'character.occupation_location_id (FALLBACK)';
              }
              console.log(`[LOCATION] 🔍 Multi-source check: ${authSource || 'NO LOCATION FOUND IN CHARACTER FILE'} | locId=${authorizedLocId || 'null'} | presence="${livePresence}"`);

              // ── ZONE HINT FROM PROMPT ────────────────────────────────────────────────
              // Derive zone hint from prompt KEYWORDS only.
              // These keywords tell us which room the prompt describes.
              // CRITICAL: The zone hint must match what the prompt says.
              // If the prompt says "bathroom", hint must be "bathroom" — NOT "living room".
              // DO NOT infer zone from furniture visible in character avatar photos.
              let liveZoneHint = null;
              if (livePresence === 'sleeping' || livePresence === 'napping') {
                liveZoneHint = 'bedroom'; // state-based, not image-based
              } else {
                const promptZoneCheck = cleanPrompt.toLowerCase();
                // Check SPECIFIC rooms first — most specific wins
                if (/\b(bathroom|shower|bathtub|toilet|vanity|steamy|fogged mirror)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'bathroom';
                } else if (/\b(bedroom|in bed|lying in bed|waking up|nightstand|duvet|mattress)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'bedroom';
                } else if (/\b(kitchen|stove|fridge|refrigerator|oven|microwave|cooking|pancake|breakfast)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'kitchen';
                } else if (/\b(backyard|patio|deck|yard|garden|grill|outside)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'backyard';
                } else if (/\b(dining room|dinner table|dining table)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'dining room';
                } else if (/\b(office|desk|workspace|home office)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'office';
                } else if (/\b(living room|couch|sofa|tv room|lounge)\b/.test(promptZoneCheck)) {
                  liveZoneHint = 'living room';
                }
                // If no room keyword detected, liveZoneHint stays null — resolveZoneImages will use first zone
                console.log(`[LOCATION] 🔍 Zone hint from prompt keywords: "${liveZoneHint || 'null (no room keyword detected — will use first zone)'}" | checked: "${promptZoneCheck.substring(0, 80)}"`);
              }

              // ── RESIDENT SCAN FALLBACK (only if character file had no location IDs) ──
              // This scans LocationReference records for homes that list this character as a resident.
              // This is a backend self-discovery lookup — do NOT ask the user for this information.
              if (!authorizedLocId) {
                const residentHome = savedLocations.find(l =>
                  l.category === 'home' &&
                  (
                    (l.resident_character_ids || []).includes(characterId) ||
                    (l.residents || []).some(r => r.character_id === characterId)
                  )
                );
                if (residentHome) {
                  authorizedLocId = residentHome.id;
                  authSource = `LocationReference resident scan — found "${residentHome.name}" (RESIDENT_SCAN)`;
                  console.log(`[LOCATION] 🏠 Resident scan found home: "${residentHome.name}" (${residentHome.id})`);
                }
              }

              let realTimeLoc = authorizedLocId
                ? await base44.asServiceRole.entities.LocationReference.get(authorizedLocId).catch(() => null)
                : null;

              // If .get() returned null, try filter as fallback
              if (!realTimeLoc && authorizedLocId) {
                const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: authorizedLocId }, null, 1).catch(() => []);
                realTimeLoc = locList?.[0] || null;
                if (realTimeLoc) console.log(`[LOCATION] 🏠 Location resolved via filter fallback: "${realTimeLoc.name}"`);
              }

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

              // ── MANDATORY LOCATION RESOLUTION AUDIT ─────────────────────────────────
              // Runtime proof of multi-source resolution — which fields were checked, what was found.
              console.log(`[LOC_AUDIT] ═══ MANDATORY LOCATION RESOLUTION TRACE ═══`);
              console.log(`[LOC_AUDIT] character_id="${characterId}" | presence="${livePresence}" | isHome=${isHome} | isAtWork=${isAtWork} | isTraveling=${isTraveling}`);
              console.log(`[LOC_AUDIT] FIELDS CHECKED (strict priority order):`);
              console.log(`[LOC_AUDIT]   1. character.resolved_current_location_id = "${charRecord?.resolved_current_location_id || 'null'}"`);
              console.log(`[LOC_AUDIT]   2. character.current_home_location_id = "${charRecord?.current_home_location_id || 'null'}"`);
              console.log(`[LOC_AUDIT]   3. character.home_location_id = "${charRecord?.home_location_id || 'null'}"`);
              console.log(`[LOC_AUDIT]   4. character.current_work_location_id = "${charRecord?.current_work_location_id || 'null'}"`);
              console.log(`[LOC_AUDIT]   5. character.occupation_location_id = "${charRecord?.occupation_location_id || 'null'}"`);
              console.log(`[LOC_AUDIT] SELECTED SOURCE: ${authSource || 'NONE — no location found in character file or resident scan'}`);
              console.log(`[LOC_AUDIT] AUTHORIZED LOC ID: "${authorizedLocId || 'NOT FOUND'}"`);
              console.log(`[LOC_AUDIT] LOCATION RECORD: "${realTimeLoc?.name || 'NULL'}" (id=${realTimeLoc?.id || 'null'})`);
              console.log(`[LOC_AUDIT] ZONE HINT (from prompt keywords only): "${liveZoneHint || 'null'}"`);
              console.log(`[LOC_AUDIT] savedLocations.length=${savedLocations.length}`);

              if (realTimeLoc) {
                // ALWAYS try to resolve zone images first, using sensible defaults
                const defaultZoneHint = liveZoneHint || getDefaultZoneHint(realTimeLoc.category);
                const { zoneImages, zoneName, matchType } = resolveZoneImages(scenePrompt.toLowerCase(), realTimeLoc, defaultZoneHint);
                // First-image fallback: if zone resolution returned nothing, use flat location images
                const imgs = zoneImages.length > 0 ? zoneImages : (realTimeLoc.image_urls || []).slice(0, 6);
                resolvedLocationName = realTimeLoc.name;
                resolvedZoneName = zoneName || defaultZoneHint;

                console.log(`[LOC_AUDIT] zones_on_location=${realTimeLoc.zones?.length || 0} | zones_with_images=${(realTimeLoc.zones || []).filter(z => z.image_urls?.length > 0).length}`);
                console.log(`[LOC_AUDIT] zone_resolution: matchType="${matchType || 'none'}" | zoneImages=${zoneImages.length} | flat_images=${(realTimeLoc.image_urls || []).length} | final_imgs=${imgs.length}`);
                console.log(`[LOC_AUDIT] first_image_fallback_used=${zoneImages.length === 0 && imgs.length > 0}`);
                console.log(`[LOC_AUDIT] ─────────────────────────────────────────────────────`);

                if (imgs.length > 0) {
                  locationImages = imgs;
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
                  console.log(`[LOCATION] ✓ REALTIME RESOLVED: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Presence: "${livePresence}" | Images: ${imgs.length} | matchType: "${matchType || 'flat_fallback'}"`);
                } else {
                  // ── HARD HALT: location found but NO images ───────────────────────────
                  // "Text-only lock" is NOT acceptable. Without location images, the
                  // provider has no environment authority. Avatar background WILL fill
                  // the vacuum regardless of what the prompt says. This must fail.
                  console.error(`[LOCATION] ⛔ HARD HALT — location "${realTimeLoc.name}" (id=${realTimeLoc.id}) has ZERO images.`);
                  console.error(`[LOCATION] zones=${realTimeLoc.zones?.length || 0} | zones_with_images=${(realTimeLoc.zones || []).filter(z => z.image_urls?.length > 0).length} | flat_image_urls=${(realTimeLoc.image_urls || []).length}`);
                  console.error(`[LOCATION] A text-only environment lock cannot enforce 80% environment authority.`);
                  console.error(`[LOCATION] Without reference images, the provider will use avatar background as the scene — environment drift is guaranteed.`);
                  console.error(`[LOCATION] FIX: Upload reference photos to this location record before generating images from it.`);
                  await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
                  return Response.json({
                    success: false,
                    error: `Location "${realTimeLoc.name}" has no reference images. Add photos to this location before generating images from it.`,
                    location_id: authorizedLocId,
                    location_name: realTimeLoc.name,
                    environment_refs_count: 0,
                  }, { status: 422 });
                }
              } else if (!isHome) {
                // No authorized location found and character is NOT home — parse from scene text
                const { locationImages: imgs, locationName, zoneName, confidenceScore } = resolveLocationAndZone(scenePrompt, savedLocations, characterId);
                console.log(`[LOC_AUDIT] Non-home, no authorized loc. Text parse: name="${locationName || 'NONE'}" | score=${confidenceScore?.toFixed(2) || '0'} | imgs=${imgs.length}`);
                if (imgs.length > 0 && confidenceScore >= 0.7) {
                  locationImages = imgs;
                  resolvedLocationName = locationName;
                  resolvedZoneName = zoneName;
                  locationNote = buildRoomLockNote(locationName, zoneName);
                  console.log(`[LOCATION] ✓ TEXT PARSE: "${locationName}" → Zone: "${zoneName}" | Score: ${confidenceScore.toFixed(2)}`);
                } else {
                  // ── HARD HALT: non-home, no location resolved, no images ──────────────
                  // Continuing without environment refs = avatar background wins.
                  console.error(`[LOCATION] ⛔ HARD HALT — non-home character "${livePresence}" has no resolved location AND text parse found no matching location images (score=${confidenceScore?.toFixed(2) || '0'}).`);
                  console.error(`[LOCATION] Without any location images, the provider has no environment authority source.`);
                  console.error(`[LOCATION] Avatar background from character refs WILL become the scene. This is not acceptable.`);
                  console.error(`[LOCATION] FIX: Assign a location to this character (home, work, etc.) and add reference images to that location.`);
                  await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
                  return Response.json({
                    success: false,
                    error: 'No location images could be resolved for this character. Assign a location with reference photos before generating images.',
                    live_presence: livePresence,
                    character_id: characterId,
                    environment_refs_count: 0,
                  }, { status: 422 });
                }
              } else {
                // ── HARD HALT: character is home but no home location record ─────────────
                // This is the most common avatar-background-leak case: character is "home"
                // but no home LocationReference exists with images, so the provider anchors
                // on whatever is in the character avatar — which is a person's bedroom or
                // kitchen from their profile photo, not a controlled reference.
                console.error(`[LOCATION] ⛔ HARD HALT — character is "${livePresence}" (home) but no home LocationReference was found.`);
                console.error(`[LOCATION] authorizedLocId was: ${authorizedLocId || 'null (no home ID on any character field)'}`);
                console.error(`[LOCATION] character fields checked: current_home_location_id="${charRecord?.current_home_location_id || 'null'}" | resolved_current_location_id="${charRecord?.resolved_current_location_id || 'null'}" | home_location_id="${charRecord?.home_location_id || 'null'}"`);
                console.error(`[LOCATION] resident scan result: ${savedLocations.filter(l => l.category === 'home' && ((l.resident_character_ids || []).includes(characterId) || (l.residents || []).some(r => r.character_id === characterId))).length} homes found`);
                console.error(`[LOCATION] Without a home location record with images, the provider has no environment authority.`);
                console.error(`[LOCATION] Avatar background from character refs WILL become the scene. This is not acceptable.`);
                console.error(`[LOCATION] FIX: Create a Home location, add zone photos to it, and assign this character as a resident.`);
                await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
                return Response.json({
                  success: false,
                  error: 'No home location with reference images found for this character. Create a Home location with photos and assign this character as a resident.',
                  live_presence: livePresence,
                  character_id: characterId,
                  character_home_location_id: charRecord?.current_home_location_id || null,
                  environment_refs_count: 0,
                }, { status: 422 });
              }
            }
          }
        }
        } // end else (non-creative / presence-scene branch)
      } catch (err) {
        console.error('[LOCATION] Resolution failed:', err.message);
      }
    }

    // ── STEP 4: ASSEMBLE REFERENCE IMAGES — STRICT ROLE SEPARATION ──────────
    // RULE: Location/zone images define the SCENE ENVIRONMENT only.
    //       Character images define the PERSON IDENTITY only.
    //       These two roles must never bleed into each other.
    //
    // ORDER: environment refs FIRST so the model anchors the scene before the person.
    //        Character identity refs LAST — extracted person-only, background suppressed.
    //
    // INDEX TRACKING: track exact indices so the prompt can name which images serve which role.
    let referenceImages = [];
    const hasLocationImages = locationImages.length > 0;

    // ── REFERENCE SLOT ALLOCATION — enforces the 80% / 90-100% / 0% weighting rules ──
    // Location gets 4 slots (environment authority = 80% — dominant)
    // Character identity gets 2 slots (person only = 90-100% on identity, 0% on background)
    // User identity gets 2 slots (same rules as character)
    // ORDER: location FIRST so the model anchors the scene before rendering the person
    const LOC_SLOT  = hasLocationImages ? Math.min(locationImages.length, 4) : 0;
    const CHAR_SLOT = finalCharSubject  ? Math.min(finalCharSubject.face_refs.length, 2) : 0;
    const USER_SLOT = finalUserSubject  ? Math.min(finalUserSubject.face_refs.length, 2) : 0;

    console.log(`[WEIGHTING] ════════════════════════════════════════`);
    console.log(`[WEIGHTING] ENFORCED REFERENCE ROLE WEIGHTS:`);
    console.log(`[WEIGHTING]   A. CHARACTER IDENTITY: 90-100% on PERSON ONLY | slots=${CHAR_SLOT} | avatar_background=0%`);
    console.log(`[WEIGHTING]   B. AVATAR BACKGROUND: 0% — completely suppressed`);
    console.log(`[WEIGHTING]   C. LOCATION/ZONE ENV: 80% on ENVIRONMENT | slots=${LOC_SLOT}`);
    console.log(`[WEIGHTING]   D. PROMPT DETAILS: controls action/objects/room-type/expression`);
    console.log(`[WEIGHTING] character_id=${characterId || 'none'} | character_name=${finalCharSubject?.canonical_name || 'NONE'}`);
    console.log(`[WEIGHTING] identity_refs_used=${finalCharSubject?.face_refs?.slice(0, CHAR_SLOT).map(u => u?.substring(0, 40)).join(', ') || 'NONE'}`);
    console.log(`[WEIGHTING] location_name="${resolvedLocationName || 'NONE'}" | zone="${resolvedZoneName || 'NONE'}" | location_imgs_used=${LOC_SLOT}`);
    console.log(`[WEIGHTING] home_lookup_ran=${!!resolvedLocationName} | first_image_fallback=${LOC_SLOT > 0 && !resolvedZoneName}`);
    console.log(`[WEIGHTING] ════════════════════════════════════════`);

    // Index ranges (1-based for prompt readability)
    const locIdxStart  = 1;
    const locIdxEnd    = LOC_SLOT;                          // e.g. 1–3
    const charIdxStart = LOC_SLOT + 1;                     // e.g. 4
    const charIdxEnd   = LOC_SLOT + CHAR_SLOT;             // e.g. 5
    const userIdxStart = LOC_SLOT + CHAR_SLOT + 1;         // e.g. 6
    const userIdxEnd   = LOC_SLOT + CHAR_SLOT + USER_SLOT; // e.g. 7

    if (finalCharSubject && finalUserSubject) {
      // MULTI-SUBJECT: location → char identity → user identity
      const locSlice  = locationImages.slice(0, LOC_SLOT);
      const charSlice = finalCharSubject.face_refs.slice(0, CHAR_SLOT);
      const userSlice = finalUserSubject.face_refs.slice(0, USER_SLOT);
      referenceImages = [...locSlice, ...charSlice, ...userSlice].filter(Boolean);
      console.log(`[REFS] Multi-subject: loc=${locSlice.length}(idx ${locIdxStart}-${locIdxEnd}) + char=${charSlice.length}(idx ${charIdxStart}-${charIdxEnd}) + user=${userSlice.length}(idx ${userIdxStart}-${userIdxEnd}) = ${referenceImages.length} total`);
    } else if (finalUserSubject && !finalCharSubject) {
      // USER-ONLY: location → user identity
      const locSlice  = locationImages.slice(0, LOC_SLOT);
      const userSlice = finalUserSubject.face_refs.slice(0, USER_SLOT);
      referenceImages = [...locSlice, ...userSlice].filter(Boolean);
      console.log(`[REFS] User-only: loc=${locSlice.length}(idx ${locIdxStart}-${locIdxEnd}) + user=${userSlice.length}(idx ${userIdxStart}-${userIdxEnd}) = ${referenceImages.length} total`);
    } else if (finalCharSubject) {
      // CHARACTER-ONLY: location FIRST (environment anchor) → char identity
      const locSlice  = locationImages.slice(0, LOC_SLOT);
      const charSlice = finalCharSubject.face_refs.slice(0, CHAR_SLOT);
      referenceImages = [...locSlice, ...charSlice].filter(Boolean);
      console.log(`[REFS] Character-only: loc=${locSlice.length}(idx ${locIdxStart}-${locIdxEnd}) + char=${charSlice.length}(idx ${charIdxStart}-${charIdxEnd}) = ${referenceImages.length} total`);
    } else {
      // No subjects — environment only
      referenceImages = locationImages.slice(0, 5);
      console.log(`[REFS] Environment-only: loc=${referenceImages.length}`);
    }

    console.log(`[REFS] env_imgs_resolved=${LOC_SLOT} | char_identity_refs=${CHAR_SLOT} | user_identity_refs=${USER_SLOT} | avatar_bg_suppressed=true`);

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

    // ── SCENE ACTION LOCK — extract and enforce mandatory scene elements ───────
    // Must be built from cleanPrompt (the raw user intent), not scenePrompt (stripped).
    const sceneActionLock = buildSceneActionLockBlock(cleanPrompt);
    if (sceneActionLock) {
      console.log(`[SCENE_LOCK] Scene action lock applied. Elements: ${sceneActionLock.split('\n').filter(l => l.startsWith('✅')).length}`);
    }
    
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

    // Build environment lock block (used whenever location images are present)
    const envBlock = (hasLocationImages && resolvedLocationName)
      ? buildEnvironmentLockBlock(resolvedLocationName, resolvedZoneName, locIdxStart, locIdxEnd)
      : '';

    // ── PROMPT ASSEMBLY ORDER ─────────────────────────────────────────────────
    // ORDER (most-to-least authoritative for model anchoring):
    //   1. SCENE ACTION LOCK (mandatory elements — model reads FIRST)
    //   2. SCENE DESCRIPTION (the actual user intent)
    //   3. OUTFIT block (clothing override for the subject)
    //   4. EXPRESSION note
    //   5. ENVIRONMENT LOCK block (reference image roles for scene)
    //   6. LOCATION NOTE (room-lock / zone enforcement)
    //   7. IDENTITY LOCK (character refs — person only, background ignored)
    //
    // This order ensures the model treats the scene as primary and identity/env as secondary.
    // Previously outfit was FIRST — that caused the model to treat outfit metadata as the
    // primary prompt context, pushing the actual scene description down.

    if (finalCharSubject && finalUserSubject) {
      // ── MULTI-SUBJECT PROMPT ────────────────────────────────────────────────
      // Pass cleanPrompt so outfit injection is skipped when prompt already describes clothing
      const charOutfitBlock = buildSubjectOutfitBlock(finalCharSubject, cleanPrompt);
      const userOutfitBlock = buildSubjectOutfitBlock(finalUserSubject, cleanPrompt);
      const charIdentityBlock = buildSubjectIdentityBlock(finalCharSubject, charIdxStart, charIdxEnd, hasLocationImages);
      const userIdentityBlock = buildSubjectIdentityBlock(finalUserSubject, userIdxStart, userIdxEnd, hasLocationImages);
      const refOrderNote = `Two subjects: ${finalCharSubject.canonical_name} and ${finalUserSubject.canonical_name}. Keep their appearances and outfits distinct.`;

      enhancedPrompt = `${sceneActionLock}${promptForGeneration}${expressionNote}\n\n${charOutfitBlock}${userOutfitBlock}${envBlock}${locationNote}${charIdentityBlock}${userIdentityBlock}\n\n${refOrderNote}`;

    } else if (finalUserSubject && !finalCharSubject) {
      // ── USER-ONLY PROMPT ────────────────────────────────────────────────────
      const userOutfitBlock = buildSubjectOutfitBlock(finalUserSubject, cleanPrompt);
      const userIdentityBlock = finalUserSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalUserSubject, userIdxStart, userIdxEnd, hasLocationImages)
        : '';
      enhancedPrompt = `${sceneActionLock}${promptForGeneration}${expressionNote}\n\n${userOutfitBlock}${envBlock}${locationNote}${userIdentityBlock}`;

    } else if (finalCharSubject) {
      // ── CHARACTER-ONLY PROMPT ───────────────────────────────────────────────
      // Pass cleanPrompt so outfit injection is skipped when prompt already describes clothing
      const charOutfitBlock = buildSubjectOutfitBlock(finalCharSubject, cleanPrompt);
      const safeClothingNote = !charOutfitBlock && !cleanPrompt.toLowerCase().includes('shirt') && !cleanPrompt.toLowerCase().includes('wear') && !cleanPrompt.toLowerCase().includes('outfit')
        ? `\nNote: Ensure the subject is wearing appropriate casual clothing suitable for the scene.\n`
        : '';
      const charIdentityBlock = finalCharSubject.face_refs.length > 0
        ? buildSubjectIdentityBlock(finalCharSubject, charIdxStart, charIdxEnd, hasLocationImages)
        : '';

      enhancedPrompt = `${sceneActionLock}${promptForGeneration}${expressionNote}\n\n${charOutfitBlock}${safeClothingNote}${envBlock}${locationNote}${charIdentityBlock}`;

    } else {
      // No subjects — pure environment/text render
      enhancedPrompt = `${sceneActionLock}${promptForGeneration}${envBlock}${locationNote}`;
    }

    // ── LIVE LOCATION TRUTH INJECTION ─────────────────────────────────────────
    // Inject authoritative live location context for presence-based scenes ONLY.
    // CRITICAL ORDERING: this must be injected AFTER the reference role labels.
    // If injected BEFORE, the model sees location text before seeing which images
    // are environment refs vs. identity refs — creating ambiguity that allows
    // avatar background scenery to fill the environment role.
    //
    // Correct order in final prompt:
    //   1. Scene action lock (mandatory elements)
    //   2. Scene description (user intent)
    //   3. Outfit block
    //   4. Expression note
    //   5. ENVIRONMENT LOCK block (ref images 1–N = environment, 80%)
    //   6. Location note (room/zone enforcement)
    //   7. IDENTITY LOCK block (ref images N+1–M = person only, 90-100%, bg=0%)
    //   8. Live location context (appended AFTER role labels — provides named place truth)
    //
    // Prepending live location context BEFORE step 5-7 was breaking role clarity.
    if (imageMode === 'presence_scene' && liveLocationContext && liveLocationContext.trim()) {
      // Append AFTER role labels, not before — preserves reference image role clarity
      enhancedPrompt = `${enhancedPrompt}\n\n${liveLocationContext}`;
      console.log(`[LOCATION_SYNC] Live location context appended AFTER reference role labels (prevents avatar bg leakage).`);
    }

    const finalPrompt = enhancedPrompt;

    // ── PRE-DISPATCH PAYLOAD VALIDATION ─────────────────────────────────────
    // Mandatory validation: explicit context must survive to this point.
    // Logs are always emitted. Warnings fire when known context is missing.
    console.log(`[PAYLOAD_VALIDATION] ════════════════════════════════════════`);
    console.log(`[PAYLOAD_VALIDATION] origin=${imageMode} | messageId=${messageId}`);
    console.log(`[PAYLOAD_VALIDATION] character_id=${characterId || 'MISSING'} | character_name=${finalCharSubject?.canonical_name || 'UNRESOLVED'}`);
    console.log(`[PAYLOAD_VALIDATION] char_refs=${finalCharSubject?.face_refs?.length ?? 0} | user_refs=${finalUserSubject?.face_refs?.length ?? 0}`);
    console.log(`[PAYLOAD_VALIDATION] location="${resolvedLocationName || 'NONE'}" | zone="${resolvedZoneName || 'NONE'}" | location_imgs=${locationImages.length}`);
    console.log(`[PAYLOAD_VALIDATION] manualLocationId=${manualLocationId || 'none'} | manualZoneId=${manualZoneId || 'none'}`);
    console.log(`[PAYLOAD_VALIDATION] subject_type=${resolvedSubjectType} | total_refs=${referenceImages.length}`);

    // ── IDENTITY REF VALIDATION — WARN ONLY ─────────────────────────────────
    // Log a warning if identity refs are zero but do NOT block generation.
    // Characters with private-stored photos should still generate (with text-only identity).
    const isCharacterCentered = resolvedSubjectType === 'character' || resolvedSubjectType === 'joint';
    const charRefCount = finalCharSubject?.face_refs?.length ?? 0;
    if (isCharacterCentered && characterId && charRefCount === 0) {
      console.warn(`[PAYLOAD_VALIDATION] ⚠️ IDENTITY REFS = 0 for character ${characterId} — all reference images may be stored as private URLs. Generation proceeds with text-only identity.`);
    }
    if (isCharacterCentered && charRefCount > 0 && charRefCount < 2) {
      console.warn(`[PAYLOAD_VALIDATION] ⚠️ LOW IDENTITY REF COUNT: only ${charRefCount} public ref(s) for character ${characterId}. Identity lock may be weaker than intended.`);
    }
    if (manualLocationId && locationImages.length === 0) {
      console.warn(`[PAYLOAD_VALIDATION] ⚠️ LOCATION SELECTED (${manualLocationId}) but no location images resolved. Scene environment unknown.`);
    }
    if (manualZoneId && resolvedZoneName !== manualZoneId) {
      console.warn(`[PAYLOAD_VALIDATION] ⚠️ ZONE SELECTED "${manualZoneId}" but resolved zone="${resolvedZoneName || 'none'}". Zone may have been substituted.`);
    }
    if (imageMode === 'presence_scene' && characterId && !finalCharSubject) {
      console.warn(`[PAYLOAD_VALIDATION] ⚠️ CHAT SELF-IMAGE: character ${characterId} is sender but subject is unresolved.`);
    }
    console.log(`[PAYLOAD_VALIDATION] ════════════════════════════════════════`);

    // ── REFERENCE IMAGE ROLE PREAMBLE ────────────────────────────────────────
    // This is the FIRST thing the provider reads — an unambiguous role map of every
    // reference image index. Without this, the model may interpret all images as
    // stylistic inspiration and let avatar background bleed into the environment.
    //
    // This enforces at runtime:
    //   - Images 1–LOC_SLOT = ENVIRONMENT ONLY (80% authority on room/location)
    //   - Images LOC_SLOT+1–LOC_SLOT+CHAR_SLOT = CHARACTER IDENTITY ONLY (90-100% on person)
    //   - Avatar background behind the person = 0% influence on environment
    //
    // The role preamble is prepended BEFORE the scene description so it is the
    // first instruction the model processes.
    let rolePreamble = '';
    if (LOC_SLOT > 0 && CHAR_SLOT > 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST:
Images 1–${LOC_SLOT}: SCENE ENVIRONMENT ONLY (${LOC_SLOT === 1 ? 'this is' : 'these are'} photographs of the actual location). Use ONLY for: flooring, walls, furniture, layout, windows, curtains, lighting, room proportions. Authority: 80%.
Images ${charIdxStart}–${charIdxEnd}: CHARACTER IDENTITY ONLY (${CHAR_SLOT === 1 ? 'this is a photo' : 'these are photos'} of the person who must appear in the scene). Use ONLY for: face, skin, hair, body type, markings. Authority: 90-100% on the person.
⛔ AVATAR BACKGROUND = 0%: ANY background, room, or scenery visible BEHIND the person in images ${charIdxStart}–${charIdxEnd} is IRRELEVANT and must be COMPLETELY IGNORED. Do NOT reproduce it. The scene environment comes from images 1–${LOC_SLOT} only.
⛔ DO NOT blend or average these two image sets. They serve entirely separate roles.\n\n`;
    } else if (LOC_SLOT === 0 && CHAR_SLOT > 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST:
Images 1–${CHAR_SLOT}: CHARACTER IDENTITY ONLY. Use ONLY for: face, skin, hair, body type, markings. Authority: 90-100% on the person.
⛔ AVATAR BACKGROUND = 0%: The background behind the person in these photos is UNRELATED to this scene. COMPLETELY IGNORE it. Build the environment 100% from the text prompt.
⛔ DO NOT use any scenery from these reference photos as the scene background.\n\n`;
    } else if (LOC_SLOT > 0 && CHAR_SLOT === 0) {
      rolePreamble = `REFERENCE IMAGE ROLE ASSIGNMENT — READ THIS FIRST:
Images 1–${LOC_SLOT}: SCENE ENVIRONMENT ONLY. Use for: flooring, walls, furniture, layout, windows, curtains. Authority: 80%.
No character identity images provided — render the character from the text description only.\n\n`;
    }

    // ── BUILD activeFinalPrompt — role preamble FIRST, then everything else ─────
    // CRITICAL: all appends below must target activeFinalPrompt (not finalPrompt).
    // Previously some appends targeted finalPrompt after activeFinalPrompt was already set,
    // which meant the role preamble was re-prepended to a stale base — losing injections.
    let activeFinalPrompt = rolePreamble + finalPrompt;

    // Inject location lock if location is resolved but name does not appear in the body
    if (hasLocationImages && resolvedLocationName) {
      const locLower = resolvedLocationName.toLowerCase();
      const zoneLower = (resolvedZoneName || '').toLowerCase();
      if (!activeFinalPrompt.toLowerCase().includes(locLower) && !activeFinalPrompt.toLowerCase().includes(zoneLower)) {
        console.warn(`[PAYLOAD_VALIDATION] ⚠️ Location not in prompt — injecting location lock`);
        activeFinalPrompt += `\n\nSCENE LOCATION (LOCKED): ${resolvedLocationName}${resolvedZoneName ? ` → ${resolvedZoneName}` : ''}. The image MUST depict this exact location.`;
      }
    }
    // For creative mode: inject explicit character identity statement if name not present
    if (imageMode === 'creative' && finalCharSubject && finalCharSubject.face_refs.length > 0) {
      const charNameLower = finalCharSubject.canonical_name.toLowerCase();
      if (!activeFinalPrompt.toLowerCase().includes(charNameLower)) {
        activeFinalPrompt += `\n\nSUBJECT (LOCKED): ${finalCharSubject.canonical_name}. This person MUST appear as the primary subject. Match facial features, identity, and appearance from the provided reference images.`;
        console.log(`[PAYLOAD_VALIDATION] Character name injected into prompt for identity lock.`);
      }
    }

    // ── STEP 6.5: FINAL SAFETY SANITIZE ─────────────────────────────────────
    // Character and user identity refs are already filtered at subject build time.
    // This pass is the final safety net for any location images that slipped through.
    const sanitizedReferenceImages = referenceImages.filter(isProviderAccessible);
    if (sanitizedReferenceImages.length !== referenceImages.length) {
      const stripped = referenceImages.length - sanitizedReferenceImages.length;
      console.warn(`[generateImageAsync] ⚠ Final sanitize stripped ${stripped} inaccessible URLs. Remaining: ${sanitizedReferenceImages.length}`);
    }
    console.log(`[generateImageAsync] REFERENCE SUMMARY: loc_imgs=${LOC_SLOT} | char_identity=${CHAR_SLOT} | user_identity=${USER_SLOT} | total_after_sanitize=${sanitizedReferenceImages.length} | avatar_bg=0%`);

    // ── STEP 6.6: ENVIRONMENT AUTHORITY ENFORCEMENT ──────────────────────
    // RUNTIME SAFETY: If this is a location-grounded request (presence_scene mode)
    // and environment refs have collapsed to zero after sanitization, the system
    // cannot safely generate because avatar background becomes the de facto environment.
    // This violates the 0% avatar background rule. BLOCK instead of guessing.
    const locationGroundedRequest = imageMode === 'presence_scene' && resolvedLocationName !== null;
    const environmentRefsAfterSanitize = sanitizedReferenceImages.slice(0, LOC_SLOT).length;
    const hasZeroEnvironmentRefs = environmentRefsAfterSanitize === 0 && LOC_SLOT > 0;

    if (locationGroundedRequest && hasZeroEnvironmentRefs) {
      console.error(`[generateImageAsync] ⛔ HARD HALT — ENVIRONMENT AUTHORITY COLLAPSE`);
      console.error(`[generateImageAsync] Location resolved: "${resolvedLocationName}" (id=${resolvedLocationName ? 'found' : 'null'})`);
      console.error(`[generateImageAsync] Zone resolved: "${resolvedZoneName || 'none'}"`);
      console.error(`[generateImageAsync] LOC_SLOT expected: ${LOC_SLOT} | LOC_SLOT after sanitize: ${environmentRefsAfterSanitize}`);
      console.error(`[generateImageAsync] All location reference images are stored as private URLs the generation provider cannot access.`);
      console.error(`[generateImageAsync] Without environment authority, avatar background would fill the gap — violating 0% avatar background rule.`);
      console.error(`[generateImageAsync] Generation is blocked. User must repair private URL storage or select a location with public reference images.`);
      await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({
        success: false,
        error: `Location "${resolvedLocationName}" has no usable reference images. All stored images are private URLs. Please contact support to repair private URL storage, or select a different location with public reference images.`,
        location_id: resolvedLocationName ? 'found_but_private_refs' : 'not_found',
        location_name: resolvedLocationName,
        environment_refs_count: environmentRefsAfterSanitize,
        environment_authority_safe: false,
      }, { status: 422 });
    }

    // ── STEP 7: GENERATE IMAGE ───────────────────────────────────────────────
    // RUNTIME PROOF LOG — shows exact state of all rule enforcement before dispatch
    console.log(`[DISPATCH_AUDIT] ════════════════════════════════════════════════════`);
    console.log(`[DISPATCH_AUDIT] messageId=${messageId} | mode=${imageMode}`);
    console.log(`[DISPATCH_AUDIT] --- CHARACTER IDENTITY (Rule A) ---`);
    console.log(`[DISPATCH_AUDIT]   character_id=${characterId || 'NONE'} | name=${finalCharSubject?.canonical_name || 'NONE'}`);
    console.log(`[DISPATCH_AUDIT]   identity_refs_sent=${sanitizedReferenceImages.slice(LOC_SLOT, LOC_SLOT + CHAR_SLOT).length} | indices=${charIdxStart}–${charIdxEnd}`);
    console.log(`[DISPATCH_AUDIT]   identity_ref_urls=${sanitizedReferenceImages.slice(LOC_SLOT, LOC_SLOT + CHAR_SLOT).map(u => u.substring(0, 50)).join(' | ') || 'NONE'}`);
    console.log(`[DISPATCH_AUDIT] --- AVATAR BACKGROUND (Rule B) ---`);
    console.log(`[DISPATCH_AUDIT]   suppression=ENFORCED | avatar_bg_influence=0% | role_preamble_injected=${rolePreamble.length > 0}`);
    console.log(`[DISPATCH_AUDIT] --- ENVIRONMENT (Rule C) ---`);
    console.log(`[DISPATCH_AUDIT]   location_name="${resolvedLocationName || 'NONE'}" | zone="${resolvedZoneName || 'NONE'}"`);
    console.log(`[DISPATCH_AUDIT]   location_imgs_sent=${sanitizedReferenceImages.slice(0, LOC_SLOT).length} | indices=1–${LOC_SLOT}`);
    console.log(`[DISPATCH_AUDIT]   home_lookup_ran=${imageMode === 'presence_scene' && !!characterId} | location_id_found=${resolvedLocationName !== null} | location_record_had_images=${locationImages.length > 0}`);
    console.log(`[DISPATCH_AUDIT]   first_image_fallback_used=${LOC_SLOT > 0 && resolvedZoneName === null}`);
    console.log(`[DISPATCH_AUDIT] --- PROMPT FIDELITY (Rule D) ---`);
    console.log(`[DISPATCH_AUDIT]   scene_action_lock_elements=${sceneActionLock ? sceneActionLock.split('\n').filter(l => l.startsWith('✅')).length : 0}`);
    console.log(`[DISPATCH_AUDIT]   prompt_length=${activeFinalPrompt.length} | role_preamble_length=${rolePreamble.length}`);
    console.log(`[DISPATCH_AUDIT] --- TOTAL REFS SENT ---`);
    console.log(`[DISPATCH_AUDIT]   total=${sanitizedReferenceImages.length} (loc=${LOC_SLOT} + char=${CHAR_SLOT} + user=${USER_SLOT})`);
    console.log(`[DISPATCH_AUDIT] ════════════════════════════════════════════════════`);
    console.log(`[generateImageAsync] SENDING TO GENERATOR | messageId=${messageId} | promptLength=${activeFinalPrompt.length} | refs=${sanitizedReferenceImages.length}`);
    
    let response;
    try {
      response = await base44.integrations.Core.GenerateImage({
        prompt: activeFinalPrompt,
        existing_image_urls: sanitizedReferenceImages.length > 0 ? sanitizedReferenceImages : undefined,
      });
    } catch (genErr) {
      // AI provider refused or failed — mark message as failed and return clean error
      console.error(`[generateImageAsync] Provider error for ${messageId}: ${genErr.message}`);
      await base44.entities.Message.update(messageId, { content: '[IMAGE_FAILED]' }).catch(() => {});
      return Response.json({ success: false, error: genErr.message }, { status: 400 });
    }

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
    // Guard: messageId may be undefined if req.json() itself threw
    if (typeof messageId === 'string' && messageId.length > 0) {
      await base44.entities.Message.update(messageId, {
        content: '[IMAGE_FAILED]',
      }).catch(() => {});
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});