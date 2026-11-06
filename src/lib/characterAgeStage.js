import { getCharacterAge } from '@/lib/characterAgeSystem';

/**
 * CHARACTER DEVELOPMENTAL STAGE
 *
 * Age 0 is a real, established age. It means an infant — a newborn under one
 * year old. It is NEVER treated as missing age information and NEVER defaulted
 * to adulthood.
 *
 * Infants are full physical participants in the world: they have identities,
 * parents, residences and authoritative locations. What they cannot do is take
 * part in adult conversation — no speech, no chat replies, no phone calls.
 *
 * This reads the existing age authority (getCharacterAge) rather than
 * introducing a new age source.
 */

/** Under one year old (age 0, or a birthday within the last 12 months). */
export const INFANT_MAX_AGE = 1;

export function isInfantCharacter(character) {
  if (!character) return false;
  const age = getCharacterAge(character);
  return age !== null && age < INFANT_MAX_AGE;
}

/**
 * Appearance authority for image generation: an infant must be depicted with
 * infant anatomy and development, using their own established avatar and
 * appearance lock for identity — never as a fully grown adult.
 */
export function buildInfantImageDirective(name) {
  const who = name ? `"${name}"` : 'This person';
  return (
    `${who} is an INFANT — a newborn baby under 1 year old. This age is established, not missing. ` +
    `Render authentic infant anatomy and development: a large head relative to a small body, soft round cheeks, ` +
    `short limbs, and an infant-sized frame. A baby is held, carried, cradled, sitting with support, or lying down — ` +
    `never standing or walking unassisted. ` +
    `⛔ Do NOT render ${who} as an adult, a teenager, or a child older than 1 year. ` +
    `⛔ Do NOT give ${who} adult proportions, an adult build, adult posture, or adult clothing.`
  );
}