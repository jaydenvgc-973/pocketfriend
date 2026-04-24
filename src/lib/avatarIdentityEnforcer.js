/**
 * Avatar Identity Enforcer
 * 
 * Ensures 100% visual consistency between generated images and character avatars.
 * Characters MUST match their stored avatar exactly—no alteration, approximation, or reinterpretation.
 */

/**
 * Builds the master visual reference list for image generation.
 * Avatars are FIRST (identity authority), environment images are SECOND (scene authority).
 */
export function buildVisualReferenceStack(characters, environmentImages = []) {
  // Collect each character's avatar as the PRIMARY visual authority
  const characterAvatars = characters
    .map(c => c.avatar_url || c.image_avatar_url)
    .filter(url => url && url.trim().length > 0);

  // Combine: avatars FIRST, then environment
  return [...characterAvatars, ...environmentImages].filter(Boolean);
}

/**
 * Builds the unbreakable identity enforcement block for the prompt.
 * This is NON-NEGOTIABLE and must be included in every generation request with characters.
 */
export function buildAvatarIdentityEnforcementBlock(characters) {
  if (!characters || characters.length === 0) {
    return '';
  }

  const characterList = characters
    .map(c => c.name)
    .filter(Boolean)
    .join(', ');

  return `\n\n════════════════════════════════════════════════════════════════════════════════
AVATAR IDENTITY LOCK — NON-NEGOTIABLE, 100% ENFORCEMENT
════════════════════════════════════════════════════════════════════════════════

THESE PEOPLE APPEAR IN THIS IMAGE: ${characterList}

For EACH person listed above, the attached reference image (avatar) is the SOLE visual source of truth.

MANDATORY MATCHING RULES (NO EXCEPTIONS):
- Face shape: Match EXACTLY
- Facial structure: Match EXACTLY
- Skin tone: Match EXACTLY
- Hair texture: Match EXACTLY
- Hair length: Match EXACTLY
- Hairstyle: Match EXACTLY
- Hairline: Match EXACTLY
- Body type: Match EXACTLY
- Apparent age: Match EXACTLY
- Gender presentation: Match EXACTLY
- Distinctive features: Match EXACTLY
- Overall visual identity: Match EXACTLY

FORBIDDEN ALTERATIONS (100% ZERO TOLERANCE):
- Do NOT beautify the person
- Do NOT age them up or down
- Do NOT slim or enlarge their body
- Do NOT alter their gender presentation
- Do NOT reinterpret their features
- Do NOT use the name as a style guide (use the avatar image)
- Do NOT invent new facial characteristics
- Do NOT make assumptions based on the person's name

IF YOU CANNOT PRESERVE AVATAR IDENTITY ACCURATELY:
- Do NOT generate that character
- It is BETTER to render fewer people than to render WRONG people
- Wrong face = FAILURE
- Wrong identity = FAILURE

REFERENCE IMAGE AUTHORITY:
The attached avatar images are REFERENCE images.
They define the EXACT visual identity for each character.
Use them as the only source for how each person must look.

SUCCESS = Every person in the image clearly matches their avatar.
FAILURE = Any person whose generated appearance diverges from their avatar.
════════════════════════════════════════════════════════════════════════════════\n`;
}