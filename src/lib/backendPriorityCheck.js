/**
 * Backend priority check for Deno functions.
 * 
 * Background functions running in Deno cannot access sessionStorage directly.
 * Instead, they should:
 * 
 * 1. Check if an authenticated user is active and on a foreground page
 *    (via the request user context)
 * 2. Return early if foreground priority is detected
 * 
 * The assumption is:
 * - If a user just made an API call to a foreground function (Chat, Text, Travel, etc.),
 *   that user has foreground priority
 * - Background work should not consume capacity while a user is actively using the app
 * 
 * For most background functions (scheduled automations, cleanup jobs), there is no
 * authenticated user in the request context. These can proceed freely since foreground
 * operations are always initiated by an authenticated user making a direct request.
 * 
 * Usage in backend functions:
 * 
 * const base44 = createClientFromRequest(req);
 * const user = await base44.auth.me();
 * 
 * if (user && shouldDeferBackgroundWork()) {
 *   return Response.json({ skipped: true, reason: 'foreground active' });
 * }
 * // Safe to proceed
 */

/**
 * Heuristic: if an authenticated user exists in the current request context,
 * assume they are actively using the app and background work should defer.
 * 
 * True = user is active (foreground) = background should NOT proceed
 * False = no user context or scheduled task = background CAN proceed
 */
export function shouldDeferBackgroundWork(userExists) {
  return userExists === true;
}