/**
 * Single authority for background request priority checking.
 * 
 * Background functions MUST call this BEFORE making API requests.
 * If this returns false, the background task must return/exit without making the request.
 * 
 * This is NOT a timer, retry loop, or recovery system.
 * This is a hard gate: either foreground is active (don't proceed) or it isn't (proceed).
 * 
 * Usage in backend functions:
 * 
 * if (!isBackgroundTaskAllowed()) {
 *   return Response.json({ skipped: true });
 * }
 * // Safe to proceed with requests
 */

export function isBackgroundTaskAllowed() {
  // Check sessionStorage set by ForegroundPriorityContext
  // True = user on foreground page = background is blocked
  // False = user not on foreground page = background can proceed
  try {
    const foregroundActive = sessionStorage.getItem('foregroundPriority') === 'true';
    return !foregroundActive; // Return true if background is allowed (foreground NOT active)
  } catch {
    // If sessionStorage is unavailable, assume foreground is NOT active
    // (we're in a context where priority checking isn't available)
    return true;
  }
}

/**
 * For backend functions running in Deno (not in browser sessionStorage context).
 * These should NOT call this directly—they should receive priority state from frontend via payload
 * or check a dedicated priority endpoint.
 * 
 * This function is for frontend/browser contexts only.
 */
export function checkBackgroundPriority() {
  return isBackgroundTaskAllowed();
}