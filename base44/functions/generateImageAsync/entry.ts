import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// subjectType: "character" | "user" | "joint"
// Only use user references when subjectType is "user" or "joint"
// Never use user references for "character" images

// ── ZONE KEYWORD MAP ──────────────────────────────────────────────────────────
// Maps prompt keywords → canonical zone name fragments for fuzzy matching
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
  // Gym zones
  { keywords: ["workout floor", "weights", "weight room", "dumbbell", "barbell", "squat rack", "bench press"], zone: "weight" },
  { keywords: ["treadmill", "cardio", "elliptical", "bike", "rowing"], zone: "cardio" },
  { keywords: ["locker room", "changing room", "showers"], zone: "locker" },
  { keywords: ["pool area", "swimming pool"], zone: "pool" },
  { keywords: ["sauna", "steam room"], zone: "sauna" },
  // Bar/club zones
  { keywords: ["vip section", "vip area", "vip booth", "vip lounge", "the vip"], zone: "vip" },
  { keywords: ["main floor", "dance floor", "dancefloor", "general floor"], zone: "main floor" },
  { keywords: ["behind the bar", "bar area", "bartending", "bar counter", "bar top"], zone: "bar area" },
  { keywords: ["rooftop", "roof deck", "roof bar", "rooftop bar"], zone: "rooftop" },
  { keywords: ["patio", "outdoor area", "outdoor seating", "outdoor patio"], zone: "patio" },
  { keywords: ["entrance", "lobby", "foyer", "entry"], zone: "entrance" },
  // Workplace zones
  { keywords: ["break room", "lunch room", "breakroom"], zone: "break room" },
  { keywords: ["conference room", "meeting room", "boardroom"], zone: "conference" },
  { keywords: ["waiting room", "waiting area", "reception"], zone: "waiting" },
  // Medical
  { keywords: ["patient room", "patient bed", "hospital room", "hospital bed"], zone: "patient" },
  { keywords: ["operating room", "or ", "surgery"], zone: "operating" },
  { keywords: ["recovery room", "recovery area"], zone: "recovery" },
  // School
  { keywords: ["classroom", "class", "lecture hall"], zone: "classroom" },
  { keywords: ["cafeteria", "school lunch", "lunch room"], zone: "cafeteria" },
  { keywords: ["library", "study hall"], zone: "library" },
];

// Possessive implication: "his bed" → implies the character's home location, zone = bedroom
// These are resolved BEFORE location matching so we can bias toward character-specific home
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

/**
 * Score how well a zone name matches a target zone keyword fragment.
 * Higher = better match.
 */
function zoneMatchScore(zoneName, targetZoneFragment) {
  const zn = zoneName.toLowerCase();
  const tf = targetZoneFragment.toLowerCase();
  if (zn === tf) return 100;
  if (zn.includes(tf)) return 80;
  if (tf.includes(zn)) return 60;
  // Partial word overlap
  const znWords = zn.split(/\s+/);
  const tfWords = tf.split(/\s+/);
  const overlap = znWords.filter(w => tfWords.some(t => t.includes(w) || w.includes(t))).length;
  if (overlap > 0) return 30 + overlap * 10;
  return 0;
}

/**
 * Given a prompt and a location record, resolve the best matching zone's images.
 * Returns { zoneImages, zoneName, matchType }
 * matchType: "exact_zone_name" | "zone_keyword" | "first_zone" | "location_flat"
 */
