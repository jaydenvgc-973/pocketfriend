/**
 * FOREGROUND PRIORITY MANAGER
 *
 * Tracks what the user is actively doing and signals background systems to yield.
 * Background tasks MUST check isForegroundActive() before running expensive work.
 */

let activeForegroundTask = null;
let foregroundListeners = [];

/**
 * Register a foreground task. Background systems will yield while this is active.
 * Returns a cleanup function to call when the task is complete.
 *
 * @param {string} type - e.g. "save_character", "chat_loading", "image_generation"
 * @param {string} [priority] - "critical" | "high" | "normal" (default: "high")
 */
export function registerForegroundTask(type, priority = "high") {
  activeForegroundTask = {
    type,
    priority,
    started_at: Date.now(),
  };
  notifyListeners();

  // Return cleanup
  return () => {
    if (activeForegroundTask?.type === type) {
      activeForegroundTask = null;
      notifyListeners();
    }
  };
}

/**
 * Wrap an async operation as a foreground task.
 * Background systems yield for its entire duration.
 */
export async function runAsForegroundTask(type, fn, priority = "high") {
  const release = registerForegroundTask(type, priority);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Returns true if a foreground task is currently active.
 * Background systems should check this and defer if true.
 */
export function isForegroundActive() {
  return activeForegroundTask !== null;
}

/**
 * Returns the current foreground task object, or null.
 */
export function getActiveForegroundTask() {
  return activeForegroundTask;
}

/**
 * Background systems call this to get a safe delay before running.
 * If foreground is active, returns a longer delay to yield priority.
 *
 * @param {number} normalDelay - delay in ms when no foreground task
 * @param {number} yieldDelay - delay in ms when foreground is active (default: 8000ms)
 */
export function getBackgroundDelay(normalDelay, yieldDelay = 8000) {
  return isForegroundActive() ? yieldDelay : normalDelay;
}

/**
 * Returns a promise that resolves when no foreground task is active.
 * Background systems can await this before starting expensive work.
 *
 * @param {number} maxWait - max ms to wait before proceeding anyway (default: 30000)
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
 * Subscribe to foreground state changes.
 * Returns an unsubscribe function.
 */
export function subscribe(listener) {
  foregroundListeners.push(listener);
  return () => {
    foregroundListeners = foregroundListeners.filter((l) => l !== listener);
  };
}

function notifyListeners() {
  foregroundListeners.forEach((l) => {
    try { l(activeForegroundTask); } catch (_) {}
  });
}

// ─── Named task constants ───────────────────────────────────────────────────
export const FOREGROUND_TASKS = {
  SAVE_CHARACTER:       "save_character",
  CHAT_LOADING:         "chat_loading",
  MESSAGE_SEND:         "message_send",
  IMAGE_GENERATION:     "image_generation",
  FILE_UPLOAD:          "file_upload",
  TRAVEL_PAGE:          "travel_page",
  MOMENTS_PAGE:         "moments_page",
  WORLD_CONTACTS:       "world_contacts",
  CREATE_CHARACTER:     "create_character",
  MEDIA_GRID:           "media_grid",
  CHARACTER_PROFILE:    "character_profile",
};