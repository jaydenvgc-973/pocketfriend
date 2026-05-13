/**
 * useForegroundTask Hook
 *
 * Register and manage owner-scoped foreground tasks within React components.
 * Automatically cleans up on unmount.
 * Imports from the single source of truth: lib/foregroundPriority.js
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { foregroundPriority } from '@/lib/foregroundPriority';

export function useForegroundTask() {
  const { user } = useAuth();
  const taskIdsRef = useRef([]);

  const registerTask = useCallback(
    (page, action, options = {}) => {
      const fgId = `${page}_${action}_${Date.now()}`;
      foregroundPriority.startForegroundAction(page, action, fgId);
      taskIdsRef.current.push(fgId);
      return fgId;
    },
    []
  );

  const clearTask = useCallback(
    (fgId) => {
      if (!fgId) return;
      foregroundPriority.endForegroundAction(fgId);
      taskIdsRef.current = taskIdsRef.current.filter((id) => id !== fgId);
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (user?.email) {
        taskIdsRef.current.forEach((taskId) => {
          foregroundPriority.endForegroundAction(taskId);
        });
        taskIdsRef.current = [];
      }
    };
  }, [user?.email]);

  return { registerTask, clearTask };
}

export default useForegroundTask;