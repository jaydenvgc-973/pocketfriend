import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * deepNeedsAudit
 *
 * Phase 1: Deep-dive diagnostic on a specific priority character (default: Ethan Nathan Thompson).
 * Phase 2: Global audit of all active created characters.
 * Returns a structured report distinguishing character-specific vs global failures.
 */

const clamp = (v) => Math.max(0, Math.min(100, v));

// Same shift logic as simulateActiveCharacterNeeds
function isOnShift(character) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const [startH, startM = 0] = character.work_start_time.split(':').map(Number);
  const [endH, endM = 0] = character.work_end_time.split(':').map(Number);
  return character.work_days.includes(dayOfWeek) &&
    currentMins >= startH * 60 + startM &&
    currentMins < endH * 60 + endM;
}

// Check if character is in sleep window
function isSleeping(character) {
  const presence = character.resolved_presence_status || '';
  if (presence === 'sleeping' || presence === 'napping') return true;
  if (!character.sleep_start_time || !character.wake_up_time) return false;
  const now = new Date();
  const hour = now.getHours();
  const sleepH = parseInt(character.sleep_start_time.split(':')[0]);
  const wakeH  = parseInt(character.wake_up_time.split(':')[0]);
  if (sleepH > wakeH) return hour >= sleepH || hour < wakeH;
  return hour >= sleepH && hour < wakeH;
}

