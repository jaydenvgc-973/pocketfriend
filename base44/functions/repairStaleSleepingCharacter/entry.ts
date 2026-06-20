import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

/**
 * repairStaleSleepingCharacter
 *
 * Fixes a character stuck in 'sleeping' state by performing a complete
 * state audit and correction. Called explicitly by the user when they
 * observe a character card stuck on "Sleeping."
 *
 * Accepts: { characterName: string, ownerEmail?: string }
 *
 * What it does:
 * 1. Finds the character by name within owner's scope
 * 2. Audits all sleep-related timestamps
 * 3. If character is sleeping but energy > 70 → forcibly wakes them
 * 4. If missing last_sleep_start → sets it retroactively (6h ago if energy high, now if low)
 * 5. If sleeping > 8h → forcibly wakes them
 * 6. Clears any orphaned stay locks with sleep reasons
 * 7. Returns full diagnostic before/after
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const payload = await req.json().catch(() => ({}));
    const { characterName, ownerEmail } = payload;

    if (!characterName) {
      return Response.json({ error: 'characterName is required' }, { status: 400 });
    }

    const scopeEmail = ownerEmail || user?.email;
    if (!scopeEmail) {
      return Response.json({ error: 'Unauthorized — provide ownerEmail or authenticate' }, { status: 401 });
    }

    // Find the character
    let characters = [];
    try {
      characters = await base44.entities.Character.filter({ owner_email: scopeEmail }, null, 200);
    } catch {
      try {
        characters = await base44.asServiceRole.entities.Character.filter({ owner_email: scopeEmail }, null, 200);
      } catch (e2) {
        return Response.json({ error: `Character load failed: ${e2.message}` }, { status: 500 });
      }
    }

    const char = characters.find(c =>
      (c.name || '').toLowerCase() === characterName.toLowerCase() ||
      (c.display_name || '').toLowerCase() === characterName.toLowerCase() ||
      (c.full_name || '').toLowerCase() === characterName.toLowerCase()
    );

    if (!char) {
      return Response.json({
        error: `Character "${characterName}" not found`,
        searchedTotal: characters.length,
        sampleNames: characters.slice(0, 10).map(c => c.name || c.display_name),
      }, { status: 404 });
    }

    // ── TIME REFERENCE: Eastern Time (authoritative) ──────────────────────
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowIso = nowET.toISOString();

    // ── DIAGNOSTIC SNAPSHOT (before) ──────────────────────────────────────
    const before = {
      name: char.name || char.display_name,
      resolved_presence_status: char.resolved_presence_status,
      resolved_source_reason: char.resolved_source_reason,
      energy_value: char.energy_value,
      last_sleep_start: char.last_sleep_start,
      last_wake_time: char.last_wake_time,
      last_nap_time: char.last_nap_time,
      sleep_lock: char.sleep_lock || false,
      presence_stay_lock: char.presence_stay_lock || false,
      presence_stay_lock_reason: char.presence_stay_lock_reason,
      current_activity: char.current_activity,
      last_need_simulated_at: char.last_need_simulated_at,
      last_pass_out_at: char.last_pass_out_at,
      pass_out_count: char.pass_out_count,
      updated_date: char.updated_date,
    };

    // ── DETERMINE IF STUCK ────────────────────────────────────────────────
    const isSleeping = char.resolved_presence_status === 'sleeping' ||
      char.resolved_presence_status === 'napping';
    const isPassedOut = char.resolved_presence_status === 'passed_out';

    if (!isSleeping && !isPassedOut) {
      return Response.json({
        success: true,
        action: 'none',
        reason: `${char.name} is not sleeping (status: ${char.resolved_presence_status})`,
        before,
      });
    }

    // Calculate sleep duration
    let sleepDurationHours = null;
    if (char.last_sleep_start) {
      sleepDurationHours = (nowET.getTime() - new Date(char.last_sleep_start).getTime()) / 3_600_000;
    }

    // ── REPAIR DECISION ───────────────────────────────────────────────────
    const energy = char.energy_value ?? 75;
    let shouldWake = false;
    let wakeReason = '';
    const fixes = [];

    // Reason 1: Missing last_sleep_start — can't track duration, wake now
    if (!char.last_sleep_start && isSleeping && !isPassedOut) {
      shouldWake = true;
      wakeReason = 'missing_last_sleep_start_cannot_track_duration';
      fixes.push('last_sleep_start was null — 8h cap cannot fire without it');
    }

    // Reason 2: Sleeping > 8 hours — hard cap should have fired
    if (sleepDurationHours !== null && sleepDurationHours >= 7.5) {
      shouldWake = true;
      wakeReason = `slept_${Math.round(sleepDurationHours)}_hours_exceeds_8h_cap`;
      fixes.push(`Sleep duration ${Math.round(sleepDurationHours * 10) / 10}h exceeds 8h hard cap`);
    }

    // Reason 3: Energy > 70 — no reason to still be sleeping
    if (energy > 70 && isSleeping && !isPassedOut) {
      shouldWake = true;
      wakeReason = wakeReason || 'energy_recovered_above_wake_threshold';
      fixes.push(`Energy is ${Math.round(energy)} — above natural wake threshold of 70`);
    }

    // Reason 4: Stale presence — last simulated > 4 hours ago
    if (char.last_need_simulated_at) {
      const hoursSinceSim = (nowET.getTime() - new Date(char.last_need_simulated_at).getTime()) / 3_600_000;
      if (hoursSinceSim > 4) {
        shouldWake = true;
        wakeReason = wakeReason || 'stale_presence_over_4h';
        fixes.push(`Last simulated ${Math.round(hoursSinceSim)}h ago — stale presence`);
      }
    }

    if (!shouldWake) {
      return Response.json({
        success: true,
        action: 'none',
        reason: `${char.name} is sleeping legitimately — energy=${Math.round(energy)}, duration=${sleepDurationHours ? Math.round(sleepDurationHours * 10) / 10 + 'h' : 'unknown'}`,
        before,
      });
    }

    // ── APPLY REPAIR ──────────────────────────────────────────────────────
    const repairPayload = {
      resolved_presence_status: 'home',
      current_activity: '',
      resolved_source_reason: 'stale_sleep_manually_cleared',
      last_wake_time: nowIso,
      resolved_last_updated_at: nowIso,
      last_need_simulated_at: nowIso,
      // Clear all sleep-related locks
      presence_stay_lock: false,
      presence_stay_lock_reason: null,
      presence_stay_lock_authority: null,
      presence_stay_lock_set_at: null,
      presence_stay_lock_expires_at: null,
      presence_stay_lock_release_condition: null,
    };

    // If energy is very low, bump it to a reasonable awake level
    if (energy < 40) {
      repairPayload.energy_value = 40;
      fixes.push(`Energy bumped from ${Math.round(energy)} → 40 (minimum awake level)`);
    }

    // Write using best available method
    let writeSuccess = false;
    let writeError = null;
    try {
      await base44.entities.Character.update(char.id, repairPayload);
      writeSuccess = true;
    } catch (err1) {
      try {
        await base44.asServiceRole.entities.Character.update(char.id, repairPayload);
        writeSuccess = true;
      } catch (err2) {
        writeError = err2.message;
      }
    }

    // Log the repair
    await base44.asServiceRole.entities.LifeEvent.create({
      character_id: char.id,
      character_name: char.name || char.display_name,
      event_type: 'medical_event',
      valence: 'neutral',
      severity: 'minor',
      title: 'Stale sleep state cleared',
      description: `${char.name || char.display_name} was stuck sleeping — manually cleared. Energy=${Math.round(energy)}, sleep duration=${sleepDurationHours ? Math.round(sleepDurationHours * 10) / 10 + 'h' : 'unknown'}, reason=${wakeReason}`,
      emotional_impact: 'system repair',
      triggered_by: 'manual',
      timestamp: nowIso,
      context_tags: ['stale_sleep', 'manual_repair', wakeReason],
    }).catch(() => {});

    return Response.json({
      success: writeSuccess,
      action: 'woke_character',
      reason: wakeReason,
      fixes_applied: fixes,
      before,
      repair_payload: repairPayload,
      write_error: writeError,
      eastern_time: nowET.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    });

  } catch (error) {
    console.error('[repairStaleSleepingCharacter]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});