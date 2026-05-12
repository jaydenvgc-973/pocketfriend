/**
 * Media Grid Identity Lock Validator
 * 
 * Validates that ALL selected people (user + characters) have visual references
 * before image generation is allowed. Hard contract enforcement.
 */

/**
 * Resolve user visual reference images from UserSettings
 */
export async function resolveUserVisualRefs(base44, userEmail) {
  if (!userEmail) return { refs: [], missing: true, error: 'User email not available — cannot resolve user identity.' };

  try {
    // OWNERSHIP: use owner_email — created_by is permanently forbidden
    const settingsList = await base44.entities.UserSettings.filter(
      { owner_email: userEmail },
      null,
      1
    ).catch(() => []);

    const sett = settingsList?.[0] || {};

    // Priority order for user identity references:
    // 1. reference_image_urls (real uploaded face photos — best identity lock)
    // 2. generated_avatar_urls (AI-generated avatars — weaker but valid)
    // 3. world-self Character avatar_url (fallback when UserSettings arrays are empty)
    // Note: We do NOT use appearance_lock fields here — those are text descriptions,
    // not image URLs. They are injected into the prompt text by the caller if needed.
    const refs = [
      ...(sett.reference_image_urls || []),
      ...(sett.generated_avatar_urls || []),
    ].filter(Boolean);

    // If UserSettings arrays are empty, fetch world-self Character record and check avatar_url
    if (refs.length === 0) {
      try {
        const userCharList = await base44.entities.Character.filter(
          { owner_email: userEmail, is_user: true },
          null,
          1
        ).catch(() => []);
        const userChar = userCharList?.[0];
        if (userChar?.avatar_url && typeof userChar.avatar_url === 'string') {
          refs.push(userChar.avatar_url);
          console.log(`[resolveUserVisualRefs] Fallback: world-self Character avatar_url found`);
        }
      } catch (charErr) {
        console.warn(`[resolveUserVisualRefs] World-self Character lookup failed: ${charErr?.message}`);
      }
    }

    if (refs.length > 0) {
      return { refs, missing: false };
    }

    // No reference images found in any source — return missing with a diagnostic message
    return {
      refs: [],
      missing: true,
      error: 'No user reference images found. Add a persona photo in Settings → My Profile to enable user likeness in generated images.',
    };
  } catch (err) {
    return { refs: [], missing: true, error: `User identity lookup failed: ${err?.message || 'unknown error'}` };
  }
}

/**
 * Resolve character visual reference images AND appearance text from Character record.
 * Returns both refs (image URLs) and appearanceText (for prompt identity injection).
 */
export async function resolveCharacterVisualRefs(base44, characterId, allCharacters = null) {
  let char = null;

  // Try from local cache first
  if (allCharacters && Array.isArray(allCharacters)) {
    char = allCharacters.find(c => c.id === characterId);
  }

  // Fallback to DB
  if (!char) {
    try {
      const list = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      char = list?.[0] || null;
    } catch {
      return { refs: [], missing: true, appearanceText: null };
    }
  }

  if (!char) return { refs: [], missing: true, appearanceText: null };

  // Build appearance text for prompt injection — used even when no reference images exist
  const lock = char.appearance_lock || {};
  const appearanceParts = [
    char.age_range ? `${char.age_range} years old` : null,
    char.gender || null,
    (char.ethnicities || []).length > 0 ? char.ethnicities.join('/') + ' ethnicity' : null,
    lock.skin_tone ? `${lock.skin_tone} skin tone` : null,
    lock.hairstyle ? `${lock.hairstyle} hairstyle` : null,
    lock.hair_type ? `${lock.hair_type} hair` : null,
    lock.facial_hair || null,
    char.appearance_notes || null,
    char.avatar_description_text || null,
  ].filter(Boolean);
  const appearanceText = appearanceParts.length > 0 ? appearanceParts.join(', ') : null;

  // Priority: reference_image_urls ONLY (not avatar as primary, to avoid scene contamination)
  const allRefs = (char.reference_image_urls || []).filter(
    url => url && typeof url === 'string' && !url.includes('generated_image')
  );

  if (allRefs.length > 0) {
    return { refs: allRefs, missing: false, appearanceText };
  }

  // Fallback: avatar only if no reference images — still valid, just weaker identity lock
  if (char.avatar_url) {
    return { refs: [char.avatar_url], missing: false, appearanceText };
  }

  // No images at all — but if we have appearance text, identity can still be described in prompt
  if (appearanceText) {
    return { refs: [], missing: false, appearanceText };
  }

  return { refs: [], missing: true, appearanceText: null };
}

