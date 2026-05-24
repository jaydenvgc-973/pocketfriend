/**
 * photoSubjectResolver.js
 *
 * Resolves WHO appears in a character-sent photo.
 *
 * CORE RULE:
 *   The SENDER is the character sending the photo.
 *   The SUBJECT is the person/place/thing shown in the photo.
 *   These are SEPARATE and must never be collapsed.
 *
 * photo_subject_type values:
 *   selfie               — sender is the subject (selfie / my outfit / how I look)
 *   known_character      — a saved Character record is the subject
 *   described_third_party — an unnamed/described person not in the Character DB
 *   location             — the subject is a place or scene
 *   object               — the subject is an object or thing
 *   group_photo          — sender + others together
 */

// Patterns that confirm the SENDER is the photo subject (selfie)
const SELFIE_PATTERNS = [
  /\bselfie\b/i,
  /\bme\b.*\b(pic|photo|picture|image|shot)\b/i,
  /\b(pic|photo|picture|shot)\b.*\bof me\b/i,
  /\bmy (outfit|face|look|hair|fit)\b/i,
  /\bpicture of myself\b/i,
  /\bi took this of me\b/i,
  /\bhow i look\b/i,
];

// Patterns that signal the photo is of a THIRD PARTY the sender encountered
const THIRD_PARTY_PATTERNS = [
  /\bi met (someone|a (guy|girl|woman|man|person))\b/i,
  /\bthis is who i met\b/i,
  /\bhere'?s (what|who) (he|she|they) look(s)?\b/i,
  /\blook at this (guy|girl|woman|man|person)\b/i,
  /\bthis (guy|girl|woman|man|person) (from|i saw|at|i met)\b/i,
  /\bmy (coworker|colleague|friend|date|neighbor|client|customer)\b.*\b(pic|photo|picture|shot|image)\b/i,
  /\b(pic|photo|picture|shot|image)\b.*\bmy (coworker|colleague|friend|date|neighbor)\b/i,
  /\bi took a (pic|photo|picture) of (him|her|them)\b/i,
  /\bsomeone i (saw|met|ran into|spotted)\b/i,
  /\b(he|she|they) look(s)?\b.*\blike\b/i,
  /\bthat (guy|girl|woman|man|person)\b/i,
  /\bcheck (him|her|them) out\b/i,
  /\bcheck out (this|the) (guy|girl|woman|man|person)\b/i,
];

// Patterns that signal a group photo including the sender
const GROUP_PHOTO_PATTERNS = [
  /\bus\b.*\b(pic|photo|picture|shot)\b/i,
  /\b(pic|photo|picture|shot)\b.*\bof us\b/i,
  /\btogether\b.*\b(pic|photo|shot)\b/i,
  /\bthe (two|three|four) of us\b/i,
  /\bgroup (pic|photo|shot)\b/i,
  /\bwith (you|everyone|all of us)\b.*\b(pic|photo|shot)\b/i,
];

// Patterns that signal a location/scene is the subject
const LOCATION_PATTERNS = [
  /\bhere at\b/i,
  /\blook where i am\b/i,
  /\bthis (place|spot|view|scene)\b/i,
  /\bview from\b/i,
  /\bcheck out (this|the) (place|view|spot|scenery)\b/i,
  /\boutside\b.*\b(pic|photo|shot)\b/i,
  /\bstreet\b.*\b(shot|photo|pic)\b/i,
];

/**
 * Resolves the photo subject type from:
 *   - The image generation prompt (what the LLM described)
 *   - The original user message (what triggered the photo)
 *
 * Returns:
 * {
 *   photo_subject_type: string,
 *   main_focal_character_id: string|null,
 *   subject_description: string,
 *   use_sender_refs: boolean,   // true ONLY if sender is the actual subject
 *   subject_override_desc: string|null, // use this as charDesc instead of sender's desc
 * }
 */
