import { isBackgroundRequestAllowed, recordUserActivity, getRequestGate } from '@/lib/requestGate';

/**
 * Hook for background tasks to check if requests are allowed.
 *
 * Usage in a background function:
 * const { isAllowed } = useBackgroundTaskGating('myTask');
 * 
 * if (!isAllowed()) {
 *   return; // Don't make the request
 * }
 * // Safe to proceed with request
 */
export function useBackgroundTaskGating(taskId) {
  return {
    /**
     * Check if a background request is allowed right now.
     * Call this BEFORE making the request.
     */
    isAllowed: () => isBackgroundRequestAllowed(taskId),
    
    /**
     * Get current gate status (for diagnostics).
     */
    getStatus: () => getRequestGate().getStatus(),
  };
}

/**
 * Standalone function to check request gate (for non-React contexts).
 * Usage: if (!checkBackgroundGate('taskName')) return;
 */
export function checkBackgroundGate(taskId) {
  return isBackgroundRequestAllowed(taskId);
}

/**
 * Record user activity to keep foreground active.
 * Call this on user interactions (clicks, typing, scrolling).
 */
export function useRecordActivity() {
  return recordUserActivity;
}