function resolveZoneImages(promptLower, location, forcedZoneHint = null) {
  const zones = (location.zones || []).filter(z => z.image_urls?.length > 0);
  const MAX = 6;

  if (zones.length === 0) {
    return {
      zoneImages: (location.image_urls || []).slice(0, MAX),
      zoneName: null,
      matchType: "location_flat",
    };
  }

  const hint = forcedZoneHint?.toLowerCase() || null;

  // 1. Exact zone name in prompt (highest confidence)
  for (const zone of zones) {
    if (promptLower.includes(zone.zone_name.toLowerCase())) {
      return {
        zoneImages: zone.image_urls.slice(0, MAX),
        zoneName: zone.zone_name,
        matchType: "exact_zone_name",
      };
    }
  }

  // 2. If we have a forced hint (from possessive or keyword inference), score zones against it
  if (hint) {
    let bestZone = null;
    let bestScore = 0;
    for (const zone of zones) {
      const score = zoneMatchScore(zone.zone_name, hint);
      if (score > bestScore) { bestScore = score; bestZone = zone; }
    }
    if (bestZone && bestScore >= 30) {
      // Collect ALL zones that match well (multiple angles of same area)
      const allMatchingZones = zones.filter(z => zoneMatchScore(z.zone_name, hint) >= 30);
      const combined = allMatchingZones.flatMap(z => z.image_urls || []).slice(0, MAX);
      return {
        zoneImages: combined,
        zoneName: bestZone.zone_name,
        matchType: "zone_keyword",
      };
    }
  }

  // 3. Keyword inference from prompt against ZONE_KEYWORD_MAP
  for (const entry of ZONE_KEYWORD_MAP) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      let bestZone = null;
      let bestScore = 0;
      for (const zone of zones) {
        const score = zoneMatchScore(zone.zone_name, entry.zone);
        if (score > bestScore) { bestScore = score; bestZone = zone; }
      }
      if (bestZone && bestScore >= 30) {
        const allMatchingZones = zones.filter(z => zoneMatchScore(z.zone_name, entry.zone) >= 30);
        const combined = allMatchingZones.flatMap(z => z.image_urls || []).slice(0, MAX);
        return {
          zoneImages: combined,
          zoneName: bestZone.zone_name,
          matchType: "zone_keyword",
        };
      }
    }
  }

  // 4. First zone with images (weakest fallback — better than generic)
  const first = zones[0];
  return {
    zoneImages: first.image_urls.slice(0, MAX),
    zoneName: first.zone_name,
    matchType: "first_zone",
  };
}

/**
 * Score how well a location name matches the prompt.
 * Returns a confidence value 0.0–1.0.
 * Handles: exact match, substring, partial word overlap, plural/singular, minor variations.
 */
function locationNameScore(locNameRaw, promptLower) {
  const locName = locNameRaw.toLowerCase().trim();

  // 1. Exact substring match
  if (promptLower.includes(locName)) return 1.0;

  // 2. Prompt substring inside loc name (e.g. "escuelita" in "escuelitas")
  if (locName.includes(promptLower.split(' ').find(w => w.length >= 4 && locName.includes(w)) || '')) {
    // only credit if that word is long enough to be meaningful
    const promptWords = promptLower.split(/\s+/).filter(w => w.length >= 4);
    for (const w of promptWords) {
      if (locName.includes(w)) return 0.9;
    }
  }

  // 3. Plural/singular stripping: try adding/removing trailing 's'
  if (promptLower.includes(locName + 's') || promptLower.includes(locName.replace(/s$/, ''))) return 0.95;
  const locNameNoS = locName.endsWith('s') ? locName.slice(0, -1) : locName + 's';
  if (promptLower.includes(locNameNoS)) return 0.95;

  // 4. All significant words of the location name appear somewhere in the prompt
  const locWords = locName.split(/\s+/).filter(w => w.length >= 3);
  if (locWords.length > 0) {
    const allMatch = locWords.every(w => promptLower.includes(w));
    if (allMatch) return 0.85;
    const matchCount = locWords.filter(w => promptLower.includes(w)).length;
    if (matchCount > 0) return 0.5 + (matchCount / locWords.length) * 0.3;
  }

  // 5. Levenshtein-like: check each prompt token against loc name
  const promptTokens = promptLower.split(/\s+/).filter(w => w.length >= 4);
  for (const token of promptTokens) {
    // Simple character overlap ratio
    const shorter = token.length < locName.length ? token : locName;
    const longer = token.length >= locName.length ? token : locName;
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++;
    }
    const ratio = matches / longer.length;
    if (ratio >= 0.8 && Math.abs(token.length - locName.length) <= 3) return 0.75;
  }

  return 0.0;
}

/**
 * Get the default zone for a location category when no zone is specified.
 * e.g. nightlife/bar → "Main Floor", home → "Living Room"
 */
