/**
 * useForegroundTask Hook
 *
 * Register and manage foreground tasks within React components.
 * Automatically cleans up on unmount.
 *
 * Usage:
 *   const { registerTask, clearTask } = useForegroundTask();
 *   
 *   const handleSendMessage = async () => {
 *     const taskId = registerTask('chat_message_response', {
 *       priority: 'critical',
 *       durationMs: 10000,
 *     });
 *     
 *     try {
 *       await sendMessage();
 *     } finally {
 *       clearTask(taskId);
 *     }
 *   };
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import {
  registerForegroundTask,
  clearForegroundTask,
  FOREGROUND_TASKS,
  PRIORITY_LEVELS,
} from '@/lib/foregroundPriorityManager';

export function useForegroundTask() {
  const { user } = useAuth();
  const taskIdsRef = useRef([]);

  const registerTask = useCallback(
    (taskType, options = {}) => {
      if (!user?.email) {
        console.warn('[useForegroundTask] User email required to register task');
        return null;
      }

      const taskId = registerForegroundTask(taskType, {
        ownerEmail: user.email,
        priority: options.priority || PRIORITY_LEVELS.HIGH,
        page: options.page || null,
        durationMs: options.durationMs ?? 5000,
      });

      if (taskId) {
        taskIdsRef.current.push(taskId);
      }

      return taskId;
    },
    [user?.email]
  );

  const clearTask = useCallback(
    (taskId) => {
      if (!user?.email || !taskId) return;
      clearForegroundTask(user.email, taskId);
      taskIdsRef.current = taskIdsRef.current.filter((id) => id !== taskId);
    },
    [user?.email]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (user?.email) {
        taskIdsRef.current.forEach((taskId) => {
          clearForegroundTask(user.email, taskId);
        });
        taskIdsRef.current = [];
      }
    };
  }, [user?.email]);

  return {
    registerTask,
    clearTask,
    FOREGROUND_TASKS,
    PRIORITY_LEVELS,
  };
}

export default useForegroundTask;