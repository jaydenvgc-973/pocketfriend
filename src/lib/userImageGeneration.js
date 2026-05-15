/**
 * Unified user identity-preserving image generation logic
 * Used by both Travel/Scene pages and Media Grid
 * Ensures consistent user visual identity across all image generation
 */

import { base44 } from "@/api/base44Client";

/**
 * Build user reference images with strict identity preservation
 * Priority: uploaded reference images > generated avatars > primary avatar
 * @param {Object} userChar - User character/profile entity
 * @returns {Array<string>} Prioritized reference image URLs
 */
export function buildUserReferenceImages(userChar) {
  if (!userChar) return [];
  
  const refs = [];
  
  // 1. HIGHEST PRIORITY: Uploaded reference images (strongest identity lock)
  if (userChar.reference_image_urls?.length > 0) {
    refs.push(...userChar.reference_image_urls.slice(0, 3));
  }
  
  // 2. MEDIUM PRIORITY: Generated avatars
  if (userChar.generated_avatar_urls?.length > 0) {
    refs.push(...userChar.generated_avatar_urls.slice(0, 2));
  }
  
  // 3. LOWEST PRIORITY: Primary avatar as fallback
  if (userChar.avatar_url && !refs.includes(userChar.avatar_url)) {
    refs.push(userChar.avatar_url);
  }
  
  return refs;
}

/**
 * Build appearance data for user identity preservation in prompts.
 * CRITICAL: Reads appearance_lock fields directly. These are the identity source of truth.
 * @param {Object} userChar - User character/profile entity
 * @returns {Object} Appearance data (age, gender, ethnicities, notes, plus appearance_lock)
 */
export function buildUserAppearanceData(userChar) {
  if (!userChar) return null;
  
  const lock = userChar.appearance_lock || {};
  
  return {
    appearance_notes: userChar.appearance_notes || '',
    age_range: userChar.age_range || '',
    gender: userChar.gender || '',
    ethnicities: userChar.ethnicities || [],
    // Appearance lock fields — these MUST be used for identity
    skin_tone: lock.skin_tone || null,
    hair_type: lock.hair_type || null,
    hairstyle: lock.hairstyle || null,
    facial_hair: lock.facial_hair || null,
    appearance_age: lock.appearance_age || null,
    custom_keywords: lock.custom_keywords || [],
  };
}

/**
 * Generate image with strict user identity preservation
 * Reusable by both Travel/Scene pages and Media Grid
 * 
 * @param {string} prompt - The user-facing scene prompt (without system instructions)
 * @param {Array<string>} characterReferenceImages - Reference images for other characters in scene
 * @param {Array<string>} locationImages - Location/zone reference images (optional)
 * @param {Object} currentUser - Current user profile
 * @param {Object} userAppearanceData - User appearance (age, gender, ethnicity)
 * @param {boolean} strictMode - If true, enforce maximum identity preservation (MANDATORY for user)
 * @returns {Promise<string>} Generated image URL
 */
export async function generateImageWithUserIdentity(
  prompt,
  characterReferenceImages = [],
  locationImages = [],
  currentUser,
  userAppearanceData,
  strictMode = true
) {
  if (!prompt || !currentUser) throw new Error("prompt and currentUser required");
  
  // Build user reference images with strict priority
  const userReferences = buildUserReferenceImages(currentUser);
  
  // Combine location + character refs + user refs (user gets 2–3 slots min)
  const locationCount = Math.min(locationImages.length, 2);
  const charCount = Math.min(characterReferenceImages.length, 2);
  const userCount = Math.min(userReferences.length, 3);
  
  const finalRefs = [
    ...locationImages.slice(0, locationCount),
    ...characterReferenceImages.slice(0, charCount),
    ...userReferences.slice(0, userCount),
  ].filter(Boolean);
  
  // Build identity lock note
  const identityLockNote = buildUserIdentityLockNote(userAppearanceData, strictMode);

  // ── CLOSET OUTFIT LOCK — user current_outfit is canonical law ──────────────
  const userOutfit = currentUser.user_current_outfit || currentUser.current_outfit || null;
  const userName = currentUser.fictional_world_name || currentUser.full_name || 'User';
  const outfitLock = buildUserOutfitLockBlock(userOutfit, userName);
  
  // Enhance prompt with identity constraints + outfit lock
  const enhancedPrompt = `${prompt}${identityLockNote}${outfitLock}`;
  
  try {
    const response = await base44.integrations.Core.GenerateImage({
      prompt: enhancedPrompt,
      existing_image_urls: finalRefs.length > 0 ? finalRefs : undefined,
    });
    
    if (!response?.url) throw new Error("No image URL returned");
    return response.url;
  } catch (err) {
    console.error("[User Identity Generation]", err);
    throw err;
  }
}

/**
 * Normalize outfit field — strips N/A, converts bare-torso aliases to canonical string.
 * Identical to generateImageAsync's inline normalizer.
 */
function normalizeOutfitField(val) {
  if (!val) return null;
  const t = val.trim();
  if (/^(n\/?a|none|-)$/i.test(t)) return null;
  const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
  if (/^(shirtless|no top|no shirt)$/i.test(s)) return 'No shirt / bare torso';
  return s || null;
}

