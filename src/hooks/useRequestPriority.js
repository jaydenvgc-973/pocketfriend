import { useEffect } from 'react';
import { getRequestPriorityManager, createBackgroundRequestAbortController } from '@/lib/requestPriorityManager';

/**
 * Hook for background tasks to check and respect request priority.
 *
 * Usage:
 * const { shouldContinue, signal } = useRequestPriority('myBackgroundTask');
 *
 * // Check before making requests
 * if (!shouldContinue()) return;
 *
 * // Pass signal to fetch to auto-cancel on priority change
 * const response = await fetch(url, { signal });
 */
export function useRequestPriority(taskId) {
  const manager = getRequestPriorityManager();

  useEffect(() => {
    return () => {
      manager.unregisterBackgroundRequest(taskId);
    };
  }, [taskId, manager]);

  return {
    shouldContinue: () => manager.shouldContinueBackgroundTask(taskId),
    getStatus: () => manager.getStatus(),
  };
}

/**
 * Helper to create a request with automatic cancellation on priority change.
 * Returns { signal, isRegistered }
 */
export function createPrioritizedRequest(taskId) {
  return createBackgroundRequestAbortController(taskId);
}