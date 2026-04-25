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
  if (!userEmail) return { refs: [], missing: true };

  try {
    const settingsList = await base44.entities.UserSettings.filter(
      { created_by: userEmail },
      null,
      1
    ).catch(() => []);

    const sett = settingsList?.[0] || {};
    const refs = [
      ...(sett.reference_image_urls || []),
      ...(sett.generated_avatar_urls || []),
    ].filter(Boolean);

    return { refs, missing: refs.length === 0 };
  } catch {
    return { refs: [], missing: true };
  }
}

/**
 * Resolve character visual reference images from Character record
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
      return { refs: [], missing: true };
    }
  }

  if (!char) return { refs: [], missing: true };

  // Priority: reference_image_urls ONLY (not avatar, to avoid scene contamination)
  // Exclude generated_image.png files (AI outputs, not face photos)
  const allRefs = (char.reference_image_urls || []).filter(
    url => url && typeof url === 'string' && !url.includes('generated_image')
  );

  if (allRefs.length > 0) {
    return { refs: allRefs, missing: false };
  }

  // Fallback: avatar only if no reference images
  if (char.avatar_url) {
    return { refs: [char.avatar_url], missing: false };
  }

  return { refs: [], missing: true };
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
    const { refs: charRefs, missing } = await resolveCharacterVisualRefs(
      base44,
      primaryCharacterId,
      allCharacters
    );
    if (missing) {
      errors.push(`Primary character has no visual reference images. Cannot generate.`);
    } else {
      selectedPeople.character = { id: primaryCharacterId, refs: charRefs };
    }
  }

  // 2. ADDITIONAL SELECTED CHARACTERS (from multi-select)
  if (selectedCharacterIds && selectedCharacterIds.length > 0) {
    for (const charId of selectedCharacterIds) {
      if (charId === primaryCharacterId) continue; // Skip primary (already validated)

      const { refs: charRefs, missing } = await resolveCharacterVisualRefs(
        base44,
        charId,
        allCharacters
      );
      if (missing) {
        const charName = allCharacters?.find(c => c.id === charId)?.name || charId;
        errors.push(`Character "${charName}" has no visual reference images.`);
      } else {
        selectedPeople.others.push({ id: charId, refs: charRefs });
      }
    }
  }

  // 3. USER (if selected in multi-select)
  if (includeUser) {
    const { refs: userRefs, missing } = await resolveUserVisualRefs(base44, userEmail);
    if (missing) {
      errors.push(`User visual reference image is missing.`);
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

  // Primary character
  if (selectedPeople.character) {
    payload.selectedCharacters.push({
      role: 'primary',
      id: selectedPeople.character.id,
      referenceImages: selectedPeople.character.refs,
    });
  }

  // Additional characters
  if (selectedPeople.others && selectedPeople.others.length > 0) {
    selectedPeople.others.forEach((char, idx) => {
      payload.selectedCharacters.push({
        role: `additional_${idx}`,
        id: char.id,
        referenceImages: char.refs,
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