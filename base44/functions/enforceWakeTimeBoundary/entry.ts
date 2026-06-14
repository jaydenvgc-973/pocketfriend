import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ENFORCE WAKE TIME BOUNDARY
 *
 * Authoritative wake-time check for ALL active_created_characters.
 * Runs every 5 minutes. This is a STATE CHECK, not a transition trigger.
 *
 * Hard rule: If a character is marked sleeping/napping past their wake_up_time
 * with no valid medical/confinement reason, WAKE THEM IMMEDIATELY.
 *
 * This is the system-level guarantee that a missed transition event
 * does not trap a character in a stale sleep state.
 */

const VALID_SLEEP_EXCEPTIONS = [
  'hospitalized',
  'incarcerated',
  'confined',
  'house_arrest',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    try { await base44.auth.me(); } catch { /* scheduled execution */ }

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
    const nowETIso = nowET.toISOString();

    console.log(`[enforceWakeTimeBoundary] Running at ${nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} Eastern`);

    // Load all characters. Try user-scoped first, then service role.
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter({ status: 'active' }, null, 500);
    } catch {
      allChars = await base44.asServiceRole.entities.Character.filter({ status: 'active' }, null, 500);
    }

    // Filter to active_created_character OR legacy characters (missing character_type but with owner_email)
    const eligibleChars = allChars.filter(c =>
      c.character_type === 'active_created_character' ||
      (!c.character_type && c.owner_email && c.status === 'active')
    );

    if (eligibleChars.length === 0) {
      return Response.json({ success: true, woken: 0, message: 'No eligible characters found', et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }) });
    }

    const results = [];
    let wokenCount = 0;

    for (const char of eligibleChars) {
      // Skip if not sleeping/napping
      if (!['sleeping', 'napping'].includes(char.resolved_presence_status)) continue;

      // Skip if valid exception (hospitalized, jailed, house arrest, etc.)
      if (VALID_SLEEP_EXCEPTIONS.includes(char.resolved_presence_status)) continue;
      if (char.is_jailed || char.house_arrest_active) continue;

      // Skip if sleep_lock is explicitly on (Vick Servicio only)
      if (char.sleep_lock === true) continue;

      // Parse wake_up_time (default 07:00)
      const wakeTime = char.wake_up_time || '07:00';
      const [wakeH, wakeM] = wakeTime.split(':').map(Number);
      if (isNaN(wakeH) || isNaN(wakeM)) continue;
      const wakeMinutes = wakeH * 60 + wakeM;

      // Only wake if current time is PAST wake_up_time
      if (currentMinutes < wakeMinutes) continue;

      // Only wake if at least 15 minutes past wake time (avoid premature wake from clock skew)
      if (currentMinutes < wakeMinutes + 15) continue;

      // WAKE THEM
      const wasActualSleep = char.resolved_presence_status === 'sleeping';
      const wakePayload = {
        resolved_presence_status: 'home',
        resolved_location_type: 'home',
        location_status: 'home',
        current_activity: null,
        resolved_source_reason: 'wake_time_boundary_enforcement',
        resolved_last_updated_at: nowETIso,
        sleep_interrupted_at: nowETIso,
      };
      // Only actual-sleep wake writes last_wake_time. Nap wake does not reset the 19h awake timer.
      if (wasActualSleep) {
        wakePayload.last_wake_time = nowETIso;
      }

      try {
        try {
          await base44.entities.Character.update(char.id, wakePayload);
        } catch {
          await base44.asServiceRole.entities.Character.update(char.id, wakePayload);
        }
        results.push({
          character_id: char.id,
          character_name: char.name,
          was_status: char.resolved_presence_status,
          wake_up_time: wakeTime,
          previous_activity: char.current_activity || 'none',
          woken: true,
        });
        wokenCount++;
        console.log(`[enforceWakeTimeBoundary] WOKE ${char.name} | was=${char.resolved_presence_status} | wake_time=${wakeTime} | activity=${char.current_activity}`);
      } catch (err) {
        console.error(`[enforceWakeTimeBoundary] FAILED to wake ${char.name}: ${err.message}`);
        results.push({
          character_id: char.id,
          character_name: char.name,
          woken: false,
          error: err.message,
        });
      }
    }

    return Response.json({
      success: true,
      et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      et_hour: nowET.getHours(),
      total_checked: eligibleChars.length,
      sleeping_count: eligibleChars.filter(c => ['sleeping', 'napping'].includes(c.resolved_presence_status)).length,
      woken: wokenCount,
      results,
    });

  } catch (error) {
    console.error('[enforceWakeTimeBoundary] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});