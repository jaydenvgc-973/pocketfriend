import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * deepNeedsAudit — SECOND PASS VERIFICATION DIAGNOSTIC
 *
 * Runs AFTER the corrected simulateActiveCharacterNeeds to verify all 6 root-cause fixes
 * are working correctly. Also performs a full new deep-dive for any remaining issues.
 *
 * RC1: corrective activity writer (eating/resting) — verify current_activity is being set
 * RC2: pass-out state writer — verify energy=0 → resolved_presence_status=passed_out
 * RC3: ER escalation ScheduledEvents — verify events are being created
 * RC4: compound crisis forced rest — verify 3+ critical needs → sleeping
 * RC5: stale cap at 8h, asServiceRole writes — verify last_need_simulated_at advances
 * RC6: write failures — verify no silent failures from protected flags
 */

const clamp = (v) => Math.max(0, Math.min(100, v));

const T = {
  HUNGER_CRITICAL: 20,
  ENERGY_PASSOUT:   0,
  ENERGY_CRITICAL: 12,
  HEALTH_ER:       15,
  HEALTH_CRITICAL: 20,
  COMPOUND_CRISIS:  3,
};

function isOnShift(char) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm = 0] = char.work_start_time.split(':').map(Number);
  const [eh, em = 0] = char.work_end_time.split(':').map(Number);
  return char.work_days.includes(now.getDay()) && cur >= sh * 60 + sm && cur < eh * 60 + em;
}

function isSleeping(char) {
  const p = char.resolved_presence_status || '';
  return p === 'sleeping' || p === 'napping' || p === 'passed_out';
}

function isHospitalized(char) {
  const p = char.resolved_presence_status || '';
  return p === 'hospitalized';
}

// ── RC VERIFICATION: check each fix per character ────────────────────────────
function verifyRCFixes(char, recentScheduledEvents, now) {
  const results = {};
  const hunger  = char.hunger_value  ?? 70;
  const energy  = char.energy_value  ?? 75;
  const health  = char.health_value  ?? 80;
  const mental  = char.mental_value  ?? 70;
  const hygiene = char.hygiene_value ?? 75;
  const presence = char.resolved_presence_status || '';
  const activity = char.current_activity || '';
  const sleeping = isSleeping(char);
  const hospitalized = isHospitalized(char);
  const onShift = isOnShift(char);
  const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
  const elapsedH = lastSim ? (now - lastSim) / 3600000 : null;

  const critCount = [hunger, energy, mental, hygiene, health].filter(v => v < 20).length;

  // RC1: Auto-eat should fire if hunger critical and not sleeping/hospitalized
  if (hunger <= T.HUNGER_CRITICAL && !sleeping && !hospitalized) {
    const eatActivityPresent = activity.toLowerCase().includes('eat') || activity.toLowerCase().includes('food') || activity.toLowerCase().includes('hunger');
    results.RC1_auto_eat = {
      expected: 'current_activity contains eating/food',
      actual: activity || '(empty)',
      pass: eatActivityPresent,
      note: eatActivityPresent ? 'PASS — eating activity injected' : 'FAIL — hunger critical but no eating activity set. Check if simulation ran after fix.',
    };
  }

  // RC1: Auto-sleep should fire if energy critical and not on shift and not already sleeping
  if (energy <= T.ENERGY_CRITICAL && !onShift && !sleeping && !hospitalized) {
    results.RC1_auto_sleep = {
      expected: 'resolved_presence_status = sleeping or passed_out',
      actual: presence,
      pass: sleeping || hospitalized,
      note: sleeping ? 'PASS — character is sleeping' : 'FAIL — energy critical but character not sleeping. Simulation may not have run yet or write failed.',
    };
  }

  // RC2: Pass-out — energy=0 must mean presence=passed_out
  if (energy <= T.ENERGY_PASSOUT) {
    const inPassOut = presence === 'passed_out' || sleeping;
    results.RC2_passout_state = {
      expected: 'resolved_presence_status = passed_out or sleeping',
      actual: presence,
      pass: inPassOut,
      note: inPassOut ? 'PASS — character is in pass-out/sleep state' : 'FAIL — energy=0 but not in pass-out state. RC2 fix may not have run yet.',
    };
  }

  // RC3: ER escalation — health ≤ 15 must have a ScheduledEvent or presence=hospitalized
  const healthERThreshold = critCount >= T.COMPOUND_CRISIS ? T.HEALTH_CRITICAL : T.HEALTH_ER;
  if (health <= healthERThreshold && !onShift) {
    const hasEREvent = recentScheduledEvents.some(e =>
      e.description?.toLowerCase().includes('medical') ||
      e.description?.toLowerCase().includes('hospital') ||
      e.description?.toLowerCase().includes('emergency') ||
      e.description?.toLowerCase().includes('discharged')
    );
    results.RC3_er_escalation = {
      expected: 'hospitalized presence OR recent ScheduledEvent for ER discharge',
      actual: { presence, has_er_event: hasEREvent },
      pass: hospitalized || hasEREvent,
      note: hospitalized ? 'PASS — character is hospitalized' : hasEREvent ? 'PASS — ER discharge event found' : 'FAIL — health critical but no hospital state and no ER ScheduledEvent. RC3 fix may not have run yet.',
    };
  }

  // RC4: Compound crisis — 3+ critical needs must push to sleeping
  if (critCount >= T.COMPOUND_CRISIS && !onShift && !hospitalized) {
    results.RC4_compound_rest = {
      expected: 'resolved_presence_status = sleeping or hospitalized',
      actual: presence,
      critical_count: critCount,
      pass: sleeping || hospitalized,
      note: sleeping || hospitalized ? 'PASS — forced rest or hospital active' : 'FAIL — compound crisis but not in rest/hospital. RC4 fix may not have run yet.',
    };
  }

  // RC5: Staleness — last simulated should be < 1h for normal characters
  if (elapsedH !== null) {
    results.RC5_staleness = {
      last_simulated_hours_ago: Math.round(elapsedH * 10) / 10,
      pass: elapsedH < 1.5,
      note: elapsedH < 1.5 ? 'PASS — simulation is current' : elapsedH < 8 ? `WARNING — ${Math.round(elapsedH * 10) / 10}h since last sim` : `FAIL — ${Math.round(elapsedH)}h since last sim. Either automation is paused or character was skipped.`,
    };
  } else {
    results.RC5_staleness = { pass: false, note: 'FAIL — last_need_simulated_at is null' };
  }

  return results;
}