function getDefaultZoneHint(category) {
  const defaults = {
    social: "main floor",
    home: "living room",
    gym: "workout floor",
    workplace: "office",
    food_drink: "main area",
    medical: "waiting",
    education: "classroom",
  };
  return defaults[category] || null;
}

/**
 * Main resolver: parse the prompt → find Location → find Zone → return images + labels.
 * Returns { locationImages, locationName, zoneName, matchConfidence, confidenceScore }
 * matchConfidence: "high" | "medium" | "low" | "none"
 * confidenceScore: 0.0–1.0 (used for failsafe threshold)
 */
function resolveLocationAndZone(prompt, locations, characterId) {
  if (!prompt || !locations || locations.length === 0) {
    return { locationImages: [], locationName: null, zoneName: null, matchConfidence: "none", confidenceScore: 0 };
  }

  const pl = prompt.toLowerCase();

  // Prioritize character-specific locations over global ones
  const characterLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');
  const ordered = [...characterLocations, ...globalLocations];

  // ── STEP 1: Check possessive patterns to infer zone hint and category bias ──
  let possessiveZoneHint = null;
  let possessiveCategoryHint = null;
  for (const entry of POSSESSIVE_ZONE_MAP) {
    if (entry.pattern.test(pl)) {
      possessiveZoneHint = entry.zone;
      possessiveCategoryHint = entry.category;
      break;
    }
  }

  // ── STEP 2: Score ALL locations against the prompt, pick best ──
  // This replaces the old exact-only check and handles fuzzy/plural/partial matches
  let bestLoc = null;
  let bestScore = 0.0;
  for (const loc of ordered) {
    const score = locationNameScore(loc.name, pl);
    if (score > bestScore) { bestScore = score; bestLoc = loc; }
  }

  if (bestLoc && bestScore >= 0.7) {
    // High-confidence location name match — use this location
    const zoneHint = possessiveZoneHint || getDefaultZoneHint(bestLoc.category);
    const { zoneImages, zoneName, matchType } = resolveZoneImages(pl, bestLoc, zoneHint);
    const confidence = bestScore >= 0.9 ? "high" : "medium";
    console.log(`[LOCATION-MATCH] "${bestLoc.name}" score=${bestScore.toFixed(2)} zone="${zoneName}" matchType=${matchType}`);
    return {
      locationImages: zoneImages,
      locationName: bestLoc.name,
      zoneName,
      matchConfidence: confidence,
      confidenceScore: bestScore,
    };
  }

  // ── STEP 3: Keyword match on location keywords field ──
  for (const loc of ordered) {
    if (loc.keywords?.some(kw => kw && pl.includes(kw.toLowerCase()))) {
      const zoneHint = possessiveZoneHint || getDefaultZoneHint(loc.category);
      const { zoneImages, zoneName, matchType } = resolveZoneImages(pl, loc, zoneHint);
      console.log(`[LOCATION-KEYWORD] "${loc.name}" zone="${zoneName}"`);
      return {
        locationImages: zoneImages,
        locationName: loc.name,
        zoneName,
        matchConfidence: matchType === "exact_zone_name" ? "high" : "medium",
        confidenceScore: 0.8,
      };
    }
  }

  // ── STEP 4: Possessive + category match (e.g. "his bed" → character-specific home) ──
  if (possessiveCategoryHint) {
    const catLoc = ordered.find(l => l.category === possessiveCategoryHint);
    if (catLoc) {
      const zoneHint = possessiveZoneHint || getDefaultZoneHint(catLoc.category);
      const { zoneImages, zoneName } = resolveZoneImages(pl, catLoc, zoneHint);
      console.log(`[LOCATION-POSSESSIVE] "${catLoc.name}" zone="${zoneName}"`);
      return {
        locationImages: zoneImages,
        locationName: catLoc.name,
        zoneName,
        matchConfidence: "medium",
        confidenceScore: 0.75,
      };
    }
  }

  // ── STEP 5: Category-level fuzzy match from prompt keywords ──
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
        if (zoneImages.length > 0) {
          return {
            locationImages: zoneImages,
            locationName: catLoc.name,
            zoneName,
            matchConfidence: "low",
            confidenceScore: 0.5,
          };
        }
      }
    }
  }

  return { locationImages: [], locationName: null, zoneName: null, matchConfidence: "none", confidenceScore: 0 };
}

