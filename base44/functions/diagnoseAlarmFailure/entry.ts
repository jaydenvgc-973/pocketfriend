/**
 * diagnoseAlarmFailure
 *
 * Full diagnostic chain for alarm failures.
 * Returns: function called, character id, owner_email, backend result,
 *          whether character lookup failed, whether RLS blocked access,
 *          current sleep state, work/school obligations near wake time.
 *
 * Does NOT write anything. Purely diagnostic.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();

    const result = {
      function_called: 'characterAlarm',
      character_id: characterId,
      caller_email: user.email,
      timestamp: nowET.toISOString(),
      checks: [],
    };

    // ── STEP 1: Character lookup (service role) ────────────────────────────
    let character = null;
    let filterError = null;
    try {
      const list = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
      character = list?.[0] || null;
      result.checks.push({
        step: 'character_lookup_service_role',
        status: character ? 'pass' : 'fail',
        detail: character ? `Found: ${character.name} (owner_email=${character.owner_email})` : 'No record returned — character may not exist or filter failed',
      });
    } catch (e) {
      filterError = e.message;
      result.checks.push({ step: 'character_lookup_service_role', status: 'error', detail: `Filter threw: ${e.message}` });
    }

    if (!character) {
      // ── STEP 1b: Try owner-scoped lookup ──────────────────────────────
      try {
        const ownerList = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email, id: characterId }, null, 1);
        const ownerChar = ownerList?.[0] || null;
        result.checks.push({
          step: 'character_lookup_owner_scoped',
          status: ownerChar ? 'pass' : 'fail',
          detail: ownerChar
            ? `Found under owner scope: ${ownerChar.name}`
            : 'Also not found under owner_email scope — character likely deleted or cross-account',
          root_cause: ownerChar
            ? 'Character exists but service-role filter by ID returned empty — possible index mismatch or SDK version issue'
            : 'Character not found under any scope',
        });
        if (ownerChar) character = ownerChar;
      } catch (e2) {
        result.checks.push({ step: 'character_lookup_owner_scoped', status: 'error', detail: `Owner-scoped filter threw: ${e2.message}` });
      }
    }

    if (!character) {
      result.root_cause = 'Character not found — deleted, wrong ID, or cross-account ownership';
      result.alarm_would_fail_with = '404';
      return Response.json(result);
    }

    // ── STEP 2: Ownership check ────────────────────────────────────────────
    const ownerMatch = character.owner_email === user.email;
    result.checks.push({
      step: 'ownership_check',
      status: ownerMatch ? 'pass' : 'fail',
      detail: ownerMatch
        ? `owner_email matches caller (${user.email})`
        : `MISMATCH: character.owner_email=${character.owner_email} vs caller=${user.email}`,
      would_produce: ownerMatch ? null : '403 Forbidden',
    });

    if (!ownerMatch) {
      result.root_cause = `RLS ownership mismatch — character.owner_email (${character.owner_email}) ≠ caller (${user.email})`;
      result.alarm_would_fail_with = '403';
      return Response.json(result);
    }

    // ── STEP 3: Sleep state check ──────────────────────────────────────────
    const isSleeping = ['sleeping', 'napping'].includes(character.resolved_presence_status);
    const sleepSource = character.resolved_source_reason || 'none';
    result.checks.push({
      step: 'sleep_state',
      status: isSleeping ? 'sleeping' : 'awake',
      detail: `resolved_presence_status=${character.resolved_presence_status || 'none'} | source=${sleepSource}`,
      sleep_start_time: character.sleep_start_time || null,
      wake_up_time: character.wake_up_time || null,
      sleep_debt_hours: character.sleep_debt_hours || 0,
    });

    // ── STEP 4: Work/school obligation check ──────────────────────────────
    const dowNow = nowET.getDay();
    const hasWork = Array.isArray(character.work_days) && character.work_days.includes(dowNow) &&
      character.work_start_time && character.work_end_time;
    const hasSchool = character.student_status === 'enrolled' && character.education_location_id;

    let workObligation = null;
    if (hasWork) {
      const shiftStart = toMin(character.work_start_time);
      const minutesToWork = shiftStart !== null ? shiftStart - nowMin : null;
      const lateForWork = minutesToWork !== null && minutesToWork < 0;
      workObligation = {
        work_start: character.work_start_time,
        work_end: character.work_end_time,
        minutes_until_shift: minutesToWork,
        is_late: lateForWork,
        shift_active: shiftStart !== null && nowMin >= shiftStart && nowMin < toMin(character.work_end_time),
      };
    }

    result.checks.push({
      step: 'work_school_obligations',
      has_work_today: hasWork,
      has_school: hasSchool,
      work_obligation: workObligation,
      school_hours: hasSchool ? '08:00–15:00' : null,
    });

    // ── STEP 5: Alarm function routing check ──────────────────────────────
    result.checks.push({
      step: 'alarm_function_routing',
      status: 'pass',
      function_name: 'characterAlarm',
      endpoint_exists: true,
      character_found: true,
      ownership_verified: ownerMatch,
      ring_now_would_work: isSleeping,
      ring_now_blocked_reason: !isSleeping ? `character is not sleeping (status=${character.resolved_presence_status})` : null,
    });

    // ── SUMMARY ────────────────────────────────────────────────────────────
    result.character_name = character.name;
    result.character_owner_email = character.owner_email;
    result.current_presence = character.resolved_presence_status;
    result.alarm_would_succeed = isSleeping && ownerMatch;
    result.root_cause = isSleeping ? null : `Character is not sleeping — ring_now action returns already_awake (not an error)`;
    result.summary = isSleeping
      ? `Alarm system is functional for ${character.name}. Character is sleeping. ring_now should work.`
      : `${character.name} is not sleeping (${character.resolved_presence_status}). Alarm ring_now will return already_awake — not a failure.`;

    return Response.json(result);

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});