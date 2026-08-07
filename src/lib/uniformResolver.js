/**
 * UNIFORM RESOLVER — Global Outfit Layer
 *
 * Resolves which uniform (if any) applies to a character in a specific location/role.
 *
 * PRIORITY ORDER (10-step):
 * 1. Explicit user-selected outfit (manual override set today)
 * 2. Manual employee-specific uniform assignment
 * 3. Job-title uniform
 * 4. Zone-specific uniform (more specific than location-wide)
 * 5. Role/status uniform (inmate, officer, student, staff, visitor, etc.)
 * 6. Generic/default staff uniform (for unmatched custom employee titles)
 * 7. Location-wide uniform
 * 8. Scheduled work/school outfit (from context resolver)
 * 9. Current closet/worn outfit
 * 10. Default outfit
 *
 * RULES:
 * - Uniforms are TEMPORARY context outfits, NOT permanent replacements
 * - Uniforms never overwrite closet, worn outfits, or character rotation
 * - Visitors/customers/patrons do NOT wear uniforms (explicit role check)
 * - Only applies if a uniform exists for the resolved applicability type
 */

/**
 * Determine if a character should wear a uniform in this location.
 * Returns the resolved uniform if applicable, null otherwise.
 *
 * @param {Object} character - Full character record
 * @param {Object} location - Location record
 * @param {string} characterRoleAtLocation - Role context: 'employee', 'inmate', 'student', 'staff',
 *                                            'visitor', 'customer', 'patient', 'member', etc.
 * @returns {{
 *   uniform: Object|null,
 *   applicability: string|null,
 *   reason: string|null,
 *   source: string
 * }}
 */
export function resolveUniform(character, location, characterRoleAtLocation) {
  const result = {
    uniform: null,
    applicability: null,
    reason: null,
    source: 'none',
  };

  if (!character || !location) return result;

  const uniforms = location.uniforms || {};
  const workerIds = location.worker_character_ids || [];
  const isWorker = workerIds.includes(character.id);
  const jobTitle = location.worker_job_titles?.[character.id];

  // ── VISITOR ROLE DETECTION ────────────────────────────────────────────────
  // NOTE: 'patient' is NOT a visitor role. An admitted patient is not merely a
  // visitor when the Location defines patient-specific clothing. Patient uniforms
  // are resolved through the normal role/status uniform path.
  const VISITOR_ROLES = new Set([
    'visitor', 'guest', 'customer', 'shopper', 'patron', 'diner',
    'tourist', 'parent', 'member', 'spectator'
  ]);
  const isVisitorRole = VISITOR_ROLES.has(characterRoleAtLocation);
  // Role-specific checks (manual_assignment, job_title, role_status, generic_staff)
  // are skipped for visitors. Non-role-specific checks (zone, location_wide) are
  // still evaluated — a visitor at a Location with a location-wide uniform rule
  // must receive that uniform. Do not let visitor detection defeat location_wide.

  // ── PRIORITY 2: Manual employee-specific uniform assignment ────────────
  if (!isVisitorRole) {
    const manualAssignment = location.worker_manual_uniforms?.[character.id];
    if (manualAssignment && uniforms[manualAssignment]) {
      const uniform = uniforms[manualAssignment];
      return {
        uniform,
        applicability: 'manual_assignment',
        reason: `manual assignment to ${manualAssignment}`,
        source: 'manual_assignment',
      };
    }
  }

  // ── PRIORITY 3: Job-title uniform ────────────────────────────────────
  if (!isVisitorRole && jobTitle && isWorker) {
    const normalizedTitle = jobTitle.toLowerCase().trim();
    for (const [uniformId, uniform] of Object.entries(uniforms)) {
      if (!uniform || uniform.applicability !== 'job_title') continue;
      const configuredTitle = (uniform.job_title || '').toLowerCase().trim();
      if (configuredTitle === normalizedTitle) {
        return {
          uniform,
          applicability: 'job_title',
          reason: `job title: ${jobTitle}`,
          source: 'job_title',
        };
      }
    }
  }

  // ── PRIORITY 4: Zone-specific uniform ────────────────────────────────
  // Non-role-specific: applies to anyone in the matching zone, including visitors.
  const characterZone = character.current_zone || character.current_activity?.toLowerCase() || '';
  if (characterZone) {
    for (const [uniformId, uniform] of Object.entries(uniforms)) {
      if (!uniform || uniform.applicability !== 'zone') continue;
      const uniformZone = (uniform.zone || '').toLowerCase().trim();
      if (uniformZone && characterZone.includes(uniformZone)) {
        return {
          uniform,
          applicability: 'zone',
          reason: `zone-specific: ${uniform.zone}`,
          source: 'zone',
        };
      }
    }
  }

  // ── PRIORITY 5: Role/status uniform ──────────────────────────────────
  if (!isVisitorRole && characterRoleAtLocation) {
    const normalizedRole = characterRoleAtLocation.toLowerCase().trim();
    for (const [uniformId, uniform] of Object.entries(uniforms)) {
      if (!uniform || uniform.applicability !== 'role_status') continue;
      const configuredRole = (uniform.role_status || '').toLowerCase().trim();
      if (configuredRole === normalizedRole) {
        return {
          uniform,
          applicability: 'role_status',
          reason: `role: ${characterRoleAtLocation}`,
          source: 'role_status',
        };
      }
    }
  }

  // ── PRIORITY 6: Generic/default staff uniform ───────────────────────
  // For any worker/staff member — not just those with a job title.
  // The existing semantics: established staff member + no more specific uniform
  // matched = generic staff uniform. Do not require a nonempty jobTitle string.
  if (!isVisitorRole && isWorker) {
    for (const [uniformId, uniform] of Object.entries(uniforms)) {
      if (!uniform || uniform.applicability !== 'generic_staff') continue;
      return {
        uniform,
        applicability: 'generic_staff',
        reason: `generic staff uniform`,
        source: 'generic_staff',
      };
    }
  }

  // ── PRIORITY 7: Location-wide uniform ───────────────────────────────
  // Non-role-specific: applies to anyone at the Location, including visitors.
  // Must NOT be defeated by visitor detection or any earlier role gate.
  for (const [uniformId, uniform] of Object.entries(uniforms)) {
    if (!uniform || uniform.applicability !== 'location_wide') continue;
    return {
      uniform,
      applicability: 'location_wide',
      reason: 'location-wide default',
      source: 'location_wide',
    };
  }

  return result;
}

