/**
 * Jail/Prison Uniform Resolution Engine
 *
 * Maps character role to uniform category based on job title matching.
 * Applies uniform context to image generation only when:
 * 1. Character is actively confined at this facility (is_jailed + facility match)
 * 2. Character is assigned staff with a matching role
 *
 * Visitors (travelers, scene guests, non-staff) are NOT forced into uniforms.
 */

// Job title → Uniform category mapping
const JOB_TO_UNIFORM_CATEGORY = {
  // Correctional Officer / Guard
  correctional_officer: 'correctional_officer',
  guard: 'correctional_officer',
  'senior correctional officer': 'correctional_officer',
  'co': 'correctional_officer',
  'intake officer': 'correctional_officer',
  'booking officer': 'correctional_officer',
  'transport officer': 'correctional_officer',

  // Warden / Administration
  warden: 'warden',
  'deputy warden': 'warden',
  administrator: 'warden',
  'assistant warden': 'warden',
  captain: 'correctional_officer', // supervisory role
  lieutenant: 'correctional_officer',
  sergeant: 'correctional_officer',

  // Medical Staff
  doctor: 'medical',
  physician: 'medical',
  'physician assistant': 'medical',
  'pa': 'medical',
  nurse: 'medical',
  'nurse practitioner': 'medical',
  'medical assistant': 'medical',
  medic: 'medical',
  'health clinician': 'medical',
  clinician: 'medical',

  // Maintenance / Kitchen / Support Staff
  'kitchen staff': 'support',
  'food service': 'support',
  cook: 'support',
  janitor: 'support',
  custodian: 'support',
  maintenance: 'support',
  'maintenance staff': 'support',
  'maintenance worker': 'support',
  housekeeper: 'support',
  laundry: 'support',
  'support staff': 'support',

  // Chaplain / Counselor (not uniform category — civilian role)
  chaplain: null,
  counselor: null,
  'case manager': null,
  'mental health clinician': null,

  // Records / Admin (civilian)
  'records clerk': null,
  clerk: null,
  receptionist: null,
  'administrative staff': null,
};

/**
 * Resolve the uniform category for a character at a given facility.
 *
 * @param {object} character - Character record
 * @param {object} location - LocationReference record (jail/prison)
 * @returns {string|null} Uniform category key or null if no uniform applies
 */
export function resolveCharacterUniformCategory(character, location) {
  if (!character || location?.category !== 'jail_prison') {
    return null;
  }

  // RULE 1: If character is actively confined at this facility → inmate uniform
  if (character.is_jailed && character.incarceration_facility_id === location.id) {
    return 'inmate';
  }

  // RULE 2: If character is assigned staff at this facility → staff uniform by job title
  const jobTitle = location.worker_job_titles?.[character.id];
  if (jobTitle) {
    const jobLower = jobTitle.toLowerCase().trim();
    // Exact match first
    if (JOB_TO_UNIFORM_CATEGORY.hasOwnProperty(jobLower)) {
      return JOB_TO_UNIFORM_CATEGORY[jobLower];
    }
    // Fuzzy match: check if any key is contained in the job title
    for (const [key, category] of Object.entries(JOB_TO_UNIFORM_CATEGORY)) {
      if (jobLower.includes(key) && category) {
        return category;
      }
    }
  }

  // RULE 3: Otherwise, visitor or civilian → no uniform
  return null;
}

/**
 * Build uniform context for image generation.
 *
 * Returns the uniform description to inject into the image prompt,
 * or null if no uniform applies (visitor/civilian).
 *
 * @param {object} character - Character record
 * @param {object} location - LocationReference record
 * @returns {object|null} { uniformCategory, description, color, imageUrl, notes } or null
 */
export function resolveUniformContext(character, location) {
  const uniformCategory = resolveCharacterUniformCategory(character, location);

  if (!uniformCategory || !location?.correctional_attire?.by_role?.[uniformCategory]) {
    return null;
  }

  const uniform = location.correctional_attire.by_role[uniformCategory];

  return {
    uniformCategory,
    description: uniform.description || null,
    color: uniform.color || null,
    imageUrl: uniform.image_url || null,
    notes: uniform.notes || null,
  };
}

/**
 * Build outfit description for a character at a jail/prison location.
 *
 * Applies uniform context only when appropriate (confined inmate or assigned staff).
 * Visitors keep their normal clothing.
 *
 * @param {object} character - Character record
 * @param {object} location - LocationReference record
 * @param {object} normalOutfitContext - Result of resolveCharacterOutfit()
 * @returns {object} Enhanced outfit context with uniform applied if needed
 */
export function buildJailUniformOutfitContext(character, location, normalOutfitContext = {}) {
  // Not a jail/prison location → return normal outfit as-is
  if (location?.category !== 'jail_prison') {
    return normalOutfitContext;
  }

  const uniformContext = resolveUniformContext(character, location);

  // No uniform applies (visitor/civilian) → return normal outfit
  if (!uniformContext?.description) {
    return normalOutfitContext;
  }

  // Uniform applies → override outfit description
  return {
    ...normalOutfitContext,
    outfit: null, // Don't use closet outfit
    category: 'uniform', // Special marker
    reason: 'facility_uniform',
    description: uniformContext.description,
    uniformContext, // Pass full uniform data for reference
    source: 'jail_uniform',
  };
}