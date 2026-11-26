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
    return `Apply ${lightingDesc} to the scene. Keep the environment consistent with the location type. ` +
      `What is visible through any window must match this hour — at night it is dark outside, never daylight.`;
  }

  const existingObjectBlock = existingObjectCue
    ? ` EXISTING OBJECT AUTHORITY — CRITICAL: This zone already contains a canonical ${existingObjectCue}. The reference images show the actual ${existingObjectCue} that exists in this space. YOU MUST compose the scene around THE EXISTING ${existingObjectCue.toUpperCase()}. ⛔ Do NOT create a second ${existingObjectCue}. ⛔ Do NOT replace or redesign the existing ${existingObjectCue}. If framing is difficult — move the camera, adjust character pose, or change distance. Do NOT alter the room.`
    : '';

  // EVERY furnished space has furniture, whether or not its zone name happens to name it —
  // a studio with a desk and laptop is the demonstrated case. An activity that needs an
  // object uses the object the reference images already show; the camera moves to it.
  const furnitureAuthority = ` EXISTING FURNITURE AUTHORITY — CRITICAL: the reference images contain this room's ACTUAL furniture and its arrangement (desk, laptop, bed, couch, chairs, table, counters, fixtures, windows, doors). If this moment needs an object — working at a desk, using a laptop, sitting at a table, lying on the bed, cooking at the counter — use the one ALREADY IN THE REFERENCE IMAGES and move the camera to show it. ⛔ Do NOT add a second desk, laptop, table, chair, bed, counter, window or door that the references do not already contain. ⛔ Do NOT duplicate furniture because more than one person is in the room — the second person sits at, stands beside, or shares the same furniture. ⛔ Do NOT move existing furniture to another wall or another side of the room between pictures: a desk by the window stays by the window, a bed stays where it is. A different camera angle is the correct answer; a second object is not.`;

  return `ZONE LOCK — STRICT: The reference images define the EXACT visual identity of the "${activeZoneName}" zone. ` +
    `These are the canonical rooms currently available to this generation path. Do not invent additional rooms, zones, furniture, or objects unless explicitly confirmed by canonical data. ` +
    `You MUST preserve: the same room layout, same furniture style, same wall colors, same flooring, same architectural features, ` +
    `same zone-defining structures (bar counter, kitchen, bed, couch, hallway, etc.), same windows and doors in the same positions, same materials and finishes. ` +
    `⛔ REFERENCE LIGHTING IS NOT AUTHORITATIVE: the reference images are LAYOUT authority only. If they were photographed in daylight, keep the room's geometry, furniture and materials EXACTLY and relight it for the authoritative hour below — the time of day is never taken from the photograph. ` +
    existingObjectBlock +
    furnitureAuthority +
    ` CAMERA DYNAMICS (MANDATORY VARIATION): You MUST use dynamic camera placement and angles. Do NOT reuse the same static viewpoint. ` +
    `Vary significantly: from the doorway looking in, from beside furniture, from across the room, from a corner angle, over-the-shoulder close-ups, ` +
    `wider environmental shots, seated eye-level, standing eye-level, from different heights, from different distances. ` +
    `Framing must change — sometimes close on character, sometimes wide room view, sometimes partial character in frame. ` +
    `Distance must vary — sometimes intimate close camera, sometimes far away establishing shot. ` +
    `You may NOT redesign the room, replace furniture, change wall colors, change flooring, ` +
    `pull elements from a different zone, or invent new location objects. ` +
    `ZONE EXCLUSIVITY: Only elements visible in the "${activeZoneName}" reference images may appear — ` +
    `no objects, wall art, furniture, or details from other zones. ` +
    `TIME OF DAY: ${lightingDesc}. Adjust lighting to match the actual current time — do not apply wrong-time-of-day lighting. ` +
    `⛔ The view outside every window MUST agree with this hour: at night the glass reads dark (night sky, distant lit windows, streetlights) — never daylight, never bright sunshine, never a bright blue sky. Interior lamps may be fully on; the outside stays night. ` +
    `Morning light is soft and golden. Afternoon light is bright and direct. Evening light is warm and low-angle. Night uses lamps or moonlight. ` +
    `The lighting changes the atmosphere, not the room identity. ` +
    `CHARACTER INTEGRATION: Any characters must feel physically inside the scene — ` +
    `match their shadows, highlights, color temperature, brightness, and light direction to the room lighting. ` +
    `If the room is dim, characters must be dimly lit. If warm light, characters have warm tones. If cool shadows, character reflects that. ` +
    `Characters must be clearly visible — camera must be close enough to identify them when they are the focus. ` +
    `Characters must not look pasted on, cutout, or photographed in different lighting. ` +
    `Feet must make sense on the floor. If sitting, body must align with existing furniture. ` +
    `Do NOT invent new furniture to make a closer view — use the same furniture from closer camera angle.`;
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
  if (!hasRefImages) return `${lightingDesc}. What is visible through any window must match this hour — at night it is dark outside, never daylight.`;
  return `ZONE: "${activeZoneName}" — preserve same room layout, furniture, and colors. The reference images are LAYOUT authority only: if they were photographed in daylight, relight the same room for the authoritative hour below. ` +
    `CAMERA DYNAMICS: Use varied camera angles, distances, and framing — doorway view, close-ups, wide shots, different heights, different positions. ` +
    `Do not repeat the same static angle. Framing must change. Distance must vary. ` +
    `Apply ${lightingDesc}. ⛔ The view outside every window MUST agree with this hour: at night it is dark outside — never daylight, never bright sunshine, never a bright blue sky. ` +
    `Match character lighting to the room. Characters must be visible and clearly identifiable. ` +
    `⛔ EXISTING FURNITURE AUTHORITY: use the furniture already in the reference images — the same desk, laptop, table, chair, bed and counters in the same places. If the activity needs an object, move the CAMERA to the existing one; never invent a second desk, laptop, table or bed, and never duplicate furniture for a second person. Never move existing furniture between pictures.`;
}