/**
 * Build canonical outfit text from a user's current_outfit object.
 * Returns null if no valid outfit fields.
 */
function buildUserOutfitText(outfit) {
  if (!outfit) return null;
  const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .map(normalizeOutfitField)
    .filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (outfit.full_description) return outfit.full_description.trim();
  return null;
}

/**
 * Build the CLOSET OUTFIT LOCK block for a user.
 * Identical structure to generateImageAsync's closet lock.
 */
function buildUserOutfitLockBlock(outfit, userName = 'User') {
  const outfitText = buildUserOutfitText(outfit);
  if (!outfitText) return '';
  const hasBottoms = /sweatpants|pants|jeans|shorts|joggers|leggings|trousers/i.test(outfitText);
  const hasShoes = /sneakers|shoes|boots|sandals|loafers|heels/i.test(outfitText);
  const isBareTorso = /no shirt \/ bare torso/i.test(outfitText);
  const lines = [
    '',
    '🔒 CLOSET OUTFIT LOCK — CANONICAL LAW. OVERRIDES ALL SCENE STYLING.',
    '════════════════════════════════════════════════════════════',
    `${userName} OUTFIT — RENDER EXACTLY:`,
    ...outfitText.split(',').map(s => `  • ${s.trim()}`).filter(Boolean),
    'NON-NEGOTIABLE:',
  ];
  if (isBareTorso) {
    lines.push('⛔ BARE TORSO — NO shirt, tank top, hoodie, jacket, robe, or any upper-body clothing.');
    lines.push('✅ Torso must be completely bare and clearly visible.');
  }
  if (hasBottoms) lines.push('✅ BOTTOMS VISIBLE — frame mid-thigh or lower to show full pants/shorts.');
  if (hasShoes) lines.push('✅ SHOES VISIBLE — full-body or 3/4-body framing required. Do not crop feet.');
  lines.push('⛔ Do NOT add or invent any clothing item not listed above.');
  lines.push('════════════════════════════════════════════════════════════');
  lines.push('FAIL: shirt on bare torso | wrong bottoms | shoes cropped | invented outfit');
  return lines.join('\n');
}

/**
 * Build the identity lock note for strict user preservation.
 * CRITICAL: appearance_lock fields are first in prompt — they are the identity source.
 * @private
 */
function buildUserIdentityLockNote(userAppearanceData, strictMode = false) {
  if (!userAppearanceData) return "";
  
  const parts = [];
  
  // APPEARANCE LOCK FIELDS — These must be FIRST and EXACT
  if (userAppearanceData.skin_tone) parts.push(`Skin tone: ${userAppearanceData.skin_tone}`);
  if (userAppearanceData.hair_type) parts.push(`Hair type: ${userAppearanceData.hair_type}`);
  if (userAppearanceData.hairstyle) parts.push(`Hairstyle: ${userAppearanceData.hairstyle}`);
  if (userAppearanceData.facial_hair) parts.push(`Facial hair: ${userAppearanceData.facial_hair}`);
  if (userAppearanceData.appearance_age) parts.push(`Appearance age: ${userAppearanceData.appearance_age}`);
  if (userAppearanceData.custom_keywords?.length > 0) parts.push(`Additional traits: ${userAppearanceData.custom_keywords.join(', ')}`);
  
  // Supplementary data
  if (userAppearanceData.age_range) parts.push(`Age range: ${userAppearanceData.age_range}`);
  if (userAppearanceData.gender) parts.push(`Gender: ${userAppearanceData.gender}`);
  if (userAppearanceData.ethnicities?.length > 0) parts.push(`Ethnicity: ${userAppearanceData.ethnicities.join(', ')}`);
  if (userAppearanceData.appearance_notes) parts.push(`Additional details: ${userAppearanceData.appearance_notes}`);

  const strictWarning = strictMode ? `
⚠️ STRICT IDENTITY LOCK FOR THIS PERSON ⚠️
Do NOT allow ANY deviation from the provided reference images.
Do NOT beautify, normalize, or substitute this person's appearance.
Do NOT drift into a "generic face" when additional subjects are present.
The reference images are the source of truth. Replicate them with maximum fidelity.
` : '';

  return `
════════════════════════════════════════════════════════════
USER IDENTITY LOCK — STRICT VISUAL CONSISTENCY
════════════════════════════════════════════════════════════
${parts.length > 0 ? parts.join('\n') : 'Use reference images as identity guide'}
${strictWarning}
WHAT IS LOCKED:
✓ Face shape and bone structure
✓ Skin tone and texture
✓ Hair color, texture, length, style
✓ Eyes (color, shape, spacing)
✓ Nose (shape, size, profile)
✓ Mouth and lips
✓ Body build and proportions
✓ Distinctive facial features

PROHIBITED:
✗ Swapping faces or using generic models
✗ Beautifying away unique characteristics
✗ Letting identity drift when other subjects are included
✗ Using a "more model-like" version

This is a specific real person. They must be recognizable and consistent.
════════════════════════════════════════════════════════════`;
}