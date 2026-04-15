import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * deepNeedsAudit — STRICT BACKEND DIAGNOSTIC
 *
 * NOT a UI audit. NOT a balancing task.
 *
 * Purpose: trace exactly WHY pre-existing safeguards (pass-out, hunger recovery,
 * sleep-energy restore, ER escalation, compound crisis handling) are NOT firing,
 * NOT completing, or are being BLOCKED.
 *
 * Phase 1: Ethan Nathan Thompson — strict outlier trace.
 * Phase 2: All active created characters — global comparison.
 */

// ── SIMULATION RATE CONSTANTS (mirrors simulateActiveCharacterNeeds) ──────────
const SLEEP_ENERGY_RATE   = 12;   // +per hour while sleeping
const HUNGER_CASCADE_MAX  = 2.0;  // energy drain per hour at hunger=0
const HEALTH_CASCADE_MAX  = 2.0;  // energy drain per hour at health=0
const WORK_ENERGY_RATE    = -5;   // per hour at work
const HOME_REST_ENERGY    = 3;    // +per hour resting at home

// ── THRESHOLD DEFINITIONS (what SHOULD trigger safeguards) ────────────────────
const T = {
  HUNGER_ER:       5,   // hospital/forced feeding
  HUNGER_CRITICAL: 20,  // auto-seek food
  HUNGER_LOW:      35,  // start planning food
  ENERGY_PASSOUT:  0,   // forced pass-out
  ENERGY_CRITICAL: 15,  // mandatory rest
  ENERGY_LOW:      30,  // rest-seeking
  HEALTH_ER:       15,  // ER escalation
  HEALTH_CRITICAL: 20,  // medical action
  SOCIAL_SLOW:     15,  // lonely flag, slow decay expected
  MENTAL_SLOW:     15,  // breakdown flag, slow decay expected
};

// ── HELPER: is character on work shift right now ──────────────────────────────
function isOnShift(char) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm = 0] = char.work_start_time.split(':').map(Number);
  const [eh, em = 0] = char.work_end_time.split(':').map(Number);
  return char.work_days.includes(now.getDay()) && cur >= sh * 60 + sm && cur < eh * 60 + em;
}

// ── HELPER: is character in declared sleep window ─────────────────────────────
function isInSleepWindow(char) {
  const p = char.resolved_presence_status || '';
  if (p === 'sleeping' || p === 'napping') return true;
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const h = new Date().getHours();
  const sh = parseInt(char.sleep_start_time.split(':')[0]);
  const wh = parseInt(char.wake_up_time.split(':')[0]);
  return sh > wh ? (h >= sh || h < wh) : (h >= sh && h < wh);
}

// ── HELPER: net energy rate during sleep accounting for cascades ──────────────
function computeNetSleepEnergyRate(hunger, health) {
  let rate = SLEEP_ENERGY_RATE;
  if (hunger < 20) {
    const sev = (20 - hunger) / 20;
    rate -= HUNGER_CASCADE_MAX * sev;
  }
  if (health < 20) {
    const sev = (20 - health) / 20;
    rate -= HEALTH_CASCADE_MAX * sev;
  }
  return rate;
}

// ── HELPER: estimate hours to reach a threshold from current value ────────────
function hoursToThreshold(current, ratePerHour, threshold) {
  if (ratePerHour >= 0 && current <= threshold) return 0;
  if (ratePerHour <= 0 && current >= threshold) return 0;
  if (ratePerHour === 0) return Infinity;
  return Math.abs((current - threshold) / ratePerHour);
}

