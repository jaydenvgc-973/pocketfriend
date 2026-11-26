/**
 * SCENE IMAGE PROMPT BUILDER
 * 
 * Builds structured prompts for scene image generation with:
 * - Zone lock: only selected zone images used, no cross-zone bleed
 * - Controlled camera flexibility (~10% viewpoint variation)
 * - Time-of-day lighting that changes atmosphere but not room identity
 * - Character integration: lighting match, no pasted-on look
 */

/**
 * Returns a descriptive lighting string based on the hour of day.
 */
/**
 * The lighting of the app's authoritative time — Eastern — right now. One helper, so every
 * picture of the same moment describes the same hour.
 */
export function getEasternLightingDescriptor(date = new Date()) {
  const nowET = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return getLightingDescriptor(nowET.getHours());
}

export function getLightingDescriptor(hour) {
  if (hour < 5)  return "very dark late-night atmosphere, minimal ambient light sources only, near darkness";
  if (hour < 7)  return "pre-dawn dim quiet light, soft and low, dark outside windows";
  if (hour < 10) return "soft warm morning light, gentle golden tones, sunlight beginning to come through windows";
  if (hour < 14) return "bright midday natural light, clear and even, windows fully lit";
  if (hour < 17) return "warm afternoon light, slightly golden and directional";
  if (hour < 19) return "early evening transitional light, warm-to-cool shift, sun getting low";
  if (hour < 22) return "evening indoor lighting, warm lamps and overhead lights on, dim ambient glow outside";
  return "late night, low artificial interior lighting only, outside is dark";
}

/**
 * TIME OF DAY — THE SAME RULE ON EVERY SCENES IMAGE PATH.
 *
 * The hour is Pocketfriend's authoritative time (Eastern), never the hour of a reference
 * photograph and never re-decided per picture. The view through any window must agree with
 * it, and one continuous scene may not drift between day and night between images.
 */
export function buildTimeOfDayLock(lightingDesc) {
  return ` TIME OF DAY — AUTHORITATIVE (America/New_York, now): ${lightingDesc}. ` +
    `What is visible through every window, glass door and opening MUST agree with this hour: at night the outside is dark — night sky, distant lit windows, streetlights — ⛔ never daylight, never bright sunshine, never a bright blue sky, never sunlit walls or floors. ` +
    `Interior lights may be fully on at night; the outside stays night. In daylight the outside is genuinely bright. Dawn and dusk show their own low, warm light. ` +
    `This hour is fixed for this continuous scene — a later picture of the same moment must not drift to a different time of day.`;
}

/**
 * Builds the zone-lock + camera-flexibility environment block.
 * This replaces the old generic "CRITICAL ENVIRONMENT RULE" string.
 */
