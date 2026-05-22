/**
 * characterSleepState.js
 *
 * CANONICAL sleep state resolver.
 * This is the single source of truth for sleep state across:
 *   - Home cards (CharacterCard)
 *   - AlarmTool
 *   - Chat header
 *   - Background task governor
 *   - Presence resolver
 *
 * PRIORITY ORDER (first match wins):
 *   1. resolved_presence_status = 'sleeping' | 'napping' → backend confirmed sleep
 *   2. location_status = 'sleeping' | 'napping'          → legacy field
 *   3. current_activity contains sleep keywords           → activity-derived
 *   4. sleep_start_time + wake_up_time schedule check     → schedule-derived (ET clock)
 *   5. last_sleep_start within 8h + no wake activity     → heuristic fallback
 *   6. Default: awake (fail-safe — never assume sleep without evidence)
 *
 * NEVER changes character data. Read-only, pure derivation.
 *
 * SLEEP STATE CLASSIFICATION:
 * The system distinguishes actual scheduled sleep from emotional/behavioral inactivity.
 * When energy is high and comfort is high but the character is still in "sleeping" state
 * with no active schedule, this is classified as emotional/social withdrawal, not true sleep.
 *
 * sleep_type:
 *   'scheduled'          — inside sleep_start_time / wake_up_time window
 *   'social_depletion'   — social < 20, energy >= 70 → isolating / withdrawing
 *   'exhaustion'         — energy < 30 → exhaustion crash
 *   'stress'             — mental < 30 → stress/depression retreat
 *   'recovery'           — sleep_debt_hours > 2 → recovery sleep
 *   'nap'                — short nap
 *   'stale'              — none of the above valid reasons → likely stale state
 *   'unknown'            — cannot determine
 */

const SLEEP_ACTIVITY_KEYWORDS = /\b(asleep|sleeping|napping|nap|bedtime|woke up|just woke|alarm went|going to sleep|went to sleep|in bed asleep|lying in bed)\b/i;
const NAPPING_KEYWORDS = /\b(napping|nap|resting|took a nap)\b/i;

/**
 * getCharacterSleepState(character) → SleepState
 *
 * Returns:
 *   isSleeping       {boolean}  — true if any sleep signal is active
 *   isNapping        {boolean}  — true if nap specifically
 *   isAwake          {boolean}  — !isSleeping
 *   sleepStateSource {string}  — which field made the decision (for diagnostics)
 *   shouldAllowAlarm {boolean} — whether Ring Now should be enabled
 *   displayLabel     {string}  — short human-readable label for UI header
 *   contextLabel     {string}  — rich contextual label explaining WHY (for chat header, home card)
 *   sleepType        {string}  — classification: scheduled|social_depletion|exhaustion|stress|recovery|nap|stale|unknown
 *   isLikelyStale    {boolean} — true when the state appears invalid based on needs
 *   blockingCondition {string|null} — the specific need/condition keeping them inactive
 */
