/**
 * APPEARANCE LOCK VALIDATOR
 * 
 * Enforces that image generation prompts:
 * 1. Use ONLY appearance_lock for identity (face, hair, skin tone, etc.)
 * 2. Use ONLY closet/current_outfit for clothing
 * 3. Separate identity from outfit completely
 * 4. Validate that prompts contain exact appearance_lock fields before sending
 */

/**
 * Convert height in inches to a head ratio category and fractional value.
 * Default (no height stored) → 7.5 heads, ~5'7.5" average adult.
 */
export function resolveHeightProportions(heightInches) {
  if (!heightInches || heightInches <= 0) {
    return { heightInches: null, headRatio: 7.5, category: 'average', isDefault: true };
  }
  const h = Number(heightInches);
  let headRatio;
  let category;
  if (h < 64) {
    headRatio = 7.0 + ((h - 60) / 4) * 0.25; // scale within short range
    category = 'short';
  } else if (h <= 69) {
    headRatio = 7.25 + ((h - 64) / 5) * 0.5;  // 7.25–7.75
    category = 'average';
  } else if (h <= 74) {
    headRatio = 7.75 + ((h - 70) / 4) * 0.25; // 7.75–8.0
    category = 'tall';
  } else {
    headRatio = 8.0 + ((h - 75) / 4) * 0.5;   // 8.0–8.5+
    category = 'very_tall';
  }
  // Round to 1 decimal
  headRatio = Math.round(headRatio * 10) / 10;
  return { heightInches: h, headRatio, category, isDefault: false };
}

/**
 * Convert total inches to feet+inches string: 68 → "5'8\""
 */