// ── ROOM LOCK PROMPT ──────────────────────────────────────────────────────────
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

FLOORING: Exact material, species, color, plank direction, tile pattern, grout lines, carpet pile, and finish. Dark hardwood stays dark hardwood. Tile stays that exact tile. No lightening, darkening, or material substitution.

WALLS: Exact paint color, sheen level, any wallpaper, wainscoting, baseboard trim color, crown molding profile, and accent walls. Every wall surface must match.

FURNITURE — EVERY SINGLE PIECE:
• Each furniture item must match in exact shape, proportions, style, color, fabric, and material.
• A square coffee table stays square. A round table stays round.
• A low modern sofa stays low and modern — do not swap the silhouette.
• A dark wood bed frame stays dark wood.
• Do NOT add, remove, substitute, or restyle ANY furniture.
• SPATIAL RELATIONSHIPS ARE LOCKED: couch position, bed position, dresser position, table position. If a couch is against the left wall in the reference, keep it there. If a bed is under a window, keep it there.

FABRICS & UPHOLSTERY: Exact texture, weave, pattern, and color of every cushion, throw pillow, blanket, curtain, rug, and chair cover. Beige woven rug stays beige and woven. Dark leather stays dark leather. Linen stays linen.

WINDOW TREATMENTS: Curtains, blinds, shades, shutters — same fabric, color, length, fullness, rod/track hardware. If open in reference, show open. If closed, show closed.

WALL ART & MOUNTED OBJECTS: Every framed photo, painting, mirror, clock, and wall-mounted object must appear in the same wall position at the same height and orientation.

SHELVING & BOOKCASES: Reproduce contents, arrangement, density, and objects exactly.

LIGHTING FIXTURES: All ceiling fixtures, pendants, floor lamps, table lamps, and sconces must match in style, position, and light temperature (warm/cool).

DECORATIVE OBJECTS: Every plant, vase, sculpture, candle, tray, remote, throw blanket — every object that defines this space must be present and in place.

SPATIAL PROPORTIONS: Room dimensions, ceiling height, window size, window placement, door positions.

────────────────────────────────────
SPATIAL FUNCTIONALITY RULES — THIS ROOM MUST BE PHYSICALLY USABLE:
────────────────────────────────────
This is a real space that real people move through. The layout must make physical sense.

ACCESS POINTS ARE SACRED — DO NOT BLOCK:
• Doors must have clear swing clearance — no furniture touching or overlapping the door arc.
• Closet doors must have open space in front of them — a bed, dresser, or shelf placed against a closet door is WRONG and physically impossible.
• Hallways and walkways visible in the reference must remain passable — at minimum 24 inches of clear floor.
• Windows must remain accessible — no furniture stacked against them unless the reference shows that.
• Bedroom: the side(s) of the bed that are accessible in the reference must stay accessible. Do not slide the bed to block a closet or wall that has clearance in the reference.
• Living room: keep the clear path between the couch and the coffee table. Keep the walking path from the doorway to the seating area open.
• Kitchen: counter and appliance frontage must have working clearance. The path between counter runs must remain walkable.
• Bar/nightclub: bar front access, booth entry gaps, stage approaches, and exit paths must remain open.
• Office: chair must be able to roll back from the desk without hitting a wall.

FURNITURE MUST NOT INTERSECT OR OVERLAP:
• No two pieces of furniture can occupy the same floor space.
• A chair cannot be inside a table. A lamp cannot be inside a couch. A bed cannot overlap a dresser.
• If objects appear close in the reference, keep that proximity — but they must not merge or clip.

CHARACTER PLACEMENT IN THIS ROOM:
• Place the subject only in spots where a person could physically be — on a seating surface, standing in open floor space, lying on a bed with the rest of the room intact.
• Do NOT place the character where they would block a door, stand inside furniture, or be pressed against a wall with no room.
• Sitting on the bed is fine — but the rest of the room must remain as-is. Do not shift the bed or surrounding furniture to center the shot.
• Standing in a doorway must look intentional — they are in the frame of the door, not clipping through the wall.

