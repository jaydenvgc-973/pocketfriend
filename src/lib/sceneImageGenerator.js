/**
 * Scene Image Generation Pipeline
 *
 * Handles image generation for scene pages with strict enforcement of:
 * - Avatar identity lock (characters must match avatars exactly)
 * - Zone-lock (images must belong to currently selected zone only)
 * - Residential privacy (home scenes show residents only)
 * 
 * CRITICAL: appearance_lock controls identity. Closet/current_outfit controls clothing.
 * Avatar/reference images are for identity ONLY — never for clothing.
 */

import { buildAppearanceLockBlock, enforceValidation } from './appearanceLockValidator.js';

/**
 * Validates and filters environment references to ONLY the active zone.
 * @param {Array} allEnvRefs - all available location images
 * @param {Array} activeZoneImages - images from currently selected zone
 * @param {string} activeZoneName - name of currently selected zone
 * @returns {Array} zone-locked images only
 */
export function enforceZoneLock(allEnvRefs, activeZoneImages, activeZoneName) {
  // STRICT: only accept images from active zone
  const validImages = allEnvRefs.filter(img => activeZoneImages.includes(img));
  
  console.log(
    `[sceneImageGenerator] ZONE-LOCK: zone="${activeZoneName}" | total refs=${allEnvRefs.length} | zone-locked=${validImages.length}`
  );

  // If no images in active zone, return empty — NO fallback to other zones
  if (validImages.length === 0) {
    console.warn(
      `[sceneImageGenerator] NO IMAGES IN ZONE "${activeZoneName}" — will generate without reference images`
    );
  }

  return validImages;
}

/**
 * Builds the identity lock enforcement block for image generation.
 * CRITICAL: Uses appearance_lock, NOT avatar appearance.
 * Avatar is identity reference only — appearance_lock defines exact traits.
 * Clothing must NEVER come from avatar/reference images.
 */
export function buildAvatarIdentityBlock(characters) {
  if (!characters || characters.length === 0) return '';
  
  // Build appearance lock block for each character from their appearance_lock fields
  let blocks = '';
  for (const char of characters) {
    blocks += buildAppearanceLockBlock(char);
  }
  
  return blocks;
}

/**
 * Builds an occupation authority block for a single character.
 * Prevents the image model from collapsing a character's occupation into a
 * venue-derived role (e.g. a "Manager" working at a bar → "Bartender" / standing
 * behind the bar counter). Keeps occupation, workplace, workplace type, and
 * current zone as SEPARATE concepts and preserves venue food-service functionality.
 */
function buildSceneOccupationBlock(occupation, locationName) {
  const occ = occupation ? String(occupation).trim() : '';
  if (!occ) return '';
  const occLower = occ.toLowerCase();
  const isManager = /\b(manager|general manager|gm|store manager|assistant manager|shift manager|operations manager|office manager|district manager|regional manager)\b/.test(occLower);

  const lines = [];
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push('OCCUPATION AUTHORITY — ROLE INTEGRITY LAW');
  lines.push('═══════════════════════════════════════════════════════════');
  lines.push(`CHARACTER OCCUPATION: "${occ}"`);
  lines.push(`WORKPLACE: ${locationName || '(unspecified)'}`);
  lines.push('Occupation and workplace are SEPARATE concepts. Do NOT collapse them.');
  lines.push(`⛔ DO NOT change the occupation "${occ}" based on the workplace, workplace type, location name, current zone, or the word "bar".`);
  lines.push('⛔ DO NOT rename the occupation using the workplace (e.g. "Bar Manager", "Restaurant Manager", "Hotel Manager").');
  lines.push('⛔ DO NOT collapse distinct occupations (Manager, Bartender, Waiter, Server, Host, Cook) into one another.');
  lines.push('⛔ A zone named "Bar" is an internal zone of the parent location — it does NOT rename or redirect the parent location and does NOT change the occupation.');
  lines.push('⛔ "Bar" may mean a named venue, a business type, an internal zone, or a physical counter — resolve it from context, never collapse it into one meaning.');
  if (isManager) {
    lines.push(`This character is a "${occ}" — their primary role is overseeing the operation of the business.`);
    lines.push('⛔ DO NOT default to bartending, serving drinks, waiting tables, serving food, or cooking.');
    lines.push('⛔ DO NOT default to standing behind a bar counter simply because the workplace is a bar.');
    lines.push('✅ Depict valid management responsibilities appropriate to the current zone and activity (staff supervision, office/admin work, inventory, deliveries, compliance, oversight, customer issue resolution).');
    lines.push('✅ Bartending/serving/cooking are valid ONLY when the specific current activity explicitly establishes the manager is temporarily performing that duty.');
    lines.push('Preserving the Manager role does NOT suppress venue functionality — bartenders, waiters, servers, cooks, kitchen staff, food ordering, dining, and customers eating remain valid for the venue.');
  }
  lines.push(`GENERATION INVALID IF: the occupation is changed from "${occ}" or the character defaults to a venue-derived role without an explicit current activity.`);
  lines.push('═══════════════════════════════════════════════════════════');
  return lines.join('\n');
}