export function getCharacterSleepState(character) {
  if (!character) {
    return {
      isSleeping: false, isNapping: false, isAwake: true,
      sleepStateSource: 'no_character', shouldAllowAlarm: false,
      displayLabel: 'Unknown',
    };
  }

  const rps = character.resolved_presence_status || '';
  const ls  = character.location_status || '';
  const ca  = (character.current_activity || '').toLowerCase();

  // ── LOG: emit diagnostics every time this is called ─────────────────────
  console.log(`[SleepState] char=${character.id} name="${character.name}"`);
  console.log(`[SleepState]   resolved_presence_status: ${rps || '(not set)'}`);
  console.log(`[SleepState]   location_status:          ${ls || '(not set)'}`);
  console.log(`[SleepState]   current_activity:         ${character.current_activity || '(not set)'}`);
  console.log(`[SleepState]   sleep_start_time:         ${character.sleep_start_time || '(not set)'}`);
  console.log(`[SleepState]   wake_up_time:             ${character.wake_up_time || '(not set)'}`);
  console.log(`[SleepState]   last_sleep_start:         ${character.last_sleep_start || '(not set)'}`);
  console.log(`[SleepState]   last_nap_time:            ${character.last_nap_time || '(not set)'}`);

  // ── PRIORITY 1: resolved_presence_status (backend-confirmed, most authoritative) ──
  if (rps === 'sleeping') {
    _log('resolved_presence_status=sleeping', false, true);
    const ctx = _classifySleepContext(character);
    return _makeRich(true, false, 'resolved_presence_status', ctx);
  }
  if (rps === 'napping') {
    _log('resolved_presence_status=napping', true, true);
    return _makeRich(true, true, 'resolved_presence_status', { sleepType: 'nap', displayLabel: '💤 napping', contextLabel: 'Taking a nap', blockingCondition: null, isLikelyStale: false });
  }

  // ── PRIORITY 2: location_status legacy field ──────────────────────────────
  if (ls === 'sleeping') {
    _log('location_status=sleeping', false, true);
    const ctx = _classifySleepContext(character);
    return _makeRich(true, false, 'location_status', ctx);
  }
  if (ls === 'napping') {
    _log('location_status=napping', true, true);
    return _makeRich(true, true, 'location_status', { sleepType: 'nap', displayLabel: '💤 napping', contextLabel: 'Taking a nap', blockingCondition: null, isLikelyStale: false });
  }

  // ── PRIORITY 3: current_activity keyword match ────────────────────────────
  if (SLEEP_ACTIVITY_KEYWORDS.test(ca)) {
    const isNap = NAPPING_KEYWORDS.test(ca);
    _log(`current_activity="${character.current_activity}"`, isNap, true);
    const ctx = isNap
      ? { sleepType: 'nap', displayLabel: '💤 napping', contextLabel: 'Taking a nap', blockingCondition: null, isLikelyStale: false }
      : _classifySleepContext(character);
    return _makeRich(true, isNap, 'current_activity', ctx);
  }

  // ── PRIORITY 4: schedule-derived (ET clock vs sleep_start/wake_up times) ──
  if (character.sleep_start_time && character.wake_up_time) {
    const schedResult = _scheduleCheck(character);
    if (schedResult !== null) {
      _log(`schedule(${character.sleep_start_time}→${character.wake_up_time})`, false, schedResult);
      if (schedResult) {
        return _makeRich(true, false, 'schedule', {
          sleepType: 'scheduled',
          displayLabel: '🌙 sleeping',
          contextLabel: `Asleep until ${character.wake_up_time || 'scheduled time'}`,
          blockingCondition: 'scheduled_sleep_window',
          isLikelyStale: false,
        });
      }
    }
  }

  // ── PRIORITY 5: last_sleep_start heuristic ───────────────────────────────
  // If character fell asleep within the last 8 hours and no active wake signal,
  // treat as still sleeping. Only applies if no conflicting awake signals.
  if (character.last_sleep_start) {
    const hoursSince = (Date.now() - new Date(character.last_sleep_start).getTime()) / 3600000;
    const hasAwakeSignal = /\b(awake|woke|up|active|working|at work|eating|gym|out|traveling)\b/i.test(ca);
    if (hoursSince < 8 && !hasAwakeSignal && rps !== 'home' && rps !== 'at_work' && rps !== 'at_school' && rps !== 'visiting') {
      _log(`last_sleep_start heuristic (${hoursSince.toFixed(1)}h ago)`, false, true);
      const ctx = _classifySleepContext(character);
      return _makeRich(true, false, 'last_sleep_start_heuristic', ctx);
    }
  }

  // ── PRIORITY 6: default — awake ───────────────────────────────────────────
  _log('default', false, false);
  return _makeRich(false, false, 'default_awake', { sleepType: 'none', displayLabel: 'awake', contextLabel: 'Awake', blockingCondition: null, isLikelyStale: false });
}

/**
 * _classifySleepContext — determine WHY the character is in a sleep/inactive state.
 * This is where we separate scheduled sleep from emotional withdrawal from stale states.
 */