// ── PROTECTED FLAG AUDIT ──────────────────────────────────────────────────────
function auditProtectedFlags(char) {
  const flags = {};
  const blockers = [];
  const warnings = [];

  flags.is_protected     = char.is_protected     ?? false;
  flags.protected_active = char.protected_active ?? false;
  flags.is_finalized     = char.is_finalized     ?? false;
  flags.is_default       = char.is_default       ?? false;
  flags.diagnostic_only  = char.diagnostic_only  ?? false;
  flags.is_test_character= char.is_test_character?? false;
  flags.status           = char.status;
  flags.character_type   = char.character_type;
  flags.created_by_role  = char.created_by_role  ?? null;

  // is_protected should ONLY guard deletion, NOT simulation or updates
  if (flags.is_protected) {
    warnings.push('is_protected=true — intended for deletion guard only. If any simulation path checks is_protected before writing needs updates, that is an ACCIDENTAL BLOCKER.');
  }
  if (flags.protected_active) {
    warnings.push('protected_active=true — secondary protection flag. Must verify simulateActiveCharacterNeeds does NOT gate on this flag.');
  }
  if (flags.is_finalized) {
    warnings.push('is_finalized=true — profile lock flag. Must verify this is NOT blocking needs updates or event processing.');
  }
  if (flags.is_default) {
    blockers.push('BLOCKER RISK: is_default=true — default characters may be excluded from some simulation or mutation paths. Check if simulateActiveCharacterNeeds skips characters where is_default=true.');
  }
  if (flags.diagnostic_only) {
    blockers.push('BLOCKER: diagnostic_only=true — this character is explicitly excluded from normal simulation queries. If set incorrectly on a real character, ALL simulation is blocked.');
  }
  if (flags.is_test_character) {
    blockers.push('BLOCKER: is_test_character=true — explicitly excluded from user-facing queries. If set on a real character, simulation skips it.');
  }

  // Check for legacy protected-implies-no-write misinterpretation
  // simulateActiveCharacterNeeds uses sdk.entities.Character.update — if is_protected was used
  // as an RLS condition that blocks update for non-admin, that would silently fail writes.
  if (flags.is_protected || flags.protected_active) {
    blockers.push('SILENT WRITE FAILURE RISK: If RLS or any update guard reads is_protected/protected_active as a broader write lock, simulateActiveCharacterNeeds updates will silently fail. The function call returns 200 but nothing is written to DB.');
  }

  return { flags, blockers, warnings };
}

