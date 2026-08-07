/**
 * UNIFORM APPLICABILITY RULES — Environment-Neutral Shared Authority
 *
 * This is the SINGLE authority for uniform applicability evaluation.
 * Consumed by both:
 *   - src/lib/uniformResolver.js (frontend)
 *   - base44/functions/resolveCharacterOutfitContext/entry.ts (backend)
 *
 * No duplicates. No synchronized copies. Both environments import this module.
 *
 * DESIGN PRINCIPLES:
 * 1. Each applicability type is evaluated according to its own stored rule.
 *    No broad visitor gate in front of unrelated applicability mechanisms.
 * 2. Role/status is derived from the character's actual existing data fields
 *    (presence status, student status, incarceration, worker assignment),
 *    NOT by interpreting the Location category.
 * 3. Job title and staff assignment are resolved for the CURRENT Location:
 *    Location-side assignment takes priority; character-side employment data
 *    matched to this Location is the fallback.
 * 4. location_wide is evaluated per the Location's own rule — it must not
 *    require a recognized role, job title, or worker record first.
 * 5. generic_staff applies when the character is established as staff at this
 *    Location; a missing jobTitle does not block it.
 * 6. manual_assignment is honored when the Location explicitly assigns a
 *    uniform to this character — no second resolver needs to agree.
 */

/**
 * Extract a text description from a uniform object.
 */
export function uniformToText(u) {
  if (!u) return null;
  const parts = [u.description, u.name].filter(Boolean);
  return parts[0] || null;
}

/**
 * Resolve the character's assignment at a specific Location.
 *
 * Uses the character's actual existing role/status/employment data and the
 * Location's existing worker/student/member assignment data. Does NOT
 * interpret the Location category to manufacture a role.
 *
 * @param {Object} character - Character record
 * @param {Object} location - LocationReference record
 * @returns {{ jobTitle: string|null, isStaff: boolean, roleStatuses: string[], zone: string, presence: string }}
 */
export function resolveCharacterAssignmentAtLocation(character, location) {
  if (!character || !location) {
    return { jobTitle: null, isStaff: false, roleStatuses: [], zone: '', presence: '' };
  }

  const locationId = location.id;
  const presence = character.resolved_presence_status || character.location_status || '';

  // ── JOB TITLE AT THIS LOCATION ──────────────────────────────────────────
  // Location-side assignment takes priority; character-side employment data
  // matched to this Location is the fallback. Never assumes a global occupation
  // belongs to the current workplace.
  let jobTitle = null;

  // 1. Location-side: explicit job title assignment for this character
  if (location.worker_job_titles && location.worker_job_titles[character.id]) {
    jobTitle = location.worker_job_titles[character.id];
  }

  // 2. Character-side: primary employment data matched to this Location
  if (!jobTitle && character.occupation_location_id === locationId) {
    if (character.work_details && character.work_details.job_title) {
      jobTitle = character.work_details.job_title;
    }
  }

  // 3. Character-side: additional occupation locations matched to this Location
  if (!jobTitle && Array.isArray(character.additional_occupation_locations)) {
    for (const loc of character.additional_occupation_locations) {
      const locId = loc.location_id || loc.id;
      if (locId === locationId && loc.job_title) {
        jobTitle = loc.job_title;
        break;
      }
    }
  }

  // ── IS STAFF AT THIS LOCATION ───────────────────────────────────────────
  // Established by Location-side worker assignment or character-side employment
  // data matched to this Location. A worker at Location A is not automatically
  // staff at Location B.
  const isStaff =
    (location.worker_character_ids && location.worker_character_ids.includes(character.id)) ||
    character.occupation_location_id === locationId ||
    (Array.isArray(character.additional_occupation_locations) &&
      character.additional_occupation_locations.some(loc =>
        (loc.location_id || loc.id) === locationId
      ));

  // ── ROLE/STATUS AT THIS LOCATION ─────────────────────────────────────────
  // Derived from the character's actual existing status data fields, NOT from
  // interpreting the Location category. These strings allow Location uniform
  // role_status rules to match against the character's real status.
  //
  // The raw presence status is always included so Location uniforms can match
  // directly on the actual status string (e.g. role_status: 'hospitalized').
  // Common aliases (patient, inmate, student, staff) are also included so
  // Location uniforms can use conventional role labels.
  const roleStatuses = [];

  if (presence) roleStatuses.push(presence);

  // Patient — from actual hospitalized presence status (not Location category)
  if (presence === 'hospitalized') roleStatuses.push('patient');

  // Inmate — from actual incarceration data (not Location category)
  if (character.is_jailed || presence === 'incarcerated') roleStatuses.push('inmate');

  // Student — from actual enrollment data matched to this Location
  if (character.student_status === 'enrolled' &&
      (character.current_school_location_id === locationId ||
       character.education_location_id === locationId)) {
    roleStatuses.push('student');
  }

  // Staff/employee — from actual staff assignment at this Location
  if (isStaff) {
    roleStatuses.push('staff');
    roleStatuses.push('employee');
  }

  // Gym member — from Location's gym_members array (existing data)
  if (location.gym_members && location.gym_members.includes(character.id)) {
    roleStatuses.push('member');
  }

  // Resident — from character's current_home_location_id (existing data)
  if (character.current_home_location_id === locationId) {
    roleStatuses.push('resident');
  }

  // ── ZONE ────────────────────────────────────────────────────────────────
  const zone = character.current_zone || character.current_activity || '';

  return { jobTitle, isStaff, roleStatuses, zone, presence };
}