DO NOT SACRIFICE LAYOUT FOR COMPOSITION:
• Do not move furniture to better frame the character. The room is fixed. The camera angle can change — the room cannot.
• Do not compress the room to fit more objects in frame. Let objects be partially off-screen if needed.
• A correct result is a room that someone who has been in this space would immediately recognize as correct AND functional.

SPATIAL LOGIC SELF-CHECK — before finalizing the image, verify:
✓ Every door has clearance to open
✓ Every closet has clear floor space in front of it
✓ Every walkway shown in the reference remains passable
✓ No furniture overlaps or clips another object
✓ The character is placed in a physically believable spot
✓ The room could be used normally by a real person

If any of these checks fail, correct the layout before rendering.

────────────────────────────────────
PERMITTED CHANGES:
✓ Camera angle, framing, zoom, and perspective
✓ Subject pose, position, expression, and action
✓ Time of day / lighting conditions ONLY IF explicitly requested
✓ Any element the prompt EXPLICITLY asks to change

PROHIBITED CHANGES (unless explicitly requested):
✗ Furniture style, color, shape, or placement
✗ Floor material or color
✗ Wall color or finish
✗ Window treatments
✗ Wall art or decorative objects
✗ Room layout, design language, or aesthetic
✗ Adding or removing any room-defining element
✗ Moving furniture to improve composition at the cost of room functionality
✗ Blocking any door, closet, walkway, or access point

CRITICAL RULE: "Same room different angle" means ONLY the camera moves. Nothing else changes.
CRITICAL RULE: Do NOT fall back to generic generation. If reference images exist, they are the source of truth.
CRITICAL RULE: A person who knows this space in real life must look at the result and immediately recognize it as the same place AND believe someone could actually live and move in it.
════════════════════════════════════════════════════════════`;
}

// ── USER IDENTITY LOCK PROMPT ────────────────────────────────────────────────────
function buildUserIdentityLockNote(userAppearanceData, strictMode = false) {
  const parts = [];
  if (userAppearanceData?.age_range) parts.push(`Age: ${userAppearanceData.age_range}`);
  if (userAppearanceData?.gender) parts.push(`Gender: ${userAppearanceData.gender}`);
  if (userAppearanceData?.ethnicities?.length > 0) parts.push(`Ethnicity/Background: ${userAppearanceData.ethnicities.join(', ')}`);
  if (userAppearanceData?.appearance_notes) parts.push(`Details: ${userAppearanceData.appearance_notes}`);

  const strictWarning = strictMode ? `
⚠️ STRICT IDENTITY PRESERVATION MODE ⚠️
This person's identity is NON-NEGOTIABLE. Any deviation from the reference images is a failure.
You are not creating "inspired by" or "similar to" — you are reproducing the exact same person.
Do NOT let the generator beautify, normalize, or substitute this person's appearance.
Do NOT interpret vague guidance as permission to drift. The reference IS the target.
` : '';

  return `
════════════════════════════════════════════════════════════
USER IDENTITY LOCK — STRONG FACE & FEATURE CONSISTENCY
════════════════════════════════════════════════════════════
The user's face and body must remain CONSISTENT and RECOGNIZABLE.
${parts.length > 0 ? `${parts.join('\n')}` : 'Use reference images as the primary identity guide.'}

${strictWarning}

WHAT IS LOCKED:
✓ Face shape and bone structure
✓ Skin tone and texture
✓ Hair color, texture, length, and style
✓ Eyes (color, shape, distance)
✓ Nose (shape, size, profile)
✓ Mouth and lips
✓ Distinctive facial features or marks
✓ Body build and proportions
✓ Age presentation
✓ Overall likeness consistency

THIS IS NOT A GENERIC CHARACTER.
This is a specific real person who must be recognizable across generations.
Do NOT produce a random person. Do NOT swap faces with generic models.
Do NOT allow face drift. Anchor identity to the provided reference images.
Do NOT beautify away their unique characteristics in favor of a "model-like" version.

PERMITTED CHANGES:
✓ Clothing, hairstyle, expression, pose, setting
✓ Age appearance within their general age range (if applicable)
✓ Styling details per the prompt

