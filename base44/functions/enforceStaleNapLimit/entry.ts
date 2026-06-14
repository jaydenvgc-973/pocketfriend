/**
 * enforceStaleNapLimit
 * 
 * HARD RULES:
 * 1. Naps are temporary. Max 3 hours. After that, wake the character.
 * 2. Naps must have: nap_start_time, nap_reason, expected_wake_time
 * 3. If napping > 3 hours with no proof of medical/unconscious reason, WAKE THEM.
 * 4. If resolved_presence_status = 'napping' but no nap_start_time, mark stale and wake.
 * 5. Sleep mode allowed ONLY within scheduled sleep window OR with explicit recovery reason.
 * 6. Emotional states (depression, stress, sadness, low social) do NOT justify sleep.
 * 7. If current time > wake_up_time + grace period (30 min) with no valid proof, wake them.
 * 
 * NO EXCUSES. NO EMOTIONAL-STATE SLEEP. ENFORCE HARD.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { dry_run = false } = await req.json();

    const nowUtc = new Date();
    const nowEt = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowEtMin = nowEt.getHours() * 60 + nowEt.getMinutes();
    const nowEtIso = nowEt.toISOString();

    console.log(`[enforceStaleNapLimit] RUN START (dry_run=${dry_run})`);
    console.log(`[enforceStaleNapLimit] ET now: ${nowEt.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`);

    // Fetch all sleeping/napping characters
    const sleeping = await base44.asServiceRole.entities.Character.filter(
      { $or: [{ resolved_presence_status: 'sleeping' }, { resolved_presence_status: 'napping' }] },
      '-resolved_last_updated_at',
      500
    ).catch(() => []);

    console.log(`[enforceStaleNapLimit] Found ${sleeping.length} sleeping/napping characters`);

    const violations = [];
    const woken = [];

    for (const char of sleeping) {
      const isNap = char.resolved_presence_status === 'napping';
      const isOwnerVerified = char.owner_email ? true : false;

      // ── NAP DURATION ENFORCEMENT ──────────────────────────────────────
      if (isNap && char.last_nap_time) {
        const napStart = new Date(char.last_nap_time);
        const napDurationMs = nowUtc.getTime() - napStart.getTime();
        const napDurationHours = napDurationMs / 3600000;

        if (napDurationHours > 3) {
          violations.push({
            character_id: char.id,
            character_name: char.name,
            reason: `Napping for ${Math.round(napDurationHours * 10) / 10} hours (exceeds 3-hour max)`,
            action: 'WAKE',
          });

          if (!dry_run) {
            const wasActualSleep = char.resolved_presence_status === 'sleeping';
            const napWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              current_activity: 'just woke up (nap time exceeded)',
              emotional_state: 'neutral',
              resolved_last_updated_at: nowEtIso,
            };
            // Nap wake does NOT write last_wake_time
            if (wasActualSleep) {
              napWakePayload.last_wake_time = nowEtIso;
            }
            await base44.asServiceRole.entities.Character.update(char.id, napWakePayload).catch(e => console.error(`Update failed: ${e.message}`));

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — nap exceeded 3 hours`);
          }
          continue;
        }
      }

      // ── STALE NAP (no start time) ─────────────────────────────────────
      if (isNap && !char.last_nap_time) {
        violations.push({
          character_id: char.id,
          character_name: char.name,
          reason: 'Marked napping but no nap_start_time (stale)',
          action: 'WAKE',
        });

        if (!dry_run) {
          const wasActualSleepStale = char.resolved_presence_status === 'sleeping';
            const staleWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              resolved_last_updated_at: nowEtIso,
            };
            // Nap wake does NOT write last_wake_time
            if (wasActualSleepStale) {
              staleWakePayload.last_wake_time = nowEtIso;
            }
            await base44.asServiceRole.entities.Character.update(char.id, staleWakePayload).catch(e => console.error(`Update failed: ${e.message}`));

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — stale nap state`);
        }
        continue;
      }

      // ── PAST SCHEDULED WAKE TIME ──────────────────────────────────────
      const wakeMin = toMinutes(char.wake_up_time);
      const graceMin = 30; // 30 min after wake time before forced wake

      if (wakeMin !== null && nowEtMin > wakeMin + graceMin) {
        // Past scheduled wake time + grace period. Do they have a valid recovery reason?
        const validSleepReasons = [
          'medical_unconscious',
          'medical_coma',
          'jail_sleep',
          'house_arrest_sleep',
          'medical_emergency_recovery',
          'scheduled_overnight_work',
        ];

        const hasValidReason = validSleepReasons.some(r => 
          (char.resolved_source_reason || '').includes(r)
        );

        if (!hasValidReason) {
          violations.push({
            character_id: char.id,
            character_name: char.name,
            reason: `Past scheduled wake time (${char.wake_up_time}) + 30min grace. No valid recovery reason.`,
            action: 'WAKE',
          });

          if (!dry_run) {
            const wasActualSleepLate = char.resolved_presence_status === 'sleeping';
            const lateWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              current_activity: 'woke up late',
              resolved_last_updated_at: nowEtIso,
            };
            // Nap wake does NOT write last_wake_time
            if (wasActualSleepLate) {
              lateWakePayload.last_wake_time = nowEtIso;
            }
            await base44.asServiceRole.entities.Character.update(char.id, lateWakePayload).catch(e => console.error(`Update failed: ${e.message}`));

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — past wake time, no valid reason`);
          }
          continue;
        }
      }
    }

    console.log(`[enforceStaleNapLimit] Violations: ${violations.length} | Woken: ${woken.length}`);

    return Response.json({
      success: true,
      dry_run,
      et_now: nowEt.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      total_sleeping_checked: sleeping.length,
      violations_found: violations.length,
      characters_woken: woken.length,
      violations,
      action: dry_run ? 'DRY RUN — no changes made' : `ENFORCED: Woke ${woken.length} characters`,
    });

  } catch (error) {
    console.error('[enforceStaleNapLimit] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});