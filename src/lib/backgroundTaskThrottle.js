/**
 * Background Task Throttle
 *
 * Allows background systems to check if they should defer due to active user interaction.
 * This is checked IN background functions (via the SDK or custom logic) before making API calls.
 *
 * Frontend stores the foreground priority state in sessionStorage.
 * Backend functions check sessionStorage before performing rate-limited work.
 */

export function isBackgroundTaskThrottled() {
  // Check if stored in sessionStorage by frontend
  try {
    const priority = sessionStorage.getItem('foregroundPriority');
    return priority === 'true';
  } catch {
    return false;
  }
}

export function setForegroundPriority(active) {
  try {
    sessionStorage.setItem('foregroundPriority', active ? 'true' : 'false');
  } catch {
    // Silently fail if sessionStorage is unavailable
  }
}

export const BACKGROUND_TASK_DEFERRAL_MS = 45000; // 45 seconds — pause background work while chat loads