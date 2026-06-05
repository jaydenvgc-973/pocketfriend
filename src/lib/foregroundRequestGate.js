/**
 * Foreground Request Gate
 *
 * CRITICAL RULE: Background requests are completely blocked while the user
 * is actively on a foreground page. No timers. No windows. No resume.
 *
 * Background only proceeds when:
 * 1. The user navigates AWAY from all foreground pages
 * 2. AND no active user-facing operations are in progress
 *
 * This is an authority rule, not a cooldown.
 */

class ForegroundRequestGate {
  constructor() {
    // Boolean: user is currently on a foreground page
    this.isUserOnForegroundPage = false;
    
    // Track active operations (chat loading, sending message, etc)
    this.activeOperationCount = 0;
  }

  /**
   * Called when user enters a foreground page (Chat, Text, Profile, Travel, etc)
   * Background requests are now completely blocked.
   */
  enterForegroundPage() {
    this.isUserOnForegroundPage = true;
    console.log('[ForegroundGate] User entered foreground page — background requests blocked');
  }

  /**
   * Called when user leaves a foreground page
   * Background may resume only if no active operations exist.
   */
  leaveForegroundPage() {
    this.isUserOnForegroundPage = false;
    console.log('[ForegroundGate] User left foreground page');
  }

  /**
   * Called when a user-facing operation starts (chat loading, sending, etc)
   * Increments the active operation counter.
   */
  startActiveOperation() {
    this.activeOperationCount++;
    console.log(`[ForegroundGate] Active operation started (count: ${this.activeOperationCount})`);
  }

  /**
   * Called when a user-facing operation finishes
   * Decrements the active operation counter.
   */
  finishActiveOperation() {
    this.activeOperationCount--;
    if (this.activeOperationCount < 0) this.activeOperationCount = 0;
    console.log(`[ForegroundGate] Active operation finished (count: ${this.activeOperationCount})`);
  }

  /**
   * Check if background requests should proceed.
   *
   * Background is ONLY allowed if:
   * 1. User is NOT on a foreground page
   * 2. AND no active operations are in progress
   *
   * Otherwise, background is DENIED immediately.
   */
  canBackgroundProceed() {
    const canProceed = !this.isUserOnForegroundPage && this.activeOperationCount === 0;
    
    if (!canProceed) {
      const reason = this.isUserOnForegroundPage
        ? 'user on foreground page'
        : 'active operations in progress';
      console.log(`[ForegroundGate] Background request DENIED (${reason})`);
    }
    
    return canProceed;
  }

  /**
   * Get current gate status for diagnostics
   */
  getStatus() {
    return {
      isUserOnForegroundPage: this.isUserOnForegroundPage,
      activeOperationCount: this.activeOperationCount,
      canBackgroundProceed: this.canBackgroundProceed(),
    };
  }
}

// Singleton instance
let instance = null;

export function getForegroundRequestGate() {
  if (!instance) {
    instance = new ForegroundRequestGate();
  }
  return instance;
}