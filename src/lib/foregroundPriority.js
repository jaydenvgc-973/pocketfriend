/**
 * FOREGROUND PRIORITY MANAGER — Single Source of Truth
 *
 * Tracks what the user is actively doing and signals background systems to yield.
 * Background tasks MUST check isForegroundActive() / shouldYieldToForeground() before running.
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

// ─── Global single-task state (legacy, used by useChatBackgroundTasks etc.) ───
// This is the simple string-based flag existing consumers rely on.
let _activeForegroundTask = null;
let _foregroundListeners = [];

// ─── Per-user task map (owner_email → task) for multi-user scoping ────────────
// This enables the owner_email-scoped API without breaking existing consumers.
const _userTasks = new Map(); // owner_email → { id, type, priority, started_at, expires_at }

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
  const incoming = priorityRank(priority);
  const current = _activeForegroundTask ? priorityRank(_activeForegroundTask.priority) : 0;

  // Only replace if incoming priority is >= current
  if (incoming >= current) {
    _activeForegroundTask = { type, priority, started_at: Date.now() };
    _notifyListeners();
  }

  return () => {
    if (_activeForegroundTask?.type === type) {
      _activeForegroundTask = null;
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
  return _activeForegroundTask !== null;
}

/**
 * Returns the current foreground task object, or null.
 */
export function getActiveForegroundTask() {
  return _activeForegroundTask;
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

function _notifyListeners() {
  _foregroundListeners.forEach((l) => {
    try { l(_activeForegroundTask); } catch (_) {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER-SCOPED API — used by MediaGallery, useForegroundTask hook, etc.
// Scoped per owner_email. Priority comparison enforced.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a foreground task scoped to an owner_email.
 * Will NOT overwrite a higher-priority active task for the same user.
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

  const incoming = priorityRank(priority);
  const existing = _userTasks.get(ownerEmail);

  // Do not overwrite a higher-priority active task
  if (existing && existing.expires_at > Date.now()) {
    const existingRank = priorityRank(existing.priority);
    if (existingRank > incoming) {
      // Keep the higher-priority task, do not register lower one
      return null;
    }
  }

  const taskId = `${taskType}_${Date.now()}`;
  const now = Date.now();
  const task = {
    id: taskId,
    type: taskType,
    priority,
    ownerEmail,
    page,
    started_at: now,
    expires_at: now + durationMs,
  };

  _userTasks.set(ownerEmail, task);

  // Also update the global flag if this is higher priority
  const currentGlobal = _activeForegroundTask ? priorityRank(_activeForegroundTask.priority) : 0;
  if (incoming >= currentGlobal) {
    _activeForegroundTask = { type: taskType, priority, started_at: now };
    _notifyListeners();
  }

  // Auto-clear after duration
  setTimeout(() => {
    const current = _userTasks.get(ownerEmail);
    if (current && current.id === taskId) {
      _userTasks.delete(ownerEmail);
      // Also clear global if this was the active one
      if (_activeForegroundTask?.type === taskType) {
        _activeForegroundTask = null;
        _notifyListeners();
      }
    }
  }, durationMs);

  return taskId;
}

/**
 * Clear an owner-scoped foreground task by taskId.
 */
export function clearUserForegroundTask(ownerEmail, taskId = null) {
  if (!ownerEmail) return;
  const current = _userTasks.get(ownerEmail);
  if (!current) return;
  if (taskId && current.id !== taskId) return;

  _userTasks.delete(ownerEmail);

  // Clear global flag if this was the active task
  if (_activeForegroundTask?.type === current.type) {
    _activeForegroundTask = null;
    _notifyListeners();
  }
}

/**
 * Get the active foreground task for a specific user.
 */
export function getUserForegroundTask(ownerEmail) {
  if (!ownerEmail) return null;
  const task = _userTasks.get(ownerEmail);
  if (!task) return null;
  if (task.expires_at < Date.now()) {
    _userTasks.delete(ownerEmail);
    return null;
  }
  return task;
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

/**
 * Debug: get all active user tasks.
 */
export function debugGetActiveTasks() {
  return Object.fromEntries(_userTasks);
}