function inchesToFeetStr(totalInches) {
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

/**
 * Build the height proportion enforcement block.
 * Returns empty string when no height is stored (default behavior: use ~7.5 heads / average).
 */
export function buildHeightProportionBlock(character) {
  if (!character) return '';
  const lock = character.appearance_lock || {};
  const stored = lock.height_inches;

  const { heightInches, headRatio, category, isDefault } = resolveHeightProportions(stored);

  // Proportion descriptions by category
  const proportionNote = {
    short:     'shorter legs relative to torso, more compact proportions — do NOT stretch the body',
    average:   'standard human proportions — torso and legs balanced naturally',
    tall:      'longer legs relative to torso, slightly elongated proportions — do NOT compress the body',
    very_tall: 'noticeably longer legs, elongated torso, visibly above average in all frame references',
  }[category];

  const heightLabel = isDefault
    ? `~5'7.5" (default average — no height stored)`
    : `${inchesToFeetStr(heightInches)} (${heightInches} inches)`;

  return `\n\n════════════════════════════════════════════════════════════════════════════════
HEIGHT + BODY PROPORTION LOCK (MANDATORY)
════════════════════════════════════════════════════════════════════════════════

Character height: ${heightLabel}
Head unit ratio: ~${headRatio} heads tall
Proportion class: ${category}

BODY STRUCTURE RULES:
✓ Build body using head-unit ratio — head = 1 unit, torso ≈ 2.5–3 units, legs ≈ 3.5–4 units
✓ ${proportionNote}
✓ All anatomy must remain believable — do NOT stretch or compress the body uniformly
✓ This height must remain CONSISTENT across all images — do NOT drift or randomize

ENVIRONMENT ALIGNMENT (when character is standing and anchors are visible):
${category === 'short'    ? '✓ Standard countertop (~36") rises ABOVE waist | doorknob (~36") rises toward upper abdomen' : ''}
${category === 'average'  ? '✓ Standard countertop (~36") ≈ waist level | doorknob (~36") ≈ belly button' : ''}
${category === 'tall'     ? '✓ Standard countertop (~36") falls BELOW waist | doorknob (~36") falls below belly button' : ''}
${category === 'very_tall'? '✓ Standard countertop (~36") well below waist | doorknob noticeably below belly button' : ''}
✓ Standard door ≈ 80 inches — use for full-height validation when visible

CONTEXT RULES:
✓ Apply full height + anchor enforcement ONLY when character is standing and anchors or other characters are present
✓ For seated, lying, close-up, or portrait scenes: maintain correct body proportions internally — do NOT force standing
✓ Do NOT convert seated scenes to standing to prove height
✓ Do NOT insert objects for scale unless they are naturally part of the scene
✓ Do NOT use camera tricks or depth positioning to fake height — height comes from body scale only
✓ Multi-character scenes: ALL characters must share the same ground plane
════════════════════════════════════════════════════════════════════════════════`;
}

/**
 * Build the appearance lock block from character data
 * STRICT: Must include exact fields from appearance_lock
 * 
 * @param {object} character - Full character record
 * @returns {string} Appearance lock block for prompt injection
 */
export function buildAppearanceLockBlock(character) {
  if (!character) return '';
  
  const lock = character.appearance_lock || {};
  
  // CRITICAL: These fields MUST be present and EXACT
  const requiredFields = {
    skin_tone: lock.skin_tone,
    hair_type: lock.hair_type,
    hairstyle: lock.hairstyle,
    facial_hair: lock.facial_hair,
  };
  
  // Check: at least 3 of 4 core fields must exist
  const filledFields = Object.values(requiredFields).filter(Boolean).length;
  if (filledFields < 3) {
    console.warn(`[appearanceLock] Character ${character.id} missing core appearance_lock fields (${filledFields}/4)`);
  }
  
  const appearanceAge = lock.appearance_age ? ` appearance age ${lock.appearance_age}` : '';
  const customKeywords = lock.custom_keywords?.length > 0 ? ` ${lock.custom_keywords.join(', ')}` : '';
  
  // Gender is a top-level identity field (character.gender / user settings user_gender).
  // It is IDENTITY, not flavor — it must not change between generations and must never
  // be overridden by the prompt, the avatar, or the outfit layer.
  const genderValue = character.gender || character.appearance_lock?.gender || null;

  // Build exact appearance string using literal field values
  const parts = [
    genderValue ? `gender: ${genderValue}` : null,
    requiredFields.skin_tone ? `skin tone: ${requiredFields.skin_tone}` : null,
    requiredFields.hair_type ? `hair type: ${requiredFields.hair_type}` : null,
    requiredFields.hairstyle ? `hairstyle: ${requiredFields.hairstyle}` : null,
    requiredFields.facial_hair ? `facial hair: ${requiredFields.facial_hair}` : null,
    appearanceAge,
    customKeywords,
  ].filter(Boolean);
  
  if (parts.length === 0 && !lock.height_inches) return '';
  
  const identityBlock = parts.length > 0 ? `\n\n════════════════════════════════════════════════════════════════════════════════
APPEARANCE LOCK — CHARACTER IDENTITY (MANDATORY)
════════════════════════════════════════════════════════════════════════════════

This character has a locked visual identity. Use ONLY these exact descriptors:

${parts.join('\n')}

CRITICAL RULES:
✓ Must match these characteristics EXACTLY
✓ Do NOT infer appearance from name, personality, or narrative
✓ Do NOT substitute or approximate these features
✓ Do NOT let avatar image override these locked fields
✓ Identity is SEPARATE from clothing — clothing comes from outfit data only

This is the character's immutable visual identity. Every image must match.
════════════════════════════════════════════════════════════════════════════════` : '';

  const heightBlock = buildHeightProportionBlock(character);

  return identityBlock + heightBlock;
}

/**
 * Build outfit lock block from character's current_outfit
 * STRICT: Must use ONLY closet/outfit data, never avatar clothing
 * 
 * @param {object} outfit - Current outfit object from closet
 * @param {string} characterName - Character name for context
 * @returns {string} Outfit lock block for prompt injection
 */
export function buildOutfitLockBlock(outfit, characterName = 'character') {
  if (!outfit) return '';
  
  const outfitDesc = outfit.full_description || 
    [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
      .filter(Boolean)
      .join(', ');
  
  if (!outfitDesc) return '';
  
  return `\n\n════════════════════════════════════════════════════════════════════════════════
OUTFIT LOCK — CLOTHING ONLY (MANDATORY)
════════════════════════════════════════════════════════════════════════════════

${characterName} must wear EXACTLY:

${outfitDesc}

CRITICAL RULES:
✓ Every piece listed MUST appear in the image
✓ Do NOT invent or substitute clothing items
✓ Do NOT use clothing from avatar/reference images
✓ Do NOT substitute similar styles
✓ Clothing is SEPARATE from identity — identity comes from appearance_lock only

This is the outfit data. It is the ONLY source of truth for what this character is wearing.
════════════════════════════════════════════════════════════════════════════════`;
}

/**
 * Validate that a prompt contains appearance_lock fields
 * Returns { valid, errors }
 * 
 * @param {object} character - Character with appearance_lock
 * @param {string} prompt - The generated prompt
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateAppearanceLockInPrompt(character, prompt) {
  if (!character || !prompt) {
    return { valid: false, errors: ['Missing character or prompt'] };
  }
  
  const lock = character.appearance_lock || {};
  const errors = [];
  
  // CHECK 1: Does prompt contain skin_tone?
  if (lock.skin_tone && !prompt.includes(lock.skin_tone)) {
    errors.push(`Missing skin tone "${lock.skin_tone}" in prompt`);
  }
  
  // CHECK 2: Does prompt contain hair_type?
  if (lock.hair_type && !prompt.includes(lock.hair_type)) {
    errors.push(`Missing hair type "${lock.hair_type}" in prompt`);
  }
  
  // CHECK 3: Does prompt contain hairstyle?
  if (lock.hairstyle && !prompt.includes(lock.hairstyle)) {
    errors.push(`Missing hairstyle "${lock.hairstyle}" in prompt`);
  }
  
  // CHECK 4: Does prompt contain facial_hair?
  if (lock.facial_hair && !prompt.includes(lock.facial_hair)) {
    errors.push(`Missing facial hair "${lock.facial_hair}" in prompt`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate that a prompt contains outfit fields
 * Returns { valid, errors }
 * 
 * @param {object} outfit - Current outfit object
 * @param {string} prompt - The generated prompt
 * @returns {object} { valid: boolean, errors: string[] }
 */
export function validateOutfitInPrompt(outfit, prompt) {
  if (!outfit || !prompt) {
    return { valid: false, errors: ['Missing outfit or prompt'] };
  }
  
  const errors = [];
  const outfitPieces = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
    .filter(Boolean);
  
  for (const piece of outfitPieces) {
    if (!prompt.includes(piece)) {
      errors.push(`Missing outfit piece "${piece}" in prompt`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Pre-flight validation: Ensure identity and outfit are properly separated
 * Returns { valid, errors, metadata }
 * 
 * @param {object} character - Character with appearance_lock and outfit
 * @param {string} prompt - Generated image prompt
 * @returns {object} Validation result
 */
export function validateIdentityOutfitSeparation(character, prompt) {
  if (!character || !prompt) {
    return { 
      valid: false, 
      errors: ['Missing character or prompt'],
      metadata: {}
    };
  }
  
  const errors = [];
  const warnings = [];
  
  // Validate appearance_lock presence
  const appearanceCheck = validateAppearanceLockInPrompt(character, prompt);
  if (!appearanceCheck.valid) {
    errors.push(...appearanceCheck.errors);
  }
  
  // Validate outfit presence (if outfit exists)
  if (character.current_outfit) {
    const outfitCheck = validateOutfitInPrompt(character.current_outfit, prompt);
    if (!outfitCheck.valid) {
      errors.push(...outfitCheck.errors);
    }
  } else {
    warnings.push('Character has no current_outfit defined');
  }
  
  // Check: Avatar clothing NOT bleeding into prompt
  if (character.avatar_url) {
    const avatarMentioned = prompt.includes('avatar') || prompt.includes('reference image');
    if (avatarMentioned) {
      warnings.push('Prompt references avatar clothing — ensure only identity, not outfit, comes from avatar');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata: {
      hasAppearanceLock: !!character.appearance_lock,
      hasOutfit: !!character.current_outfit,
      appearanceLockFields: Object.keys(character.appearance_lock || {}).length,
    },
  };
}

/**
 * CRITICAL: Block prompt if validation fails
 * Call this before sending ANY image generation request
 * 
 * @param {object} character - Character record
 * @param {string} prompt - Generated prompt
 * @throws Error if validation fails
 */
export function enforceValidation(character, prompt) {
  const validation = validateIdentityOutfitSeparation(character, prompt);
  
  if (!validation.valid) {
    const errorList = validation.errors.join('; ');
    console.error(`[VALIDATION FAILED] ${errorList}`);
    throw new Error(`Image prompt validation failed: ${errorList}`);
  }
  
  if (validation.warnings.length > 0) {
    console.warn(`[VALIDATION WARNING] ${validation.warnings.join('; ')}`);
  }
  
  return validation;
}