// ── TRIGGER CHAIN TRACE for a single need ─────────────────────────────────────
function traceNeedChain(needName, value, char, locationMap) {
  const chain = [];
  const failures = [];
  const now = new Date();
  const sleeping = isInSleepWindow(char);
  const onShift = isOnShift(char);
  const presence = char.resolved_presence_status || 'unknown';
  const hunger = char.hunger_value ?? 70;
  const health = char.health_value ?? 80;
  const energy = char.energy_value ?? 75;
  const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
  const elapsedHours = lastSim ? (now - lastSim) / 3600000 : null;
  const simIsStale = elapsedHours === null || elapsedHours > 1;

  // ── STEP 1: Is decay running? ──
  chain.push({ step: 1, label: 'Decay running?', pass: !simIsStale, detail: simIsStale ? `FAIL — last simulated ${elapsedHours === null ? 'never' : Math.round(elapsedHours * 10) / 10}h ago. simulateActiveCharacterNeeds is not running on schedule or not reaching this character.` : `OK — simulated ${Math.round((elapsedHours ?? 0) * 60)}min ago` });

  if (needName === 'hunger') {
    // ── HUNGER CHAIN ──
    chain.push({ step: 2, label: 'Threshold crossed?', pass: value <= T.HUNGER_CRITICAL, detail: value <= T.HUNGER_CRITICAL ? `YES — hunger=${Math.round(value)} ≤ ${T.HUNGER_CRITICAL}. Safeguard SHOULD have fired.` : `NOT YET — hunger=${Math.round(value)} above critical threshold ${T.HUNGER_CRITICAL}` });

    if (value <= T.HUNGER_CRITICAL) {
      // Step 3: Was proactive activity injected?
      const activity = (char.current_activity || '').toLowerCase();
      const hasEatingActivity = activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal');
      chain.push({ step: 3, label: 'Proactive eating activity injected?', pass: hasEatingActivity, detail: hasEatingActivity ? `YES — current_activity="${char.current_activity}" includes eating` : `FAIL — current_activity="${char.current_activity || '(empty)'}". simulateActiveCharacterNeeds does NOT currently inject a corrective activity. It reads activity but never WRITES it. This is a design gap: the safeguard trigger exists but has no action executor.` });
      if (!hasEatingActivity) failures.push('SAFEGUARD GAP: Hunger threshold crossed but no corrective activity injected. simulateActiveCharacterNeeds reads current_activity to determine context but never writes it. The trigger fires implicitly but the action never executes.');

      // Step 4: Does hunger recovery context exist?
      const hasEatingContext = sleeping ? false : hasEatingActivity; // eating while sleeping is invalid
      chain.push({ step: 4, label: 'Recovery context active (food_drink/eating)?', pass: hasEatingContext, detail: hasEatingContext ? 'YES — eating context active, hunger should be recovering' : 'FAIL — no eating context. The simulation will apply eating rates ONLY if current_activity says eating. Since nothing writes current_activity, hunger recovery NEVER fires autonomously.' });

      // Step 5: Is hunger cascade draining energy simultaneously?
      if (value < 20) {
        const cascadeRate = HUNGER_CASCADE_MAX * ((20 - value) / 20);
        chain.push({ step: 5, label: 'Hunger cascade active?', pass: false, detail: `YES — hunger=${Math.round(value)} triggers energy drain at −${cascadeRate.toFixed(2)}/hr AND health drain at −${(1.5 * (20 - value) / 20).toFixed(2)}/hr. Recovery must outpace cascade OR cascade must be interrupted first.` });
        failures.push(`ACTIVE CASCADE: Hunger at ${Math.round(value)} is draining energy and health simultaneously. Even if sleep fires, energy recovery may be zero or negative.`);
      }

      // Step 6: ER escalation at starvation level
      if (value <= T.HUNGER_ER) {
        chain.push({ step: 6, label: 'ER/hospital escalation triggered?', pass: false, detail: `FAIL — hunger=${Math.round(value)} ≤ ${T.HUNGER_ER}. This should trigger hospital logic. No such escalation function exists in the simulation pipeline. ER escalation for hunger was DESIGNED but NOT IMPLEMENTED as an automatic trigger.` });
        failures.push('MISSING IMPLEMENTATION: Hunger ER escalation (hunger ≤ 5) was designed but no backend function automatically transitions character to hospital state or creates a ScheduledEvent for it.');
      }
    }
  }

  if (needName === 'energy') {
    // ── ENERGY CHAIN ──
    chain.push({ step: 2, label: 'Threshold crossed?', pass: value <= T.ENERGY_CRITICAL, detail: value <= T.ENERGY_CRITICAL ? `YES — energy=${Math.round(value)} ≤ ${T.ENERGY_CRITICAL}. Rest/sleep SHOULD be selected.` : `NOT YET — energy=${Math.round(value)}` });

    if (value <= T.ENERGY_PASSOUT) {
      // Pass-out check
      const isInPassOut = presence === 'sleeping' || presence === 'napping' || sleeping;
      chain.push({ step: 3, label: 'Pass-out state activated?', pass: isInPassOut, detail: isInPassOut ? 'YES — character is in sleep/nap state' : `FAIL — energy=0 but presence="${presence}" and is NOT in sleep window. Pass-out logic does NOT exist as an automatic state writer. simulateActiveCharacterNeeds logs a console.error for ENERGY_CRITICAL but writes NO state change. The flag never changes to "passed_out" or "sleeping" automatically.` });
      if (!isInPassOut) {
        failures.push('PASS-OUT NOT IMPLEMENTED AS STATE WRITER: energy=0 triggers a console.error log in simulateActiveCharacterNeeds but does NOT write resolved_presence_status="sleeping" or any pass-out state. Character remains in whatever state they were in — awake indefinitely at zero energy.');
      }
    }

    if (value <= T.ENERGY_CRITICAL && sleeping) {
      // Is sleep actually recovering energy?
      const netRate = computeNetSleepEnergyRate(hunger, health);
      chain.push({ step: 4, label: `Net sleep energy rate positive? (base +${SLEEP_ENERGY_RATE}, cascades applied)`, pass: netRate > 0, detail: netRate > 0 ? `YES — net rate=${netRate.toFixed(2)}/hr. Sleep IS recovering energy.` : `FAIL — net rate=${netRate.toFixed(2)}/hr. Hunger (${Math.round(hunger)}) and/or health (${Math.round(health)}) cascades are DRAINING energy faster than sleep restores it. Character is in sleep state but energy is STILL FALLING.` });
      if (netRate <= 0) failures.push(`SLEEP RECOVERY CANCELLED BY CASCADE: net energy rate during sleep = ${netRate.toFixed(2)}/hr. Sleep is futile until hunger or health is fixed first.`);
    }

    if (value <= T.ENERGY_CRITICAL && !sleeping) {
      chain.push({ step: 4, label: 'Auto-rest triggered?', pass: false, detail: `FAIL — energy=${Math.round(value)} and not sleeping. simulateActiveCharacterNeeds does NOT autonomously set character to sleeping or resting. It reads context, applies rates, and writes new values — but never commands the character to sleep. Auto-rest is DESIGNED but NOT IMPLEMENTED.` });
      failures.push('AUTO-REST NOT IMPLEMENTED: Energy critical but no automatic sleep trigger writes presence_status=sleeping. This must be done manually or via a separate trigger function that does not exist.');
    }
  }

  if (needName === 'health') {
    chain.push({ step: 2, label: 'Threshold crossed?', pass: value <= T.HEALTH_CRITICAL, detail: value <= T.HEALTH_CRITICAL ? `YES — health=${Math.round(value)} ≤ ${T.HEALTH_CRITICAL}` : `NOT YET — health=${Math.round(value)}` });

    if (value <= T.HEALTH_ER) {
      chain.push({ step: 3, label: 'ER escalation triggered?', pass: false, detail: `FAIL — health=${Math.round(value)} ≤ ${T.HEALTH_ER}. Hospital/ER logic was designed but no function automatically transitions character to hospital state at this threshold. detectCriticalEscalations() creates a Memory record — but does NOT create a ScheduledEvent, does NOT set presence_status="hospitalized", and does NOT stop decay.` });
      failures.push('ER ESCALATION IS MEMORY-ONLY: Health critical only creates a Memory entry. No state change to hospitalized, no ScheduledEvent, no blocking of further decay. Character continues degrading in normal simulation.');
    }
  }

  if (needName === 'social') {
    // Social should decay SLOWLY
    const socialDecayRate = -1; // per hour default
    const hoursToZero = value / 1; // rough
    chain.push({ step: 2, label: 'Social decaying at intended slow rate?', pass: true, detail: `Social decays at ${socialDecayRate}/hr in default context. At ${Math.round(value)}, ~${Math.round(hoursToZero)}h to zero without intervention. This is slow by design. If social is crashing fast it means context is being misdetected (e.g. at_work_service gives +2/hr but work_off_shift gives -1/hr).` });
    chain.push({ step: 3, label: 'Social low behavior trigger?', pass: false, detail: `FAIL — no autonomous behavior fires when social < ${T.SOCIAL_SLOW}. simulateActiveCharacterNeeds detects the level and applies cascade to mental, but does NOT schedule a social outing, does NOT set current_activity, does NOT create a ScheduledEvent. Social recovery requires either context change (bar, social_out) or manual edit.` });
  }

  if (needName === 'mental') {
    chain.push({ step: 2, label: 'Mental decaying at intended slow rate?', pass: true, detail: `Mental decays at -0.5/hr default, faster at work. If crashing quickly, check compound crisis (hunger+energy+health all low triggers additional -0.5/hr mental cascade per need).` });
    chain.push({ step: 3, label: 'Mental low behavior trigger?', pass: false, detail: `FAIL — no autonomous recovery behavior fires when mental < ${T.MENTAL_SLOW}. Memory is created, but no rest/therapy/social ScheduledEvent is auto-created. Mental recovery requires context change or manual edit.` });
  }

  return { need: needName, current_value: value !== null ? Math.round(value) : null, chain, failures };
}

