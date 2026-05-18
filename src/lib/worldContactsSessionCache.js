/**
 * worldContactsSessionCache.js
 *
 * SHIM — delegates to the global characterRuntimeCache.
 * Kept for backward compatibility so existing imports in WorldContactsPopup still work.
 * New code should import directly from characterRuntimeCache.js.
 *
 * NOTE: ownerEmail is not available at module level, so these shims use a
 * fallback key prefix "wc_session" for the legacy callers. WorldContactsPopup
 * now calls the global cache directly with ownerEmail for proper scoping.
 */

import {
  getCachedCanonicalPrompt as _getCanonical,
  setCachedCanonicalPrompt as _setCanonical,
  getCachedCharRecord as _getChar,
  setCachedCharRecord as _setChar,
  invalidateCharacterCache as _invalidate,
} from './characterRuntimeCache';

// Legacy shims — use a fixed sentinel owner so they don't collide with scoped keys.
const LEGACY_OWNER = '__wc_session__';

export function getCachedCanonicalPrompt(characterId) {
  return _getCanonical(LEGACY_OWNER, characterId);
}

export function setCachedCanonicalPrompt(characterId, systemPrompt) {
  _setCanonical(LEGACY_OWNER, characterId, systemPrompt);
}

export function getCachedCharRecord(characterId) {
  return _getChar(LEGACY_OWNER, characterId);
}

export function setCachedCharRecord(characterId, record) {
  _setChar(LEGACY_OWNER, characterId, record);
}

export function invalidateCharacterCache(characterId) {
  _invalidate(LEGACY_OWNER, characterId);
}