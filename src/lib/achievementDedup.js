/**
 * achievementDedup.js
 *
 * Single source of truth for achievement deduplication key logic.
 * Used by:
 *   - checkAchievements (backend function)
 *   - retroactiveAchievementScan (backend function)
 *   - backfillAchievementOwnerEmail (backend function)
 *
 * Scope is derived from the achievement definition in lib/achievements.js.
 * Never hardcode scope lists here — read from ACHIEVEMENTS[id].scope.
 *
 * Key format:
 *   global:    "global::{owner_email}::{achievement_id}"
 *   character: "char::{owner_email}::{achievement_id}::{character_id}"
 *
 * This file is safe to import in both frontend and backend contexts.
 * Backend functions inline the same logic (no local imports allowed in Deno).
 */

import { ACHIEVEMENTS } from './achievements.js';

/**
 * Returns the dedup key for an achievement record.
 * @param {string} ownerEmail
 * @param {string} achievementId
 * @param {string|null} characterId
 * @returns {string}
 */
export function buildDedupKey(ownerEmail, achievementId, characterId) {
  const def = ACHIEVEMENTS[achievementId];
  const scope = def?.scope ?? 'character'; // default to character-scoped if definition missing
  if (scope === 'global') {
    return `global::${ownerEmail}::${achievementId}`;
  }
  // character scope (and any future scopes that use character_id)
  return `char::${ownerEmail}::${achievementId}::${characterId || ''}`;
}

/**
 * Returns true if the achievement is global-scoped.
 * @param {string} achievementId
 * @returns {boolean}
 */
export function isGlobalAchievement(achievementId) {
  return ACHIEVEMENTS[achievementId]?.scope === 'global';
}

/**
 * Builds a Set of existing dedup keys from a list of UserAchievement records.
 * @param {Array} records - UserAchievement records (must have owner_email, achievement_id, character_id)
 * @returns {Set<string>}
 */
export function buildExistingKeySet(records) {
  return new Set(records.map(r =>
    buildDedupKey(r.owner_email, r.achievement_id, r.character_id)
  ));
}