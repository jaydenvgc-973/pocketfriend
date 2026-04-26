/**
 * Scene Photo Identity Lock — Strict Reference Enforcement
 * 
 * Ensures avatar images are treated as HARD identity references.
 * Each person in the photo must be instantly recognizable as their exact avatar.
 */

import { resolveCurrentOutfit, buildOutfitPromptText } from './outfitRotationEngine.js';

/**
 * Build outfit enforcement text for a list of characters and optionally the user.
 */
function buildPhotoOutfitBlock(selectedChars, user = null, locationCategory = null) {
  const lines = [];
  for (const c of selectedChars) {
    const outfit = resolveCurrentOutfit(c, '', locationCategory);
    const text = buildOutfitPromptText(outfit);
    if (text) lines.push(`${c.name}: wearing ${text}`);
  }
  if (user) {
    const userOutfit = user.current_outfit || user.selected_outfit || null;
    if (userOutfit) {
      const text = buildOutfitPromptText(userOutfit);
      const name = user.fictional_world_name || user.full_name || 'User';
      if (text) lines.push(`${name}: wearing ${text}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\nOUTFIT LOCK — MANDATORY:\nEach person MUST appear in exactly the outfit listed. Do NOT invent or substitute clothing.\n${lines.join('\n')}`;
}

export function buildPhotoIdentityLockPrompt(selectedChars, displayName) {
  const charList = selectedChars.map((c, idx) => {
    const ageInfo = c.age ? ` (age ${c.age})` : '';
    return `${idx + 1}. ${c.name}${ageInfo}`;
  }).join('\n');

  return `════════════════════════════════════════════════════════════════
IDENTITY LOCK — REFERENCE IMAGE ENFORCEMENT (100% STRICT)
════════════════════════════════════════════════════════════════

People who MUST appear in this photo (use reference images exactly):

${charList}
${displayName} (the photographer/user)

CRITICAL RULES FOR EACH PERSON:

For each provided avatar reference image:
- Reproduce THE SAME PERSON — do not create a new identity
- Preserve face structure, facial features, and bone structure exactly
- Match skin tone precisely
- Match hair texture, length, style, and color exactly
- Match body type, build, and proportions exactly
- ${selectedChars.some(c => c.age) ? 'Preserve exact ages — do NOT age characters up or down' : 'Preserve visible age and development level'}
- Do NOT substitute any face with a different person
- Do NOT blend, merge, or average faces
- Do NOT approximate or reinterpret identity
- Do NOT use generic or random people

VALIDATION:
✓ Success: Each person is instantly recognizable as their avatar
✗ Failure: Any person does not match their reference or appears as a stranger

════════════════════════════════════════════════════════════════`;
}

export function buildPhotoGenerationPrompt(basePrompt, selectedChars, location, displayName, user = null) {
  const identityLock = buildPhotoIdentityLockPrompt(selectedChars, displayName);
  const outfitBlock = buildPhotoOutfitBlock(selectedChars, user, location?.category || null);
  
  const charSummary = selectedChars.length > 0
    ? selectedChars.map(c => `${c.name}${c.age ? ` (${c.age})` : ''}`).join(', ')
    : '';

  const allNames = displayName + (charSummary ? `, ${charSummary}` : '');

  return `${basePrompt}

Location: ${location.name}
People in the photo: ${allNames}

${identityLock}${outfitBlock}

Additional context: Photorealistic, candid, authentic moment. Include ALL listed people in the photo.`;
}

export function extractPhotoAvatarUrls(selectedChars, userAvatar) {
  // Build reference stack: user first, then characters in order
  const avatarStack = [];
  
  if (userAvatar) {
    avatarStack.push(userAvatar);
  }
  
  selectedChars.forEach(c => {
    if (c.avatar_url) {
      avatarStack.push(c.avatar_url);
    }
  });
  
  return avatarStack;
}

export function validatePhotoGenerationInput(selectedChars, generatedImage) {
  // Check that all selected characters have avatars
  const missingAvatars = selectedChars.filter(c => !c.avatar_url);
  if (missingAvatars.length > 0) {
    console.warn(
      '[Photo] Characters without avatars:',
      missingAvatars.map(c => c.name).join(', ')
    );
  }

  // If generation happened, validate that we have a result
  if (generatedImage === null) {
    console.error('[Photo] Generation failed — no image returned');
    return {
      valid: false,
      error: 'Image generation failed. Please try again.',
    };
  }

  return { valid: true };
}

export function logPhotoGenerationState(participants, selectedChars, userAvatar) {
  console.log(
    '[Photo generation state]:',
    `participants selected: ${participants.length} |`,
    `characters resolved: ${selectedChars.length} |`,
    `user avatar present: ${!!userAvatar} |`,
    `people: ${selectedChars.map(c => `${c.name}(age:${c.age || '?'},avatar:${!!c.avatar_url})`).join(', ')}`
  );
}