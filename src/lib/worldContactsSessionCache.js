/**
 * worldContactsSessionCache.js
 *
 * Module-level session cache for World Contacts canonical context and character records.
 * Survives popup open/close within the same browser session.
 * Keyed by characterId. Invalidated only on hard page reload.
 *
 * This prevents re-running buildCanonicalCharacterContext on every popup reopen,
 * which was the primary source of the 1-2 minute "character not ready" experience.
 */

const _canonicalCache = new Map(); // characterId → { systemPrompt, cachedAt }
const _charRecordCache = new Map(); // characterId → full Character record
const CANONICAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getCachedCanonicalPrompt(characterId) {
  const entry = _canonicalCache.get(characterId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CANONICAL_TTL_MS) {
    _canonicalCache.delete(characterId);
    return null;
  }
  return entry.systemPrompt;
}

export function setCachedCanonicalPrompt(characterId, systemPrompt) {
  if (!characterId || !systemPrompt) return;
  _canonicalCache.set(characterId, { systemPrompt, cachedAt: Date.now() });
}

export function getCachedCharRecord(characterId) {
  return _charRecordCache.get(characterId) || null;
}

export function setCachedCharRecord(characterId, record) {
  if (!characterId || !record) return;
  _charRecordCache.set(characterId, record);
}

export function invalidateCharacterCache(characterId) {
  _canonicalCache.delete(characterId);
  _charRecordCache.delete(characterId);
}