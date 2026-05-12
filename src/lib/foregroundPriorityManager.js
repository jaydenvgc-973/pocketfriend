/**
 * Foreground Priority Manager
 *
 * Centralized system to track active user interactions and coordinate background task yielding.
 * All user-facing actions (chat, image generation, page loads) register here.
 * Background systems check before running: do not compete with active foreground tasks.
 *
 * RULES:
 * - All scoping is owner_email-based (NEVER created_by)
 * - Foreground tasks are critical and always win
 * - Background systems must check shouldYieldToForeground before running
 * - Cache is a performance layer and must be protected
 * - No logging spam in production
 */

// In-memory registry of active foreground tasks per owner_email
const activeTasks = new Map(); // owner_email -> { type, priority, started_at, expires_at, page, ... }

export const FOREGROUND_TASKS = {
  // Critical user interactions
  CHAT_MESSAGE_RESPONSE: 'chat_message_response',
  IMAGE_GENERATION: 'image_generation',
  CHARACTER_SAVE: 'character_save',
  CREATE_CHARACTER_SAVE: 'create_character_save',

  // High-priority page/UI loads
  PAGE_LOAD: 'page_load',
  PROFILE_LOAD: 'profile_load',
  MEDIA_GRID_LOAD: 'media_grid_load',
  WORLD_CONTACTS_LOAD: 'world_contacts_load',
  TRAVEL_LOAD: 'travel_load',
  MOMENTS_LOAD: 'moments_load',
  SETTINGS_LOAD: 'settings_load',
  CLOSET_LOAD: 'closet_load',
  DROPDOWN_LOAD: 'dropdown_load',
  
  // User tool/action
  USER_TOOL_ACTION: 'user_tool_action',
};

export const PRIORITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  NORMAL: 'normal',
  BACKGROUND: 'background',
};

/**
 * Register a foreground task for the current user.
 * 
 * @param {string} taskType - Type from FOREGROUND_TASKS
 * @param {object} options - { ownerEmail, priority, page, durationMs }
 * @returns {string} taskId for tracking
 */
