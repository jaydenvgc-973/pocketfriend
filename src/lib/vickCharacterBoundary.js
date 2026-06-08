/**
 * vickCharacterBoundary.js
 *
 * VICK SERVICIO — FOURTH WALL TRAIT ENFORCEMENT
 *
 * Vick Servicio carries the "Never Break the Fourth Wall" protected trait.
 * This file is the Vick-specific entry point into that trait system.
 *
 * All enforcement logic, pattern detection, and safe rewrites live in:
 *   lib/fourthWallTrait.js
 *
 * This file exists for:
 *   1. Backward compatibility — all existing callers use enforceVickCharacterBoundary()
 *   2. Vick-specific identification — isVickServicio() remains here as the canonical check
 *   3. The Vick-specific prompt block — VICK_CHARACTER_BOUNDARY_PROMPT
 *
 * ── VICK IDENTIFICATION RULE ──────────────────────────────────────────────────
 * Vick is identified by ANY of the following — all treated equally:
 *   - character_type === 'npc_world_service'
 *   - is_world_service === true
 *   - diagnostic_only === true
 *   - name includes 'vick servicio' (case-insensitive)
 *   - display_name includes 'vick servicio' (case-insensitive)
 *   - primary_name includes 'vick servicio' (case-insensitive)
 *
 * ── SAFE PIPELINE (unchanged API) ────────────────────────────────────────────
 * enforceVickCharacterBoundary(text, targetName, channel):
 *   → Delegates to enforceFourthWallTrait() in fourthWallTrait.js
 *   → Returns same shape: { safe, text, action, violatedPatterns }
 *   → 'not_applicable' is remapped to 'passed' for Vick (he always has the trait)
 *
 * VICK_CHARACTER_BOUNDARY_PROMPT:
 *   → Uses buildFourthWallPromptBlock('Vick Servicio')
 *   → Identical behavioral instructions — same rules, same examples
 */

import {
  enforceFourthWallTrait,
  detectFourthWallViolation,
  rewriteToInWorld,
  hasFourthWallTrait,
  buildFourthWallPromptBlock,
} from './fourthWallTrait.js';

// ── VICK IDENTIFICATION ────────────────────────────────────────────────────────
/**
 * Returns true if a character record is Vick Servicio by ANY reliable identifier.
 * This is the canonical check — use this everywhere instead of single-field checks.
 *
 * @param {object} character — character record (partial or full)
 * @returns {boolean}
 */
export function isVickServicio(character) {
  if (!character) return false;
  if (character.character_type === 'npc_world_service') return true;
  if (character.is_world_service === true) return true;
  if (character.diagnostic_only === true) return true;
  const names = [character.name, character.display_name, character.primary_name]
    .filter(Boolean)
    .map(n => n.toLowerCase());
  return names.some(n => n.includes('vick servicio'));
}

// ── BACKWARD-COMPATIBLE DETECTION ─────────────────────────────────────────────
/**
 * Detects whether a Vick→character message contains forbidden content.
 * Delegates to the generalized trait system.
 *
 * @param {string} text
 * @returns {{ violated: boolean, patterns: string[] }}
 */
export function detectVickBoundaryViolation(text) {
  return detectFourthWallViolation(text);
}

// ── BACKWARD-COMPATIBLE REWRITE ────────────────────────────────────────────────
/**
 * Attempts a full in-world rewrite of a Vick→character message.
 * Delegates to the generalized trait system.
 *
 * @param {string} text
 * @returns {string}
 */
export function rewriteVickToInWorld(text) {
  return rewriteToInWorld(text);
}

// ── BACKWARD-COMPATIBLE ENFORCEMENT PIPELINE ──────────────────────────────────
/**
 * Full Vick character boundary enforcement pipeline.
 * Delegates to enforceFourthWallTrait().
 *
 * Run this on every Vick→character message BEFORE saving or delivering.
 *
 * @param {string} text — Vick's generated response
 * @param {string} targetCharacterName — the character receiving (for logging)
 * @param {string} channel — 'world_phone' | 'world_contacts' | 'direct' | 'scene' etc.
 * @returns {{ safe: boolean, text: string|null, action: 'passed'|'rewritten'|'rejected', violatedPatterns: string[] }}
 */
export function enforceVickCharacterBoundary(text, targetCharacterName = 'unknown', channel = 'unknown') {
  // Build a minimal Vick-shaped character object so the trait system identifies him
  const vickRecord = { character_type: 'npc_world_service', name: 'Vick Servicio' };
  const result = enforceFourthWallTrait(text, vickRecord, targetCharacterName, channel);

  // Remap 'not_applicable' → 'passed' for callers that don't expect 'not_applicable'
  // (Vick always has the trait, so this branch should never fire, but guard it anyway)
  if (result.action === 'not_applicable') {
    return { safe: true, text, action: 'passed', violatedPatterns: [] };
  }

  // Return the same shape existing callers expect (drop 'applicable' field)
  return {
    safe: result.safe,
    text: result.text,
    action: result.action,
    violatedPatterns: result.violatedPatterns,
  };
}

// ── VICK SYSTEM PROMPT BLOCK ───────────────────────────────────────────────────
/**
 * Hard-coded system prompt block injected into Vick's canonical prompt
 * when the conversation context is character-to-character.
 *
 * This replaces (not supplements) the diagnostic authority section
 * when Vick is speaking to a character.
 *
 * Generated from the generalized buildFourthWallPromptBlock() so Vick's
 * behavioral rules stay in sync with the trait definition.
 */
export const VICK_CHARACTER_BOUNDARY_PROMPT = buildFourthWallPromptBlock('Vick Servicio');