export function buildZoneLockEnvNote(activeZoneName, hasRefImages, lightingDesc, existingObjectCue = null) {
  if (!hasRefImages) {
    return `ZONE: "${activeZoneName}" — the selected zone is the actual surroundings of this moment; everything happens inside it, and only what this zone actually is may appear. ⛔ Never invent an indoor interior or borrow a room from another zone or location. ` +
      `Apply ${lightingDesc} to the scene. Keep the environment consistent with the location type. ` +
      `What is visible through any window must match this hour — at night it is dark outside, never daylight.`;
  }

  const existingObjectBlock = existingObjectCue
    ? ` EXISTING OBJECT AUTHORITY — CRITICAL: This zone already contains a canonical ${existingObjectCue}. The reference images show the actual ${existingObjectCue} that exists in this space. YOU MUST compose the scene around THE EXISTING ${existingObjectCue.toUpperCase()}. ⛔ Do NOT create a second ${existingObjectCue}. ⛔ Do NOT replace or redesign the existing ${existingObjectCue}. If framing is difficult — move the camera, adjust character pose, or change distance. Do NOT alter the space.`
    : '';

  // THE SPACE IS WHATEVER THE IMAGES SHOW — never assumed to be a room.
  // Reading these references as "a room" is what furnished an outdoor street: the
  // instructions used to ask for the same wall colours, flooring and windows, and for
  // "this room's actual furniture", on a photograph of a street.
  const spaceIdentity = `ZONE LOCK — STRICT: The reference images define the EXACT physical space of the "${activeZoneName}" zone, whatever that space actually is — an open outdoor street, an alley, a sidewalk, under a bridge, a vacant lot, a park bench, inside a tent, a vehicle cabin, or a room inside a building. Determine the kind of space FROM THE IMAGES and reproduce that same kind of space. ` +
    `You MUST preserve: the same layout and arrangement, the same ground and surfaces, the same structures, materials, finishes and colours, the same fixed features (buildings, walls, curbs, fences, doors, windows, counters, fixtures) in the same positions, and the same condition of the place — worn, deteriorating, cluttered, clean or new, exactly as it is. ` +
    `⛔ NOTHING THE IMAGES DO NOT CONTAIN MAY BE ADDED: no furniture, seating, bed, couch, table, desk, rug, lamp, ceiling, indoor wall, extra window or door, decoration or appliance unless it is actually visible in the reference images. A street stays a street. An alley stays an alley. A tent stays a tent. A room keeps only what that room has. If the references show open air, the picture is open air — no ceiling, no interior, no furnishings. ` +
    `⛔ DO NOT IMPROVE THE PLACE: never furnish, modernise, tidy or upgrade it to suit the activity.`;

  const furnitureAuthority = ` EXISTING OBJECTS — CRITICAL: if this moment needs an object (somewhere to sit, lie, eat, set something down, lean), use the one ALREADY VISIBLE in the reference images and move the camera to it. ⛔ Do NOT invent an object the references do not contain — if the space has no chair, bed, table or counter, the moment happens without one. ⛔ Do NOT duplicate an existing object because more than one person is present: the second person sits beside, leans on, or shares the same one. ⛔ Do NOT move existing objects between pictures — a bench on the kerb stays on the kerb.`;

  return spaceIdentity +
    `⛔ REFERENCE LIGHTING IS NOT AUTHORITATIVE: the reference images are LAYOUT authority only. Keep the space's geometry, structures and materials EXACTLY and relight it for the authoritative hour below — the time of day is never taken from the photograph. ` +
    existingObjectBlock +
    furnitureAuthority +
    ` CAMERA DYNAMICS (MANDATORY VARIATION): You MUST use dynamic camera placement and angles. Do NOT reuse the same static viewpoint. ` +
    `Vary significantly: from the doorway or kerb, from beside an object, from across the space, from a corner angle, over-the-shoulder close-ups, ` +
    `wider environmental shots, seated eye-level, standing eye-level, from different heights, from different distances. ` +
    `Framing must change — sometimes close on character, sometimes wide view, sometimes partial character in frame. ` +
    `Distance must vary — sometimes intimate close camera, sometimes far away establishing shot. ` +
    `You may NOT redesign the space, replace what is there, change its colours or surfaces, ` +
    `pull elements from a different zone, or invent new objects. ` +
    `ZONE EXCLUSIVITY: Only elements visible in the "${activeZoneName}" reference images may appear — ` +
    `no objects, structures, furnishings or details from other zones. ` +
    `TIME OF DAY: ${lightingDesc}. Adjust lighting to match the actual current time — do not apply wrong-time-of-day lighting. ` +
    `⛔ The view beyond every opening MUST agree with this hour: at night the outside reads dark (night sky, distant lit windows, streetlights) — never daylight, never bright sunshine, never a bright blue sky. Interior lamps may be fully on; the outside stays night. ` +
    `Morning light is soft and golden. Afternoon light is bright and direct. Evening light is warm and low-angle. Night uses lamps or moonlight. ` +
    `The lighting changes the atmosphere, not the identity of the space. ` +
    `CHARACTER INTEGRATION: Any characters must feel physically inside the space — ` +
    `match their shadows, highlights, colour temperature, brightness and light direction to the light of this space. ` +
    `If the space is dim, characters must be dimly lit. If warm light, characters have warm tones. If cool shadows, character reflects that. ` +
    `Characters must be clearly visible — camera must be close enough to identify them when they are the focus. ` +
    `Characters must not look pasted on, cutout, or photographed in different lighting. ` +
    `Feet must make sense on the ground. If sitting, the body must align with whatever they are sitting on. ` +
    `Do NOT invent furniture to make a closer view — use the same space from a closer camera angle.`;
}

/**
 * Derives the canonical existing-object cue for a given zone name.
 * Returns a short noun phrase (e.g. "desk", "dining table") or null.
 * Used to inject the EXISTING OBJECT AUTHORITY block into zone-lock prompts.
 *
 * @param {string} zoneName - Active zone name (e.g. "Office Zone", "Dining Room")
 * @returns {string|null}
 */
export function resolveExistingObjectCueForZone(zoneName) {
  if (!zoneName) return null;
  const lower = zoneName.toLowerCase();
  if (lower.includes('office') || lower.includes('study') || lower.includes('den')) return 'desk';
  // A studio, loft or open-plan apartment keeps its workstation in the same room as the bed
  // and the couch — the room's own desk is the one the picture must use.
  if (lower.includes('studio') || lower.includes('loft') || lower.includes('workspace')) return 'desk and workstation';
  if (lower.includes('dining')) return 'dining table';
  if (lower.includes('bedroom') || lower.includes('bed room') || lower.includes('master')) return 'bed';
  if (lower.includes('kitchen')) return 'kitchen counter and stove';
  if (lower.includes('gym') || lower.includes('fitness') || lower.includes('workout')) return 'gym equipment';
  if (lower.includes('laundry')) return 'washer and dryer';
  if (lower.includes('living') || lower.includes('lounge')) return 'couch/sofa';
  return null;
}

