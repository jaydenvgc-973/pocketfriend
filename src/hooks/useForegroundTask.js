/**
 * useForegroundTask Hook
 *
 * Register and manage owner-scoped foreground tasks within React components.
 * Automatically cleans up on unmount.
 * Imports from the single source of truth: lib/foregroundPriority.js
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  registerUserForegroundTask,
  clearUserForegroundTask,
  FOREGROUND_TASKS,
  PRIORITY_LEVELS,
} from '@/lib/foregroundPriority';

export function useForegroundTask() {
  const { user } = useAuth();
  const taskIdsRef = useRef([]);

  const registerTask = useCallback(
    (taskType, options = {}) => {
      if (!user?.email) return null;

      const taskId = registerUserForegroundTask(taskType, {
        ownerEmail: user.email,
        priority: options.priority || PRIORITY_LEVELS.HIGH,
        page: options.page || null,
        durationMs: options.durationMs ?? 8000,
      });

      if (taskId) taskIdsRef.current.push(taskId);
      return taskId;
    },
    [user?.email]
  );

  const clearTask = useCallback(
    (taskId) => {
      if (!user?.email || !taskId) return;
      clearUserForegroundTask(user.email, taskId);
      taskIdsRef.current = taskIdsRef.current.filter((id) => id !== taskId);
    },
    [user?.email]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (user?.email) {
        taskIdsRef.current.forEach((taskId) => {
          clearUserForegroundTask(user.email, taskId);
        });
        taskIdsRef.current = [];
      }
    };
  }, [user?.email]);

  return { registerTask, clearTask, FOREGROUND_TASKS, PRIORITY_LEVELS };
}

export default useForegroundTask;