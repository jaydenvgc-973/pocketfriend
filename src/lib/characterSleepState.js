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
 */

const SLEEP_ACTIVITY_KEYWORDS = /\b(asleep|sleeping|napping|nap|bedtime|woke up|just woke|alarm went|going to sleep|went to sleep|in bed asleep|lying in bed)\b/i;
const NAPPING_KEYWORDS = /\b(napping|nap|resting|took a nap)\b/i;

/**
 * getCharacterSleepState(character) → SleepState
 *
 * Returns:
 *   isSleeping    {boolean}  — true if any sleep signal is active
 *   isNapping     {boolean}  — true if nap specifically
 *   isAwake       {boolean}  — !isSleeping
 *   sleepStateSource {string} — which field made the decision (for diagnostics)
 *   shouldAllowAlarm {boolean} — whether Ring Now should be enabled
 *   displayLabel  {string}  — human-readable label for UI
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
    return _make(true, false, 'resolved_presence_status', 'sleeping');
  }
  if (rps === 'napping') {
    _log('resolved_presence_status=napping', true, true);
    return _make(true, true, 'resolved_presence_status', 'napping');
  }

  // ── PRIORITY 2: location_status legacy field ──────────────────────────────
  if (ls === 'sleeping') {
    _log('location_status=sleeping', false, true);
    return _make(true, false, 'location_status', 'sleeping');
  }
  if (ls === 'napping') {
    _log('location_status=napping', true, true);
    return _make(true, true, 'location_status', 'napping');
  }

  // ── PRIORITY 3: current_activity keyword match ────────────────────────────
  if (SLEEP_ACTIVITY_KEYWORDS.test(ca)) {
    const isNap = NAPPING_KEYWORDS.test(ca);
    _log(`current_activity="${character.current_activity}"`, isNap, true);
    return _make(true, isNap, 'current_activity', isNap ? 'napping' : 'sleeping');
  }

  // ── PRIORITY 4: schedule-derived (ET clock vs sleep_start/wake_up times) ──
  if (character.sleep_start_time && character.wake_up_time) {
    const schedResult = _scheduleCheck(character);
    if (schedResult !== null) {
      _log(`schedule(${character.sleep_start_time}→${character.wake_up_time})`, false, schedResult);
      if (schedResult) return _make(true, false, 'schedule', 'sleeping (scheduled)');
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
      return _make(true, false, 'last_sleep_start_heuristic', 'sleeping (estimated)');
    }
  }

  // ── PRIORITY 6: default — awake ───────────────────────────────────────────
  _log('default', false, false);
  return _make(false, false, 'default_awake', 'awake');
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

function _make(isSleeping, isNapping, source, label) {
  return {
    isSleeping,
    isNapping,
    isAwake: !isSleeping,
    sleepStateSource: source,
    shouldAllowAlarm: isSleeping, // alarm only makes sense when sleeping
    displayLabel: label,
  };
}

function _log(source, isNap, isSleeping) {
  console.log(`[SleepState]   → final isSleeping=${isSleeping} | source="${source}"${isNap ? ' (nap)' : ''}`);
}