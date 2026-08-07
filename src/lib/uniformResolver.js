/**
 * UNIFORM RESOLVER — Frontend-facing wrapper
 *
 * This module is a thin wrapper around the shared uniform applicability rules
 * in base44/shared/uniformApplicabilityRules.js. It preserves the existing
 * export signatures (resolveUniform, buildUniformOutfitContext) so existing
 * callers continue to work.
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