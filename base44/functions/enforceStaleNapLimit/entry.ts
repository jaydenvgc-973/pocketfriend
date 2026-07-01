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
            const napWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              current_activity: 'just woke up (nap time exceeded)',
              emotional_state: 'neutral',
              resolved_last_updated_at: nowEtIso,
              // A completed nap IS a restorative boundary — it MUST reset the
              // continuous-awake timer. The old "nap wake does NOT write last_wake_time"
              // rule was a bug that caused false 19h pass-out calculations.
              last_wake_time: nowEtIso,
              presence_stay_lock: false,
              presence_stay_lock_reason: null,
              presence_stay_lock_release_condition: null,
              presence_stay_lock_authority: null,
              presence_stay_lock_set_at: null,
              presence_stay_lock_expires_at: null,
            };
            const napWakeRevert = {
              resolved_presence_status: char.resolved_presence_status, location_status: char.location_status,
              current_activity: char.current_activity, emotional_state: char.emotional_state,
              resolved_last_updated_at: char.resolved_last_updated_at, last_wake_time: char.last_wake_time,
              presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
              presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
              presence_stay_lock_authority: char.presence_stay_lock_authority,
              presence_stay_lock_set_at: char.presence_stay_lock_set_at,
              presence_stay_lock_expires_at: char.presence_stay_lock_expires_at,
            };
            await base44.asServiceRole.entities.Character.update(char.id, napWakePayload);
            try {
              await base44.asServiceRole.entities.SleepTransition.create({
                character_id: char.id, character_name: char.name, owner_email: char.owner_email,
                transition_type: 'nap_end', from_status: 'napping', to_status: 'home',
                authority: 'nap_cap_3h',
                reason: `Napping exceeded 3-hour max. last_wake_time reset (restorative boundary).`,
                timestamp: nowEtIso, state_start_ref: char.last_nap_time,
                elapsed_hours: char.last_nap_time ? Math.round(((nowUtc.getTime() - new Date(char.last_nap_time).getTime()) / 3600000) * 100) / 100 : null,
                verified_higher_priority_interrupt: false,
              });
            } catch (transitionError) {
              let revertError = null;
              try { await base44.asServiceRole.entities.Character.update(char.id, napWakeRevert); } catch (e) { revertError = e.message; }
              violations[violations.length - 1].action = 'WAKE_UNVERIFIED_REVERTED';
              console.error(`[enforceStaleNapLimit] nap_end SleepTransition failed for ${char.name} — reverted. transition_error=${transitionError.message} revert_error=${revertError}`);
              continue;
            }

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — nap exceeded 3 hours (last_wake_time written)`);
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
            const staleWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              resolved_last_updated_at: nowEtIso,
              last_wake_time: nowEtIso,
              presence_stay_lock: false,
              presence_stay_lock_reason: null,
              presence_stay_lock_release_condition: null,
              presence_stay_lock_authority: null,
              presence_stay_lock_set_at: null,
              presence_stay_lock_expires_at: null,
            };
            const staleWakeRevert = {
              resolved_presence_status: char.resolved_presence_status, location_status: char.location_status,
              resolved_last_updated_at: char.resolved_last_updated_at, last_wake_time: char.last_wake_time,
              presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
              presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
              presence_stay_lock_authority: char.presence_stay_lock_authority,
              presence_stay_lock_set_at: char.presence_stay_lock_set_at,
              presence_stay_lock_expires_at: char.presence_stay_lock_expires_at,
            };
            await base44.asServiceRole.entities.Character.update(char.id, staleWakePayload);
            try {
              await base44.asServiceRole.entities.SleepTransition.create({
                character_id: char.id, character_name: char.name, owner_email: char.owner_email,
                transition_type: 'nap_end', from_status: 'napping', to_status: 'home',
                authority: 'nap_cap_3h',
                reason: `Stale nap (no start time). last_wake_time reset.`,
                timestamp: nowEtIso,
                verified_higher_priority_interrupt: false,
              });
            } catch (transitionError) {
              let revertError = null;
              try { await base44.asServiceRole.entities.Character.update(char.id, staleWakeRevert); } catch (e) { revertError = e.message; }
              console.error(`[enforceStaleNapLimit] stale-nap SleepTransition failed for ${char.name} — reverted. transition_error=${transitionError.message} revert_error=${revertError}`);
              continue;
            }

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — stale nap state (last_wake_time written)`);
        }
        continue;
      }

      // ── PAST SCHEDULED WAKE TIME ──────────────────────────────────────
      // This section applies to sleeping characters ONLY.
      // Napping characters with a stale start time are handled above (stale nap path).
      // A napping character must NEVER be woken by wake_up_time boundary logic —
      // nap end is governed by the 3h cap above, not by sleep schedule metadata.
      if (isNap) continue; // napping is fully handled above — skip sleep boundary entirely

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
          // ── 6-HOUR MINIMUM SLEEP GUARD ─────────────────────────────────
          // Wake_up_time boundary alone is NOT sufficient to wake a sleeping
          // active_created_character. The character must have slept at least 6 hours.
          // Naps are exempt (naps are short by definition).
          // Medical emergency (health ≤ 15) is the only valid early-wake override.
          const isActualSleep = char.resolved_presence_status === 'sleeping';
          const isMedicalEmergency = (char.health_value ?? 80) <= 15;
          if (isActualSleep && char.last_sleep_start && !isMedicalEmergency) {
            const elapsedSleepHours = (nowUtc.getTime() - new Date(char.last_sleep_start).getTime()) / 3600000;
            if (elapsedSleepHours < 6) {
              console.log(`[enforceStaleNapLimit] 6H_GUARD: ${char.name} slept ${elapsedSleepHours.toFixed(2)}h < 6h — not waking despite past wake_up_time`);
              try {
                await base44.asServiceRole.entities.SleepTransition.create({
                  character_id: char.id, character_name: char.name, owner_email: char.owner_email,
                  transition_type: 'sleep_end', from_status: 'sleeping', to_status: 'sleeping',
                  authority: 'enforceWakeTimeBoundary',
                  reason: `Wake-time boundary reached after ${elapsedSleepHours.toFixed(2)}h sleep — wake blocked by 6h minimum guard. No verified higher-priority interrupt.`,
                  timestamp: nowEtIso, state_start_ref: char.last_sleep_start,
                  elapsed_hours: Math.round(elapsedSleepHours * 100) / 100,
                  verified_higher_priority_interrupt: false,
                });
              } catch (guardLogError) {
                console.error(`[enforceStaleNapLimit] 6h guard SleepTransition audit log FAILED for ${char.name}: ${guardLogError.message}`);
              }
              continue; // skip — do not wake
            }
          }

          violations.push({
            character_id: char.id,
            character_name: char.name,
            reason: `Past scheduled wake time (${char.wake_up_time}) + 30min grace. No valid recovery reason.`,
            action: 'WAKE',
          });

          if (!dry_run) {
            const lateWakePayload = {
              resolved_presence_status: 'home',
              location_status: 'home',
              current_activity: 'woke up late',
              resolved_last_updated_at: nowEtIso,
              last_wake_time: nowEtIso,
              presence_stay_lock: false,
              presence_stay_lock_reason: null,
              presence_stay_lock_release_condition: null,
              presence_stay_lock_authority: null,
              presence_stay_lock_set_at: null,
              presence_stay_lock_expires_at: null,
            };
            const lateWakeRevert = {
              resolved_presence_status: char.resolved_presence_status, location_status: char.location_status,
              current_activity: char.current_activity,
              resolved_last_updated_at: char.resolved_last_updated_at, last_wake_time: char.last_wake_time,
              presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
              presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
              presence_stay_lock_authority: char.presence_stay_lock_authority,
              presence_stay_lock_set_at: char.presence_stay_lock_set_at,
              presence_stay_lock_expires_at: char.presence_stay_lock_expires_at,
            };
            await base44.asServiceRole.entities.Character.update(char.id, lateWakePayload);
            try {
              await base44.asServiceRole.entities.SleepTransition.create({
                character_id: char.id, character_name: char.name, owner_email: char.owner_email,
                transition_type: char.resolved_presence_status === 'napping' ? 'nap_end' : 'sleep_end',
                from_status: char.resolved_presence_status, to_status: 'home',
                authority: 'wake_time_boundary',
                reason: `Past wake time + grace. last_wake_time reset.`,
                timestamp: nowEtIso,
                verified_higher_priority_interrupt: false,
              });
            } catch (transitionError) {
              let revertError = null;
              try { await base44.asServiceRole.entities.Character.update(char.id, lateWakeRevert); } catch (e) { revertError = e.message; }
              console.error(`[enforceStaleNapLimit] late-wake SleepTransition failed for ${char.name} — reverted. transition_error=${transitionError.message} revert_error=${revertError}`);
              continue;
            }

            woken.push(char.id);
            console.log(`[enforceStaleNapLimit] WOKE ${char.name} — past wake time, no valid reason (last_wake_time written)`);
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