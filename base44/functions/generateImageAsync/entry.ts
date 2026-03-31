import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// subjectType: "character" | "user" | "joint"
// Only use user references when subjectType is "user" or "joint"
// Never use user references for "character" images

// Zone hint keywords — maps prompt words to zone names for precise matching
const ZONE_HINTS = {
  "living room": "living room", "lounge": "living room", "couch": "living room", "sofa": "living room",
  "kitchen": "kitchen", "cooking": "kitchen", "fridge": "kitchen",
  "bedroom": "bedroom", "bed": "bedroom", "sleeping": "bedroom",
  "bathroom": "bathroom", "shower": "bathroom", "mirror": "bathroom",
  "dining room": "dining room", "dining table": "dining room",
  "hallway": "hallway", "entryway": "entryway", "front door": "entryway",
  "backyard": "backyard", "patio": "backyard",
  "exterior": "front exterior", "garage": "garage", "basement": "basement",
  "workout floor": "workout floor", "weights": "weight room", "treadmill": "cardio zone",
  "locker room": "locker room", "pool": "pool", "sauna": "sauna",
  "desk": "desk / workspace", "break room": "break room", "conference": "conference room",
  "waiting room": "waiting area", "waiting area": "waiting area",
  "patient room": "patient room", "patient bed": "patient room",
  "operating room": "operating room", "recovery room": "recovery room",
  "classroom": "classroom", "cafeteria": "cafeteria", "library": "library",
};

/**
 * Find zone-accurate image URLs from a location record.
 * Tries to match the prompt to the most specific zone first.
 */
function findZoneImages(promptLower, location) {
  const zones = location.zones || [];
  if (zones.length === 0) return (location.image_urls || []).slice(0, 4);

  // 1. Exact zone name match
  for (const zone of zones) {
    if (zone.image_urls?.length > 0 && promptLower.includes(zone.zone_name.toLowerCase())) {
      return zone.image_urls.slice(0, 4);
    }
  }
  // 2. Zone hint keyword match
  for (const [keyword, targetZone] of Object.entries(ZONE_HINTS)) {
    if (promptLower.includes(keyword)) {
      const matched = zones.find(z => z.image_urls?.length > 0 && z.zone_name.toLowerCase().includes(targetZone));
      if (matched) return matched.image_urls.slice(0, 4);
    }
  }
  // 3. First zone with images
  const first = zones.find(z => z.image_urls?.length > 0);
  if (first) return first.image_urls.slice(0, 4);

  return (location.image_urls || []).slice(0, 4);
}

/**
 * Match a prompt against saved LocationReference records.
 * Returns zone-accurate reference image URLs.
 * Character-specific locations are prioritized over global ones.
 */