export function resolvePhotoSubject({
  imageGenPrompt = '',
  userMessage = '',
  senderCharacterId,
  senderCharacterName,
  allCharacters = [],
}) {
  const combinedText = `${userMessage} ${imageGenPrompt}`.toLowerCase();

  // SENDER ANCHOR GUARD — if the sender's own name appears in the combined text, the photo
  // is about them (selfie, self-reference). LLM-generated prompts frequently include the
  // character's name in the scene description (e.g. "Maya sits at her kitchen table").
  // Without this check, a THIRD_PARTY_PATTERN hit on "she looks..." or "he walks..."
  // in an autonomous LLM prompt incorrectly classifies the character's own self-photo as
  // a described_third_party, clearing all identity refs.
  const senderNameLower = (senderCharacterName || '').toLowerCase();
  const senderFirstName = senderNameLower.split(' ')[0];
  const senderNameInPrompt = senderNameLower.length >= 2 && (
    combinedText.includes(senderNameLower) ||
    (senderFirstName.length >= 3 && combinedText.includes(senderFirstName))
  );

  // 1. THIRD PARTY CHECK — highest priority flag
  //    If the prompt says someone else is the subject, sender refs must NOT be used.
  //    EXCEPTION: if the sender's own name is in the prompt, they ARE the subject.
  const isThirdParty = !senderNameInPrompt && THIRD_PARTY_PATTERNS.some(p => p.test(combinedText));
  if (isThirdParty) {
    // Check if the described third party matches a known saved Character
    const knownChar = findKnownCharacterInText(combinedText, allCharacters, senderCharacterId);
    if (knownChar) {
      console.log(`[photoSubjectResolver] Third party matched to saved character: "${knownChar.name}" (${knownChar.id})`);
      return {
        photo_subject_type: 'known_character',
        main_focal_character_id: knownChar.id,
        subject_description: buildCharacterDesc(knownChar),
        use_sender_refs: false,
        subject_override_desc: buildCharacterDesc(knownChar),
      };
    }
    // Described stranger — extract description from prompt
    const subjectDesc = extractThirdPartyDesc(imageGenPrompt);
    console.log(`[photoSubjectResolver] Third party (unknown person): "${subjectDesc}"`);
    return {
      photo_subject_type: 'described_third_party',
      main_focal_character_id: null,
      subject_description: subjectDesc,
      use_sender_refs: false,
      subject_override_desc: subjectDesc || null,
    };
  }

  // 2. GROUP PHOTO CHECK
  const isGroup = GROUP_PHOTO_PATTERNS.some(p => p.test(combinedText));
  if (isGroup) {
    console.log(`[photoSubjectResolver] Group photo — sender + others`);
    return {
      photo_subject_type: 'group_photo',
      main_focal_character_id: senderCharacterId,
      subject_description: imageGenPrompt,
      use_sender_refs: true,
      subject_override_desc: null,
    };
  }

  // 3. LOCATION / SCENE CHECK
  const isLocation = LOCATION_PATTERNS.some(p => p.test(combinedText));
  if (isLocation) {
    console.log(`[photoSubjectResolver] Location/scene photo — sender NOT the focal subject`);
    return {
      photo_subject_type: 'location',
      main_focal_character_id: null,
      subject_description: imageGenPrompt,
      use_sender_refs: false,
      subject_override_desc: null,
    };
  }

  // 4. SELFIE / SENDER IS SUBJECT CHECK
  const isSelfie = SELFIE_PATTERNS.some(p => p.test(combinedText));
  if (isSelfie) {
    console.log(`[photoSubjectResolver] Selfie — sender IS the photo subject`);
    return {
      photo_subject_type: 'selfie',
      main_focal_character_id: senderCharacterId,
      subject_description: imageGenPrompt,
      use_sender_refs: true,
      subject_override_desc: null,
    };
  }

  // 5. CHECK if prompt mentions a known character by name
  //    CRITICAL GUARD: If the sender's own name is already in the prompt (senderNameInPrompt),
  //    do NOT let a name-match against other characters clear the sender's identity refs.
  //    The sender IS the subject — their name being in the prompt confirms this.
  //    Only resolve to a known_character if the match is NOT the sender's own name fragment.
  if (!senderNameInPrompt) {
    const mentionedChar = findKnownCharacterInText(combinedText, allCharacters, senderCharacterId);
    if (mentionedChar) {
      console.log(`[photoSubjectResolver] Known character mentioned in prompt: "${mentionedChar.name}"`);
      return {
        photo_subject_type: 'known_character',
        main_focal_character_id: mentionedChar.id,
        subject_description: buildCharacterDesc(mentionedChar),
        use_sender_refs: false,
        subject_override_desc: buildCharacterDesc(mentionedChar),
      };
    }
  }

  // 6. DEFAULT: sender is the focal subject (standard character photo)
  // This covers: selfies, object photos (work ID, keys, etc.), scene photos where
  // the character's name is in the prompt, and any unclassified case.
  // use_sender_refs=true ensures the character's identity is always in the generation pipeline.
  console.log(`[photoSubjectResolver] Default — sender "${senderCharacterName}" is the photo subject (senderNameInPrompt=${senderNameInPrompt})`);
  return {
    photo_subject_type: 'selfie',
    main_focal_character_id: senderCharacterId,
    subject_description: imageGenPrompt,
    use_sender_refs: true,
    subject_override_desc: null,
  };
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Scan text for mentions of known character names (excluding the sender).
 * Uses exact name match, then first-name match.
 */
function findKnownCharacterInText(text, allCharacters, excludeId) {
  if (!allCharacters?.length) return null;
  const candidates = allCharacters.filter(c => c.id !== excludeId && c.name);

  // Full name exact match first
  for (const c of candidates) {
    if (text.includes(c.name.toLowerCase())) return c;
  }
  // First name match (safer than full fuzzy)
  for (const c of candidates) {
    const firstName = c.name.split(' ')[0].toLowerCase();
    if (firstName.length >= 3 && text.includes(firstName)) return c;
  }
  return null;
}

/**
 * Builds a concise appearance description from a character record.
 */
function buildCharacterDesc(c) {
  if (!c) return '';
  const parts = [
    c.age_range,
    c.gender,
    c.ethnicities?.length > 0 ? c.ethnicities.join('/') + ' ethnicity' : null,
    c.appearance_lock?.skin_tone ? `${c.appearance_lock.skin_tone} skin tone` : null,
    c.appearance_lock?.hairstyle ? `${c.appearance_lock.hairstyle} hairstyle` : null,
    c.appearance_notes || null,
    c.avatar_description_text || null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : c.name;
}

/**
 * Extracts a description of the third party from the image generation prompt.
 * Falls back to the full prompt if no specific description can be extracted.
 */
function extractThirdPartyDesc(prompt) {
  if (!prompt) return 'a person as described in context';
  // Strip routing tags
  const clean = prompt.replace(/^\[(CHARACTER|USER|JOINT)\]\s*/i, '').trim();
  return clean || 'a person as described in context';
}