import { getForegroundRequestGate } from '@/lib/foregroundRequestGate';

/**
 * Hook for background tasks to check if they should proceed.
 *
 * Background tasks MUST check this before making requests.
 * If canProceed() returns false, the task should abort immediately.
 *
 * Usage:
 * const { canProceed } = useBackgroundTaskGate();
 *
 * if (!canProceed()) {
 *   console.log('User on foreground page, aborting background task');
 *   return;
 * }
 *
 * // Safe to make requests now
 * const data = await fetch(...);
 */
export function useBackgroundTaskGate() {
  const gate = getForegroundRequestGate();

  return {
    /**
     * Check if background is allowed to proceed
     * Returns false if user is on foreground page or active operations exist
     */
    canProceed: () => gate.canBackgroundProceed(),
    
    /**
     * Get current gate status for diagnostics
     */
    getStatus: () => gate.getStatus(),
  };
}

/**
 * Synchronous version for use in backend functions
 * Call this before making any background request
 */
export function checkBackgroundGate() {
  const gate = getForegroundRequestGate();
  return gate.canBackgroundProceed();
}