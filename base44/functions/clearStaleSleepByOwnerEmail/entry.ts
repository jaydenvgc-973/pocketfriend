/**
 * clearStaleSleepByOwnerEmail
 * 
 * Finds and wakes characters stuck in stale sleep.
 * Uses owner_email-scoped query (proven working path).
 * 
 * RULES:
 * - Sleep ends at wake_up_time unless proven unconscious
 * - Nap max is 3 hours
 * - Emotional state does NOT justify indefinite sleep
 * - Sleep debt does NOT justify indefinite sleep
 * - Stale sleep = time-based only
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = false } = await req.json();
    const nowUtc = new Date();
    const nowEt = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowIso = nowEt.toISOString();

    console.log(`[clearStaleSleepByOwnerEmail] START owner=${user.email} dry_run=${dry_run}`);

    // Fetch all characters for this owner using PROVEN working path (user-scoped, not service-role)
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );

    console.log(`[clearStaleSleepByOwnerEmail] Found ${allChars.length} total characters`);

    const sleeping = allChars.filter(c => ['sleeping', 'napping'].includes(c.resolved_presence_status));
    console.log(`[clearStaleSleepByOwnerEmail] Sleeping: ${sleeping.length}`);

    const results = {
      total_characters: allChars.length,
      sleeping_characters: sleeping.length,
      dry_run,
      cleared: []
    };

    for (const char of sleeping) {
      const wakeTime = char.wake_up_time || '07:00';
      const [wh, wm] = wakeTime.split(':').map(Number);
      const scheduledWake = new Date(nowEt);
      scheduledWake.setHours(wh, wm, 0, 0);

      const minutesPastWake = (nowEt - scheduledWake) / 60000;
      const isPastWakeTime = minutesPastWake > 0;

      // Nap duration check
      const napDuration = char.last_nap_time ? (nowUtc - new Date(char.last_nap_time)) / 3600000 : null;
      const napExceeded = napDuration && napDuration > 3;

      // Only hard blockers for justified sleep
      const isJailed = char.is_jailed;
      const isHospitalized = char.resolved_location_type === 'hospital';
      const isHouseArrest = char.house_arrest_active;
      const isConfinement = ['incarcerated', 'house_arrest', 'confined'].includes(char.resolved_presence_status);

      const hasHardBlocker = isJailed || isHospitalized || isHouseArrest || isConfinement;

      // STALE SLEEP = past wake_up_time with no hard blocker
      const isStale = isPastWakeTime && !hasHardBlocker;
      const napStale = napExceeded;

      if (!isStale && !napStale) {
        results.cleared.push({
          name: char.name,
          status: 'valid_sleep',
          reason: hasHardBlocker ? `blocked:${char.resolved_presence_status}` : 'within_sleep_window'
        });
        console.log(`[clearStaleSleepByOwnerEmail] KEEP ${char.name} — ${hasHardBlocker ? 'blocked' : 'within_sleep_window'}`);
        continue;
      }

      // CLEAR STALE SLEEP
      if (!dry_run) {
        await base44.entities.Character.update(char.id, {
          resolved_presence_status: 'home',
          location_status: 'home',
          current_activity: 'awake',
          resolved_last_updated_at: nowIso,
          sleep_interrupted_at: nowIso,
          // Keep emotional state — don't hide consequences
        });
        console.log(`[clearStaleSleepByOwnerEmail] CLEARED ${char.name} stale=${isStale} napStale=${napStale}`);
      }

      results.cleared.push({
        name: char.name,
        character_id: char.id,
        action: 'cleared',
        reason: isStale ? `past_wake_time(${Math.round(minutesPastWake)}m)` : `nap_exceeded_3h`,
        was_state: char.resolved_presence_status,
        wake_time: wakeTime
      });
    }

    return Response.json({
      success: true,
      ...results,
      proof: {
        method: 'user-scoped query (service-role path broken)',
        path: 'entities.Character.filter({owner_email})',
        user_email: user.email
      }
    });

  } catch (error) {
    console.error('[clearStaleSleepByOwnerEmail] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});