/**
 * Constructs the full scene image generation prompt with all enforcement rules.
 * CRITICAL: Validates appearance_lock and outfit separation before returning.
 */
export function buildScenePrompt({
  envNote = '',
  locationName = '',
  zoneSuffix = '',
  timeOfDay = 'day',
  atmosphere = '',
  peopleConstraint = '',
  residentialConstraint = '',
  identityLock = '',
  avatarIdentityBlock = '',
  outfitSuffix = '',
  isResidential = false,
  characters = [],
}) {
  // Human presence purity enforcement for scene images
  const expectedCount = characters?.length || 0;
  const humanPurityEnforcement = `
⛔ HUMAN PRESENCE PURITY LAW: Only ${expectedCount} declared subject(s) may appear.
No background extras. No ambient patrons. No silhouettes. No reflections of undeclared people.
No location owners, workers, residents, or family members unless explicitly declared as a subject.
No partial bodies, cropped torsos, or over-the-shoulder framing implying an additional person.
LOCATION OWNER/RESIDENT FIREWALL: This location's associated people are EXCLUDED unless named.
${expectedCount === 0 ? 'ZERO HUMANS. No people of any kind. No bodies. No hands. No silhouettes.' : `EXACTLY ${expectedCount} person(s). No extras. No background occupants.`}
`;

  // {{VISUAL_SOURCE_BOUNDARY_BLOCK}} is replaced at generation time by generateImageAsync
  // after imageVisualSourceValidator runs the pre-generation audit. This ensures the
  // runtime-computed forbidden entity list (conversation context, location owner names,
  // sender identity) is injected into every scene image prompt.
  const basePrompt = `${envNote} Scene: ${locationName}${zoneSuffix}, ${timeOfDay} lighting.${atmosphere} ${peopleConstraint}${residentialConstraint}${humanPurityEnforcement}{{VISUAL_SOURCE_BOUNDARY_BLOCK}}${identityLock}${avatarIdentityBlock}${outfitSuffix} Photorealistic.`;
  
  // CRITICAL: Validate each character's appearance_lock and outfit before returning prompt
  // Only validate characters that have an appearance_lock defined
  for (const char of characters) {
    if (char?.appearance_lock && Object.keys(char.appearance_lock).length > 0) {
      try {
        enforceValidation(char, basePrompt);
      } catch (err) {
        console.error(`[Scene] Validation failed for ${char?.name || 'unknown'}:`, err.message);
        throw err;
      }
    }
  }

  // OCCUPATION AUTHORITY — prevent venue type from collapsing a character's occupation
  for (const char of characters) {
    if (char?.occupation) {
      basePrompt += buildSceneOccupationBlock(char.occupation, locationName);
    }
  }

  return basePrompt;
}