// ── FULL CHARACTER DIAGNOSTIC ─────────────────────────────────────────────────
function diagnoseCharacter(char, locationMap, recentMemories, recentScheduledEvents, now) {
  const hunger  = char.hunger_value  ?? null;
  const energy  = char.energy_value  ?? null;
  const health  = char.health_value  ?? null;
  const mental  = char.mental_value  ?? null;
  const hygiene = char.hygiene_value ?? null;
  const comfort = char.comfort_value ?? null;
  const social  = char.social_value  ?? null;

  const needVals = [hunger, energy, health, mental, hygiene, comfort, social].filter(v => v !== null);
  const criticalNeeds = [];
  const issues = [];
  const warnings = [];

  // ── VALUE CHECKS ──
  for (const [name, val] of [['hunger', hunger], ['energy', energy], ['health', health], ['mental', mental], ['hygiene', hygiene], ['comfort', comfort], ['social', social]]) {
    if (val === null) { issues.push(`MISSING: ${name}_value is null`); continue; }
    if (val < 10) { criticalNeeds.push(name); issues.push(`COLLAPSE: ${name}=${Math.round(val)}`); }
    else if (val < 20) { criticalNeeds.push(name); warnings.push(`CRITICAL: ${name}=${Math.round(val)}`); }
    else if (val < 35) { warnings.push(`LOW: ${name}=${Math.round(val)}`); }
  }

  // ── INITIALIZATION ──
  if (!char.needs_initialized) issues.push('needs_initialized=false — bars never set');

  // ── PROTECTED FLAGS AUDIT ──
  const protectedFlags = {
    is_protected:      char.is_protected      ?? false,
    protected_active:  char.protected_active  ?? false,
    is_default:        char.is_default        ?? false,
    is_finalized:      char.is_finalized      ?? false,
    diagnostic_only:   char.diagnostic_only   ?? false,
    is_test_character: char.is_test_character ?? false,
  };
  const dangerousFlags = Object.entries(protectedFlags).filter(([, v]) => v).map(([k]) => k);
  if (dangerousFlags.length > 0) warnings.push(`PROTECTED FLAGS ACTIVE: ${dangerousFlags.join(', ')} — verify these are not blocking simulation writes`);
  if (protectedFlags.diagnostic_only || protectedFlags.is_test_character) {
    issues.push(`SIMULATION EXCLUDED: diagnostic_only or is_test_character flag is set — this character is EXCLUDED from simulation batch runs`);
  }

  // ── SLEEP RECOVERY CHECK ──
  const sleeping = isSleeping(char);
  if (sleeping && energy !== null && energy < 15) {
    // Check if cascade is cancelling sleep recovery
    const hungerSev  = hunger  !== null && hunger  < 20 ? (20 - hunger)  / 20 : 0;
    const healthSev  = health  !== null && health  < 20 ? (20 - health)  / 20 : 0;
    const cascadeDrain = (1.5 * hungerSev) + (1.5 * healthSev);
    const netSleepRate = 12 - cascadeDrain;
    if (netSleepRate <= 0) {
      issues.push(`SLEEP-RECOVERY CANCELLED: net sleep energy rate=${netSleepRate.toFixed(1)}/hr (cascades exceed +12 gain). Must fix hunger/health first before sleep can restore energy.`);
    } else {
      warnings.push(`SLEEP-RECOVERY SLOW: net rate=${netSleepRate.toFixed(1)}/hr. Energy should recover but slowly.`);
    }
  }

  // ── PASS-OUT WITHOUT STATE CHANGE ──
  if (energy !== null && energy <= 0 && !sleeping) {
    issues.push(`ENERGY=0 BUT NOT IN PASS-OUT STATE: presence="${char.resolved_presence_status || 'unknown'}". RC2 fix may not have run yet — rerun simulation.`);
  }

  // ── SCHEDULE VIOLATION ──
  const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
  const elapsedH = lastSim ? (now - lastSim) / 3600000 : null;
  if (elapsedH !== null && elapsedH > 8) {
    issues.push(`STALE: simulation ${Math.round(elapsedH)}h ago — exceeds 8h cap. Automation may be paused.`);
  } else if (elapsedH !== null && elapsedH > 2) {
    warnings.push(`STALE: simulation ${Math.round(elapsedH * 10) / 10}h ago`);
  }

  // ── STUCK PENDING EVENTS ──
  const stuckEvents = recentScheduledEvents.filter(e => {
    if (e.status !== 'pending') return false;
    return e.trigger_time && (now - new Date(e.trigger_time)) > 2 * 3600000;
  });
  if (stuckEvents.length > 0) {
    warnings.push(`STUCK EVENTS: ${stuckEvents.length} pending ScheduledEvent(s) are overdue by >2h`);
  }

  // ── RC VERIFICATION ──
  const rcVerification = verifyRCFixes(char, recentScheduledEvents, now);

  // ── CRISIS MEMORIES (48h) ──
  const crisisMemories = recentMemories.filter(m => {
    const age = m.timestamp ? (now - new Date(m.timestamp)) / 3600000 : 999;
    return age < 48 && m.source_context?.includes('needs_simulation');
  });

  // Severity
  const severity = issues.some(i => i.includes('COLLAPSE') || i.includes('SIMULATION EXCLUDED')) ? 'COLLAPSE'
    : issues.length >= 3 ? 'COMPOUND_CRISIS'
    : criticalNeeds.length >= 1 ? 'CRITICAL'
    : warnings.length >= 2 ? 'WARNING'
    : 'OK';

  return {
    character_id: char.id,
    character_name: char.name,
    severity,
    issues,
    warnings,
    critical_needs: criticalNeeds,
    protected_flags: dangerousFlags,
    rc_verification: rcVerification,
    crisis_memories_48h: crisisMemories.length,
    stuck_pending_events: stuckEvents.length,
    snapshot: {
      hunger:  hunger  !== null ? Math.round(hunger)  : null,
      energy:  energy  !== null ? Math.round(energy)  : null,
      health:  health  !== null ? Math.round(health)  : null,
      mental:  mental  !== null ? Math.round(mental)  : null,
      social:  social  !== null ? Math.round(social)  : null,
      hygiene: hygiene !== null ? Math.round(hygiene) : null,
      comfort: comfort !== null ? Math.round(comfort) : null,
      financial: Math.round(char.financial_need_value ?? 60),
      presence: char.resolved_presence_status ?? null,
      activity: char.current_activity ?? null,
      is_sleeping: sleeping,
      is_hospitalized: isHospitalized(char),
      last_simulated_h_ago: elapsedH !== null ? Math.round(elapsedH * 10) / 10 : null,
    },
  };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const priorityName = payload.priorityCharacterName || 'Ethan Nathan Thompson';

    // Step 1: Run the corrected simulation first to apply all RC fixes
    console.log('[deepNeedsAudit] Running corrected simulation first...');
    const simResult = await base44.functions.invoke('simulateActiveCharacterNeeds', {}).catch(e => ({ error: e.message }));
    const simRanSuccessfully = !simResult?.error && simResult?.data?.success;
    const simCorrectiveCount = simResult?.data?.corrective_actions_taken ?? 0;
    const simWriteFailures   = simResult?.data?.write_failures ?? 0;
    const simProcessed       = simResult?.data?.processed ?? 0;
    console.log(`[deepNeedsAudit] Sim result: processed=${simProcessed}, corrective=${simCorrectiveCount}, write_failures=${simWriteFailures}`);

    // Step 2: Load FRESH character data after simulation ran
    const [allLocations, allCharsRaw] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.list().catch(() => []),
      base44.asServiceRole.entities.Character.list('-updated_date', 300).catch(() => []),
    ]);
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    const activeChars = allCharsRaw.filter(c => c.character_type === 'active' && c.status === 'active');

    // Find priority character
    const nameParts = priorityName.toLowerCase().split(' ');
    const priorityChar = activeChars.find(c => nameParts.every(p => c.name?.toLowerCase().includes(p)))
      || activeChars.find(c => nameParts.some(p => c.name?.toLowerCase().includes(p)));

    const now = new Date();

    // ── PRIORITY CHARACTER DEEP DIVE ──────────────────────────────────────────
    let ethanDiagnostic = null;
    if (priorityChar) {
      const [ethanMemories, ethanEvents, ethanLifeEvents] = await Promise.all([
        base44.asServiceRole.entities.Memory.filter({ character_id: priorityChar.id }, '-timestamp', 30).catch(() => []),
        base44.asServiceRole.entities.ScheduledEvent.filter({ character_ids: [priorityChar.id] }, '-trigger_time', 20).catch(() => []),
        base44.asServiceRole.entities.LifeEvent.filter({ character_id: priorityChar.id }, '-timestamp', 5).catch(() => []),
      ]);

      ethanDiagnostic = diagnoseCharacter(priorityChar, locationMap, ethanMemories, ethanEvents, now);
      ethanDiagnostic.label = `Priority Outlier: ${priorityChar.name}`;
      ethanDiagnostic.recent_life_events = ethanLifeEvents.map(e => ({ title: e.title, event_type: e.event_type, timestamp: e.timestamp }));

      // RC6: Write verification — did the simulation write successfully?
      // Compare last_need_simulated_at against when we ran simulation (it should be < 5 min ago)
      const lastSimTime = priorityChar.last_need_simulated_at ? new Date(priorityChar.last_need_simulated_at) : null;
      const minsSinceSimWrite = lastSimTime ? (now - lastSimTime) / 60000 : null;
      ethanDiagnostic.rc6_write_verification = {
        last_need_simulated_at: priorityChar.last_need_simulated_at,
        minutes_since_write: minsSinceSimWrite !== null ? Math.round(minsSinceSimWrite) : null,
        write_confirmed: minsSinceSimWrite !== null && minsSinceSimWrite < 5,
        verdict: minsSinceSimWrite !== null && minsSinceSimWrite < 5
          ? 'PASS — write confirmed, last_need_simulated_at updated within last 5 minutes'
          : 'FAIL — last_need_simulated_at did NOT update. Writes are silently failing. Check RLS or protected flags blocking asServiceRole update.',
      };
    } else {
      ethanDiagnostic = { label: `NOT FOUND: "${priorityName}"`, severity: 'NOT_FOUND', note: 'Character not found among active created characters' };
    }

    // ── GLOBAL AUDIT ─────────────────────────────────────────────────────────
    const globalResults = activeChars.map(c => diagnoseCharacter(c, locationMap, [], [], now));

    const severityDist = {};
    const rcFailCounts = {};
    for (const r of globalResults) {
      severityDist[r.severity] = (severityDist[r.severity] || 0) + 1;
      for (const [rcKey, rcVal] of Object.entries(r.rc_verification || {})) {
        if (!rcVal.pass) rcFailCounts[rcKey] = (rcFailCounts[rcKey] || 0) + 1;
      }
    }

    // Characters with write failures (last simulated > 15 min AFTER we just ran simulation)
    const writeFailedChars = globalResults.filter(r => {
      const rc5 = r.rc_verification?.RC5_staleness;
      return rc5 && !rc5.pass && rc5.last_simulated_hours_ago > 0.25;
    }).map(r => r.character_name);

    const ORDER = { COLLAPSE: 0, COMPOUND_CRISIS: 1, CRITICAL: 2, WARNING: 3, OK: 4 };
    const worstChars = globalResults
      .filter(r => r.severity !== 'OK')
      .sort((a, b) => (ORDER[a.severity] ?? 5) - (ORDER[b.severity] ?? 5))
      .slice(0, 20)
      .map(r => ({
        name: r.character_name,
        severity: r.severity,
        hunger: r.snapshot.hunger,
        energy: r.snapshot.energy,
        health: r.snapshot.health,
        presence: r.snapshot.presence,
        activity: r.snapshot.activity,
        critical_needs: r.critical_needs,
        rc_failures: Object.entries(r.rc_verification || {}).filter(([, v]) => !v.pass).map(([k]) => k),
        protected_flags: r.protected_flags,
      }));

    // RC status summary across all characters
    const rcSummary = {
      RC1_auto_eat_failures:   rcFailCounts['RC1_auto_eat']   || 0,
      RC1_auto_sleep_failures: rcFailCounts['RC1_auto_sleep'] || 0,
      RC2_passout_failures:    rcFailCounts['RC2_passout_state'] || 0,
      RC3_er_failures:         rcFailCounts['RC3_er_escalation'] || 0,
      RC4_compound_failures:   rcFailCounts['RC4_compound_rest'] || 0,
      RC5_stale_failures:      rcFailCounts['RC5_staleness']   || 0,
      note: 'Failures here may mean simulation has not run yet on those characters, or the fix was not applied. Rerun in 5 minutes and check again.',
    };

    // Remaining issues after fixes
    const remainingIssues = [];
    if (simWriteFailures > 0) remainingIssues.push(`${simWriteFailures} write failures in simulation — likely protected-flag or RLS issue for those specific characters`);
    if (rcSummary.RC5_stale_failures > 2) remainingIssues.push(`${rcSummary.RC5_stale_failures} characters have stale simulation — check if automation is active and running at correct frequency`);
    if (writeFailedChars.length > 0) remainingIssues.push(`Write-failure candidates: ${writeFailedChars.slice(0, 5).join(', ')}`);
    if (rcSummary.RC1_auto_eat_failures > 0) remainingIssues.push(`${rcSummary.RC1_auto_eat_failures} characters still show hunger critical without eating activity — may need another sim tick`);
    if (rcSummary.RC2_passout_failures > 0) remainingIssues.push(`${rcSummary.RC2_passout_failures} characters at energy=0 without pass-out state — rerun simulation or manual override`);

    return Response.json({
      success: true,
      diagnostic_pass: 'SECOND_PASS_VERIFICATION',
      priority_character: priorityName,
      timestamp: now.toISOString(),

      simulation_pre_run: {
        ran_successfully: simRanSuccessfully,
        characters_processed: simProcessed,
        corrective_actions_applied: simCorrectiveCount,
        write_failures: simWriteFailures,
        corrective_logs: simResult?.data?.corrective_logs || [],
        error: simResult?.error || null,
      },

      priority_character_diagnostic: ethanDiagnostic,

      rc_fix_verification_global: rcSummary,

      global_audit: {
        total_active_created: activeChars.length,
        severity_distribution: severityDist,
        worst_characters: worstChars,
        possible_write_failure_characters: writeFailedChars,
      },

      remaining_issues_after_fixes: remainingIssues.length > 0 ? remainingIssues : ['No critical remaining issues detected — all RC fixes appear to be working'],

      next_steps: [
        'Wait 5–10 minutes for the scheduled automation to run another tick',
        'Rerun deepNeedsAudit — RC verification columns should show PASS',
        'If RC5 failures persist, check that the simulateActiveCharacterNeeds scheduled automation is active (not paused)',
        'If RC6 write failures persist on specific characters, check their is_protected/is_default flags and verify asServiceRole has write access',
        'Use manualOverrideNeeds to break any remaining COLLAPSE-level characters still stuck in crisis',
      ],
    });

  } catch (error) {
    console.error('[deepNeedsAudit]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});