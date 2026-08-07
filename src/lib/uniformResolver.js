/**
 * UNIFORM RESOLVER — Frontend-facing wrapper
 *
 * This module is a thin wrapper around the shared uniform applicability rules
 * in base44/shared/uniformApplicabilityRules.js. It preserves the existing
 * export signatures (resolveUniform, determineCharacterRoleAtLocation,
 * buildUniformOutfitContext) so existing callers continue to work.
 *
 * The actual applicability algorithm lives in the shared module — there is
 * no duplicated rule body here.
 *
 * RULES:
 * - Uniforms are TEMPORARY context outfits, NOT permanent replacements
 * - Uniforms never overwrite closet, worn outfits, or character rotation
 * - Each applicability type is evaluated on its own evidence (no visitor gate)
 * - Location owns the uniform requirement; character's actual data determines fit
 */

import {
  resolveUniform as _resolveUniformShared,
  resolveCharacterAssignmentAtLocation,
} from '../../base44/shared/uniformApplicabilityRules.js';

/**
 * Resolve which uniform (if any) applies to a character at a specific location.
 *
 * The characterRoleAtLocation parameter is accepted for backward compatibility
 * but is no longer used — the shared module resolves the assignment internally
 * from the character's actual existing data.
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
  return _resolveUniformShared(character, location);
}

/**
 * Determine the character's role/status at a location.
 *
 * DEPRECATED as an authority — the uniform system now uses
 * resolveCharacterAssignmentAtLocation from the shared module, which returns
 * structured assignment data instead of a single role string.
 *
 * This function is kept for backward compatibility with any callers that
 * still use the role string. It returns a role derived from the character's
 * actual existing status data, NOT from interpreting the Location category.
 *
 * @param {Object} character - Character record
 * @param {Object} location - Location record
 * @returns {string|null} Role label
 */
export function determineCharacterRoleAtLocation(character, location) {
  if (!character || !location) return null;
  const assignment = resolveCharacterAssignmentAtLocation(character, location);
  // Return the most specific role/status from the assignment
  // Priority: patient > inmate > student > staff > member > resident > visitor
  if (assignment.roleStatuses.includes('patient')) return 'patient';
  if (assignment.roleStatuses.includes('inmate')) return 'inmate';
  if (assignment.roleStatuses.includes('student')) return 'student';
  if (assignment.roleStatuses.includes('staff')) return 'staff';
  if (assignment.roleStatuses.includes('member')) return 'member';
  if (assignment.roleStatuses.includes('resident')) return 'resident';
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
    outfit: uniform,
    category: 'uniform',
    reason: reason || applicability,
    description: uniform.description || uniform.name || 'uniform',
    source: `uniform:${source}`,
  };
}