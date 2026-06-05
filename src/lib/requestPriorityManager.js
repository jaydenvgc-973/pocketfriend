/**
 * Request Priority Manager
 *
 * Manages request quota and lifecycle for priority-based execution.
 * When a user-facing page is active, background requests are cancelled
 * before they consume capacity.
 *
 * Uses AbortController to cancel in-flight requests.
 */

class RequestPriorityManager {
  constructor() {
    // Map of background task IDs to AbortControllers
    this.backgroundRequests = new Map();
    // Current foreground priority level (true = user-facing page active)
    this.isForegroundActive = false;
    // Timestamp when foreground became active
    this.foregroundActivatedAt = null;
  }

  /**
   * Register a background request with a unique ID and AbortController.
   * If foreground is active, immediately abort the request.
   */
  registerBackgroundRequest(taskId, abortController) {
    if (this.isForegroundActive) {
      // User-facing page is active — abort immediately
      console.log(`[RequestPriority] Aborting background task ${taskId} — foreground active`);
      abortController.abort();
      return false;
    }

    this.backgroundRequests.set(taskId, abortController);
    return true;
  }

  /**
   * Check if a background task should continue.
   * Returns false if foreground became active within the last 5 seconds.
   */
  shouldContinueBackgroundTask(taskId) {
    if (!this.isForegroundActive) {
      return true;
    }

    // Only enforce priority for 5 seconds after foreground activation
    // This gives active pages time to load critical data
    const elapsedMs = Date.now() - this.foregroundActivatedAt;
    if (elapsedMs < 5000) {
      console.log(`[RequestPriority] Task ${taskId} paused — foreground active (${elapsedMs}ms)`);
      return false;
    }

    return true;
  }

  /**
   * Called when a user-facing page becomes active.
   * Cancels all pending background requests.
   */
  activateForeground() {
    if (this.isForegroundActive) return;

    console.log(`[RequestPriority] Foreground activated — cancelling ${this.backgroundRequests.size} background tasks`);

    // Cancel all pending background requests
    for (const [taskId, abortController] of this.backgroundRequests) {
      abortController.abort();
      console.log(`[RequestPriority] Cancelled background task: ${taskId}`);
    }

    this.backgroundRequests.clear();
    this.isForegroundActive = true;
    this.foregroundActivatedAt = Date.now();
  }

  /**
   * Called when foreground is no longer active.
   */
  deactivateForeground() {
    console.log(`[RequestPriority] Foreground deactivated — background tasks can resume`);
    this.isForegroundActive = false;
    this.foregroundActivatedAt = null;
  }

  /**
   * Unregister a background task after completion.
   */
  unregisterBackgroundRequest(taskId) {
    this.backgroundRequests.delete(taskId);
  }

  /**
   * Get current priority status.
   */
  getStatus() {
    return {
      isForegroundActive: this.isForegroundActive,
      backgroundTaskCount: this.backgroundRequests.size,
      foregroundActivatedAt: this.foregroundActivatedAt,
    };
  }
}

// Singleton instance
let instance = null;

export function getRequestPriorityManager() {
  if (!instance) {
    instance = new RequestPriorityManager();
  }
  return instance;
}

export function createBackgroundRequestAbortController(taskId) {
  const controller = new AbortController();
  const manager = getRequestPriorityManager();
  
  const isRegistered = manager.registerBackgroundRequest(taskId, controller);
  
  return {
    signal: controller.signal,
    taskId,
    isRegistered, // false if immediately aborted due to foreground active
  };
}