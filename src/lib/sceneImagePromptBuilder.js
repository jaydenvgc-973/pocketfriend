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
export function buildZoneLockEnvNote(activeZoneName, hasRefImages, lightingDesc) {
  if (!hasRefImages) {
    return `Apply ${lightingDesc} to the scene. Keep the environment consistent with the location type.`;
  }

  return `ZONE LOCK — STRICT: The reference images define the EXACT visual identity of the "${activeZoneName}" zone. ` +
    `You MUST preserve: the same room layout, same furniture style, same wall colors, same flooring, same architectural features, ` +
    `same zone-defining structures (bar counter, kitchen, bed, couch, hallway, etc.), same windows and doors, same overall atmosphere. ` +
    `CAMERA FLEXIBILITY (10% shift only): You may vary the camera angle slightly — ` +
    `different viewpoint within the same space, wider or closer framing, seated eye-level, standing eye-level, ` +
    `over-the-shoulder, or doorway view into the same zone. ` +
    `You may NOT redesign the room, replace furniture, change wall colors, change flooring, ` +
    `pull elements from a different zone, or invent a new location. ` +
    `ZONE EXCLUSIVITY: Only elements visible in the "${activeZoneName}" reference images may appear — ` +
    `no objects, wall art, furniture, or details from other zones. ` +
    `TIME OF DAY: ${lightingDesc}. Adjust lighting to match — do not apply wrong-time-of-day lighting. ` +
    `The lighting changes the atmosphere, not the room identity. ` +
    `CHARACTER INTEGRATION: Any characters must feel physically inside the scene — ` +
    `match their shadows, highlights, color temperature, brightness, and light direction to the room. ` +
    `If the room is dim, characters must be dimly lit. If warm light, characters have warm tones. ` +
    `Characters must not look pasted on, cutout, or photographed in different lighting. ` +
    `Feet must make sense on the floor. If sitting, body must align with the furniture.`;
}

/**
 * Builds the action-override environment note (shorter, used when an action triggers regen).
 */
export function buildActionEnvNote(activeZoneName, hasRefImages, lightingDesc) {
  if (!hasRefImages) return `${lightingDesc}.`;
  return `ZONE: "${activeZoneName}" — preserve same room layout, furniture, and colors. ` +
    `Camera may shift slightly within the same space. ` +
    `Apply ${lightingDesc}. Match character lighting to the room. Do not redesign the space.`;
}