/**
 * Evaluate uniform applicability rules.
 *
 * Each applicability type is evaluated according to its own stored rule.
 * No broad visitor gate — the evidence for each type determines applicability.
 *
 * Priority order (existing):
 * 1. manual_assignment — Location explicitly assigns a uniform to this character
 * 2. job_title — character's job title at this Location matches
 * 3. role_status — character's actual role/status at this Location matches
 * 4. generic_staff — character is established as staff at this Location
 * 5. zone — character's current zone matches (per existing zone semantics)
 * 6. location_wide — Location has a location-wide rule (per existing semantics)
 *
 * @param {Object} uniforms - Location.uniforms object
 * @param {Object} character - Character record
 * @param {Object} location - LocationReference record
 * @param {Object} assignment - Output of resolveCharacterAssignmentAtLocation()
 * @returns {{ uniform: Object, applicability: string, source: string }|null}
 */
export function evaluateUniformApplicability(uniforms, character, location, assignment) {
  if (!uniforms || !character || !location || !assignment) return null;
  if (Object.keys(uniforms).length === 0) return null;

  // 1. Manual assignment — Location explicitly assigns a uniform to this character.
  // Evidence: location.worker_manual_uniforms[character.id] exists and maps to a uniform.
  // No role gate — the Location's explicit assignment is the authority.
  const manualKey = location.worker_manual_uniforms && location.worker_manual_uniforms[character.id];
  if (manualKey && uniforms[manualKey]) {
    return { uniform: uniforms[manualKey], applicability: 'manual_assignment', source: 'manual_assignment' };
  }

  // 2. Job title — character's job title at this Location matches.
  // Evidence: assignment.jobTitle matches the uniform's job_title.
  if (assignment.jobTitle) {
    const normalizedTitle = assignment.jobTitle.toLowerCase().trim();
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'job_title' &&
          (u.job_title || '').toLowerCase().trim() === normalizedTitle) {
        return { uniform: u, applicability: 'job_title', source: 'job_title' };
      }
    }
  }

  // 3. Role/status — character's actual role/status at this Location matches.
  // Evidence: assignment.roleStatuses includes the uniform's role_status.
  if (assignment.roleStatuses.length > 0) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'role_status' && u.role_status) {
        const uniformRoleStatus = u.role_status.toLowerCase().trim();
        if (assignment.roleStatuses.some(rs => rs.toLowerCase().trim() === uniformRoleStatus)) {
          return { uniform: u, applicability: 'role_status', source: 'role_status' };
        }
      }
    }
  }

  // 4. Generic staff — character is established as staff at this Location.
  // Evidence: assignment.isStaff is true. Missing jobTitle does not block this.
  if (assignment.isStaff) {
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'generic_staff') {
        return { uniform: u, applicability: 'generic_staff', source: 'generic_staff' };
      }
    }
  }

  // 5. Zone — per existing zone semantics.
  // Evidence: character's current zone matches the uniform's zone.
  if (assignment.zone) {
    const characterZone = assignment.zone.toLowerCase();
    for (const u of Object.values(uniforms)) {
      if (u && u.applicability === 'zone' && u.zone && characterZone.includes(u.zone.toLowerCase())) {
        return { uniform: u, applicability: 'zone', source: 'zone' };
      }
    }
  }

  // 6. Location-wide — per existing location-wide semantics.
  // Evidence: the Location has a location-wide uniform rule.
  // Must NOT require a recognized role, job title, or worker record first.
  for (const u of Object.values(uniforms)) {
    if (u && u.applicability === 'location_wide') {
      return { uniform: u, applicability: 'location_wide', source: 'location_wide' };
    }
  }

  return null;
}

/**
 * Convenience: resolve assignment + evaluate applicability in one call.
 * Returns the same { uniform, applicability, source } format, plus a reason field
 * for backward compatibility with uniformResolver.js callers.
 *
 * @param {Object} character - Character record
 * @param {Object} location - LocationReference record
 * @returns {{ uniform: Object|null, applicability: string|null, reason: string|null, source: string }}
 */
export function resolveUniform(character, location) {
  if (!character || !location) {
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }
  const uniforms = location.uniforms || {};
  const assignment = resolveCharacterAssignmentAtLocation(character, location);
  const result = evaluateUniformApplicability(uniforms, character, location, assignment);
  if (!result) {
    return { uniform: null, applicability: null, reason: null, source: 'none' };
  }
  return {
    uniform: result.uniform,
    applicability: result.applicability,
    reason: result.applicability,
    source: result.source,
  };
}