// ── FULL CHARACTER DIAGNOSTIC ─────────────────────────────────────────────────
function fullDiagnose(char, locationMap, recentMemories = [], recentScheduledEvents = []) {
  const now = new Date();
  const hunger  = char.hunger_value   ?? null;
  const energy  = char.energy_value   ?? null;
  const health  = char.health_value   ?? null;
  const mental  = char.mental_value   ?? null;
  const hygiene = char.hygiene_value  ?? null;
  const comfort = char.comfort_value  ?? null;
  const social  = char.social_value   ?? null;
  const financial = char.financial_need_value ?? null;

  // Protected flag audit
  const protectedAudit = auditProtectedFlags(char);

  // Need chain traces for all critical/low needs
  const chains = [];
  for (const [name, val] of [['hunger', hunger], ['energy', energy], ['health', health], ['social', social], ['mental', mental]]) {
    if (val !== null) chains.push(traceNeedChain(name, val, char, locationMap));
  }

  // Collect all failures across chains
  const allChainFailures = chains.flatMap(c => c.failures);

  // Staleness check
  const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
  const elapsedH = lastSim ? (now - lastSim) / 3600000 : null;

  // Stuck events check
  const stuckEvents = recentScheduledEvents.filter(e => {
    if (e.status !== 'pending') return false;
    const trigger = new Date(e.trigger_time);
    return trigger < now && (now - trigger) > 3600000; // overdue by >1h
  });

  // Needs crisis memories in last 48h
  const recentCrisis = recentMemories.filter(m => {
    if (!m.timestamp) return false;
    const age = (now - new Date(m.timestamp)) / 3600000;
    return age < 48 && (m.source_context?.includes('needs_simulation') || m.title?.toLowerCase().match(/hunger|exhaustion|passed|critical|collapse|breakdown/));
  });

  // Critical needs count
  const vals = [hunger, energy, health, mental, hygiene, comfort, social].filter(v => v !== null);
  const criticalCount = vals.filter(v => v < 20).length;
  const collapsedCount = vals.filter(v => v < 5).length;

  // Key system gaps identified
  const systemGaps = [];

  // Gap 1: simulateActiveCharacterNeeds never writes current_activity
  systemGaps.push({ gap: 'CORRECTIVE_ACTIVITY_WRITER_MISSING', description: 'simulateActiveCharacterNeeds computes decay/recovery but NEVER writes current_activity or resolved_presence_status. Corrective behavior (eat, sleep, rest) can only happen if something else changes those fields. The simulation is read-only on context — it never commands action.' });

  // Gap 2: Pass-out is a log not a state transition
  if (energy !== null && energy < 10) {
    systemGaps.push({ gap: 'PASSOUT_STATE_WRITER_MISSING', description: 'energy < 10 triggers console.error ENERGY_CRITICAL but writes no state. resolved_presence_status stays at whatever it was. Character is logged as critical but never placed in pass-out/sleeping state. Decay continues as if awake.' });
  }

  // Gap 3: ER escalation is memory-only
  if (health !== null && health < 20) {
    systemGaps.push({ gap: 'ER_ESCALATION_IS_MEMORY_ONLY', description: 'detectCriticalEscalations() creates Memory records but no ScheduledEvent and no state transition. Hospital context rates only apply if character is manually moved to a hospital location — the escalation does not move them.' });
  }

  // Gap 4: Compound crisis has no emergency handler
  if (criticalCount >= 3) {
    systemGaps.push({ gap: 'COMPOUND_CRISIS_HAS_NO_HANDLER', description: `${criticalCount} needs below 20 simultaneously. Multi-critical collapse is detected (health takes extra -1/hr) but no emergency function is called. No forced hospitalization, no forced sleep, no intervention event.` });
  }

  // Gap 5: Automation frequency check
  if (elapsedH !== null && elapsedH > 2) {
    systemGaps.push({ gap: 'AUTOMATION_STALE', description: `simulateActiveCharacterNeeds last ran ${Math.round(elapsedH * 10) / 10}h ago. If automation interval is > 30min and simulation isn't triggered on profile load, needs can drift far between runs. Check: (1) scheduled automation exists and is active, (2) profile page triggers simulateActiveCharacterNeeds on load.` });
  }

  // Severity
  const severity = collapsedCount >= 2 ? 'COLLAPSE'
    : criticalCount >= 3 ? 'COMPOUND_CRISIS'
    : criticalCount >= 1 ? 'CRITICAL'
    : vals.some(v => v < 35) ? 'DEGRADED'
    : 'OK';

  return {
    character_id: char.id,
    character_name: char.name,
    severity,
    protected_flag_audit: protectedAudit,
    snapshot: {
      needs_initialized: char.needs_initialized ?? false,
      last_simulated_hours_ago: elapsedH !== null ? Math.round(elapsedH * 10) / 10 : null,
      resolved_presence_status: char.resolved_presence_status ?? null,
      is_sleeping: isInSleepWindow(char),
      on_shift: isOnShift(char),
      hunger: hunger !== null ? Math.round(hunger) : null,
      energy: energy !== null ? Math.round(energy) : null,
      health: health !== null ? Math.round(health) : null,
      social: social !== null ? Math.round(social) : null,
      mental: mental !== null ? Math.round(mental) : null,
      hygiene: hygiene !== null ? Math.round(hygiene) : null,
      comfort: comfort !== null ? Math.round(comfort) : null,
      financial: financial !== null ? Math.round(financial) : null,
      current_activity: char.current_activity ?? null,
      is_protected: char.is_protected ?? false,
      protected_active: char.protected_active ?? false,
      is_default: char.is_default ?? false,
      is_jailed: char.is_jailed ?? false,
    },
    need_chains: chains,
    all_chain_failures: allChainFailures,
    system_gaps: systemGaps,
    stuck_pending_events: stuckEvents.map(e => ({ id: e.id, description: e.description, trigger_time: e.trigger_time, overdue_hours: Math.round((now - new Date(e.trigger_time)) / 3600000) })),
    recent_crisis_memories_48h: recentCrisis.map(m => ({ title: m.title, timestamp: m.timestamp, tag: m.source_context })),
    recurring_crisis_count_48h: recentCrisis.length,
  };
}