PROHIBITED CHANGES:
✗ Face shape or bone structure
✗ Skin tone or ethnicity
✗ Core hair color or natural texture
✗ Body build or proportions
✗ Distinctive features that define their appearance
✗ Substituting a "prettier" or "more model-like" version
════════════════════════════════════════════════════════════`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId, prompt, characterReferenceImages, userReferenceImages, characterName, userWorldName, subjectType, characterId, manualLocationId, manualZoneId, isUserIdentityLocked, userIdentityStrictMode, userAppearanceData, includesUser } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    // ── SERVER-SIDE CHARACTER REF RESOLUTION ──────────────────────────────────
    // Always fetch the character record so we have the latest avatar + reference images,
    // regardless of what the frontend passed in. This prevents "no refs" when the
    // frontend passes an empty array.
    let resolvedCharacterRefs = characterReferenceImages || [];
    let characterAppearanceNote = "";

    if (characterId) {
      try {
        const charRecord = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
        if (charRecord) {
          // Build server-side ref list: avatar first, then reference_image_urls
          const serverRefs = [];
          if (charRecord.avatar_url) serverRefs.push(charRecord.avatar_url);
          if (charRecord.reference_image_urls?.length > 0) serverRefs.push(...charRecord.reference_image_urls);

          // Use server-side refs if frontend passed nothing or server has more
          if (serverRefs.length > resolvedCharacterRefs.length) {
            resolvedCharacterRefs = serverRefs;
            console.log(`[CHAR-REFS] Using server-side refs: ${serverRefs.length} images for ${charRecord.name}`);
          }

          // Build appearance description text for when refs are sparse/missing
          const appearanceParts = [];
          if (charRecord.age_range) appearanceParts.push(charRecord.age_range);
          if (charRecord.gender) appearanceParts.push(charRecord.gender);
          if (charRecord.ethnicities?.length > 0) appearanceParts.push(charRecord.ethnicities.join(', '));
          if (charRecord.appearance_notes) appearanceParts.push(charRecord.appearance_notes);
          if (charRecord.avatar_description_text) appearanceParts.push(charRecord.avatar_description_text);

          if (appearanceParts.length > 0) {
            characterAppearanceNote = `\n\nCHARACTER APPEARANCE — ${charRecord.name}: ${appearanceParts.join(', ')}. Generate this specific person consistently.`;
          }
        }
      } catch (err) {
        console.error('[CHAR-REFS] Failed to fetch character:', err.message);
      }
    }

    // ── SERVER-SIDE USER REF RESOLUTION ──────────────────────────────────────
    // Always resolve from the message owner's settings to prevent stale/empty refs
    let resolvedUserRefs = userReferenceImages || [];
    let resolvedUserAppearanceData = userAppearanceData || null;

    try {
      const message = await base44.entities.Message.get(messageId).catch(() => null);
      const createdBy = message?.created_by;
      const needsUserRefs = resolvedSubjectType === "user" || resolvedSubjectType === "joint" || includesUser === true;
      if (createdBy && needsUserRefs) {
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: createdBy }, null, 1).catch(() => []);
        const sett = settingsList?.[0] || {};
        // Merge: generated avatars first (highest fidelity), then raw uploads
        const settRefs = [
          ...(sett.generated_avatar_urls || []),
          ...(sett.reference_image_urls || []),
        ].filter(Boolean);
        if (settRefs.length > resolvedUserRefs.length) {
          resolvedUserRefs = settRefs;
          console.log(`[USER-REFS] Server resolved ${settRefs.length} user ref images from settings`);
        }
        // Build appearance data if not provided
        if (!resolvedUserAppearanceData && (sett.user_gender || sett.user_birthday)) {
          resolvedUserAppearanceData = {
            gender: sett.user_gender || '',
            age_range: sett.user_age_range || '',
            appearance_notes: sett.appearance_notes || '',
            ethnicities: sett.ethnicities || [],
          };
        }
        // Log the user's in-world name for debugging
        if (sett.fictional_world_name) {
          console.log(`[USER-IDENTITY] In-world name: "${sett.fictional_world_name}" (passed: "${userWorldName}")`);
        }
      }
    } catch (refErr) {
      console.error('[USER-REFS] Failed to resolve user refs server-side:', refErr.message);
    }

    // Parse [TAG] from start of prompt — do this BEFORE user ref resolution
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) resolvedSubjectType = tagMatch[1].toLowerCase();
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    const hasUserImages = resolvedUserRefs.length > 0;
    const hasCharacterImages = resolvedCharacterRefs.length > 0;

    // ── LOCATION + ZONE RESOLUTION ────────────────────────────────────────────
    let locationImages = [];
    let locationNote = "";
    let resolvedLocationName = null;
    let resolvedZoneName = null;

    if (resolvedSubjectType !== "user") {
      try {
        // ── MANUAL SELECTION PATH (highest priority — bypasses all text parsing) ──
        if (manualLocationId) {
          const manualLoc = await base44.asServiceRole.entities.LocationReference.get(manualLocationId).catch(() => null);
          if (manualLoc) {
            resolvedLocationName = manualLoc.name;
            let imgs = [];
            if (manualZoneId && manualLoc.zones?.length > 0) {
              const zone = manualLoc.zones.find(z => z.zone_name === manualZoneId);
              if (zone?.image_urls?.length > 0) {
                imgs = zone.image_urls.slice(0, 6);
                resolvedZoneName = zone.zone_name;
              }
            }
            // Fallback: if no zone matched, use flat image_urls or first zone
            if (imgs.length === 0) {
              const firstZoneWithImages = manualLoc.zones?.find(z => z.image_urls?.length > 0);
              imgs = firstZoneWithImages?.image_urls?.slice(0, 6) || manualLoc.image_urls?.slice(0, 6) || [];
              resolvedZoneName = firstZoneWithImages?.zone_name || null;
            }
            locationImages = imgs;
            locationNote = buildRoomLockNote(resolvedLocationName, resolvedZoneName);
            console.log(`[LOCATION] ✓ MANUAL: "${resolvedLocationName}" → Zone: "${resolvedZoneName}" | Images: ${imgs.length}`);
          }
        } else {
          // ── AUTOMATIC TEXT-PARSING PATH (fallback when no manual selection) ──
          const charRecord = characterId
            ? await base44.asServiceRole.entities.Character.get(characterId).catch(() => null)
            : null;
          const createdBy = charRecord?.created_by;

          if (createdBy) {
            const savedLocations = await base44.asServiceRole.entities.LocationReference.filter(
              { created_by: createdBy }, '-created_date', 100
            );

            const { locationImages: imgs, locationName, zoneName, matchConfidence, confidenceScore } =
              resolveLocationAndZone(cleanPrompt, savedLocations, characterId);

            if (imgs.length > 0 && confidenceScore >= 0.7) {
              locationImages = imgs;
              resolvedLocationName = locationName;
              resolvedZoneName = zoneName;
              locationNote = buildRoomLockNote(locationName, zoneName);
              console.log(`[LOCATION] ✓ AUTO: "${locationName}" → Zone: "${zoneName}" | Score: ${confidenceScore.toFixed(2)} | Images: ${imgs.length}`);
            } else if (imgs.length > 0) {
              console.log(`[LOCATION] ✗ Auto match below threshold (score=${confidenceScore.toFixed(2)}) — no environment applied`);
            }
          }
        }
      } catch (err) {
        console.error('[LOCATION] Resolution failed:', err.message);
      }
    }

    // ── REFERENCE IMAGE ASSEMBLY ───────────────────────────────────────────────
    // Location/zone images ALWAYS first — they are the dominant reference
    let referenceImages;
    let enhancedPrompt = cleanPrompt + locationNote;
    const hasLocationImages = locationImages.length > 0;

    // Slot budget: location gets 3 max, character gets 4 max — prioritize face fidelity
    const locationCount = Math.min(locationImages.length, 3);
    const charCount = Math.min(resolvedCharacterRefs.length, 4);
    const userCount = Math.min((userReferenceImages || []).length, 2);

    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [
        ...locationImages.slice(0, 3),
        ...resolvedCharacterRefs.slice(0, 2),
        ...resolvedUserRefs.slice(0, 2),
      ].filter(Boolean);

      const roomNote = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${locationCount} = THE ROOM ("${resolvedZoneName || resolvedLocationName}") — locked environment. Images ${locationCount + 1}–${locationCount + 2} = ${characterName} (replicate exactly). Final images = the USER (replicate exactly). Both people must be placed inside the locked room.`
        : `CRITICAL: Features BOTH ${characterName} AND the user. Replicate both faces and appearances with pristine accuracy.`;
      enhancedPrompt = `${cleanPrompt}${locationNote}${characterAppearanceNote}\n\n${roomNote}`;

    } else if (resolvedSubjectType === "user" && hasUserImages) {
      // User identity-lock mode: prioritize user refs, strong identity preservation
      // Strict mode requires maximum facial consistency, no drift/beautification
      referenceImages = resolvedUserRefs.slice(0, 4);
      const identityLockNote = isUserIdentityLocked ? buildUserIdentityLockNote(resolvedUserAppearanceData, userIdentityStrictMode) : '';
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject is the USER (not ${characterName}). Replicate their exact face, features, and appearance.${identityLockNote}`;

    } else if (hasCharacterImages) {
      // Character refs come AFTER location refs but get more slots (4 vs 3) for face priority
      referenceImages = [
        ...locationImages.slice(0, 3),
        ...resolvedCharacterRefs.slice(0, 4),
      ].filter(Boolean);

      // If user is included in the scene, add their refs + identity lock
      const effectiveUserIncluded = includesUser === true && resolvedUserRefs.length > 0;
      if (effectiveUserIncluded) {
        // Inject user refs alongside character refs
        referenceImages = [
          ...locationImages.slice(0, 3),
          ...resolvedCharacterRefs.slice(0, 2),
          ...resolvedUserRefs.slice(0, 2),
        ].filter(Boolean);
      }

      const userIdentityNote = effectiveUserIncluded
        ? `\n\nUSER ALSO IN THIS SCENE: A second person (the user) must appear alongside ${characterName}. Replicate the user's exact face, features, and appearance from the final reference images. ${buildUserIdentityLockNote(resolvedUserAppearanceData, true)}`
        : '';

      const doNotIncludeOthers = effectiveUserIncluded ? '' : ' Do NOT include any other person.';
      const roomInstruction = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${locationCount} = THE ROOM ("${resolvedZoneName || resolvedLocationName}") — locked environment blueprint. Reproduce it with strict visual fidelity. Images ${locationCount + 1}–${locationCount + (effectiveUserIncluded ? 2 : charCount)} = ${characterName} — replicate their exact face, skin tone, hair, and body with maximum fidelity.${effectiveUserIncluded ? ` Final images = THE USER — also present in this scene, replicate their exact appearance.` : ''} Do NOT redesign the room.`
        : `CRITICAL: Subject is ${characterName}. Replicate their exact face, features, and appearance.${doNotIncludeOthers}`;
      enhancedPrompt = `${cleanPrompt}${locationNote}${characterAppearanceNote}${userIdentityNote}\n\n${roomInstruction}`;

    } else if (hasLocationImages) {
      // No character refs at all — use location refs + strong appearance text
      referenceImages = locationImages.slice(0, 5);
      enhancedPrompt = `${cleanPrompt}${locationNote}${characterAppearanceNote}`;
      if (characterAppearanceNote) {
        console.log(`[CHAR-REFS] No reference images available — using appearance text description only`);
      }

    } else {
      referenceImages = undefined;
      enhancedPrompt = `${cleanPrompt}${characterAppearanceNote}`;
    }

    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (response?.url) {
      // Store generation context so regeneration can reuse the exact same scene
      const generationContext = {
        prompt: cleanPrompt,
        character_id: characterId || null,
        character_reference_images: resolvedCharacterRefs.slice(0, 4),
        location_id: manualLocationId || null,
        zone_name: resolvedZoneName || null,
        location_name: resolvedLocationName || null,
        location_reference_images: locationImages.slice(0, 3),
        subject_type: resolvedSubjectType,
        user_reference_images: resolvedUserRefs.slice(0, 4),
        user_appearance_data: resolvedUserAppearanceData || null,
        is_user_identity_locked: isUserIdentityLocked || false,
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