export function registerForegroundTask(taskType, options = {}) {
  const {
    ownerEmail,
    priority = PRIORITY_LEVELS.HIGH,
    page = null,
    durationMs = 5000, // default: clear after 5s
  } = options;

  if (!ownerEmail) {
    console.warn('[ForegroundPriority] registerForegroundTask: ownerEmail required');
    return null;
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

  activeTasks.set(ownerEmail, task);

  // Auto-clear after duration
  if (durationMs > 0) {
    setTimeout(() => {
      const current = activeTasks.get(ownerEmail);
      if (current && current.id === taskId) {
        activeTasks.delete(ownerEmail);
      }
    }, durationMs);
  }

  return taskId;
}

/**
 * Clear a foreground task.
 * 
 * @param {string} ownerEmail
 * @param {string} taskId - optional, if not provided clears any task for this user
 */
export function clearForegroundTask(ownerEmail, taskId = null) {
  if (!ownerEmail) return;
  
  const current = activeTasks.get(ownerEmail);
  if (!current) return;
  
  if (taskId && current.id !== taskId) return; // not this task
  
  activeTasks.delete(ownerEmail);
}

/**
 * Get the active foreground task for a user.
 * 
 * @param {string} ownerEmail
 * @returns {object|null} task or null
 */
export function getForegroundTask(ownerEmail) {
  if (!ownerEmail) return null;
  
  const task = activeTasks.get(ownerEmail);
  if (!task) return null;
  
  // Check if expired
  if (task.expires_at < Date.now()) {
    activeTasks.delete(ownerEmail);
    return null;
  }
  
  return task;
}

/**
 * Check if there's an active foreground task for a user.
 * 
 * @param {string} ownerEmail
 * @returns {boolean}
 */
export function hasForegroundTask(ownerEmail) {
  return getForegroundTask(ownerEmail) !== null;
}

/**
 * Determine if a background task should yield to an active foreground task.
 * Background systems should call this before running non-essential work.
 * 
 * @param {string} ownerEmail
 * @param {string} backgroundTaskType - label for diagnostics (e.g., 'simulation', 'media_scan')
 * @returns {boolean} true if background should yield
 */
export function shouldYieldToForeground(ownerEmail, backgroundTaskType = null) {
  const foregroundTask = getForegroundTask(ownerEmail);
  if (!foregroundTask) return false;
  
  // Critical foreground tasks block most background work
  if (foregroundTask.priority === PRIORITY_LEVELS.CRITICAL) return true;
  
  // High priority blocks some background work
  if (foregroundTask.priority === PRIORITY_LEVELS.HIGH) {
    // Allow only the most essential background work during high-priority actions
    return true;
  }
  
  return false;
}

/**
 * Get a recommended delay for background task execution.
 * 
 * @param {string} ownerEmail
 * @param {string} backgroundTaskType - label for diagnostics
 * @returns {number} ms to wait before running, 0 if safe to run immediately
 */
export function getBackgroundDelay(ownerEmail, backgroundTaskType = null) {
  const foregroundTask = getForegroundTask(ownerEmail);
  if (!foregroundTask) return 0;
  
  if (foregroundTask.priority === PRIORITY_LEVELS.CRITICAL) {
    // Wait significantly longer for critical tasks
    return Math.max(0, foregroundTask.expires_at - Date.now() + 1000);
  }
  
  if (foregroundTask.priority === PRIORITY_LEVELS.HIGH) {
    // Wait a bit for high-priority tasks
    return Math.max(0, foregroundTask.expires_at - Date.now());
  }
  
  return 0;
}

/**
 * Run a callback when the app becomes idle (no active foreground task).
 * Useful for deferred background work.
 * 
 * @param {string} ownerEmail
 * @param {function} callback - () => Promise<void> or void
 * @param {object} options - { maxWaitMs, checkIntervalMs }
 */
export function runWhenIdle(ownerEmail, callback, options = {}) {
  const { maxWaitMs = 30000, checkIntervalMs = 500 } = options;
  
  const startTime = Date.now();
  
  const checkAndRun = async () => {
    if (!hasForegroundTask(ownerEmail)) {
      // Idle, safe to run
      try {
        await callback();
      } catch (err) {
        console.error('[ForegroundPriority] runWhenIdle callback failed:', err);
      }
      return;
    }
    
    // Still busy, check again later
    if (Date.now() - startTime > maxWaitMs) {
      // Timeout, run anyway
      try {
        await callback();
      } catch (err) {
        console.error('[ForegroundPriority] runWhenIdle timeout callback failed:', err);
      }
      return;
    }
    
    // Keep waiting
    setTimeout(checkAndRun, checkIntervalMs);
  };
  
  checkAndRun();
}

/**
 * Execute a function with automatic foreground task registration.
 * Clears the task when the function completes.
 * 
 * @param {object} task - { type, ownerEmail, priority, page, durationMs }
 * @param {function} callback - async or sync function
 * @returns {Promise} result of callback
 */
export async function withForegroundPriority(task, callback) {
  const taskId = registerForegroundTask(task.type, task);
  
  try {
    return await callback();
  } finally {
    clearForegroundTask(task.ownerEmail, taskId);
  }
}

/**
 * Lightweight diagnostic: log when background task yields to foreground.
 * Only logged in development or on explicit request.
 * 
 * @param {string} backgroundTaskType
 * @param {string} ownerEmail
 * @param {string} foregroundTaskType
 */
export function logBackgroundYield(backgroundTaskType, ownerEmail, foregroundTaskType) {
  if (typeof window !== 'undefined' && window.DEBUG_FOREGROUND_PRIORITY) {
    console.log(
      `[ForegroundPriority] Background "${backgroundTaskType}" yielding to foreground "${foregroundTaskType}" for ${ownerEmail}`
    );
  }
}

/**
 * Lightweight diagnostic: log when a foreground task is registered.
 * Only logged in development or on explicit request.
 */
export function logForegroundTaskStart(taskType, ownerEmail) {
  if (typeof window !== 'undefined' && window.DEBUG_FOREGROUND_PRIORITY) {
    console.log(`[ForegroundPriority] Foreground task started: ${taskType} (${ownerEmail})`);
  }
}

/**
 * Debug helper: show all active tasks.
 * @returns {object} map of owner_email -> active task
 */
export function debugGetActiveTasks() {
  return Object.fromEntries(activeTasks);
}

export default {
  registerForegroundTask,
  clearForegroundTask,
  getForegroundTask,
  hasForegroundTask,
  shouldYieldToForeground,
  getBackgroundDelay,
  runWhenIdle,
  withForegroundPriority,
  logBackgroundYield,
  logForegroundTaskStart,
  debugGetActiveTasks,
  FOREGROUND_TASKS,
  PRIORITY_LEVELS,
};