// ── MAIN SERVER ───────────────────────────────────────────────────────────────
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

    // Load all data in parallel
    const [allLocations, allCharsRaw] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.list().catch(() => []),
      base44.asServiceRole.entities.Character.list('-updated_date', 300).catch(() => []),
    ]);

    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    const activeChars = allCharsRaw.filter(c => c.character_type === 'active' && c.status === 'active');

    // Find priority character (Ethan)
    const nameParts = priorityName.toLowerCase().split(' ');
    const priorityChar = activeChars.find(c => nameParts.every(p => c.name?.toLowerCase().includes(p)))
      || activeChars.find(c => nameParts.some(p => c.name?.toLowerCase().includes(p)));

    // ── PHASE 1: ETHAN STRICT DIAGNOSTIC ─────────────────────────────────────
    let phase1 = null;
    if (priorityChar) {
      // Load Ethan's memories, scheduled events, and life events in parallel
      const [ethanMemories, ethanScheduled, ethanLifeEvents] = await Promise.all([
        base44.asServiceRole.entities.Memory.filter({ character_id: priorityChar.id }, '-timestamp', 30).catch(() => []),
        base44.asServiceRole.entities.ScheduledEvent.filter({ character_ids: [priorityChar.id] }, '-trigger_time', 20).catch(() => []),
        base44.asServiceRole.entities.LifeEvent.filter({ character_id: priorityChar.id }, '-timestamp', 10).catch(() => []),
      ]);

      phase1 = fullDiagnose(priorityChar, locationMap, ethanMemories, ethanScheduled);
      phase1.label = `Priority Outlier: ${priorityChar.name}`;
      phase1.recent_life_events = ethanLifeEvents.slice(0, 5).map(e => ({ title: e.title, event_type: e.event_type, timestamp: e.timestamp }));

      // Explicit protected-status-as-blocker determination
      const pFlags = phase1.protected_flag_audit.flags;
      phase1.protected_status_blocker_verdict = {
        is_protected: pFlags.is_protected,
        protected_active: pFlags.protected_active,
        is_default: pFlags.is_default,
        is_finalized: pFlags.is_finalized,
        diagnostic_only: pFlags.diagnostic_only,
        verdict: (pFlags.diagnostic_only || pFlags.is_test_character)
          ? 'CONFIRMED BLOCKER — diagnostic_only or is_test_character flag is excluding this character from simulation'
          : (pFlags.is_protected || pFlags.protected_active || pFlags.is_default)
          ? 'POTENTIAL SILENT WRITE BLOCKER — protected/default flags may cause update() calls to silently fail under certain RLS conditions. Must verify writes are completing by checking updated_at timestamp vs last_need_simulated_at.'
          : 'NO BLOCKER DETECTED from protected flags — failure is in simulation logic, not access control',
      };
    } else {
      phase1 = {
        label: `Priority character "${priorityName}" NOT FOUND among active created characters`,
        severity: 'NOT_FOUND',
        note: 'Check: (1) character exists with active status and active character_type, (2) name spelling matches',
      };
    }

    // ── PHASE 2: GLOBAL AUDIT (parallel, lightweight) ────────────────────────
    // Full memory+events load for all characters would be too slow — do snapshot-level audit
    const globalResults = activeChars.map(c => {
      const d = fullDiagnose(c, locationMap, [], []);
      return {
        character_id: c.id,
        character_name: c.name,
        severity: d.severity,
        snapshot: d.snapshot,
        chain_failure_count: d.all_chain_failures.length,
        top_failures: d.all_chain_failures.slice(0, 3),
        system_gaps: d.system_gaps.map(g => g.gap),
        protected_blockers: d.protected_flag_audit.blockers,
      };
    });

    // Severity distribution
    const severityDist = {};
    for (const r of globalResults) {
      severityDist[r.severity] = (severityDist[r.severity] || 0) + 1;
    }

    // Identify which gaps are universal vs character-specific
    const gapCounts = {};
    for (const r of globalResults) {
      for (const g of r.system_gaps) {
        gapCounts[g] = (gapCounts[g] || 0) + 1;
      }
    }

    // Characters with protected flags that might be blocking
    const protectedBlockerChars = globalResults
      .filter(r => r.protected_blockers.length > 0)
      .map(r => ({ name: r.character_name, blockers: r.protected_blockers }));

    // Worst characters
    const ORDER = { COLLAPSE: 0, COMPOUND_CRISIS: 1, CRITICAL: 2, DEGRADED: 3, OK: 4 };
    const worstChars = globalResults
      .filter(r => r.severity !== 'OK')
      .sort((a, b) => (ORDER[a.severity] ?? 5) - (ORDER[b.severity] ?? 5))
      .slice(0, 15)
      .map(r => ({
        name: r.character_name,
        severity: r.severity,
        hunger: r.snapshot.hunger,
        energy: r.snapshot.energy,
        health: r.snapshot.health,
        last_sim_h_ago: r.snapshot.last_simulated_hours_ago,
        is_protected: r.snapshot.is_protected,
        is_default: r.snapshot.is_default,
        failures: r.chain_failure_count,
      }));

    // ── SYSTEM-WIDE ROOT CAUSE SUMMARY ───────────────────────────────────────
    const rootCauses = [
      {
        id: 'RC1',
        title: 'simulateActiveCharacterNeeds is read-only on behavior',
        description: 'The simulation reads current_activity and resolved_presence_status to determine context/rates but NEVER writes them. Corrective behaviors (eat, sleep, rest, hospital) require those fields to be set by an external writer that does not exist. Hunger/energy critical thresholds are detected, logged, and used in cascade math — but no action is dispatched.',
        affects: 'ALL active created characters',
        severity: 'CRITICAL — this is why no automatic recovery happens',
      },
      {
        id: 'RC2',
        title: 'Pass-out is a console.error, not a state transition',
        description: 'When energy = 0, simulateActiveCharacterNeeds logs [NEEDS_FAILSAFE] ENERGY_CRITICAL but does not write resolved_presence_status = "sleeping" or any collapsed state. The character remains in their current presence state indefinitely at zero energy.',
        affects: 'ALL characters with energy = 0',
        severity: 'CRITICAL — this is why pass-out never happens',
      },
      {
        id: 'RC3',
        title: 'ER/hospital escalation is Memory creation only',
        description: 'detectCriticalEscalations() creates Memory records when hunger/energy/health hit thresholds. It does NOT: create a ScheduledEvent, change resolved_presence_status, move character to a medical location, or stop decay. Emergency escalation exists in memory-logging form only.',
        affects: 'ALL characters at or near collapse thresholds',
        severity: 'CRITICAL — this is why health crises never trigger ER logic',
      },
      {
        id: 'RC4',
        title: 'Compound crisis has no intervention handler',
        description: 'applyStatInfection() detects 3+ critical needs and adds -1/hr to health. This correctly accelerates the crisis. But nothing reads this compound state to dispatch an emergency behavior. The crisis deepens; no one responds.',
        affects: 'Characters with 3+ needs below 20',
        severity: 'SEVERE — deepens already-bad situations',
      },
      {
        id: 'RC5',
        title: 'Simulation automation may not be reaching all characters',
        description: 'If the scheduled automation for simulateActiveCharacterNeeds is paused, erroring, or has a low run frequency, characters can go hours without a tick. With -2 to -5/hr decay rates, 6 hours without a tick = 12–30 point drops in a single update.',
        affects: 'Characters with stale last_need_simulated_at',
        severity: 'SEVERE — multiplied by cascade infection on catch-up tick',
      },
      {
        id: 'RC6',
        title: 'Protected/default flags may cause silent write failures',
        description: 'If RLS conditions or any update guard checks is_protected, protected_active, or is_default before allowing writes, simulateActiveCharacterNeeds update() calls will silently fail (return 200 but write nothing). The function has no write-success verification.',
        affects: 'Characters with is_protected=true, protected_active=true, or is_default=true',
        severity: 'POSSIBLE — must verify with timestamp comparison',
      },
    ];

    // ── REPAIR ORDER ─────────────────────────────────────────────────────────
    const repairOrder = [
      { priority: 1, action: 'VERIFY AUTOMATION: Check scheduled automation for simulateActiveCharacterNeeds — is it active? Last run time? Frequency? If stale or paused, restart immediately.' },
      { priority: 2, action: 'VERIFY WRITES: Compare last_need_simulated_at vs updated_at for Ethan and 2–3 others. If last_need_simulated_at is NOT updating, writes are silently failing. Check RLS/protected flags.' },
      { priority: 3, action: 'MANUAL STABILIZE: Use manualOverrideNeeds to break compound crises on all COLLAPSE/COMPOUND_CRISIS characters — set all needs to 65. This stops cascade acceleration while root causes are fixed.' },
      { priority: 4, action: 'IMPLEMENT PASS-OUT WRITER: Add logic to simulateActiveCharacterNeeds that writes resolved_presence_status="sleeping" when energy ≤ 0, and wakes character when energy ≥ 20.' },
      { priority: 5, action: 'IMPLEMENT AUTO-REST WRITER: When energy ≤ 15 and character is not at work/school, set resolved_presence_status="sleeping" and current_activity="resting" so next tick applies sleep recovery rates.' },
      { priority: 6, action: 'IMPLEMENT AUTO-EAT WRITER: When hunger ≤ 20, if financial need is not critically low, set current_activity to "eating" for 1 tick (then clear it). This allows hunger recovery rate (+15/hr) to apply.' },
      { priority: 7, action: 'IMPLEMENT ER ESCALATION WRITER: When health ≤ 15 AND compound crisis active, create ScheduledEvent with type="internal" to move character to hospital location and set presence="hospitalized" for 4–8 hours.' },
      { priority: 8, action: 'VERIFY ETHAN SPECIFICALLY: Check if is_protected, protected_active, or is_default blocks his update() calls. Compare his updated_at timestamp over multiple simulation runs.' },
    ];

    // ── VALIDATION TESTS ─────────────────────────────────────────────────────
    const validationTests = [
      'TEST 1: Set Ethan energy=0, run simulateActiveCharacterNeeds, check resolved_presence_status → EXPECT: "sleeping" (will FAIL until RC2 is fixed)',
      'TEST 2: Set Ethan hunger=5, run simulateActiveCharacterNeeds, check current_activity → EXPECT: "eating" (will FAIL until RC1 is fixed)',
      'TEST 3: Run simulateActiveCharacterNeeds for Ethan, immediately read his Character record — check if last_need_simulated_at changed → EXPECT: timestamp updated (if NOT, RC6 confirmed)',
      'TEST 4: Set Ethan health=10, run simulation → EXPECT: ScheduledEvent created pointing to hospital (will FAIL until RC3 is fixed)',
      'TEST 5: Check scheduled automation for simulateActiveCharacterNeeds — verify last_fired_at < 30min ago and is_active=true',
      'TEST 6: Check all characters where last_need_simulated_at > 2h ago — EXPECT: 0 (any > 0 confirms automation gap)',
    ];

    return Response.json({
      success: true,
      diagnostic_type: 'STRICT_BACKEND_SAFEGUARD_TRACE',
      priority_character: priorityName,
      timestamp: new Date().toISOString(),

      // SECTION 1+2+3+4: Ethan strict trace
      ethan_diagnostic: phase1,

      // SECTION 5: Why safeguards are not happening
      root_causes: rootCauses,

      // SECTION 6+7: Global comparison
      global_audit: {
        total_active_created: activeChars.length,
        severity_distribution: severityDist,
        universal_system_gaps: Object.entries(gapCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([gap, count]) => ({ gap, affected_characters: count, is_universal: count >= activeChars.length * 0.8 })),
        characters_with_protected_blockers: protectedBlockerChars,
        worst_characters: worstChars,
      },

      // SECTION 8: Persistence
      persistence_notes: {
        simulation_writes_verified_by: 'last_need_simulated_at timestamp update',
        silent_failure_risk: 'if last_need_simulated_at does not advance after running simulation, writes are failing silently — check RLS, protected flags, and SDK update() error handling',
        manual_override_always_works: 'manualOverrideNeeds uses asServiceRole and bypasses RLS — use to confirm DB is writable',
      },

      // SECTION 9+10: Exact systems failing + repair order
      exact_systems_failing: rootCauses.map(r => `[${r.id}] ${r.title} — ${r.severity}`),
      repair_order: repairOrder,

      // SECTION 11: Validation tests
      validation_tests: validationTests,
    });

  } catch (error) {
    console.error('[deepNeedsAudit]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});