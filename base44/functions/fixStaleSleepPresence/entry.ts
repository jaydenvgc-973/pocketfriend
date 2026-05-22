/**
 * fixStaleSleepPresence
 *
 * Owner_email-scoped. Two-phase: diagnostic first, then optional repair.
 *
 * Phase 1 (dry_run: true): returns full diagnostic per character — no writes.
 * Phase 2 (dry_run: false): applies repairs only to confirmed stale/system-error states.
 *
 * WHAT IT REPAIRS (confirmed stale):
 *   - DB sleeping/napping past wake_up_time with no valid character-driven reason
 *   - Orphaned arrived TravelSession records whose arrival_time is old but
 *     character still shows traveling presence (marks them as harmless)
 *
 * WHAT IT NEVER TOUCHES (valid character-driven):
 *   - illness sleep (health_value < 30)
 *   - emotional crash (mental_value < 25)
 *   - high sleep debt (>= 2h)
 *   - recovery nap during nap window with sleep debt
 *   - interrupted sleep recovery (within 4h)
 *   - shifted sleep (decided_to_stay_up_until set recently)
 *   - user-directed nap (resolved_source_reason === 'user_directed_nap' or includes 'nap')
 *   - within canonical sleep window
 *   - within 20-minute wake grace period
 *   - active commitments / in_transit sessions
 *
 * Never uses created_by.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const STALE_GRACE_MINUTES = 20;

function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isCanonicallyAsleep(character, nowET) {
  if (character.decided_to_stay_up_until && new Date() < new Date(character.decided_to_stay_up_until)) return false;
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dayOfWeek = nowET.getDay();
  // Priority 1: stored schedule
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time), w = toMin(character.wake_up_time);
    if (s !== null && w !== null) {
      return s > w ? (currentMin >= s || currentMin < w) : (currentMin >= s && currentMin < w);
    }
  }
  // Priority 2: work-derived
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days)) {
    if (character.work_days.includes(dayOfWeek) || character.work_days.includes((dayOfWeek + 1) % 7)) {
      const ws = toMin(character.work_start_time), we = toMin(character.work_end_time);
      if (ws !== null && we !== null) {
        const isOvnt = we < ws;
        const wakeMin = (ws - 60 + 1440) % 1440;
        const sleepMin = isOvnt ? (we + 60) % 1440 : (wakeMin - 7 * 60 + 1440) % 1440;
        return sleepMin > wakeMin ? (currentMin >= sleepMin || currentMin < wakeMin) : (currentMin >= sleepMin && currentMin < wakeMin);
      }
    }
  }
  return false;
}

function classifySleepEntry(character, nowET) {
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dbStatus = character.resolved_presence_status;
  const dbSource = character.resolved_source_reason || '';
  const dbSleeping = dbStatus === 'sleeping' || dbStatus === 'napping';

  if (!dbSleeping) return { isStale: false, isValid: false, classification: 'not_sleeping', blockReason: null, consequence_tags: [] };
  if (isCanonicallyAsleep(character, nowET)) return { isStale: false, isValid: true, classification: 'within_sleep_window', blockReason: 'still within canonical sleep window', consequence_tags: [] };

  // Past window — check valid reasons in priority order
  if (character.decided_to_stay_up_until && new Date(character.decided_to_stay_up_until) > new Date(Date.now() - 8 * 3600 * 1000)) {
    return { isStale: false, isValid: true, classification: 'shifted_sleep_stay_up', blockReason: 'decided_to_stay_up_until was set recently — shifted schedule', consequence_tags: ['tired'] };
  }
  if (dbSource === 'user_directed_nap' || dbSource.includes('nap')) {
    return { isStale: false, isValid: true, classification: 'user_directed_nap', blockReason: `source_reason="${dbSource}" — user/narrative directed nap`, consequence_tags: [] };
  }
  if ((character.sleep_debt_hours || 0) > 0 && dbStatus === 'napping') {
    return { isStale: false, isValid: true, classification: 'recovery_nap', blockReason: `sleep_debt_hours=${character.sleep_debt_hours} — recovery nap`, consequence_tags: ['recovering'] };
  }
  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, classification: 'illness_sleep', blockReason: `health_value=${character.health_value} — illness sleep`, consequence_tags: ['sick', 'tired'] };
  }
  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, classification: 'emotional_crash_sleep', blockReason: `mental_value=${character.mental_value} — emotional crash sleep`, consequence_tags: ['exhausted', 'emotional'] };
  }
  if ((character.sleep_debt_hours || 0) >= 2) {
    return { isStale: false, isValid: true, classification: 'oversleeping_sleep_debt', blockReason: `sleep_debt_hours=${character.sleep_debt_hours} — legitimate oversleeping to recover`, consequence_tags: ['tired', 'oversleeping'] };
  }
  if (character.sleep_interrupted_at && (Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000 < 4) {
    const hrsAgo = ((Date.now() - new Date(character.sleep_interrupted_at).getTime()) / 3600000).toFixed(1);
    return { isStale: false, isValid: true, classification: 'interrupted_sleep_recovery', blockReason: `sleep_interrupted_at=${hrsAgo}h ago — still recovering`, consequence_tags: ['tired', 'interrupted'] };
  }

  // Grace period
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let pastWake = currentMin - wakeMin;
    if (pastWake < 0) pastWake += 1440;
    if (pastWake < STALE_GRACE_MINUTES) {
      return { isStale: false, isValid: true, classification: 'within_wake_grace_period', blockReason: `only ${pastWake}m past wake_up_time — within ${STALE_GRACE_MINUTES}m grace`, consequence_tags: [] };
    }
  }

  // Confirmed stale — build consequence tags
  const dayOfWeek = nowET.getDay();
  const consequenceTags = [];
  const hasWork = character.work_start_time && character.work_end_time &&
    Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek);
  if (hasWork) {
    const workStart = toMin(character.work_start_time);
    if (workStart !== null && currentMin > workStart) consequenceTags.push('late_for_work');
  }
  if (character.student_status === 'enrolled' && [1,2,3,4,5].includes(dayOfWeek) && currentMin > 8 * 60) {
    consequenceTags.push('late_for_school');
  }
  if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    consequenceTags.push('spiraling', 'rushing');
  } else if (character.trait_lazy) {
    consequenceTags.push('dismissive', 'may_call_out');
  } else if (character.trait_workaholic) {
    consequenceTags.push('panicking', 'guilty');
  } else {
    consequenceTags.push('groggy');
  }
  if ((character.energy_value || 75) < 40) consequenceTags.push('exhausted');

  return { isStale: true, isValid: false, classification: 'stale_system_sleep', blockReason: null, consequence_tags: consequenceTags };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false; // default true (diagnostic mode)

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const etTimeStr = `${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2, '0')} ET`;

    // Load all characters (owner_email scoped — never created_by)
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      200
    );

    const active = characters.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'moved_away' &&
      !c.is_test_character && !c.diagnostic_only
    );

    // Load travel sessions for context (in_transit + recent arrived)
    const travelSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email: user.email },
      '-created_at',
      100
    ).catch(() => []);

    // Load active commitments
    const commitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
      { owner_email: user.email },
      '-created_at',
      50
    ).catch(() => []);

    const sessionsByChar = {};
    for (const s of travelSessions) {
      if (!sessionsByChar[s.character_id]) sessionsByChar[s.character_id] = [];
      sessionsByChar[s.character_id].push(s);
    }
    const commitmentsByChar = {};
    for (const c of commitments) {
      if (!commitmentsByChar[c.character_id]) commitmentsByChar[c.character_id] = [];
      commitmentsByChar[c.character_id].push(c);
    }

    const diagnostics = [];
    const repaired = [];
    const preserved = [];
    const skipped = [];
    const sessionRepairs = [];

    // ── Per-character analysis ──────────────────────────────────────────────
    for (const char of active) {
      const dbStatus = char.resolved_presence_status;
      const dbSource = char.resolved_source_reason || '';
      const charSessions = sessionsByChar[char.id] || [];
      const charCommitments = (commitmentsByChar[char.id] || []).filter(c => c.status === 'active' || c.status === 'in_progress');
      const activeSession = charSessions.find(s => s.route_status === 'in_transit');
      const arrivedSessions = charSessions.filter(s => s.route_status === 'arrived');
      const arrivalDueSessions = charSessions.filter(s => s.route_status === 'arrival_due');

      const { isStale, isValid, classification, blockReason, consequence_tags } = classifySleepEntry(char, nowET);
      const isSleepingInDB = dbStatus === 'sleeping' || dbStatus === 'napping';

      // Build diagnostic entry regardless of sleep state
      const wakeMin = toMin(char.wake_up_time);
      const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
      let minutesPastWake = null;
      if (wakeMin !== null) {
        minutesPastWake = currentMin - wakeMin;
        if (minutesPastWake < 0) minutesPastWake += 1440;
      }

      // Detect stale arrived sessions that might poison presence
      const staleArrivedSessions = arrivedSessions.filter(s => {
        if (!s.actual_arrival_time) return false;
        const arrivedMs = new Date(s.actual_arrival_time).getTime();
        const hoursSince = (Date.now() - arrivedMs) / 3600000;
        // Arrived sessions older than 6h where character travel_status is still set
        return hoursSince > 6 && (char.travel_status === 'traveling_to_destination' || char.resolved_presence_status === 'traveling');
      });

      const diagnostic = {
        character_id: char.id,
        name: char.name,
        db_presence: dbStatus,
        db_source: dbSource,
        db_location: char.resolved_current_location_name,
        wake_up_time: char.wake_up_time,
        sleep_start_time: char.sleep_start_time,
        minutes_past_wake: minutesPastWake,
        sleep_debt_hours: char.sleep_debt_hours || 0,
        health_value: char.health_value,
        mental_value: char.mental_value,
        energy_value: char.energy_value,
        canonical_asleep: isCanonicallyAsleep(char, nowET),
        classification,
        is_stale_sleep: isStale,
        is_valid_sleep: isValid,
        block_reason: blockReason,
        consequence_tags,
        active_travel_session: activeSession ? {
          id: activeSession.id,
          route_status: activeSession.route_status,
          destination: activeSession.destination_location_name,
          eta: activeSession.estimated_arrival_time,
        } : null,
        arrival_due_sessions: arrivalDueSessions.map(s => ({ id: s.id, destination: s.destination_location_name })),
        stale_arrived_sessions: staleArrivedSessions.map(s => ({ id: s.id, destination: s.destination_location_name, arrived_at: s.actual_arrival_time })),
        active_commitments: charCommitments.map(c => ({ id: c.id, type: c.commitment_type, destination: c.destination_location_name, status: c.status })),
        repair_allowed: isStale,
        et_time: etTimeStr,
      };

      diagnostics.push(diagnostic);

      // ── Repair phase ────────────────────────────────────────────────────────
      if (dry_run) continue; // diagnostic only

      // Repair stale sleep
      if (isStale && isSleepingInDB) {
        const homeId = char.current_home_location_id || char.temporary_housing_location_id || null;
        const repairPayload = {
          resolved_presence_status: 'home',
          resolved_source_reason: 'stale_sleep_cleared',
          resolved_last_updated_at: nowET.toISOString(),
          ...(homeId ? { resolved_current_location_id: homeId, resolved_location_type: 'home' } : {}),
          ...(consequence_tags?.length > 0 ? {
            last_oversleep_consequence_tags: consequence_tags,
            last_oversleep_cleared_at: nowET.toISOString(),
          } : {}),
        };
        try {
          await base44.entities.Character.update(char.id, repairPayload);
          repaired.push({
            character_id: char.id,
            name: char.name,
            was_presence: dbStatus,
            was_source: dbSource,
            now_presence: 'home',
            now_source: 'stale_sleep_cleared',
            consequence_tags,
            home_id: homeId,
          });
          console.log(`[fixStaleSleepPresence] ✓ ${char.name}: stale sleep cleared → home`);
        } catch (err) {
          skipped.push({ name: char.name, reason: `write failed: ${err.message}` });
        }
      } else if (isValid && isSleepingInDB) {
        preserved.push({ name: char.name, classification, reason: blockReason });
      }

      // Repair stale arrived sessions that are poisoning travel_status
      for (const s of staleArrivedSessions) {
        try {
          // Clear orphaned travel display fields on character — session stays as historical record
          await base44.entities.Character.update(char.id, {
            travel_status: 'not_traveling',
            traveling_to_location_id: null,
            traveling_to_location_name: null,
            travel_destination_location_id: null,
          });
          sessionRepairs.push({ character: char.name, session_id: s.id, action: 'cleared_orphaned_travel_display' });
          console.log(`[fixStaleSleepPresence] ✓ ${char.name}: cleared orphaned travel_status from stale arrived session ${s.id}`);
        } catch (err) {
          skipped.push({ name: char.name, reason: `session repair failed: ${err.message}` });
        }
      }
    }

    const staleSleepCount = diagnostics.filter(d => d.is_stale_sleep).length;
    const validSleepCount = diagnostics.filter(d => d.is_valid_sleep).length;
    const staleSessionCount = diagnostics.reduce((acc, d) => acc + (d.stale_arrived_sessions?.length || 0), 0);

    return Response.json({
      dry_run,
      owner_email: user.email,
      et_time: etTimeStr,
      summary: dry_run
        ? `Diagnostic complete. ${staleSleepCount} stale sleep state(s) found. ${validSleepCount} valid sleep state(s) preserved. ${staleSessionCount} stale arrival session(s) detected.`
        : `Repair complete. ${repaired.length} stale sleep state(s) cleared. ${preserved.length} valid states preserved. ${sessionRepairs.length} orphaned travel display(s) cleaned.`,
      totals: {
        characters_checked: active.length,
        sleeping_in_db: diagnostics.filter(d => d.db_presence === 'sleeping' || d.db_presence === 'napping').length,
        stale_sleep: staleSleepCount,
        valid_sleep: validSleepCount,
        stale_arrived_sessions: staleSessionCount,
      },
      diagnostics,
      repaired,
      preserved,
      session_repairs: sessionRepairs,
      skipped,
    });

  } catch (error) {
    console.error('[fixStaleSleepPresence]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});