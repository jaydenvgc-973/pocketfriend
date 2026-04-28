import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * clearExpiredWorkExceptions
 *
 * Runs daily at midnight ET. Clears work_exception_status/date from any character
 * whose exception_date is no longer today. This ensures callouts don't carry
 * into a new day.
 *
 * Called by scheduled automation.
 */

function getTodayET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled — no session */ }

    const todayET = getTodayET();

    // Find all characters with a work_exception_date that is NOT today
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { status: 'active' }, '-updated_date', 500
    );

    const expired = allChars.filter(c =>
      c.work_exception_status &&
      c.work_exception_date &&
      c.work_exception_date !== todayET
    );

    const cleared = [];
    for (const char of expired) {
      await base44.asServiceRole.entities.Character.update(char.id, {
        work_exception_status: null,
        work_exception_date: null,
        work_exception_id: null,
      });
      cleared.push(char.name);
    }

    return Response.json({
      success: true,
      today: todayET,
      cleared_count: cleared.length,
      cleared,
    });

  } catch (error) {
    console.error('[clearExpiredWorkExceptions]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});