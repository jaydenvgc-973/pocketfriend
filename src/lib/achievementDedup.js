/**
 * achievementDedup.js
 *
 * Single source of truth for achievement dedup key logic on the FRONTEND.
 * Derives scope directly from ACHIEVEMENTS — no separate hardcoded list.
 *
 * Backend functions (Deno) cannot import this file. They maintain an inline
 * BACKEND_ACHIEVEMENT_SCOPES mirror. Run auditAchievementScopeDrift to verify
 * backend inline maps are in sync with this file whenever lib/achievements.js changes.
 */
import { ACHIEVEMENTS } from '@/lib/achievements';

/**
 * Returns the scope for an achievement id.
 * Derived from ACHIEVEMENTS — no hardcoded separate list.
 * Falls back to 'character' for any id not present in ACHIEVEMENTS (e.g. legacy records).
 */
export function getAchievementScope(id) {
  return ACHIEVEMENTS[id]?.scope ?? 'character';
}

/**
 * Builds the canonical dedup key for a UserAchievement record.
 *   global scope:    "global::{ownerEmail}::{achievementId}"
 *   character scope: "char::{ownerEmail}::{achievementId}::{characterId}"
 *
 * ownerEmail   — required. The record's owner_email field.
 * achievementId — required. The record's achievement_id field.
 * characterId  — optional. The record's character_id field (null/undefined for global).
 */
export function buildDedupKey(ownerEmail, achievementId, characterId) {
  if (getAchievementScope(achievementId) === 'global') {
    return `global::${ownerEmail}::${achievementId}`;
  }
  return `char::${ownerEmail}::${achievementId}::${characterId || ''}`;
}

/**
 * Builds a Set of existing dedup keys from an array of UserAchievement records.
 * Use this to guard against creating duplicates before inserting a new record.
 */
export function buildExistingKeySet(records, ownerEmail) {
  return new Set(records.map(r => buildDedupKey(ownerEmail, r.achievement_id, r.character_id)));
}

/**
 * Returns a Map of frontendScopes derived from ACHIEVEMENTS,
 * suitable for passing to auditAchievementScopeDrift as the payload.
 *
 *   { achievement_id: 'global' | 'character', ... }
 *
 * Use this when calling the drift audit:
 *   const frontendScopes = getFrontendScopeMap();
 *   await base44.functions.invoke('auditAchievementScopeDrift', { frontendScopes });
 */
export function getFrontendScopeMap() {
  return Object.fromEntries(
    Object.values(ACHIEVEMENTS).map(a => [a.id, a.scope])
  );
}