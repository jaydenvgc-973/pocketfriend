import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createDailyDateMarker — DEPRECATED AND DISABLED
 *
 * This function previously inserted "—— Monday, April 27, 2026 ——" records
 * into the Message table with sender_type='system'. That architecture was
 * fundamentally wrong:
 *
 * 1. Date dividers are UI-only. They must be derived from real message timestamps
 *    during rendering via injectDateSeparators() in lib/messageDateGrouping.js.
 * 2. Saving divider text as Message records caused:
 *    - The LLM to receive date strings as conversation context and sometimes echo them back
 *    - Malformed "—— Monday, June 1, 2026 ——" bubbles appearing in the chat stream
 *    - Unread count contamination (even with sender_type guards, recovery paths leaked)
 *    - Last-message preview showing a date string instead of real dialogue
 *
 * The scheduled automation "Daily Date Marker — Midnight" has been archived.
 * The UI date divider rendering (DateSeparator component + injectDateSeparators) is unaffected.
 *
 * This function is kept as a stub so the archived automation reference does not break.
 * It does nothing and writes nothing.
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return Response.json({
    success: true,
    message: 'createDailyDateMarker is deprecated. Date dividers are UI-only, derived from message timestamps. No Message records were created.',
    records_created: 0,
  });
});