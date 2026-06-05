/**
 * FOREGROUND PRIORITY MANAGER — Single Source of Truth (Stack-Based)
 *
 * Tracks what the user is actively doing and signals background systems to yield.
 * Background tasks MUST check isForegroundActive() / shouldYieldToForeground() before running.
 *
 * ARCHITECTURE:
 * - Task registry: all active tasks (global + owner-scoped) stored in Map
 * - Global active task: highest-priority non-expired task from the entire registry
 * - Clearing one task: only removes that task, recomputes global active
 * - Auto-expire: stale tasks pruned on access
 * - Listener notifications: fire only on global active state change
 *
 * RULES:
 * - All owner_email-scoped tasks use the per-user task stack
 * - A lower-priority task NEVER overwrites a higher-priority active task
 * - critical > high > normal > background
 * - No created_by logic anywhere in this module
 * - Background systems check shouldYieldToForeground() before expensive work
 */

// ─── Priority levels ──────────────────────────────────────────────────────────
export const PRIORITY_LEVELS = {
  CRITICAL:   'critical',   // chat response, image generation
  HIGH:       'high',       // page load, profile load, dropdown load
  NORMAL:     'normal',     // settings, moments
  BACKGROUND: 'background', // simulations, narratives, presence refresh
};

const PRIORITY_ORDER = {
  critical:   4,
  high:       3,
  normal:     2,
  background: 1,
};

function priorityRank(p) {
  return PRIORITY_ORDER[p] ?? 0;
}

// ─── Named task constants ─────────────────────────────────────────────────────
export const FOREGROUND_TASKS = {
  // Critical — block all background work
  CHAT_MESSAGE_RESPONSE: 'chat_message_response',
  IMAGE_GENERATION:      'image_generation',
  MESSAGE_SEND:          'message_send',
  CHARACTER_SAVE:        'character_save',
  CREATE_CHARACTER_SAVE: 'create_character_save',
  FILE_UPLOAD:           'file_upload',

  // High — block most background work
  PAGE_LOAD:            'page_load',
  CHAT_LOADING:         'chat_loading',
  PROFILE_LOAD:         'character_profile',
  MEDIA_GRID:           'media_grid',
  WORLD_CONTACTS:       'world_contacts',
  TRAVEL_PAGE:          'travel_page',
  MOMENTS_PAGE:         'moments_page',
  SETTINGS_LOAD:        'settings_load',
  CLOSET_LOAD:          'closet_load',
  DROPDOWN_LOAD:        'dropdown_load',
  CREATE_CHARACTER:     'create_character',
  USER_TOOL_ACTION:     'user_tool_action',
  SAVE_CHARACTER:       'save_character',
};

// ─── Task Registry & State ────────────────────────────────────────────────────
// All active tasks: global and owner-scoped, keyed by taskId
const _taskRegistry = new Map(); // taskId → { id, type, priority, ownerEmail, started_at, expires_at }

// Cached global active task (highest priority non-expired)
let _cachedGlobalActive = null;
let _listenersDirty = false;

// Listeners for global active state changes
let _foregroundListeners = [];

// ─── Private Utilities ────────────────────────────────────────────────────────

/**
 * Prune expired tasks from registry.
 * Called before computing global active to ensure stale tasks don't block.
 */
function _pruneExpiredTasks() {
  const now = Date.now();
  const toDelete = [];
  for (const [taskId, task] of _taskRegistry) {
    if (task.expires_at < now) {
      toDelete.push(taskId);
    }
  }
  for (const taskId of toDelete) {
    _taskRegistry.delete(taskId);
  }
}

/**
 * Recompute the global active task: highest priority non-expired task.
 * Call after any registry change.
 * Returns the task object or null if registry is empty.
 */
function _recomputeGlobalActive() {
  _pruneExpiredTasks();
  
  if (_taskRegistry.size === 0) {
    const changed = _cachedGlobalActive !== null;
    _cachedGlobalActive = null;
    return changed;
  }

  let highest = null;
  let highestRank = 0;

  for (const task of _taskRegistry.values()) {
    const rank = priorityRank(task.priority);
    if (rank > highestRank) {
      highestRank = rank;
      highest = task;
    }
  }

  const changed = _cachedGlobalActive !== highest;
  _cachedGlobalActive = highest;
  return changed;
}

/**
 * Notify listeners if global active state changed.
 */
