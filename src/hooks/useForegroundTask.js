/**
 * useForegroundTask
 *
 * React hook that registers a foreground task for the lifetime of a page/component.
 * Background simulation systems (simulationGate, useChatBackgroundTasks, etc.) will
 * yield automatically while this task is active.
 *
 * Usage:
 *   useForegroundTask(FOREGROUND_TASKS.CHAT_LOADING);          // always active on this page
 *   useForegroundTask(FOREGROUND_TASKS.CHAT_LOADING, isReady); // active only when condition is true
 */

import { useEffect, useRef } from 'react';
import { registerForegroundTask } from '@/lib/foregroundPriority';

export function useForegroundTask(taskType, active = true) {
  const releaseRef = useRef(null);

  useEffect(() => {
    if (!active || !taskType) return;

    // Register and hold the foreground lock for this component's lifetime
    releaseRef.current = registerForegroundTask(taskType, 'high');

    return () => {
      if (releaseRef.current) {
        releaseRef.current();
        releaseRef.current = null;
      }
    };
  }, [taskType, active]);
}