/**
 * Validate that all selected people have visual references.
 * Returns: { valid: boolean, errors: string[], selectedPeople: {...} }
 */
export async function validateSelectedPeopleIdentities(
  base44,
  selectedCharacterIds,
  includeUser,
  userEmail,
  primaryCharacterId,
  allCharacters
) {
  const errors = [];
  const selectedPeople = {
    character: null,      // primary character (always required)
    others: [],           // additional selected characters
    user: null,           // user (if included)
  };

  // 1. PRIMARY CHARACTER (always required in chat)
  if (primaryCharacterId) {
    const { refs: charRefs, missing, appearanceText } = await resolveCharacterVisualRefs(
      base44,
      primaryCharacterId,
      allCharacters
    );
    if (missing) {
      errors.push(`Primary character has no visual reference images or appearance data. Cannot generate.`);
    } else {
      selectedPeople.character = { id: primaryCharacterId, refs: charRefs, appearanceText };
    }
  }

  // 2. ADDITIONAL SELECTED CHARACTERS (from multi-select)
  if (selectedCharacterIds && selectedCharacterIds.length > 0) {
    for (const charId of selectedCharacterIds) {
      if (charId === primaryCharacterId) continue;

      const { refs: charRefs, missing, appearanceText } = await resolveCharacterVisualRefs(
        base44,
        charId,
        allCharacters
      );
      if (missing) {
        const charName = allCharacters?.find(c => c.id === charId)?.name || charId;
        errors.push(`Character "${charName}" has no visual reference images or appearance description.`);
      } else {
        selectedPeople.others.push({ id: charId, refs: charRefs, appearanceText });
      }
    }
  }

  // 3. USER (if selected in multi-select)
  if (includeUser) {
    const { refs: userRefs, missing, error: userError } = await resolveUserVisualRefs(base44, userEmail);
    if (missing) {
      // Surface the specific diagnostic message from resolveUserVisualRefs
      errors.push(userError || 'User visual reference image is missing. Add a persona photo in Settings to enable user likeness.');
    } else {
      selectedPeople.user = { refs: userRefs };
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    selectedPeople: errors.length === 0 ? selectedPeople : null,
  };
}

/**
 * Build multi-person image generation payload with hard identity lock.
 * Enforces that selected people ARE the visual contract.
 */
export function buildMultiPersonPayload(selectedPeople, prompt, locationId, zoneName) {
  const payload = {
    prompt,
    subjectType: 'multi',
    selectedCharacters: [],
    includeUser: false,
    locationId: locationId || null,
    zoneName: zoneName || null,
  };

  // Primary character — include appearance text for prompt identity injection
  if (selectedPeople.character) {
    payload.selectedCharacters.push({
      role: 'primary',
      id: selectedPeople.character.id,
      referenceImages: selectedPeople.character.refs,
      appearanceText: selectedPeople.character.appearanceText || null,
    });
  }

  // Additional characters — include per-character appearance text for each subject slot
  if (selectedPeople.others && selectedPeople.others.length > 0) {
    selectedPeople.others.forEach((char, idx) => {
      payload.selectedCharacters.push({
        role: `additional_${idx}`,
        id: char.id,
        referenceImages: char.refs,
        appearanceText: char.appearanceText || null,
      });
    });
  }

  // User
  if (selectedPeople.user) {
    payload.includeUser = true;
    payload.userReferenceImages = selectedPeople.user.refs;
  }

  return payload;
}