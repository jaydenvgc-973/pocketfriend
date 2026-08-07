/**
 * UNIFORM RESOLVER
 *
 * Resolves which Location-owned uniform applies to a character at a specific location.
 * Uniforms are TEMPORARY context outfits — they never permanently replace closet,
 * rotation, or currently-wearing state.
 *
 * RULES:
 * - Each applicability type is evaluated on its own evidence (no visitor gate)
 * - Location owns the uniform requirement; character's actual data determines fit
 * - Multi-job isolation: only the current Location's employment data is used
 * - location_wide is reachable without a preceding role/job gate
 * - generic_staff applies when the character is established as staff at this Location
 *   even without a specific job-title string
 * - Hospitalized patients are not blocked as visitors when the hospital Location
 *   defines patient clothing (role_status match)
 */

/**
 * Check whether a character is a member of a Location array.
 * Handles both arrays of strings (character IDs) and arrays of objects
 * with a `character_id` field.
 */
function isInLocationArray(arr, characterId) {
  if (!Array.isArray(arr) || !characterId) return false;
  return arr.some(item => {
    if (typeof item === 'string') return item === characterId;
    return item?.character_id === characterId;
  });
}

/**
 * Resolve which uniform (if any) applies to a character at a specific location.
 *
 * The characterRoleAtLocation parameter is accepted for backward compatibility
 * but is not used — applicability is resolved from the character's actual existing
 * data at the current Location.
 *
 * @param {Object} character - Full character record
 * @param {Object} location - Location record
 * @param {string} [characterRoleAtLocation] - Ignored (backward compat)
 * @returns {{
 *   uniform: Object|null,
 *   applicability: string|null,
 *   reason: string|null,
 *   source: string
 * }}
 */
export function resolveUniform(character, location, characterRoleAtLocation) {
  if (!character || !location) {
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }

  const uniforms = location.uniforms || {};
  if (Object.keys(uniforms).length === 0) {
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }

  const charId = character.id;
  const presence = character.resolved_presence_status || character.location_status || '';

  // 1. Manual assignment — Location explicitly assigns a uniform to this character
  const manualKey = location.worker_manual_uniforms && location.worker_manual_uniforms[charId];
  if (manualKey && uniforms[manualKey]) {
    return { uniform: uniforms[manualKey], applicability: 'manual_assignment', reason: 'manual_assignment', source: 'manual_assignment' };
  }

  // 2. Job title — character's job title at THIS Location matches
  let jobTitle = null;
  if (location.worker_job_titles && location.worker_job_titles[charId]) {
    jobTitle = location.worker_job_titles[charId];
  }
  if (!jobTitle && character.occupation_location_id === location.id && character.work_details?.job_title) {
    jobTitle = character.work_details.job_title;
  }
  if (!jobTitle && Array.isArray(character.additional_occupation_locations)) {
    for (const loc of character.additional_occupation_locations) {
      if ((loc.location_id || loc.id) === location.id && loc.job_title) {
        jobTitle = loc.job_title;
        break;
      }
    }
  }
  if (jobTitle) {
    const normalizedTitle = jobTitle.toLowerCase().trim();
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'job_title' &&
          (u.job_title || '').toLowerCase().trim() === normalizedTitle) {
        return { uniform: u, applicability: 'job_title', reason: 'job_title', source: 'job_title' };
      }
    }
  }

  // 3. Role/status — character's actual status string at THIS Location matches.
  // Uses raw data values (presence status, student status, Location membership
  // array field names) — no manufactured vocabulary.
  const statusStrings = [];
  if (presence) statusStrings.push(presence);
  if (character.student_status && character.student_status !== 'not_student' &&
      (character.current_school_location_id === location.id ||
       character.education_location_id === location.id)) {
    statusStrings.push(character.student_status);
  }
  if (isInLocationArray(location.enrolled_students, charId)) statusStrings.push('enrolled_students');
  if (isInLocationArray(location.inmates, charId)) statusStrings.push('inmates');
  if (location.gym_members && location.gym_members.includes(charId)) statusStrings.push('gym_members');
  if (isInLocationArray(location.religious_members, charId)) statusStrings.push('religious_members');
  if (isInLocationArray(location.residents, charId)) statusStrings.push('residents');
  if (location.worker_character_ids && location.worker_character_ids.includes(charId)) statusStrings.push('worker_character_ids');

  if (statusStrings.length > 0) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'role_status' && u.role_status) {
        const uniformRoleStatus = u.role_status.toLowerCase().trim();
        if (statusStrings.some(s => s.toLowerCase().trim() === uniformRoleStatus)) {
          return { uniform: u, applicability: 'role_status', reason: 'role_status', source: 'role_status' };
        }
      }
    }
  }

  // 4. Generic staff — established worker at THIS Location, no job title required
  const isStaff =
    (location.worker_character_ids && location.worker_character_ids.includes(charId)) ||
    character.occupation_location_id === location.id ||
    (Array.isArray(character.additional_occupation_locations) &&
      character.additional_occupation_locations.some(loc =>
        (loc.location_id || loc.id) === location.id
      ));
  if (isStaff) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'generic_staff') {
        return { uniform: u, applicability: 'generic_staff', reason: 'generic_staff', source: 'generic_staff' };
      }
    }
  }

  // 5. Zone — character's current zone matches
  const zone = (character.current_zone || character.current_activity || '').toLowerCase();
  if (zone) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'zone' && u.zone && zone.includes(u.zone.toLowerCase())) {
        return { uniform: u, applicability: 'zone', reason: 'zone', source: 'zone' };
      }
    }
  }

  // 6. Location-wide — no preceding gate, always applies if defined
  for (const u of Object.values(uniforms)) {
    if (u && u.applicability === 'location_wide') {
      return { uniform: u, applicability: 'location_wide', reason: 'location_wide', source: 'location_wide' };
    }
  }

  return { uniform: null, applicability: null, reason: null, source: 'none' };
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
    outfit: uniform,
    category: 'uniform',
    reason: reason || applicability,
    description: uniform.description || uniform.name || 'uniform',
    source: `uniform:${source}`,
  };
}