function _notifyListeners() {
  if (!_listenersDirty) return;
  _listenersDirty = false;
  _foregroundListeners.forEach((l) => {
    try { l(_cachedGlobalActive); } catch (_) {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY API — used by useChatBackgroundTasks, useNarrativeCorrection, etc.
// DO NOT REMOVE OR RENAME — existing imports rely on these exact exports.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a foreground task. Returns a cleanup function.
 * Lower-priority tasks will NOT overwrite a higher-priority active task.
 *
 * @param {string} type - task type from FOREGROUND_TASKS
 * @param {string} [priority] - 'critical' | 'high' | 'normal' (default: 'high')
 * @returns {function} cleanup — call when task completes
 */
export function registerForegroundTask(type, priority = 'high') {
  const taskId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const incoming = priorityRank(priority);

  // Check if we can add this task (don't add if lower priority than current global)
  const currentRank = _cachedGlobalActive ? priorityRank(_cachedGlobalActive.priority) : 0;
  if (incoming < currentRank) {
    // Lower priority — don't add, but still return a cleanup function
    return () => {};
  }

  const now = Date.now();
  _taskRegistry.set(taskId, {
    id: taskId,
    type,
    priority,
    ownerEmail: null, // global task
    started_at: now,
    expires_at: now + 30000, // 30s default
  });

  const changed = _recomputeGlobalActive();
  if (changed) {
    _listenersDirty = true;
    _notifyListeners();
  }

  return () => {
    _taskRegistry.delete(taskId);
    const changed = _recomputeGlobalActive();
    if (changed) {
      _listenersDirty = true;
      _notifyListeners();
    }
  };
}

/**
 * Wrap an async operation as a foreground task. Background systems yield for its duration.
 */
export async function runAsForegroundTask(type, fn, priority = 'high') {
  const release = registerForegroundTask(type, priority);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Returns true if any foreground task is currently active.
 */
export function isForegroundActive() {
  _pruneExpiredTasks();
  return _cachedGlobalActive !== null;
}

/**
 * Returns the current foreground task object, or null.
 */
export function getActiveForegroundTask() {
  _pruneExpiredTasks();
  return _cachedGlobalActive;
}

/**
 * Get recommended background delay.
 * @param {number} normalDelay - ms when idle
 * @param {number} yieldDelay - ms when foreground active (default 8000)
 */
export function getBackgroundDelay(normalDelay, yieldDelay = 8000) {
  return isForegroundActive() ? yieldDelay : normalDelay;
}

/**
 * Returns a promise that resolves when no foreground task is active.
 * @param {number} maxWait - max ms to wait (default 30000)
 */
export function waitForForegroundClear(maxWait = 30000) {
  if (!isForegroundActive()) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, maxWait);
    const unsubscribe = subscribe(() => {
      if (!isForegroundActive()) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}

/**
 * Subscribe to foreground state changes. Returns unsubscribe function.
 */
export function subscribe(listener) {
  _foregroundListeners.push(listener);
  return () => {
    _foregroundListeners = _foregroundListeners.filter((l) => l !== listener);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER-SCOPED API — used by MediaGallery, useForegroundTask hook, etc.
// Scoped per owner_email. Priority comparison enforced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a foreground task scoped to an owner_email.
 * Will NOT overwrite a higher-priority active task.
 *
 * @param {string} taskType - from FOREGROUND_TASKS
 * @param {object} options - { ownerEmail, priority, page, durationMs }
 * @returns {string|null} taskId
 */
export function registerUserForegroundTask(taskType, options = {}) {
  const {
    ownerEmail,
    priority = PRIORITY_LEVELS.HIGH,
    page = null,
    durationMs = 8000,
  } = options;

  if (!ownerEmail) return null;

  const taskId = `user_${ownerEmail}_${taskType}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const incoming = priorityRank(priority);

  // Do not add if lower priority than current global active
  const currentRank = _cachedGlobalActive ? priorityRank(_cachedGlobalActive.priority) : 0;
  if (incoming < currentRank) {
    return null;
  }

  const now = Date.now();
  _taskRegistry.set(taskId, {
    id: taskId,
    type: taskType,
    priority,
    ownerEmail,
    page,
    started_at: now,
    expires_at: now + durationMs,
  });

  const changed = _recomputeGlobalActive();
  if (changed) {
    _listenersDirty = true;
    _notifyListeners();
  }

  // Auto-clear after duration
  setTimeout(() => {
    _taskRegistry.delete(taskId);
    const changed = _recomputeGlobalActive();
    if (changed) {
      _listenersDirty = true;
      _notifyListeners();
    }
  }, durationMs);

  return taskId;
}

/**
 * Clear an owner-scoped foreground task by taskId.
 */
export function clearUserForegroundTask(ownerEmail, taskId = null) {
  if (!ownerEmail) return;

  if (taskId) {
    // Clear specific task
    _taskRegistry.delete(taskId);
  } else {
    // Clear all tasks for this owner
    for (const [id] of _taskRegistry) {
      if (id.startsWith(`user_${ownerEmail}_`)) {
        _taskRegistry.delete(id);
      }
    }
  }

  const changed = _recomputeGlobalActive();
  if (changed) {
    _listenersDirty = true;
    _notifyListeners();
  }
}

/**
 * Get the active foreground task for a specific user (if any).
 */
export function getUserForegroundTask(ownerEmail) {
  if (!ownerEmail) return null;
  _pruneExpiredTasks();

  for (const task of _taskRegistry.values()) {
    if (task.ownerEmail === ownerEmail) {
      return task;
    }
  }
  return null;
}

/**
 * Returns true if the given user has an active foreground task.
 */
export function hasUserForegroundTask(ownerEmail) {
  return getUserForegroundTask(ownerEmail) !== null;
}

/**
 * Determine if a background task should yield to an active foreground task.
 * Checks both global state and per-user state.
 *
 * @param {string} [ownerEmail] - optional, checks user-scoped task too
 * @returns {boolean}
 */
export function shouldYieldToForeground(ownerEmail = null) {
  // Global check first — affects all users
  if (isForegroundActive()) return true;
  // User-scoped check
  if (ownerEmail && hasUserForegroundTask(ownerEmail)) return true;
  return false;
}

/**
 * Execute with automatic foreground task lifecycle.
 * Clears when complete. Priority comparison enforced.
 */
export async function withForegroundPriority(taskType, fn, options = {}) {
  const { ownerEmail, priority = PRIORITY_LEVELS.HIGH, durationMs = 8000, page } = options;

  let globalRelease = null;
  let userTaskId = null;

  if (ownerEmail) {
    userTaskId = registerUserForegroundTask(taskType, { ownerEmail, priority, page, durationMs });
  } else {
    globalRelease = registerForegroundTask(taskType, priority);
  }

  try {
    return await fn();
  } finally {
    if (ownerEmail && userTaskId) {
      clearUserForegroundTask(ownerEmail, userTaskId);
    } else if (globalRelease) {
      globalRelease();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SIDE YIELD TOKEN — write to AppWorldState when user enters foreground
// Background automations (simulateActiveCharacterNeeds, autonomousCharacterMovement,
// processScheduledRelocations) check AppWorldState key='user_active_session' before
// doing bulk work. This bridges the browser→server priority gap.
// ─────────────────────────────────────────────────────────────────────────────

let _sessionWriteTimer = null;
let _sessionWriteBase44 = null;

/**
 * Signal to server-side automations that the user is actively using the app.
 * Called when a user opens chat, travel, profile, or settings.
 * Writes a short-lived token to AppWorldState with a TTL of `durationMs`.
 *
 * @param {object} base44Client - initialized base44 SDK client
 * @param {number} durationMs - how long to hold the yield token (default 3 minutes)
 */
export async function signalUserActiveSession(base44Client, durationMs = 180000) {
  if (!base44Client) return;
  _sessionWriteBase44 = base44Client;
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  try {
    // Try to update existing record first, create if not found
    const existing = await base44Client.entities.AppWorldState.filter({ key: 'user_active_session' }, null, 1).catch(() => []);
    if (existing?.[0]) {
      await base44Client.entities.AppWorldState.update(existing[0].id, { value: expiresAt }).catch(() => {});
    } else {
      await base44Client.entities.AppWorldState.create({ key: 'user_active_session', value: expiresAt }).catch(() => {});
    }
    console.log(`[ForegroundPriority] Server yield token written — automations will yield until ${new Date(expiresAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET`);
  } catch { /* non-fatal */ }
}

/**
 * Clear the server-side yield token when the user navigates away or the session ends.
 */
export async function clearUserActiveSession(base44Client) {
  const client = base44Client || _sessionWriteBase44;
  if (!client) return;
  try {
    const existing = await client.entities.AppWorldState.filter({ key: 'user_active_session' }, null, 1).catch(() => []);
    if (existing?.[0]) {
      await client.entities.AppWorldState.update(existing[0].id, { value: null }).catch(() => {});
    }
    console.log('[ForegroundPriority] Server yield token cleared — automations resuming');
  } catch { /* non-fatal */ }
}

/**
 * Debug: get all active tasks (global + owner-scoped).
 */
export function debugGetActiveTasks() {
  _pruneExpiredTasks();
  return {
    registry: Object.fromEntries(_taskRegistry),
    globalActive: _cachedGlobalActive,
    listenerCount: _foregroundListeners.length,
  };
}