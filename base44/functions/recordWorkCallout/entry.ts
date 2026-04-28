import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * recordWorkCallout
 *
 * Creates a WorkException record and stamps the Character with work_exception_status/date
 * so the location resolution engine can skip work schedule for today.
 *
 * Required body:
 *   character_id    — ID of the character calling out
 *   callout_reason  — reason string
 *   source_context  — where this came from ("chat", "travel", "manual")
 *
 * Optional:
 *   work_location_id — override workplace (defaults to character.occupation_location_id)
 */

function getTodayET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))
    .toISOString().slice(0, 10);
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { character_id, callout_reason, source_context, work_location_id } = body;

    if (!character_id || !callout_reason) {
      return Response.json({ error: 'character_id and callout_reason are required' }, { status: 400 });
    }

    // Load character
    const chars = await base44.entities.Character.filter({ id: character_id });
    if (!chars.length) return Response.json({ error: 'Character not found' }, { status: 404 });
    const char = chars[0];

    // Confirm ownership
    if (char.owner_email !== user.email && char.created_by !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const workLocId = work_location_id || char.occupation_location_id;
    if (!workLocId) {
      return Response.json({ error: 'Character has no linked work location' }, { status: 400 });
    }

    const todayET = getTodayET();
    const nowISO = new Date().toISOString();

    // Determine scheduled shift times
    const scheduledStart = char.work_start_time || null;
    const scheduledEnd = char.work_end_time || null;

    // Compute notice window: how many minutes before shift start is callout being filed?
    let calloutStatus = 'called_out';
    let calloutNoticeMinutes = null;

    if (scheduledStart) {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const nowMinutes = nowET.getHours() * 60 + nowET.getMinutes();
      const startMinutes = toMinutes(scheduledStart);
      calloutNoticeMinutes = startMinutes - nowMinutes;

      // Notice window: 2 hours (120 minutes) before shift start
      if (calloutNoticeMinutes < 120 && calloutNoticeMinutes > -30) {
        // Less than 2 hours notice but not already past shift
        calloutStatus = 'late_callout';
      } else if (calloutNoticeMinutes <= -30) {
        // Shift started more than 30 min ago and no callout — no_call_no_show territory
        // Still allow the record, but mark accordingly
        calloutStatus = 'no_call_no_show';
      }
      // calloutNoticeMinutes >= 120 → valid on-time callout → 'called_out'
    }

    // Create the WorkException record
    const exceptionRecord = await base44.entities.WorkException.create({
      character_id,
      work_location_id: workLocId,
      exception_date: todayET,
      scheduled_start_time: scheduledStart,
      scheduled_end_time: scheduledEnd,
      callout_created_at: nowISO,
      callout_reason,
      callout_status: calloutStatus,
      callout_notice_minutes: calloutNoticeMinutes,
      approved_by_system: calloutStatus === 'called_out',
      source_context: source_context || 'manual',
      owner_email: user.email,
    });

    // Stamp Character fields so resolution engine can read them synchronously
    // Only stamp if it's a valid callout — late/no-show still gets recorded but doesn't grant bypass
    if (calloutStatus === 'called_out') {
      await base44.entities.Character.update(character_id, {
        work_exception_status: 'called_out',
        work_exception_date: todayET,
        work_exception_id: exceptionRecord.id,
      });
    }

    return Response.json({
      success: true,
      callout_status: calloutStatus,
      callout_notice_minutes: calloutNoticeMinutes,
      exception_id: exceptionRecord.id,
      approved: calloutStatus === 'called_out',
      message: calloutStatus === 'called_out'
        ? 'Callout accepted. Character is now available for today.'
        : calloutStatus === 'late_callout'
        ? 'Late callout recorded. Character is still marked busy but absence is logged.'
        : 'No-call/no-show recorded. Character is marked as missed shift.',
    });

  } catch (error) {
    console.error('[recordWorkCallout]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});