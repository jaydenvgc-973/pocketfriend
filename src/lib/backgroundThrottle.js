/**
 * backgroundThrottle.js
 *
 * Shared module for background-task rate limiting, deduplication, and
 * per-message image recovery guards.
 *
 * RULES:
 * - One in-flight guard per logical operation key (characterId:fnName, messageId, etc.)
 * - Per-key cooldown registry (survives component remounts — module-level)
 * - Session-level image recovery dedup: once recovered per messageId, never re-attempted
 * - Foreground operations are NEVER gated here — only background tasks
 * - No records deleted, no data hidden
 */

// ── In-flight guards ─────────────────────────────────────────────────────────
// Key → boolean. Prevents concurrent duplicate calls.
const _inFlight = {};

export function isInFlight(key) {
  return !!_inFlight[key];
}

export function setInFlight(key, val) {
  _inFlight[key] = !!val;
}

// ── Per-key cooldown registry ────────────────────────────────────────────────
// Key → last fired timestamp (ms). Module-level: survives remounts.
const _cooldowns = {};

export function isOnCooldown(key, cooldownMs) {
  const last = _cooldowns[key] || 0;
  return (Date.now() - last) < cooldownMs;
}

export function markCooldown(key) {
  _cooldowns[key] = Date.now();
}

export function getCooldownRemaining(key, cooldownMs) {
  const last = _cooldowns[key] || 0;
  return Math.max(0, cooldownMs - (Date.now() - last));
}

// ── Image recovery dedup ─────────────────────────────────────────────────────
// Cooldown-based: prevents rapid-fire duplicate recovery for the same message,
// but allows retry after 5 minutes if the previous attempt failed.
// Using a timestamp map instead of a permanent Set — failed recoveries can be retried.
const _recoveredMessageTimestamps = {};
const IMAGE_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown between auto-recovery attempts

export function isImageRecoveryDone(messageId) {
  const last = _recoveredMessageTimestamps[messageId] || 0;
  return (Date.now() - last) < IMAGE_RECOVERY_COOLDOWN_MS;
}

export function markImageRecoveryDone(messageId) {
  if (messageId) _recoveredMessageTimestamps[messageId] = Date.now();
}

// Allow forcing a retry regardless of cooldown (used when user manually triggers recovery)
export function clearImageRecoveryCooldown(messageId) {
  if (messageId) delete _recoveredMessageTimestamps[messageId];
}

// ── Per-page query refresh cooldown ─────────────────────────────────────────
// Prevents refetch-on-focus/reconnect storms when the app is backgrounded and restored.
// Pages call throttledInvalidate() instead of direct queryClient.invalidateQueries().
const _lastInvalidated = {};

/**
 * Conditionally call invalidateQueries only if the key hasn't been invalidated
 * within the cooldown window.
 *
 * @param {object} queryClient - React Query client
 * @param {Array|object} queryKey - key to invalidate
 * @param {number} cooldownMs - minimum ms between invalidations (default: 5min)
 * @param {string} [label] - log label for diagnostics
 */
export function throttledInvalidate(queryClient, queryKey, cooldownMs = 5 * 60 * 1000, label = '') {
  const key = JSON.stringify(queryKey);
  if (isOnCooldown(`invalidate:${key}`, cooldownMs)) {
    console.log(`[BackgroundThrottle] SKIP invalidate ${label || key} — cooldown ${Math.round(getCooldownRemaining(`invalidate:${key}`, cooldownMs) / 1000)}s`);
    return false;
  }
  markCooldown(`invalidate:${key}`);
  queryClient.invalidateQueries({ queryKey });
  return true;
}

// ── Proactive message cooldown ────────────────────────────────────────────────
// Prevents `sendProactiveMessageForCharacter` or `generateProactiveMessages` from
// firing more than once per character per 5-minute window from any frontend hook.
const PROACTIVE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

export function canFireProactive(characterId) {
  return !isOnCooldown(`proactive:${characterId}`, PROACTIVE_COOLDOWN_MS);
}

export function markProactiveFired(characterId) {
  markCooldown(`proactive:${characterId}`);
}

// ── Presence/location update cooldown ────────────────────────────────────────
// Prevents repeated `syncCharacterLocationRealTime` calls when no location has changed.
const PRESENCE_COOLDOWN_MS = 3 * 60 * 1000; // 3 min

export function canFirePresenceSync(characterId) {
  return !isOnCooldown(`presence:${characterId}`, PRESENCE_COOLDOWN_MS);
}

export function markPresenceSyncFired(characterId) {
  markCooldown(`presence:${characterId}`);
}

// ── Needs simulation cooldown ────────────────────────────────────────────────
// Prevents simulateActiveCharacterNeeds from hammering on rapid navigation.
const NEEDS_COOLDOWN_MS = 4 * 60 * 1000; // 4 min

export function canFireNeedsSimulation(characterId) {
  return !isOnCooldown(`needs:${characterId}`, NEEDS_COOLDOWN_MS);
}

export function markNeedsSimulationFired(characterId) {
  markCooldown(`needs:${characterId}`);
}

// ── Schedule enforcement cooldown ────────────────────────────────────────────
const SCHEDULE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

export function canFireScheduleEnforcement(characterId) {
  return !isOnCooldown(`schedule:${characterId}`, SCHEDULE_COOLDOWN_MS);
}

export function markScheduleEnforcementFired(characterId) {
  markCooldown(`schedule:${characterId}`);
}

// ── World Contacts refresh cooldown ────────────────────────────────────────
// Prevents WorldContactsPopup from re-fetching on every open event.
const WORLD_CONTACTS_COOLDOWN_MS = 2 * 60 * 1000; // 2 min

export function canRefreshWorldContacts(characterId) {
  return !isOnCooldown(`worldContacts:${characterId}`, WORLD_CONTACTS_COOLDOWN_MS);
}

export function markWorldContactsRefreshed(characterId) {
  markCooldown(`worldContacts:${characterId}`);
}

// ── Achievement refresh cooldown ────────────────────────────────────────────
const ACHIEVEMENT_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

export function canRefreshAchievements(ownerEmail) {
  return !isOnCooldown(`achievements:${ownerEmail}`, ACHIEVEMENT_COOLDOWN_MS);
}

export function markAchievementsRefreshed(ownerEmail) {
  markCooldown(`achievements:${ownerEmail}`);
}

// ── Autonomous narrative cooldown ────────────────────────────────────────────
const AUTO_NARRATIVE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

export function canFireAutoNarrative(characterId) {
  return !isOnCooldown(`autoNarrative:${characterId}`, AUTO_NARRATIVE_COOLDOWN_MS);
}

export function markAutoNarrativeFired(characterId) {
  markCooldown(`autoNarrative:${characterId}`);
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
export function debugBackgroundThrottle() {
  const now = Date.now();
  const active = Object.entries(_cooldowns)
    .filter(([, ts]) => (now - ts) < 10 * 60 * 1000)
    .map(([key, ts]) => ({ key, secondsAgo: Math.round((now - ts) / 1000) }));
  const inFlight = Object.entries(_inFlight).filter(([, v]) => v).map(([k]) => k);
  return {
    activeCooldowns: active,
    inFlightKeys: inFlight,
    recoveredMessageCount: Object.keys(_recoveredMessageTimestamps).length,
  };
}