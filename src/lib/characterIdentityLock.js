/**
 * Character Identity Lock Enforcement
 * 
 * Ensures every character shown in scene images maintains 100% facial consistency
 * with their assigned avatar. Prevents identity drift, face variation, and feature swapping.
 * 
 * CRITICAL: appearance_lock is the identity source of truth.
 * Avatar/reference images are visual references for identity ONLY — never for clothing.
 */

import { buildAppearanceLockBlock } from './appearanceLockValidator.js';

/**
 * Builds identity lock constraint for a single character
 * Forces the image generator to match the avatar face exactly
 */
export function buildCharacterIdentityLock(character) {
  if (!character || !character.id) return '';

  // appearance_lock block is imported at file top
  
  const avatarUrl = character.avatar_url || character.image_avatar_url || null;
  const charName = character.name || 'the character';
  
  // STEP 1: Build appearance_lock block (this is the IDENTITY source of truth)
  const appearanceLockBlock = buildAppearanceLockBlock(character);
  
  // STEP 2: Avatar URL is used as a VISUAL REFERENCE for identity ONLY (not clothing)
  const avatarRef = avatarUrl 
    ? `Reference Image (IDENTITY ONLY — DO NOT copy clothing from this image): ${avatarUrl}`
    : '';

  return `🔒 IDENTITY LOCK: ${charName} (ID: ${character.id})
${avatarRef}
CRITICAL RULE: ${charName}'s face and physical identity MUST match the reference avatar image exactly.
- Same facial structure, bone structure, jawline
- Same skin tone and complexion
- Same eye shape, color, spacing
- Same nose shape and size
- Same lips and mouth
- Overall same person visually — NOT a different variation of the same type
This is NOT a style guide. This IS the exact face. Do NOT interpret loosely.
Allowed: different expression, angle, pose, lighting, outfit
NOT allowed: different face, altered features, identity drift
⚠️ CLOTHING WARNING: DO NOT copy or replicate clothing from the avatar/reference image.
Clothing must come ONLY from the outfit data provided separately. Avatar = identity, not outfit.
${charName} must be instantly recognizable as the same person.${appearanceLockBlock}`;
}

/**
 * Builds identity locks for multiple characters
 * Ensures each character maintains distinct, consistent identity
 */
export function buildMultiCharacterIdentityLocks(characters = []) {
  const validChars = characters.filter(c => c && c.id && c.avatar_url);
  if (validChars.length === 0) return '';

  const locks = validChars.map((char, idx) => {
    const avatarUrl = char.avatar_url || char.image_avatar_url || '';
    return `
[${idx + 1}] ${char.name}
Avatar: ${avatarUrl}
MUST match face exactly — same person every time, no drift`;
  }).join('\n');

  return `

════════════════════════════════════════════════════════════
MULTI-CHARACTER IDENTITY LOCK (STRICT ENFORCEMENT)
════════════════════════════════════════════════════════════
Each character shown MUST match their assigned avatar face exactly:
${locks}

CRITICAL RULES:
• Each person must look like THEMSELVES every time
• Faces must NOT blend or morph into each other
• Identities must remain visually distinct
• No "similar-looking variations" — must be exact match
• Identity drift is NOT allowed
════════════════════════════════════════════════════════════`;
}

/**
 * Builds user identity lock if user appears in the image
 */
export function buildUserIdentityLock(user = null) {
  if (!user || !user.id) return '';

  const userAvatarUrl = user.generated_avatar_urls?.[0] || user.avatar_url || null;
  if (!userAvatarUrl) return '';

  const userName = user.fictional_world_name || user.full_name || 'You';

  return `

🔒 USER IDENTITY LOCK: ${userName}
Avatar: ${userAvatarUrl}
CRITICAL: The user's face MUST match their avatar exactly.
Same person every time. No drift. No variation.
Expression, pose, lighting can change. Face structure cannot.`;
}

/**
 * Builds combined identity lock constraints for scene image generation
 * Combines character + user identity locks into a single strong constraint block
 */
export function buildIdentityLockBlock(characters = [], user = null) {
  const charLocks = buildMultiCharacterIdentityLocks(characters);
  const userLock = buildUserIdentityLock(user);

  if (!charLocks && !userLock) return '';

  return `${charLocks}${userLock}`;
}

/**
 * Wraps avatar reference images to ensure they are used as identity anchors
 * Prioritizes avatar images in the reference list for maximum identity preservation
 */
export function prioritizeAvatarReferences(characters = [], existingRefImages = []) {
  const avatarImages = characters
    .filter(c => c && (c.avatar_url || c.image_avatar_url))
    .map(c => c.avatar_url || c.image_avatar_url)
    .filter(Boolean)
    .slice(0, 3); // Limit to 3 character avatars

  // Combine: avatars first (identity source), then location refs
  return [
    ...avatarImages,
    ...existingRefImages.filter(ref => !avatarImages.includes(ref))
  ];
}

/**
 * Validates identity lock compliance in a prompt
 * Returns warning if identity locks may not be properly enforced
 */
export function validateIdentityLockCompliance(prompt = '') {
  if (!prompt) return { valid: false, warning: 'Empty prompt' };

  const hasIdentityLock = prompt.includes('IDENTITY LOCK') ||
    prompt.includes('face MUST match') ||
    prompt.includes('exact face');

  if (!hasIdentityLock) {
    console.warn(
      '[IDENTITY_LOCK] Warning: Image prompt may lack identity enforcement constraints'
    );
    return { valid: false, warning: 'Missing identity lock constraints' };
  }

  return { valid: true };
}

/**
 * Pre-flight check: ensures all visible characters have avatars for identity locking
 * Returns list of characters that can be identity-locked
 */
export function getIdentityLockableCharacters(characters = []) {
  return characters.filter(c => c && c.id && (c.avatar_url || c.image_avatar_url));
}

/**
 * Describes identity lock requirement for logging/debugging
 */
export function describeIdentityLocks(characters = [], user = null) {
  const lockableChars = getIdentityLockableCharacters(characters);
  const hasUser = user && (user.generated_avatar_urls?.[0] || user.avatar_url);

  return {
    characters_locked: lockableChars.length,
    user_locked: hasUser ? true : false,
    total_identities_locked: lockableChars.length + (hasUser ? 1 : 0),
    character_names: lockableChars.map(c => c.name),
  };
}