function diagnoseCharacter(char, locationMap) {
  const issues = [];
  const warnings = [];
  const info = [];

  const hunger   = char.hunger_value   ?? null;
  const energy   = char.energy_value   ?? null;
  const health   = char.health_value   ?? null;
  const mental   = char.mental_value   ?? null;
  const hygiene  = char.hygiene_value  ?? null;
  const comfort  = char.comfort_value  ?? null;
  const social   = char.social_value   ?? null;

  // ── INITIALIZATION CHECK ──
  if (!char.needs_initialized) {
    issues.push('CRITICAL: needs_initialized=false — bars have NEVER been set. Every decay tick starts from null/default, causing instant runaway to critical.');
  }
  if (char.last_need_simulated_at === null || char.last_need_simulated_at === undefined) {
    issues.push('CRITICAL: last_need_simulated_at is null — elapsed-time calculation will cap at 24h on first run, causing massive single-tick decay.');
  }

  // ── CURRENT VALUES ──
  const criticalNeeds = [];
  const needMap = { hunger, energy, health, mental, hygiene, comfort, social };
  for (const [name, val] of Object.entries(needMap)) {
    if (val === null) { issues.push(`MISSING VALUE: ${name}_value is null — not decaying or recovering correctly.`); continue; }
    if (val < 10)  criticalNeeds.push(name);
    if (val < 10)  issues.push(`CRITICAL NEED: ${name}=${Math.round(val)} — at collapse threshold.`);
    else if (val < 20) warnings.push(`LOW NEED: ${name}=${Math.round(val)} — approaching crisis.`);
  }

  // ── ELAPSED TIME ISSUES ──
  const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
  const now = new Date();
  if (lastSim) {
    const elapsedHours = (now - lastSim) / 3600000;
    if (elapsedHours > 2) {
      warnings.push(`STALE SIMULATION: last simulated ${Math.round(elapsedHours * 10) / 10}h ago — decay has been accumulating unchecked.`);
    }
    if (elapsedHours > 24) {
      issues.push(`SEVERE STALENESS: last simulated ${Math.round(elapsedHours)}h ago — runaway decay likely. 24h cap was applied once, state may be severely degraded.`);
    }
    info.push(`Last simulated: ${Math.round(elapsedHours * 10) / 10}h ago`);
  }

  // ── SLEEP + ENERGY MISMATCH ──
  const sleeping = isSleeping(char);
  if (sleeping) {
    info.push(`Presence: sleeping/napping — context=sleeping — energy SHOULD be recovering at +12/hr.`);
    if (energy !== null && energy < 20) {
      issues.push(`SLEEP-RECOVERY FAILURE: Character is in sleep state but energy=${Math.round(energy)}. Energy is NOT recovering during sleep. Possible causes: (1) simulation not running, (2) stat infection loop is draining energy faster than sleep recovers it, (3) compound health crisis suppresses sleep gains.`);
    }
    if (hunger !== null && hunger < 15) {
      issues.push(`HUNGER SUPPRESSING SLEEP RECOVERY: hunger=${Math.round(hunger)} — hunger cascade actively draining energy (−2/hr * severity) even while sleeping, preventing net energy gain.`);
    }
    if (health !== null && health < 20) {
      issues.push(`HEALTH CASCADE ACTIVE DURING SLEEP: health=${Math.round(health)} — health infection drains energy −2/hr * severity even during sleep. Net energy recovery may be zero or negative.`);
    }
  }

  // ── COMPOUND CRISIS DETECTION ──
  if (criticalNeeds.length >= 3) {
    issues.push(`COMPOUND CRISIS: ${criticalNeeds.length} needs below 10 simultaneously (${criticalNeeds.join(', ')}). Multi-critical collapse active — health is taking additional −1/hr cascade damage. Character should be at emergency escalation level.`);
  }

  // ── ENERGY AT ZERO — PASS-OUT REQUIRED ──
  if (energy !== null && energy <= 0) {
    issues.push(`PASS-OUT STATE: energy=0 — character MUST be in involuntary sleep/pass-out. No active behavior should be possible. If character is still "awake" this is a pass-out logic failure.`);
  }

  // ── LOCATION CONTEXT CONFLICT ──
  const presence = char.resolved_presence_status || '';
  const locId = char.resolved_current_location_id;
  const loc = locId ? locationMap[locId] : null;
  const workLocId = char.current_work_location_id || char.occupation_location_id;

  if (presence === 'sleeping' && locId && loc) {
    const cat = (loc.category || '').toLowerCase();
    if (['social', 'food_drink', 'gym', 'workplace'].includes(cat)) {
      issues.push(`ENVIRONMENT MISMATCH: Presence=sleeping but resolved_current_location is "${loc.name}" (category="${cat}"). Character is sleeping at a non-home venue — sleep recovery context may be wrong.`);
    }
  }

  if (presence === 'at_work' && !workLocId) {
    warnings.push(`WORK LOCATION MISSING: presence=at_work but no work_location_id or occupation_location_id. Shift detection fails, context defaults to generic work.`);
  }

  // ── SCHEDULE CONFLICT ──
  const onShift = isOnShift(char);
  if (presence === 'home' && onShift) {
    warnings.push(`SCHEDULE CONFLICT: Character has active shift right now but presence=home. Should be at_work. Needs context is using home_resting instead of at_work rates.`);
  }

  // ── STUCK FLAGS ──
  if (char.is_jailed && char.jail_release_date) {
    const releaseDate = new Date(char.jail_release_date);
    if (releaseDate < now) {
      issues.push(`STALE JAIL FLAG: is_jailed=true but jail_release_date=${char.jail_release_date} is in the past. Character is stuck in jail state.`);
    }
  }

  // ── RECOVERY BLOCKER: All critical means no corrective context ──
  if (criticalNeeds.includes('hunger') && criticalNeeds.includes('energy')) {
    issues.push(`RECOVERY DEADLOCK: Both hunger AND energy are critical. Hunger cascade actively drains energy; energy being 0 prevents any activity. Character cannot self-recover — requires MANUAL OVERRIDE or automatic pass-out + hospital.`);
  }

  // ── FINANCIAL NEED ──
  const financial = char.financial_need_value ?? null;
  if (financial !== null && financial < 20) {
    warnings.push(`FINANCIAL CRISIS: financial_need_value=${Math.round(financial)} — may prevent food access and trigger hunger cascade.`);
  }

  // Summarize severity
  const severity = issues.length >= 5 ? 'CRITICAL_FAILURE'
    : issues.length >= 3 ? 'SEVERE'
    : issues.length >= 1 ? 'DEGRADED'
    : warnings.length >= 2 ? 'WARNING'
    : 'OK';

  return {
    character_id: char.id,
    character_name: char.name,
    severity,
    critical_needs: criticalNeeds,
    issues,
    warnings,
    info,
    snapshot: {
      needs_initialized: char.needs_initialized,
      last_need_simulated_at: char.last_need_simulated_at,
      resolved_presence_status: presence,
      resolved_current_location_id: locId,
      resolved_location_name: loc?.name ?? null,
      location_category: loc?.category ?? null,
      is_sleeping: sleeping,
      on_shift: onShift,
      hunger: hunger !== null ? Math.round(hunger) : null,
      energy: energy !== null ? Math.round(energy) : null,
      social: social !== null ? Math.round(social) : null,
      health: health !== null ? Math.round(health) : null,
      mental: mental !== null ? Math.round(mental) : null,
      hygiene: hygiene !== null ? Math.round(hygiene) : null,
      comfort: comfort !== null ? Math.round(comfort) : null,
      financial: financial !== null ? Math.round(financial) : null,
    }
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin-only
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const priorityName = payload.priorityCharacterName || 'Ethan Nathan Thompson';

    // Load all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.list().catch(() => []);
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Load all active created characters
    const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 300).catch(() => []);
    const activeChars = allChars.filter(c => c.character_type === 'active' && c.status === 'active');

    // ── PHASE 1: Priority Character Diagnostic ────────────────────────────────
    const priorityChar = activeChars.find(c =>
      c.name?.toLowerCase().includes(priorityName.toLowerCase().split(' ')[0].toLowerCase())
    ) || activeChars.find(c =>
      priorityName.toLowerCase().split(' ').some(part => c.name?.toLowerCase().includes(part.toLowerCase()))
    );

    let phase1 = null;
    if (priorityChar) {
      phase1 = diagnoseCharacter(priorityChar, locationMap);
      phase1.phase = 1;
      phase1.label = `Priority Character: ${priorityChar.name}`;

      // Deep-dive: load recent memories for clues on recurring failures
      const recentMemories = await base44.asServiceRole.entities.Memory.filter(
        { character_id: priorityChar.id }, '-timestamp', 20
      ).catch(() => []);
      const needsMemories = recentMemories.filter(m =>
        m.source_context?.includes('needs_simulation') ||
        m.title?.toLowerCase().includes('hunger') ||
        m.title?.toLowerCase().includes('exhaustion') ||
        m.title?.toLowerCase().includes('passed out') ||
        m.title?.toLowerCase().includes('critical')
      );
      phase1.recurring_crisis_memories = needsMemories.slice(0, 10).map(m => ({
        title: m.title,
        timestamp: m.timestamp,
        tag: m.source_context,
      }));
      phase1.recurring_crisis_count = needsMemories.length;

      if (needsMemories.length >= 3) {
        phase1.issues.push(`RECURRING PATTERN: ${needsMemories.length} needs-crisis memories found. This character is repeatedly hitting collapse thresholds — indicating chronic, not one-time failure.`);
      }
    } else {
      phase1 = {
        phase: 1,
        label: `Priority Character Not Found: ${priorityName}`,
        severity: 'NOT_FOUND',
        issues: [`Character matching "${priorityName}" not found among active created characters.`],
        warnings: [],
        info: [],
        snapshot: {},
      };
    }

    // ── PHASE 2: Global Audit ────────────────────────────────────────────────
    const globalResults = activeChars.map(c => diagnoseCharacter(c, locationMap));

    // Aggregate global stats
    const globalSeverityCounts = { CRITICAL_FAILURE: 0, SEVERE: 0, DEGRADED: 0, WARNING: 0, OK: 0 };
    const globalIssuePatterns = {};
    for (const r of globalResults) {
      globalSeverityCounts[r.severity] = (globalSeverityCounts[r.severity] || 0) + 1;
      for (const issue of r.issues) {
        // Extract pattern key
        const key = issue.split(':')[0];
        globalIssuePatterns[key] = (globalIssuePatterns[key] || 0) + 1;
      }
    }

    // Find characters sharing the same issues as priority char
    const priorityIssueKeys = (phase1.issues || []).map(i => i.split(':')[0]);
    const sharedIssueCharacters = globalResults
      .filter(r => r.character_id !== priorityChar?.id)
      .filter(r => r.issues.some(i => priorityIssueKeys.includes(i.split(':')[0])))
      .map(r => ({ name: r.character_name, severity: r.severity, shared_issues: r.issues.filter(i => priorityIssueKeys.includes(i.split(':')[0])).length }));

    // Determine which issues are Ethan-specific vs global
    const ethanSpecificIssues = [];
    const globalIssues = [];
    for (const issue of (phase1.issues || [])) {
      const key = issue.split(':')[0];
      const globalCount = globalIssuePatterns[key] || 0;
      if (globalCount <= 1) {
        ethanSpecificIssues.push(issue);
      } else {
        globalIssues.push(`[GLOBAL — ${globalCount} chars affected] ${issue}`);
      }
    }

    // Top broken characters globally
    const worstChars = globalResults
      .filter(r => r.severity !== 'OK')
      .sort((a, b) => {
        const order = { CRITICAL_FAILURE: 0, SEVERE: 1, DEGRADED: 2, WARNING: 3 };
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
      })
      .slice(0, 10)
      .map(r => ({ name: r.character_name, severity: r.severity, critical_needs: r.critical_needs, issue_count: r.issues.length }));

    // Build repair priority list
    const repairPriority = [];
    if (phase1.issues?.some(i => i.includes('needs_initialized=false'))) {
      repairPriority.push('1. RUN simulateActiveCharacterNeeds for priority character — needs_initialized=false must be resolved first.');
    }
    if (phase1.issues?.some(i => i.includes('SLEEP-RECOVERY FAILURE'))) {
      repairPriority.push('2. FIX stat infection loop: hunger/health cascade may be draining energy faster than sleep recovers. Manual override needed to break deadlock.');
    }
    if (phase1.issues?.some(i => i.includes('COMPOUND CRISIS'))) {
      repairPriority.push('3. MANUAL OVERRIDE: Use needs edit panel to stabilize all bars above 30 to break compound crisis loop.');
    }
    if (phase1.issues?.some(i => i.includes('PASS-OUT STATE'))) {
      repairPriority.push('4. TRIGGER PASS-OUT RECOVERY: energy=0 requires forced sleep context + hospital escalation logic.');
    }
    if (phase1.issues?.some(i => i.includes('RECOVERY DEADLOCK'))) {
      repairPriority.push('5. DEADLOCK RESOLUTION: Hunger+Energy both critical creates self-reinforcing loop. Must set hunger≥40 via manual override FIRST, then energy will recover naturally during next sleep cycle.');
    }
    if (globalSeverityCounts.CRITICAL_FAILURE > 0) {
      repairPriority.push(`6. GLOBAL: ${globalSeverityCounts.CRITICAL_FAILURE} other characters at CRITICAL_FAILURE level. Run batch simulateActiveCharacterNeeds immediately.`);
    }

    // Validation rules
    const validationRules = [
      'sleeping characters must show net positive energy gain unless hunger<20 OR health<20 causing cascade drain that exceeds sleep rate',
      'character cannot be initialized=true with null need values',
      'elapsed hours >24 is always a sign of automation failure — check scheduled automation for simulateActiveCharacterNeeds',
      'compound crisis (3+ needs <10) must trigger emergency escalation, not just memory logging',
      'energy=0 must trigger pass-out state change — character should NOT be shown as awake/active',
      'hunger=0 must trigger food-seeking behavior or escalation event',
      'manual override must be available for ALL active created characters',
    ];

    // Test cases
    const testCases = [
      `Set ${priorityChar?.name || priorityName} hunger to 5, energy to 5, then run simulateActiveCharacterNeeds — EXPECT: compound crisis detected, no further decay before manual intervention`,
      `Set ${priorityChar?.name || priorityName} energy to 0 — EXPECT: pass-out state, presence changes to sleeping, energy recovers on next tick`,
      `Set ${priorityChar?.name || priorityName} hunger to 5 then put in sleep context — EXPECT: sleep energy gain (12/hr) reduced by hunger cascade (severity drain), net should still be positive if health>20`,
      `Run simulateActiveCharacterNeeds for all — EXPECT: all needs_initialized=true after run`,
      `Check characters with last_need_simulated_at > 2h ago — EXPECT: stale chars get updated immediately`,
    ];

    return Response.json({
      success: true,
      priority_character: priorityName,
      timestamp: new Date().toISOString(),

      phase_1_priority_diagnostic: phase1,

      phase_2_differential: {
        ethan_specific_issues: ethanSpecificIssues,
        global_issues_also_affecting_priority_char: globalIssues,
        characters_sharing_same_issues: sharedIssueCharacters,
      },

      phase_3_global_audit: {
        total_active_created: activeChars.length,
        severity_breakdown: globalSeverityCounts,
        top_broken_characters: worstChars,
        most_common_issue_patterns: Object.entries(globalIssuePatterns)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([pattern, count]) => ({ pattern, affected_count: count })),
      },

      repair_priority: repairPriority,
      validation_rules: validationRules,
      test_cases: testCases,

      manual_override_instructions: {
        endpoint: 'manualOverrideNeeds',
        description: 'Use the ManualNeedsEditor component on the character profile to directly set any need bar value and force a simulation refresh.',
        required_fields: ['characterId', 'needs (object with any of: hunger, energy, social, health, mental, hygiene, comfort, financial)'],
      },
    });

  } catch (error) {
    console.error('[deepNeedsAudit]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});