function findLocationImages(prompt, locations, characterId) {
  if (!prompt || !locations || locations.length === 0) return [];

  const pl = prompt.toLowerCase();

  const characterLocations = characterId
    ? locations.filter(l => l.location_type === 'character_specific' && l.character_id === characterId)
    : [];
  const globalLocations = locations.filter(l => l.location_type === 'global');
  const ordered = [...characterLocations, ...globalLocations];

  // 1. Exact location name match → zone-accurate images
  for (const loc of ordered) {
    if (pl.includes(loc.name.toLowerCase())) {
      const imgs = findZoneImages(pl, loc);
      if (imgs.length > 0) return imgs;
    }
  }
  // 2. Keyword match → zone-accurate images
  for (const loc of ordered) {
    if (loc.keywords?.some(kw => pl.includes(kw.toLowerCase()))) {
      const imgs = findZoneImages(pl, loc);
      if (imgs.length > 0) return imgs;
    }
  }
  // 3. Category-level fuzzy match
  const categoryKeywords = {
    home: ['home', 'apartment', 'house', 'living room', 'bedroom', 'kitchen', 'bathroom', 'backyard'],
    gym: ['gym', 'workout', 'weights', 'treadmill', 'locker room', 'fitness'],
    workplace: ['work', 'office', 'job', 'workplace', 'store', 'shop'],
    social: ['bar', 'club', 'party', 'lounge'],
    outdoor: ['park', 'outside', 'outdoors', 'trail'],
    food_drink: ['coffee', 'cafe', 'restaurant', 'diner'],
    medical: ['hospital', 'clinic', 'doctor', 'waiting room', 'patient'],
    education: ['school', 'class', 'college', 'campus', 'library'],
  };
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => pl.includes(kw))) {
      const catLoc = ordered.find(l => l.category === cat);
      if (catLoc) {
        const imgs = findZoneImages(pl, catLoc);
        if (imgs.length > 0) return imgs;
      }
    }
  }

  return [];
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

    // Parse [TAG] from start of prompt as override (set by LLM in system prompt)
    let resolvedSubjectType = subjectType || "character";
    const tagMatch = prompt.match(/^\[(USER|CHARACTER|JOINT)\]/i);
    if (tagMatch) {
      resolvedSubjectType = tagMatch[1].toLowerCase();
    }
    // Strip the tag from the actual prompt
    const cleanPrompt = prompt.replace(/^\[(USER|CHARACTER|JOINT)\]\s*/i, "");

    // ── LOCATION REFERENCE LOOKUP ────────────────────────────────────
    // Fetch saved locations for this user and try to find matching location images
    // Only inject location references for character/joint images (not user-only shots)
    let locationImages = [];
    let locationNote = "";
    if (resolvedSubjectType !== "user") {
      try {
        // Use service role to fetch all locations for this app user
        const charRecord = characterId
          ? await base44.asServiceRole.entities.Character.get(characterId).catch(() => null)
          : null;
        const createdBy = charRecord?.created_by;
        if (createdBy) {
          const savedLocations = await base44.asServiceRole.entities.LocationReference.filter(
            { created_by: createdBy }, '-created_date', 100
          );
          locationImages = findLocationImages(cleanPrompt, savedLocations, characterId).slice(0, 4);
          if (locationImages.length > 0) {
            locationNote = `\n\nLOCATION CONSISTENCY — ABSOLUTE REQUIREMENT: Reference images of this exact room/space are provided. You MUST reproduce the environment with 90–99% visual fidelity. The generated image must look like a photograph taken in the IDENTICAL room — only the camera angle may differ. Every other detail must be preserved exactly as shown.

REPLICATE THESE ELEMENTS WITH PIXEL-PERFECT ACCURACY:
1. FURNITURE: Every single piece of furniture must appear — exact model, style, shape, color, fabric/material, texture, and spatial placement. Sofas, chairs, tables, shelving units, beds, dressers, ottomans, rugs — all must match exactly. Do NOT substitute, remove, recolor, or add any furniture.
2. FABRIC & UPHOLSTERY: Match the exact fabric texture, pattern, weave, and color of every upholstered surface — sofa cushions, throw pillows, curtains, rugs, bedding, chair covers.
3. FLOORING: Reproduce the exact floor material (hardwood species, tile pattern, carpet pile, etc.), color, grain direction, grout lines, and finish.
4. WINDOW TREATMENTS: Curtains, blinds, shades, or shutters must match exactly — same fabric, color, pattern, length, and hang style.
5. WALL COLOR & FINISH: Exact wall paint color, sheen level, wallpaper pattern, wainscoting, trim color, and any accent walls.
6. WALL ART & DECOR: Every picture, painting, mirror, clock, shelf bracket, and wall-mounted object must appear in the same position and orientation.
7. BOOKSHELVES & SHELVING: Reproduce the exact contents, arrangement, and style of any shelving units or bookcases.
8. LIGHTING FIXTURES: Match all ceiling lights, floor lamps, table lamps, and sconces — same style, position, and warm/cool tone they cast.
9. DECORATIVE OBJECTS: Every vase, plant, sculpture, remote control, throw blanket, candle — every object visible in the reference must be present.
10. SPATIAL LAYOUT: Room proportions, ceiling height, window placement, and door positions must match exactly.

THE ONLY PERMITTED CHANGE IS CAMERA ANGLE/FRAMING. Everything else must be an exact reproduction of the reference. This must be instantly and unmistakably recognizable as the same room.`;
          }
        }
      } catch (_) {
        // Location lookup failed silently — continue without
      }
    }

    let referenceImages;
    let enhancedPrompt = cleanPrompt + locationNote;

    // Always put location images FIRST so the model treats them as the primary environment reference
    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [
        ...locationImages.slice(0, 3),
        ...characterReferenceImages.slice(0, 2),
        ...userReferenceImages.slice(0, 2),
      ].filter(Boolean);
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\nCRITICAL: This photo features BOTH ${characterName} AND the user together. The first reference images show the ROOM — reproduce it with high fidelity. The next reference images are of ${characterName} — replicate their exact face and appearance. The remaining reference images are of the USER — replicate their exact face, features, skin tone, and appearance with pristine accuracy. Both people must look like their respective reference images.`;
    } else if (resolvedSubjectType === "user" && hasUserImages) {
      referenceImages = userReferenceImages.slice(0, 3);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance with pristine accuracy.`;
    } else if (hasCharacterImages) {
      // "character" or fallback — NEVER include user references
      // Location images come FIRST so the model anchors on the room before the subject
      referenceImages = [
        ...locationImages.slice(0, 3),
        ...characterReferenceImages.slice(0, 3),
      ].filter(Boolean);
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\nCRITICAL: The subject of this photo is ${characterName}. The first reference images show the ROOM — reproduce it with high fidelity (same furniture, walls, floors, decor). The remaining reference images are of ${characterName} — replicate their exact face, features, and appearance. Do NOT include any other person.`;
    } else if (locationImages.length > 0) {
      // No character refs but have location refs
      referenceImages = locationImages;
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
      return Response.json({ success: true, imageUrl: response.url, locationMatched: locationImages.length > 0 });
    }

    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});