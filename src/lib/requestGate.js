/**
 * Request Gate
 *
 * Hard blocking layer that prevents background requests from being made
 * while a user-facing page is active.
 *
 * Background tasks must call checkGate() BEFORE making any request.
 * If the gate is closed, the request is prevented entirely.
 *
 * The gate remains closed as long as the user-facing page is active,
 * not just for a fixed time window.
 */

class RequestGate {
  constructor() {
    // Is a user-facing page currently active?
    this.isForegroundActive = false;
    
    // Timestamp when foreground was last detected as active
    // Used to detect if user is still actively using the page
    this.lastForegroundActivityAt = null;
    
    // Track which component/page requested blocking
    this.foregroundComponentId = null;
    
    // Blocked request count for diagnostics
    this.blockedRequestCount = 0;
  }

  /**
   * Called when a user-facing page becomes active.
   * All background requests are immediately denied.
   */
  activateForeground(componentId) {
    console.log(`[RequestGate] Foreground ACTIVATED: ${componentId}`);
    this.isForegroundActive = true;
    this.foregroundComponentId = componentId;
    this.lastForegroundActivityAt = Date.now();
  }

  /**
   * Called when a user-facing page becomes inactive.
   */
  deactivateForeground(componentId) {
    if (this.foregroundComponentId === componentId) {
      console.log(`[RequestGate] Foreground DEACTIVATED: ${componentId}`);
      this.isForegroundActive = false;
      this.foregroundComponentId = null;
      this.lastForegroundActivityAt = null;
    }
  }

  /**
   * Called when the user performs an action (type, click, scroll, etc).
   * Extends the time foreground remains active.
   */
  recordActivity() {
    if (this.isForegroundActive) {
      this.lastForegroundActivityAt = Date.now();
    }
  }

  /**
   * Check if a background request is allowed.
   * Returns true only if no foreground activity is detected.
   *
   * This must be called BEFORE the request is made, not after.
   * If it returns false, the background task should not attempt the request.
   */
  isBackgroundRequestAllowed() {
    if (!this.isForegroundActive) {
      return true;
    }

    // Foreground is marked active
    // Keep blocking for as long as activity is recent (within 10 seconds)
    const timeSinceActivity = Date.now() - this.lastForegroundActivityAt;
    const isStillActive = timeSinceActivity < 10000; // 10 seconds of inactivity tolerance

    if (isStillActive) {
      this.blockedRequestCount++;
      return false;
    }

    // No activity for 10+ seconds, allow background to resume
    console.log(`[RequestGate] Background requests resumed after activity ceased`);
    this.isForegroundActive = false;
    this.foregroundComponentId = null;
    return true;
  }

  /**
   * Get diagnostic status.
   */
  getStatus() {
    return {
      isForegroundActive: this.isForegroundActive,
      foregroundComponentId: this.foregroundComponentId,
      blockedRequestCount: this.blockedRequestCount,
      timeSinceLastActivity: this.lastForegroundActivityAt ? Date.now() - this.lastForegroundActivityAt : null,
    };
  }

  /**
   * Reset diagnostics.
   */
  resetDiagnostics() {
    this.blockedRequestCount = 0;
  }
}

// Singleton instance
let instance = null;

export function getRequestGate() {
  if (!instance) {
    instance = new RequestGate();
  }
  return instance;
}

/**
 * Middleware for checking the request gate before making background requests.
 * Call this BEFORE creating the fetch/API request.
 *
 * Usage:
 * if (!isBackgroundRequestAllowed('myBackgroundTask')) {
 *   return; // Don't make the request
 * }
 * // Safe to make the request now
 */
export function isBackgroundRequestAllowed(taskId) {
  const gate = getRequestGate();
  const allowed = gate.isBackgroundRequestAllowed();
  
  if (!allowed) {
    console.log(`[RequestGate] Background task '${taskId}' blocked — foreground active`);
  }
  
  return allowed;
}

/**
 * Record user activity on the current page to keep foreground active.
 */
export function recordUserActivity() {
  const gate = getRequestGate();
  gate.recordActivity();
}