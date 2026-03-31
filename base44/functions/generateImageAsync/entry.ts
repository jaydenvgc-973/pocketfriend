import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// subjectType: "character" | "user" | "joint"
// Only use user references when subjectType is "user" or "joint"
// Never use user references for "character" images

/**
 * Match a prompt against saved LocationReference records.
 * Returns up to 3 reference image URLs for the best matching location.
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

  for (const loc of ordered) {
    if (!loc.image_urls || loc.image_urls.length === 0) continue;

    // Exact name match
    if (pl.includes(loc.name.toLowerCase())) {
      return loc.image_urls.slice(0, 3);
    }

    // Keyword match
    if (loc.keywords && loc.keywords.some(kw => pl.includes(kw.toLowerCase()))) {
      return loc.image_urls.slice(0, 3);
    }
  }

  // Category-level fuzzy match
  const categoryKeywords = {
    home: ['home', 'apartment', 'house', 'living room', 'bedroom', 'kitchen', 'bathroom', 'backyard'],
    workplace: ['work', 'office', 'job', 'workplace', 'store', 'shop'],
    social: ['bar', 'club', 'party', 'lounge'],
    outdoor: ['park', 'outside', 'outdoors', 'trail'],
    food_drink: ['coffee', 'cafe', 'restaurant', 'diner'],
    medical: ['hospital', 'clinic', 'doctor'],
    education: ['school', 'class', 'college', 'campus', 'library'],
  };

  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(kw => pl.includes(kw))) {
      const catLoc = ordered.find(l => l.category === cat && l.image_urls?.length > 0);
      if (catLoc) return catLoc.image_urls.slice(0, 3);
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
          locationImages = findLocationImages(cleanPrompt, savedLocations, characterId);
          if (locationImages.length > 0) {
            locationNote = `\n\nLOCATION CONSISTENCY: Reference images of this specific location are provided. The generated image MUST match the visual style, layout, furniture, lighting, and atmosphere shown in those references. This must look like the SAME place. Vary the camera angle and framing naturally, but keep the environment visually consistent.`;
          }
        }
      } catch (_) {
        // Location lookup failed silently — continue without
      }
    }

    let referenceImages;
    let enhancedPrompt = cleanPrompt + locationNote;

    if (resolvedSubjectType === "joint" && hasCharacterImages && hasUserImages) {
      referenceImages = [
        ...characterReferenceImages.slice(0, 2),
        ...userReferenceImages.slice(0, 2),
        ...locationImages.slice(0, 2),
      ].filter(Boolean);
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\nCRITICAL: This photo features BOTH ${characterName} AND the user together. The first reference images are of ${characterName} — replicate their exact face and appearance. The next reference images are of the USER — replicate their exact face, features, skin tone, and appearance with pristine accuracy. Both people must look like their respective reference images.`;
    } else if (resolvedSubjectType === "user" && hasUserImages) {
      referenceImages = userReferenceImages.slice(0, 3);
      enhancedPrompt = `${cleanPrompt}\n\nCRITICAL: The subject of this photo is the USER (not ${characterName}). Use the provided reference images to replicate their exact face, features, and appearance with pristine accuracy.`;
    } else if (hasCharacterImages) {
      // "character" or fallback — NEVER include user references
      referenceImages = [
        ...characterReferenceImages.slice(0, 3),
        ...locationImages.slice(0, 2),
      ].filter(Boolean);
      enhancedPrompt = `${cleanPrompt}${locationNote}\n\nCRITICAL: The subject of this photo is ${characterName}. Use the provided character reference images to replicate their exact face, features, and appearance. Do NOT include any other person.`;
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