/**
 * Determine the character's role/status at a location.
 * Used for role-based uniform matching.
 *
 * @param {Object} character - Character record
 * @param {Object} location - Location record
 * @returns {string|null} Role: 'employee', 'inmate', 'student', 'staff', 'visitor', etc.
 */
export function determineCharacterRoleAtLocation(character, location) {
  if (!character || !location) return null;

  const workerIds = location.worker_character_ids || [];
  const isWorker = workerIds.includes(character.id);

  // Inmate at jail/prison
  if (location.category === 'jail_prison' && character.is_jailed) {
    return 'inmate';
  }

  // Staff at jail/prison
  if (location.category === 'jail_prison' && isWorker) {
    return 'staff';
  }

  // Student at school
  if ((location.category === 'school' || location.category === 'education') &&
      character.education_location_id === location.id) {
    return 'student';
  }

  // Patient at medical facility (hospitalized establishes patient status)
  // Checked BEFORE the generic employee check so a hospitalized worker at a
  // medical facility is classified as 'patient', not 'employee'.
  if ((location.category === 'medical' || location.category === 'hospital') &&
      (character.resolved_presence_status === 'hospitalized' || character.location_status === 'hospitalized')) {
    return 'patient';
  }

  // Medical staff (worker at a medical facility, not hospitalized)
  // Checked BEFORE the generic employee check so medical workers are 'staff'.
  if ((location.category === 'medical' || location.category === 'hospital') && isWorker) {
    return 'staff';
  }

  // Employee at workplace/business/restaurant/etc
  if (isWorker) {
    return 'employee';
  }

  // Gym member
  if (location.category === 'gym' && (location.gym_members || []).includes(character.id)) {
    return 'member';
  }

  // Home resident
  if ((location.category === 'home' || location.category === 'generic') &&
      character.current_home_location_id === location.id) {
    return 'resident';
  }

  // Default: visitor/customer
  return 'visitor';
}

/**
 * Build outfit context from a resolved uniform.
 * Returns a structure matching resolveCharacterOutfit format for seamless integration.
 *
 * @param {Object} resolvedUniform - Output of resolveUniform()
 * @returns {Object|null} Outfit context or null if no uniform
 */
export function buildUniformOutfitContext(resolvedUniform) {
  if (!resolvedUniform || !resolvedUniform.uniform) return null;

  const { uniform, applicability, reason, source } = resolvedUniform;

  return {
    outfit: uniform, // uniform object includes name, image_url, description, etc.
    category: 'uniform', // special category
    reason: reason || applicability,
    description: uniform.description || uniform.name || 'uniform',
    source: `uniform:${source}`,
  };
}