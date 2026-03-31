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

CRITICAL RULE: "Same room different angle" means ONLY the camera moves. Nothing else changes.
CRITICAL RULE: Do NOT fall back to generic generation. If reference images exist, they are the source of truth.
CRITICAL RULE: A person who knows this space in real life must look at the result and immediately recognize it as the same place.
════════════════════════════════════════════════════════════`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId, prompt, characterReferenceImages, userReferenceImages, characterName, subjectType, characterId } = await req.json();

    if (!messageId || !prompt) {
      return Response.json({ error: 'messageId and prompt required' }, { status: 400 });
    }

    const message = await base44.entities.Message.get(messageId);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    const hasUserImages = userReferenceImages && userReferenceImages.length > 0;
    const hasCharacterImages = characterReferenceImages && characterReferenceImages.length > 0;

    // Parse [TAG] from start of prompt
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) resolvedSubjectType = tagMatch[1].toLowerCase();
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    // ── LOCATION + ZONE RESOLUTION ────────────────────────────────────────────
    let locationImages = [];
    let locationNote = "";
    let resolvedLocationName = null;
    let resolvedZoneName = null;

    if (resolvedSubjectType !== "user") {
      try {
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

          // FAILSAFE: Only use location references if confidence >= 0.7
          // Below threshold → fall back to generic generation (no contamination from wrong location)
          if (imgs.length > 0 && confidenceScore >= 0.7) {
            locationImages = imgs;
            resolvedLocationName = locationName;
            resolvedZoneName = zoneName;
            locationNote = buildRoomLockNote(locationName, zoneName);
            console.log(`[LOCATION] ✓ Matched: "${locationName}" → Zone: "${zoneName}" | Score: ${confidenceScore.toFixed(2)} | Confidence: ${matchConfidence} | Images: ${imgs.length}`);
          } else if (imgs.length > 0) {
            console.log(`[LOCATION] ✗ Match below threshold (score=${confidenceScore.toFixed(2)}) — falling back to generic generation`);
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

    const locationCount = Math.min(locationImages.length, 4);
    const charCount = Math.min((characterReferenceImages || []).length, 3);
    const userCount = Math.min((userReferenceImages || []).length, 2);

    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [
        ...locationImages.slice(0, 4),
        ...characterReferenceImages.slice(0, 2),
        ...userReferenceImages.slice(0, 2),
      ].filter(Boolean);

      const roomNote = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${locationCount} = THE ROOM ("${resolvedZoneName || resolvedLocationName}") — locked environment. Images ${locationCount + 1}–${locationCount + charCount} = ${characterName} (replicate exactly). Final images = the USER (replicate exactly). Both people must be placed inside the locked room.`
        : `CRITICAL: Features BOTH ${characterName} AND the user. Replicate both faces and appearances with pristine accuracy.`;
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\n${roomNote}`;

    } else if (resolvedSubjectType === "user" && hasUserImages) {
      referenceImages = userReferenceImages.slice(0, 4);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject is the USER (not ${characterName}). Replicate their exact face, features, and appearance.`;

    } else if (hasCharacterImages) {
      referenceImages = [
        ...locationImages.slice(0, 4),
        ...characterReferenceImages.slice(0, 3),
      ].filter(Boolean);

      const roomInstruction = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${locationCount} = THE ROOM ("${resolvedZoneName || resolvedLocationName}") — this is the locked environment blueprint. Reproduce it with near-locked visual fidelity. Images ${locationCount + 1}–${locationCount + charCount} = ${characterName} — place them naturally inside that exact room. Replicate ${characterName}'s face and appearance. Do NOT include any other person. Do NOT redesign or reimagine the room.`
        : `CRITICAL: Subject is ${characterName}. Replicate their exact face, features, and appearance. Do NOT include any other person.`;
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\n${roomInstruction}`;

    } else if (hasLocationImages) {
      referenceImages = locationImages.slice(0, 6);
      enhancedPrompt = `${cleanPrompt}${locationNote}`;

    } else {
      referenceImages = undefined;
    }

    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
    });

    if (response?.url) {
      await base44.entities.Message.update(messageId, { image_url: response.url });
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