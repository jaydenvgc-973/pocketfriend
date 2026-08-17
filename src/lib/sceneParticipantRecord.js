/**
 * Scene Participant Record
 *
 * Builds ONE authoritative participant record per present person by reading
 * from existing authoritative sources. This is NOT a new role resolver or
 * presence system — it assembles existing authoritative data
 * (resolved_presence_status, isCharacterAtWork, outfit resolver results,
 * avatar/reference imagery) into a single record so identity, role, and
 * outfit remain BOUND TOGETHER for Who's Here classification AND Scene image
 * generation.
 *
 * Role comes from actual state, not from location type:
 *   on-shift employee  → employee
 *   hospitalized       → patient
 *   incarcerated       → inmate
 *   ordinary presence   → visitor
 *   user at medical    → visitor (unless valid patient/check-in state exists)
 */

/**
 * Resolve the authoritative role for a participant from existing state.
 *
 * @param {Object} person - Character or user pseudo-character object
 * @param {Object} context - { isOnShift, isHomeResident, isCheckedInPatient }
 * @returns {string} - 'employee' | 'patient' | 'inmate' | 'visitor' | 'resident'
 */
export function resolveParticipantRole(person, context = {}) {
  const { isOnShift = false, isHomeResident = false, isCheckedInPatient = false } = context;

  // User role — from existing authoritative user state.
  // Entering a medical facility does NOT create patient status.
  // Entering a jail/prison does NOT create inmate status.
  // The user is never an inmate.
  if (person.isUser) {
    if (isCheckedInPatient) return 'patient';
    return 'visitor';
  }

  // Character role — from authoritative resolved_presence_status + employment state.
  const status = person.resolved_presence_status;
  if (status === 'hospitalized') return 'patient';
  if (['incarcerated', 'confined', 'house_arrest'].includes(status)) return 'inmate';
  if (isOnShift) return 'employee';
  if (isHomeResident) return 'resident';
  return 'visitor';
}

/**
 * Build one authoritative participant record binding identity + role + outfit.
 *
 * @param {Object} person - Character or user pseudo-character object
 * @param {Object} context - { isOnShift, isHomeResident, isCheckedInPatient, outfitText, location }
 * @returns {Object} - Participant record with all fields bound together
 */
export function buildParticipantRecord(person, context = {}) {
  const role = resolveParticipantRole(person, context);
  const avatarUrl =
    person.avatar_url ||
    person.image_avatar_url ||
    person.generated_avatar_urls?.[0] ||
    null;
  const referenceImageUrls = (person.reference_image_urls || []).filter(
    (u) => u && !u.includes('generated_image')
  );

  return {
    ...person,
    id: person.id,
    name: person.name || person.display_name,
    isUser: person.isUser || false,
    avatar_url: avatarUrl,
    reference_image_urls: referenceImageUrls,
    gender: person.gender || person.user_gender || null,
    role,
    outfitText: context.outfitText || null,
    isOnShift: context.isOnShift || false,
    isHospitalized: person.resolved_presence_status === 'hospitalized',
    isIncarcerated: ['incarcerated', 'confined', 'house_arrest'].includes(
      person.resolved_presence_status
    ),
  };
}

/**
 * Build a per-person prompt block that binds identity → role → outfit together.
 * Each person's block is self-contained so the model cannot drift values
 * between participants.
 *
 * @param {Array} participants - Array of participant records from buildParticipantRecord
 * @returns {string} - Prompt block with per-person binding
 */
export function buildParticipantBoundBlock(participants = []) {
  const valid = participants.filter((p) => p && p.name);
  if (valid.length === 0) return '';

  const blocks = valid.map((p, idx) => {
    const lines = [`[${idx + 1}] ${p.name}`];
    if (p.gender) {
      lines.push(`GENDER: ${p.gender.toUpperCase()} — established identity, do NOT infer from name`);
    }
    lines.push(`ROLE: ${p.role}`);
    if (p.outfitText) {
      lines.push(`OUTFIT: ${p.outfitText} (assigned to ${p.name} ONLY — no cross-contamination)`);
    }
    if (p.avatar_url) {
      lines.push(`REFERENCE IMAGE POSITION ${idx + 1}: ${p.avatar_url} (identity for ${p.name})`);
    }
    if (p.isHospitalized) {
      lines.push(`STATE: hospitalized — depict as patient in this facility`);
    }
    if (p.isIncarcerated) {
      lines.push(`STATE: incarcerated — depict as inmate in this facility`);
    }
    if (p.isOnShift) {
      lines.push(`STATE: on-shift employee at this facility`);
    }
    return lines.join('\n');
  });

  return `\n\n═══════════════════════════════════════════════════════════
PARTICIPANT BINDING — identity → role → outfit bound per person
═══════════════════════════════════════════════════════════
Each participant's identity, role, and outfit are bound TOGETHER.
Do NOT swap, blend, or transfer any value between participants.
Reference image positions match the participant numbers below.

${blocks.join('\n\n')}

CRITICAL: Each outfit is assigned to the named person ONLY.
The user wears the user's outfit; each character wears their own outfit.
Do NOT use avatar/reference photo clothing — outfit comes from the OUTFIT field above.
═══════════════════════════════════════════════════════════\n`;
}

/**
 * Build ordered reference images matching participant order.
 * Avatar of participant 1 is first, participant 2 is second, etc.
 * Environment images follow, excluded if they duplicate an avatar URL.
 *
 * @param {Array} participants - Array of participant records
 * @param {Array} envImages - Environment/location reference images
 * @returns {Array} - Ordered reference image URLs
 */
export function buildOrderedReferenceImages(participants = [], envImages = []) {
  const avatarUrls = participants
    .map((p) => p.avatar_url)
    .filter((url) => url && url.trim().length > 0);

  return [...avatarUrls, ...envImages.filter((u) => !avatarUrls.includes(u))];
}