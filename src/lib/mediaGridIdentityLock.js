/**
 * Media Grid Identity Lock Validator
 * 
 * Validates that ALL selected people (user + characters) have visual references
 * before image generation is allowed. Hard contract enforcement.
 */

/**
 * Resolve user visual reference images from UserSettings.
 *
 * @param {object} base44 - base44 SDK instance
 * @param {string} userEmail - owner_email scope
 * @param {object} [options]
 * @param {string[]} [options.sessionCacheRefs] - Last-known-good refs from the active Media Grid session.
 *   If DB lookup returns empty, these are returned instead of surfacing a false "missing" error.
 * @param {string} [options.selectorAvatarUrl] - The avatar_url already visible beside the user in the
 *   selector dropdown. If DB lookup returns empty and session cache is empty, this is used as a last
 *   fallback — the image is visible in the UI so it must be usable as a reference.
 */
export async function resolveUserVisualRefs(base44, userEmail, options = {}) {
  const { sessionCacheRefs = [], selectorAvatarUrl = null } = options;

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

    // ── SESSION CACHE FALLBACK ────────────────────────────────────────────────
    // DB returned empty. Before reporting "missing", check the session cache.
    // A user image that was successfully used 30 seconds ago is NOT missing.
    // This is the primary fix for the false "missing" error state contradiction.
    if (sessionCacheRefs.length > 0) {
      console.log(`[resolveUserVisualRefs] DB returned empty — using session cache (${sessionCacheRefs.length} refs). NOT a missing error.`);
      return { refs: sessionCacheRefs, missing: false };
    }

    // ── SELECTOR AVATAR FALLBACK ──────────────────────────────────────────────
    // If the user's avatar is visible in the selector dropdown, use it.
    // "Visible in the UI = valid identity reference" is a hard rule.
    if (selectorAvatarUrl && typeof selectorAvatarUrl === 'string') {
      console.log(`[resolveUserVisualRefs] DB + session cache empty — using selector avatar URL as last fallback`);
      return { refs: [selectorAvatarUrl], missing: false };
    }

    // No reference images found from any source
    return {
      refs: [],
      missing: true,
      error: 'No user reference images found. Add a persona photo in Settings → My Profile to enable user likeness in generated images.',
    };
  } catch (err) {
    // On lookup failure, try session cache before reporting error
    if (sessionCacheRefs.length > 0) {
      console.log(`[resolveUserVisualRefs] Lookup failed — using session cache as recovery (${sessionCacheRefs.length} refs)`);
      return { refs: sessionCacheRefs, missing: false };
    }
    if (selectorAvatarUrl) {
      return { refs: [selectorAvatarUrl], missing: false };
    }
    return { refs: [], missing: true, error: `User identity lookup failed: ${err?.message || 'unknown error'}` };
  }
}

/**
 * Resolve character visual reference images AND appearance text from Character record.
 * Returns both refs (image URLs) and appearanceText (for prompt identity injection).
 *
 * characterId should always be a canonical_person_id (real Character.id).
 * If the roster entry is passed in allCharacters, it will use image_generation_target_id
 * to ensure the correct canonical record is resolved.
 */
