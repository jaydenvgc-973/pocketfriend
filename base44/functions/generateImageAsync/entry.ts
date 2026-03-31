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
  // Max 6 images per zone — more references = stronger room lock
  const MAX_ZONE_IMGS = 6;
  if (zones.length === 0) return (location.image_urls || []).slice(0, MAX_ZONE_IMGS);

  // 1. Exact zone name match
  for (const zone of zones) {
    if (zone.image_urls?.length > 0 && promptLower.includes(zone.zone_name.toLowerCase())) {
      return zone.image_urls.slice(0, MAX_ZONE_IMGS);
    }
  }
  // 2. Zone hint keyword match — also combine multi-angle shots of same zone
  for (const [keyword, targetZone] of Object.entries(ZONE_HINTS)) {
    if (promptLower.includes(keyword)) {
      // Collect ALL zones whose names match targetZone (multiple angles of same room)
      const matchedZones = zones.filter(z => z.image_urls?.length > 0 && z.zone_name.toLowerCase().includes(targetZone));
      if (matchedZones.length > 0) {
        // Combine all angles of the same zone to build strongest possible room reference
        const combined = matchedZones.flatMap(z => z.image_urls || []).slice(0, MAX_ZONE_IMGS);
        if (combined.length > 0) return combined;
      }
    }
  }
  // 3. First zone with images
  const first = zones.find(z => z.image_urls?.length > 0);
  if (first) return first.image_urls.slice(0, MAX_ZONE_IMGS);

  return (location.image_urls || []).slice(0, MAX_ZONE_IMGS);
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
          locationImages = findLocationImages(cleanPrompt, savedLocations, characterId).slice(0, 6);
          if (locationImages.length > 0) {
            locationNote = `

════════════════════════════════════════════════════════════
ROOM IDENTITY LOCK — THIS IS A MANDATORY ARCHITECTURAL CONSTRAINT
════════════════════════════════════════════════════════════
The provided reference images are NOT mood boards. They are NOT inspiration. They are NOT general style guides.
They are the GROUND TRUTH of this specific room. Treat them as a locked environment blueprint.

YOU ARE PHOTOGRAPHING THE SAME ROOM AGAIN FROM A DIFFERENT ANGLE.
This is not a new room. This is not a similar room. This is THE EXACT SAME ROOM.
The reference images are multiple photographs of one persistent real space.
Your job is to generate another photograph of that same space.

WHAT YOU MUST LOCK IN — NO EXCEPTIONS:
─────────────────────────────────────────
FLOORING: Reproduce the exact floor material, species, color, plank direction, tile pattern, grout color, carpet pile, and finish. If it is dark hardwood, it stays dark hardwood. If it has a specific grain pattern, match it. Do not lighten, darken, or change the material.

WALLS: Exact paint color, sheen, any wallpaper pattern, wainscoting, baseboard trim color, crown molding, and accent walls. Every wall must match identically.

FURNITURE — EVERY PIECE:
- Reproduce each piece of furniture with exact shape, proportions, style, color, and material.
- A square coffee table stays a square coffee table. A round one stays round.
- A low modern sofa stays a low modern sofa. Do not swap it for a different silhouette.
- A dark wood bed frame stays a dark wood bed frame.
- Do not remove, add, or substitute ANY furniture piece.
- Placement: If a couch is against a certain wall, keep it there. If a bed is under a window, keep it there. If a dresser is beside a door, keep it there. These spatial relationships are locked.

FABRICS & UPHOLSTERY:
- Exact fabric texture, weave pattern, and color of every cushion, pillow, blanket, curtain panel, and rug.
- A beige woven rug stays a beige woven rug — same pile height, same weave, same color family.
- Dark leather stays dark leather. Linen stays linen. Velvet stays velvet.
- Do not change the color, pattern, or material of any fabric or upholstered surface.

WINDOW TREATMENTS: Curtains, blinds, shades, or shutters must match exactly — same fabric, color, pattern, length, fullness, hardware/rods, and hang position. If they are open, show them open. If closed, show them closed.

WALL ART & MOUNTED OBJECTS: Every framed photo, painting, mirror, clock, shelf bracket, and decorative wall piece must appear in the same position on the same wall, at the same height and orientation. Do not move them.

SHELVING & BOOKCASES: Reproduce the exact contents, density, color arrangement, and decorative objects on every shelf. Bookcases must match identically including the books, objects, and overall composition.

LIGHTING FIXTURES: All ceiling lights, pendants, floor lamps, table lamps, and sconces must match in style, position, and the warm/cool quality of the light they emit.

DECORATIVE OBJECTS: Every plant, vase, sculpture, candle, tray, bowl, remote, throw blanket, and tabletop object that defines this room must be present. Do not remove or substitute defining objects.

SPATIAL PROPORTIONS: Room dimensions, ceiling height, window size and placement, door positions, and the overall sense of space must match exactly.

─────────────────────────────────────────
WHAT YOU ARE ALLOWED TO CHANGE:
─────────────────────────────────────────
✓ Camera angle and framing (you may pan, tilt, zoom, or reframe)
✓ The subject's pose, position, or expression
✓ Lighting conditions if explicitly requested (e.g. nighttime vs daytime)
✓ Any element the user's prompt EXPLICITLY requests be changed

WHAT YOU ARE NEVER ALLOWED TO CHANGE (UNLESS EXPLICITLY PROMPTED):
✗ The room's furniture — not style, not color, not placement, not shape
✗ The floor material or color
✗ The wall color
✗ The window treatments
✗ Any wall art or decorative objects
✗ The room's design language or aesthetic
✗ The spatial layout or furniture arrangement

If the prompt says "same room different angle" — treat this as the STRICTEST possible constraint. ONLY the camera moves. Nothing else.

THE RESULT MUST BE INSTANTLY AND UNMISTAKABLY RECOGNIZABLE AS THE SAME ROOM.
A person who knows this room in real life must look at the result and say "yes, that is the exact same room."
════════════════════════════════════════════════════════════`;
          }
        }
      } catch (_) {
        // Location lookup failed silently — continue without
      }
    }

    let referenceImages;
    let enhancedPrompt = cleanPrompt + locationNote;

    // Location images ALWAYS come first and dominate — they are the locked environment blueprint
    // When a saved room exists, it is the primary reference. Character/person refs are secondary.
    const hasLocationImages = locationImages.length > 0;

    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [
        ...locationImages.slice(0, 4),       // Room first — max 4 room refs to dominate
        ...characterReferenceImages.slice(0, 2),
        ...userReferenceImages.slice(0, 2),
      ].filter(Boolean);
      const roomNote = hasLocationImages
        ? `REFERENCE IMAGE ORDER: Images 1–${Math.min(locationImages.length, 4)} are of THE ROOM — this is the locked environment. Images ${Math.min(locationImages.length, 4) + 1}–${Math.min(locationImages.length, 4) + Math.min(characterReferenceImages.length, 2)} are of ${characterName}. Final images are of the USER. Reproduce the room with near-locked fidelity. Both people must look exactly like their references.`
        : `CRITICAL: This photo features BOTH ${characterName} AND the user together. Replicate both faces and appearances with pristine accuracy.`;
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\n${roomNote}`;
    } else if (resolvedSubjectType === "user" && hasUserImages) {
      referenceImages = userReferenceImages.slice(0, 4);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance with pristine accuracy.`;
    } else if (hasCharacterImages) {
      // "character" or fallback — NEVER include user references
      // Location images come FIRST and get maximum slots — the room is the anchor
      referenceImages = [
        ...locationImages.slice(0, 4),       // Room gets up to 4 slots — locked environment
        ...characterReferenceImages.slice(0, 3),  // Character gets up to 3 slots
      ].filter(Boolean);
      const roomInstruction = hasLocationImages
        ? `REFERENCE IMAGE ORDER: The first ${Math.min(locationImages.length, 4)} image(s) are of THE ROOM — this is the locked environment blueprint. Reproduce it with near-locked visual fidelity (same furniture, exact placement, same floors, walls, decor, lighting). The remaining reference images are of ${characterName} — place them in that exact room. Replicate ${characterName}'s exact face and appearance. Do NOT include any other person. Do NOT redesign the room.`
        : `CRITICAL: The subject of this photo is ${characterName}. Replicate their exact face, features, and appearance. Do NOT include any other person.`;
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\n${roomInstruction}`;
    } else if (hasLocationImages) {
      // No character refs but have location refs
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
      return Response.json({ success: true, imageUrl: response.url, locationMatched: locationImages.length > 0 });
    }

    return Response.json({ success: false, error: 'No image URL generated' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});