function _classifySleepContext(character) {
  const energy = character.energy_value ?? 75;
  const social = character.social_value ?? 65;
  const mental = character.mental_value ?? 70;
  const comfort = character.comfort_value ?? 70;
  const health = character.health_value ?? 80;
  const sleepDebt = character.sleep_debt_hours || 0;
  const rps = character.resolved_presence_status || '';
  const sleepSource = character.resolved_source_reason || '';

  // ── Scheduled sleep: character is inside their sleep window ──────────────
  if (character.sleep_start_time && character.wake_up_time) {
    const inWindow = _scheduleCheck(character);
    if (inWindow) {
      return {
        sleepType: 'scheduled',
        displayLabel: '🌙 sleeping',
        contextLabel: `Asleep until ${character.wake_up_time}`,
        blockingCondition: 'scheduled_sleep_window',
        isLikelyStale: false,
      };
    }
  }

  // ── Recovery sleep: significant sleep debt ────────────────────────────────
  if (sleepDebt >= 2) {
    return {
      sleepType: 'recovery',
      displayLabel: '🌙 recovering',
      contextLabel: 'Sleeping to recover from exhaustion',
      blockingCondition: `sleep_debt:${sleepDebt.toFixed(1)}h`,
      isLikelyStale: false,
    };
  }

  // ── Exhaustion crash: very low energy ────────────────────────────────────
  if (energy < 30) {
    return {
      sleepType: 'exhaustion',
      displayLabel: '🌙 exhausted',
      contextLabel: 'Crashed from exhaustion',
      blockingCondition: `energy:${Math.round(energy)}`,
      isLikelyStale: false,
    };
  }

  // ── Illness/health crisis ─────────────────────────────────────────────────
  if (health < 30) {
    return {
      sleepType: 'illness',
      displayLabel: '🌙 resting (unwell)',
      contextLabel: 'Resting due to health',
      blockingCondition: `health:${Math.round(health)}`,
      isLikelyStale: false,
    };
  }

  // ── Stress / mental depletion ─────────────────────────────────────────────
  if (mental < 30) {
    return {
      sleepType: 'stress',
      displayLabel: '🌙 depressed/withdrawn',
      contextLabel: 'Retreating due to mental stress',
      blockingCondition: `mental:${Math.round(mental)}`,
      isLikelyStale: false,
    };
  }

  // ── Social depletion: energy and comfort are fine, but social is critically low ──
  // This is the James Anderson case: Energy=100, Comfort=100, Social=0
  // Character is NOT asleep — they are emotionally withdrawing from people
  if (social < 20 && energy >= 60 && comfort >= 60) {
    return {
      sleepType: 'social_depletion',
      displayLabel: '🌙 laying low',
      contextLabel: 'Withdrawing — social battery depleted',
      blockingCondition: `social:${Math.round(social)}`,
      isLikelyStale: false,
    };
  }

  // ── Avoidance / low comfort (not fully depleted but withdrawing) ──────────
  if (comfort < 40) {
    return {
      sleepType: 'avoidance',
      displayLabel: '🌙 isolating',
      contextLabel: 'Resting — emotionally low',
      blockingCondition: `comfort:${Math.round(comfort)}`,
      isLikelyStale: false,
    };
  }

  // ── High energy + high comfort + no schedule + sleeping = STALE STATE ─────
  // This is the definitive stale state: character has no reason to be sleeping
  if (energy >= 80 && comfort >= 70 && social >= 30) {
    return {
      sleepType: 'stale',
      displayLabel: '🌙 sleeping?',
      contextLabel: 'Sleep state may be stale — no active reason detected',
      blockingCondition: null,
      isLikelyStale: true,
    };
  }

  // ── Fallback: mildly low social or moderate fatigue ──────────────────────
  if (social < 40) {
    return {
      sleepType: 'social_depletion',
      displayLabel: '🌙 resting',
      contextLabel: 'Resting — low social energy',
      blockingCondition: `social:${Math.round(social)}`,
      isLikelyStale: false,
    };
  }

  return {
    sleepType: 'unknown',
    displayLabel: '🌙 sleeping',
    contextLabel: 'Resting',
    blockingCondition: null,
    isLikelyStale: false,
  };
}

function _scheduleCheck(character) {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const curMin = nowET.getHours() * 60 + nowET.getMinutes();
  const sleepMin = toMin(character.sleep_start_time);
  const wakeMin  = toMin(character.wake_up_time);

  if (sleepMin > wakeMin) {
    // Crosses midnight: sleep 23:00 → wake 07:00
    return curMin >= sleepMin || curMin < wakeMin;
  }
  return curMin >= sleepMin && curMin < wakeMin;
}

function _makeRich(isSleeping, isNapping, source, ctx) {
  return {
    isSleeping,
    isNapping,
    isAwake: !isSleeping,
    sleepStateSource: source,
    shouldAllowAlarm: isSleeping,
    displayLabel: ctx.displayLabel || (isSleeping ? '🌙 sleeping' : 'awake'),
    contextLabel: ctx.contextLabel || ctx.displayLabel || 'Resting',
    sleepType: ctx.sleepType || 'unknown',
    isLikelyStale: ctx.isLikelyStale || false,
    blockingCondition: ctx.blockingCondition || null,
  };
}

// Backward-compatible alias so existing callers that use _make still work
function _make(isSleeping, isNapping, source, label) {
  return _makeRich(isSleeping, isNapping, source, {
    sleepType: isNapping ? 'nap' : 'unknown',
    displayLabel: label,
    contextLabel: label,
    blockingCondition: null,
    isLikelyStale: false,
  });
}

function _log(source, isNap, isSleeping) {
  console.log(`[SleepState]   → final isSleeping=${isSleeping} | source="${source}"${isNap ? ' (nap)' : ''}`);
}