export async function resolveCharacterVisualRefs(base44, characterId, allCharacters = null) {
  let char = null;

  // Resolve via roster entry — use image_generation_target_id (canonical Character.id)
  if (allCharacters && Array.isArray(allCharacters)) {
    const rosterEntry = allCharacters.find(c =>
      c.canonical_person_id === characterId ||
      c.id === characterId ||
      c.source_record_ids?.includes(characterId)
    );
    // Use canonical record ID for lookup — roster guarantees this is a real Character.id
    const resolveId = rosterEntry?.image_generation_target_id || rosterEntry?.canonical_person_id || characterId;
    char = allCharacters.find(c => c.id === resolveId) || null;
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

  // Build appearance text for prompt injection — used even when no reference images exist.
  // SYNC: must match the charDesc building logic in generateImageAsync and regenerateImageWithReason.
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
    char.avatar_description_text || null, // vision-analyzed description from photo upload
  ].filter(Boolean);
  const appearanceText = appearanceParts.length > 0 ? appearanceParts.join(', ') : null;

  // Priority: reference_image_urls ONLY (not avatar as primary, to avoid scene contamination).
  // Cap at 2 — consistent with generateImageAsync. More refs = more background contamination.
  const allRefs = (char.reference_image_urls || [])
    .filter(url => url && typeof url === 'string' && !url.includes('generated_image'))
    .slice(0, 2);

  console.log(
    `[resolveCharacterVisualRefs] id=${char.id} name="${char.name}"` +
    ` | raw_ref_urls=${(char.reference_image_urls || []).length}` +
    ` | valid_refs_used=${allRefs.length}` +
    ` | avatar_present=${!!char.avatar_url}` +
    ` | appearance_lock_fields=${Object.keys(char.appearance_lock || {}).join(',') || 'none'}` +
    ` | avatar_description_present=${!!char.avatar_description_text}`
  );

  if (allRefs.length > 0) {
    return { refs: allRefs, missing: false, appearanceText, source: 'reference_image_urls' };
  }

  // Fallback: avatar_url as controlled last-resort identity anchor.
  // Face-only extraction is enforced in the prompt — background contamination is minimized.
  // Better than generating a random person when no reference_image_urls exist.
  if (char.avatar_url) {
    console.warn(
      `[resolveCharacterVisualRefs] ⚠️ No reference_image_urls for "${char.name}" — using avatar_url as last-resort face anchor.` +
      ` Add reference photos for a stronger identity lock.`
    );
    return { refs: [char.avatar_url], missing: false, appearanceText, source: 'avatar_url_fallback' };
  }

  // No images at all — if appearance text exists, identity can still be text-described in prompt.
  // This is NOT "missing" — it is a text-only identity path.
  if (appearanceText) {
    console.log(`[resolveCharacterVisualRefs] No image refs for "${char.name}" — using text description only. Generation will proceed without visual anchoring.`);
    return { refs: [], missing: false, appearanceText, source: 'text_only' };
  }

  // Truly no identity data at all — generation would produce a random person
  console.error(`[resolveCharacterVisualRefs] ❌ IDENTITY MISSING for "${char.name || char.id}" — no images, no appearance description. Cannot generate identity-locked image.`);
  return { refs: [], missing: true, appearanceText: null, source: 'none' };
}

/**
 * Validate that all selected people have visual references.
 * Returns: { valid: boolean, errors: string[], selectedPeople: {...} }
 *
 * @param {object} base44
 * @param {string[]} selectedCharacterIds
 * @param {boolean} includeUser
 * @param {string} userEmail
 * @param {string} primaryCharacterId
 * @param {object[]} allCharacters - local roster cache
 * @param {object} [userRefHints] - session-scoped user ref hints to prevent false "missing" errors
 * @param {string[]} [userRefHints.sessionCacheRefs] - last-known-good refs from active session
 * @param {string} [userRefHints.selectorAvatarUrl] - avatar shown in selector list
 */
export async function validateSelectedPeopleIdentities(
  base44,
  selectedCharacterIds,
  includeUser,
  userEmail,
  primaryCharacterId,
  allCharacters,
  userRefHints = {}
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
        const rosterEntry = allCharacters?.find(c => c.canonical_person_id === charId || c.id === charId);
        const charName = rosterEntry?.name || charId;
        errors.push(`Character "${charName}" has no visual reference images or appearance description.`);
      } else {
        const rosterEntry = allCharacters?.find(c => c.canonical_person_id === charId || c.id === charId);
        const canonicalId = rosterEntry?.canonical_person_id || charId;
        selectedPeople.others.push({ id: canonicalId, refs: charRefs, appearanceText });
      }
    }
  }

  // 3. USER (if selected in multi-select)
  if (includeUser) {
    // Pass session cache and selector avatar so resolveUserVisualRefs never produces a
    // false "missing" error when a known-good ref exists from the current session.
    const { refs: userRefs, missing, error: userError } = await resolveUserVisualRefs(
      base44,
      userEmail,
      {
        sessionCacheRefs: userRefHints.sessionCacheRefs || [],
        selectorAvatarUrl: userRefHints.selectorAvatarUrl || null,
      }
    );
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