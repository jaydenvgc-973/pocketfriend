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
 * Builds the zone-lock + camera-flexibility environment block.
 * This replaces the old generic "CRITICAL ENVIRONMENT RULE" string.
 */
export function buildZoneLockEnvNote(activeZoneName, hasRefImages, lightingDesc, existingObjectCue = null) {
  if (!hasRefImages) {
    return `Apply ${lightingDesc} to the scene. Keep the environment consistent with the location type.`;
  }

  const existingObjectBlock = existingObjectCue
    ? ` EXISTING OBJECT AUTHORITY — CRITICAL: This zone already contains a canonical ${existingObjectCue}. The reference images show the actual ${existingObjectCue} that exists in this space. YOU MUST compose the scene around THE EXISTING ${existingObjectCue.toUpperCase()}. ⛔ Do NOT create a second ${existingObjectCue}. ⛔ Do NOT replace or redesign the existing ${existingObjectCue}. If framing is difficult — move the camera, adjust character pose, or change distance. Do NOT alter the room.`
    : '';

  return `ZONE LOCK — STRICT: The reference images define the EXACT visual identity of the "${activeZoneName}" zone. ` +
    `These are the canonical rooms currently available to this generation path. Do not invent additional rooms, zones, furniture, or objects unless explicitly confirmed by canonical data. ` +
    `You MUST preserve: the same room layout, same furniture style, same wall colors, same flooring, same architectural features, ` +
    `same zone-defining structures (bar counter, kitchen, bed, couch, hallway, etc.), same windows and doors, same overall atmosphere. ` +
    existingObjectBlock +
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
  if (lower.includes('dining')) return 'dining table';
  if (lower.includes('bedroom') || lower.includes('bed room') || lower.includes('master')) return 'bed';
  if (lower.includes('kitchen')) return 'kitchen counter and stove';
  if (lower.includes('gym') || lower.includes('fitness') || lower.includes('workout')) return 'gym equipment';
  if (lower.includes('laundry')) return 'washer and dryer';
  if (lower.includes('living') || lower.includes('lounge')) return 'couch/sofa';
  return null;
}

/**
 * Builds the action-override environment note (shorter, used when an action triggers regen).
 */
export function buildActionEnvNote(activeZoneName, hasRefImages, lightingDesc) {
  if (!hasRefImages) return `${lightingDesc}.`;
  return `ZONE: "${activeZoneName}" — preserve same room layout, furniture, and colors. ` +
    `CAMERA DYNAMICS: Use varied camera angles, distances, and framing — doorway view, close-ups, wide shots, different heights, different positions. ` +
    `Do not repeat the same static angle. Framing must change. Distance must vary. ` +
    `Apply ${lightingDesc}. Match character lighting to the room. Characters must be visible and clearly identifiable. ` +
    `Do not redesign the space or invent new furniture.`;
}