/**
 * The environment note for a property viewed as a whole — no single private room is
 * asserted. Used when the selected space is the facility itself.
 */
/**
 * PHYSICAL SETTING — the one thing a parent property must never override.
 *
 * An outdoor workspace stays outdoors even though its employer occupies a building; an
 * outdoor residence or an encampment stays outdoors. The picture shows the space that
 * actually exists, never an invented interior of the property it belongs to.
 */
export function buildPhysicalSettingNote(physicalSetting) {
  if (physicalSetting === 'outdoor') {
    return `PHYSICAL SETTING: This space is OUTDOORS — open to the sky and the weather even where it is attached to a larger property or building. Never place anyone inside an invented indoor interior (office, hallway, warehouse, lobby, living room, kitchen, bedroom); only the elements the chosen zone itself establishes may appear. `;
  }
  if (physicalSetting === 'indoor') {
    return `PHYSICAL SETTING: This space is INDOORS, inside a building. `;
  }
  return '';
}

export function buildFacilityEnvNote(locationName, hasRefImages, lightingDesc) {
  const layout = hasRefImages
    ? `The reference images show this property as a whole — preserve its architecture, materials and shared surroundings. `
    : '';
  return `THIS IS ${locationName} AS A WHOLE — the property and its shared surroundings, not any one private room or residence. ${layout}` +
    `Apply ${lightingDesc}. ⛔ The view outside every window and beyond every doorway MUST agree with this hour: at night it is dark outside — never daylight, never bright sunshine, never a bright blue sky.`;
}

/**
 * Builds the action-override environment note (shorter, used when an action triggers regen).
 */
export function buildActionEnvNote(activeZoneName, hasRefImages, lightingDesc) {
  // The selected zone IS the environment, whatever the activity is. An activity changes what
  // the people are doing, never where they are: a kiss on a street happens on that street.
  // The zone named here is the one the app has already resolved — including a destination a
  // legitimate activity relocated the character to. The picture obeys that zone; it never
  // picks a different space of its own, and it never invents an interior for an activity.
  const zoneAuthority = `THIS MOMENT HAPPENS IN THE SELECTED ZONE "${activeZoneName}" — the activity is performed HERE, in these actual surroundings, and nowhere else. Whatever this zone is, that is the space: if it is a street, the picture is that street; if it is a bathroom, a bedroom, a kitchen or a living room, the picture is that room. ⛔ NEVER substitute a different space — no house, apartment, bedroom, living room, kitchen or invented interior in place of the one named here, and nothing borrowed from another zone or location. An activity that is commonly associated with an interior — kissing, hugging, eating, sleeping, resting, talking — is performed in whatever space these people are actually in; the activity never chooses the surroundings. `;
  if (!hasRefImages) return zoneAuthority + `Only what this zone actually is may appear — the space as it really is, with nothing added: no furniture, seating, bed, couch, table, ceiling or indoor walls that this place does not have. Apply ${lightingDesc}. What is visible beyond any opening must match this hour — at night it is dark outside, never daylight.`;
  return zoneAuthority + `ZONE: "${activeZoneName}" — the reference images are the exact physical space, whatever kind of space it is (an outdoor street, an alley, a sidewalk, under a bridge, a vacant lot, a tent, a vehicle cabin, or a room). Preserve the same layout, ground, structures, materials, colours and condition, and add nothing they do not contain — no furniture, seating, bed, couch, table, rug, ceiling, indoor wall or decoration that is not visible in them. Never furnish, modernise or improve the place to suit the activity. ` +
    `CAMERA DYNAMICS: Use varied camera angles, distances, and framing — kerb or doorway view, close-ups, wide shots, different heights, different positions. ` +
    `Do not repeat the same static angle. Framing must change. Distance must vary. ` +
    `Apply ${lightingDesc}. ⛔ The view beyond every opening MUST agree with this hour: at night it is dark outside — never daylight, never bright sunshine, never a bright blue sky. ` +
    `Match character lighting to the space. Characters must be visible and clearly identifiable. ` +
    `⛔ EXISTING OBJECTS AUTHORITY: use only the objects already visible in the reference images — if the activity needs somewhere to sit, lie or set something down, move the CAMERA to the one that exists. If the space has none, the moment happens without one. Never invent a second object or add furniture, and never move existing objects between pictures.`;
}