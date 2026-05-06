/**
 * simulationGate.js
 *
 * Central simulation access control layer.
 *
 * GOVERNANCE RULE: No simulation function may fire unless:
 *   1. The character is on the active page context (chat, scene, travel, profile), OR
 *   2. A hard scheduled transition is due (sleep/wake/work/travel), OR
 *   3. The caller explicitly opts into catch-up mode (user just opened a character).
 *
 * This module tracks the active page context in a single shared object.
 * All simulation callers must call gate() before invoking backend functions.
 *
 * WRITE PRIORITY (descending):
 *   1. emergency_override
 *   2. explicit_user_action
 *   3. active_scene
 *   4. active_chat
 *   5. travel_transition
 *   6. schedule_transition (sleep/wake/work/school)
 *   7. needs_correction
 *   8. passive_idle
 *
 * Lower-priority systems must not overwrite higher-priority writes.
 */

// ── Active context registry ────────────────────────────────────────────────
// Mutated by page-level hooks when they mount/unmount.
const _context = {
  page: null,          // 'home' | 'chat' | 'scene' | 'travel' | 'profile' | null
  characterId: null,   // currently open character id (chat or profile)
  locationId: null,    // currently open location id (scene)
};

// ── Per-function, per-character cooldown registry ─────────────────────────
// Key: `${characterId}:${fnName}` → last fired timestamp (ms)
const _cooldowns = {};

// ── In-flight guard ───────────────────────────────────────────────────────
const _inFlight = {};

// ── Global rate limit flag ────────────────────────────────────────────────
// Shared via window so all hooks read the same state.
function _setGlobalRateLimit(durationMs = 60000) {
  window.__simRateLimited = true;
  console.warn(`[SimGate] Global rate limit — all simulation suspended for ${durationMs / 1000}s`);
  setTimeout(() => { window.__simRateLimited = false; }, durationMs);
}

export function isGloballyRateLimited() {
  return !!window.__simRateLimited;
}

export function reportRateLimit(durationMs = 60000) {
  _setGlobalRateLimit(durationMs);
}

// ── Context registration (called by page hooks on mount/unmount) ──────────

export function setActiveContext(updates) {
  Object.assign(_context, updates);
}

export function clearActiveContext(page) {
  // Only clear if this page is still the active one (prevents cross-page race)
  if (_context.page === page) {
    _context.page = null;
    _context.characterId = null;
    _context.locationId = null;
  }
}

export function getActiveContext() {
  return { ..._context };
}

// ── Priority write lock ───────────────────────────────────────────────────
// Tracks the current highest-priority writer per character.
// Lower-priority callers are blocked from writing.
const PRIORITY = {
  emergency_override: 1,
  explicit_user_action: 2,
  active_scene: 3,
  active_chat: 4,
  travel_transition: 5,
  schedule_transition: 6,
  needs_correction: 7,
  passive_idle: 8,
};

const _activeWriters = {}; // characterId → current priority label

export function claimWriteLock(characterId, priorityLabel) {
  const current = _activeWriters[characterId];
  const currentPriority = PRIORITY[current] || 999;
  const newPriority = PRIORITY[priorityLabel] || 999;
  if (newPriority <= currentPriority) {
    _activeWriters[characterId] = priorityLabel;
    return true; // lock claimed
  }
  console.log(`[SimGate] Write BLOCKED for char=${characterId}: "${priorityLabel}" (${newPriority}) < current "${current}" (${currentPriority})`);
  return false; // lower priority — blocked
}

export function releaseWriteLock(characterId) {
  delete _activeWriters[characterId];
}

// ── Main gate function ────────────────────────────────────────────────────

/**
 * gate(characterId, fnName, opts) → boolean
 *
 * Returns true if the simulation call is allowed to proceed.
 * Returns false if it should be suppressed.
 *
 * opts:
 *   cooldownMs        — per-character, per-function cooldown in ms (default: 60000)
 *   requirePage       — array of page names that must be active (e.g. ['chat', 'scene'])
 *   requireCharacterId — must match the currently open character (for chat/profile)
 *   allowCatchUp      — if true, bypasses page requirement (for user-triggered catch-up)
 *   hardTransition    — if true, bypasses page requirement (for scheduled transitions)
 *   priority          — write priority label for lock checking
 */
export function gate(characterId, fnName, opts = {}) {
  const {
    cooldownMs = 60000,
    requirePage = null,
    requireCharacterId = false,
    allowCatchUp = false,
    hardTransition = false,
    priority = null,
  } = opts;

  // 1. Global rate limit check
  if (window.__simRateLimited) {
    console.log(`[SimGate] BLOCKED ${fnName}(${characterId}) — global rate limit`);
    return false;
  }

  // 2. Hard transitions always bypass page checks
  if (hardTransition) {
    return _checkCooldownAndFlight(characterId, fnName, cooldownMs);
  }

  // 3. User-triggered catch-up always allowed (bypasses page check, still respects cooldown)
  if (allowCatchUp) {
    return _checkCooldownAndFlight(characterId, fnName, cooldownMs);
  }

  // 4. Page context check
  if (requirePage) {
    if (!requirePage.includes(_context.page)) {
      console.log(`[SimGate] BLOCKED ${fnName}(${characterId}) — page "${_context.page}" not in [${requirePage.join(',')}]`);
      return false;
    }
  }

  // 5. Character context check (for chat/profile-specific calls)
  if (requireCharacterId && _context.characterId !== characterId) {
    console.log(`[SimGate] BLOCKED ${fnName}(${characterId}) — active char is "${_context.characterId}"`);
    return false;
  }

  // 6. Write priority check
  if (priority && !claimWriteLock(characterId, priority)) {
    return false;
  }

  return _checkCooldownAndFlight(characterId, fnName, cooldownMs);
}

function _checkCooldownAndFlight(characterId, fnName, cooldownMs) {
  const key = `${characterId}:${fnName}`;

  // In-flight guard
  if (_inFlight[key]) {
    console.log(`[SimGate] BLOCKED ${fnName}(${characterId}) — already in-flight`);
    return false;
  }

  // Cooldown check
  const lastRun = _cooldowns[key] || 0;
  if (Date.now() - lastRun < cooldownMs) {
    console.log(`[SimGate] BLOCKED ${fnName}(${characterId}) — on cooldown (${Math.round((cooldownMs - (Date.now() - lastRun)) / 1000)}s left)`);
    return false;
  }

  return true;
}

export function markInFlight(characterId, fnName) {
  _inFlight[`${characterId}:${fnName}`] = true;
}

export function markComplete(characterId, fnName) {
  const key = `${characterId}:${fnName}`;
  _inFlight[key] = false;
  _cooldowns[key] = Date.now();
}

// ── Catch-up time calculator ──────────────────────────────────────────────

/**
 * calculateElapsedState(character, now?)
 *
 * Derives the character's current state from stored timestamps
 * without any backend call. Used by character cards and chat context builders
 * to show accurate status purely from data.
 *
 * Returns:
 *   { displayStatus, isSleeping, isWorking, isAtSchool, isTraveling, elapsedSinceLastInteractionHours }
 */
export function calculateElapsedState(character, now = new Date()) {
  const nowMs = now.getTime();

  // --- Sleep window check (derived from stored schedule, no backend needed) ---
  let isSleeping = false;
  if (character.sleep_start_time && character.wake_up_time) {
    const [sleepH, sleepM] = character.sleep_start_time.split(':').map(Number);
    const [wakeH, wakeM] = character.wake_up_time.split(':').map(Number);
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const h = nowET.getHours();
    const m = nowET.getMinutes();
    const nowMinutes = h * 60 + m;
    const sleepMinutes = sleepH * 60 + sleepM;
    const wakeMinutes = wakeH * 60 + wakeM;

    if (sleepMinutes > wakeMinutes) {
      // Sleep crosses midnight (e.g. 23:00 → 07:00)
      isSleeping = nowMinutes >= sleepMinutes || nowMinutes < wakeMinutes;
    } else {
      isSleeping = nowMinutes >= sleepMinutes && nowMinutes < wakeMinutes;
    }
  }

  // Fall back to presence status if schedule not set
  if (!isSleeping) {
    isSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
  }

  // --- Work check ---
  let isWorking = false;
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nowET.getDay();
    const h = nowET.getHours();
    const m = nowET.getMinutes();
    const nowMinutes = h * 60 + m;
    const [workStartH, workStartM] = character.work_start_time.split(':').map(Number);
    const [workEndH, workEndM] = character.work_end_time.split(':').map(Number);
    const workStart = workStartH * 60 + workStartM;
    const workEnd = workEndH * 60 + workEndM;
    isWorking = character.work_days.includes(dayOfWeek) && nowMinutes >= workStart && nowMinutes < workEnd;
  }

  // --- Travel check ---
  let isTraveling = false;
  let travelArrived = false;
  if (character.travel_departure_time && character.travel_arrival_time) {
    const dep = new Date(character.travel_departure_time).getTime();
    const arr = new Date(character.travel_arrival_time).getTime();
    isTraveling = nowMs >= dep && nowMs < arr;
    travelArrived = nowMs >= arr;
  }

  // --- Elapsed since last interaction ---
  const lastInteractionMs = character.last_interaction_at
    ? new Date(character.last_interaction_at).getTime()
    : null;
  const elapsedSinceLastInteractionHours = lastInteractionMs
    ? (nowMs - lastInteractionMs) / 3600000
    : null;

  // --- Task progress ---
  let taskProgressPercent = null;
  if (character.current_task_started_at && character.current_task_expected_end_at) {
    const start = new Date(character.current_task_started_at).getTime();
    const end = new Date(character.current_task_expected_end_at).getTime();
    const total = end - start;
    const elapsed = nowMs - start;
    taskProgressPercent = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : null;
  }

  // --- Display status ---
  let displayStatus = 'idle';
  if (isSleeping) displayStatus = 'sleeping';
  else if (isWorking) displayStatus = 'at_work';
  else if (character.resolved_presence_status === 'at_school') displayStatus = 'at_school';
  else if (isTraveling) displayStatus = 'traveling';
  else if (character.resolved_presence_status === 'visiting' || character.resolved_presence_status === 'at_location') displayStatus = 'visiting';
  else if (character.resolved_presence_status === 'home') displayStatus = 'home';

  return {
    displayStatus,
    isSleeping,
    isWorking,
    isAtSchool: character.resolved_presence_status === 'at_school',
    isTraveling,
    travelArrived,
    elapsedSinceLastInteractionHours,
    taskProgressPercent,
    taskIsComplete: taskProgressPercent !== null && taskProgressPercent >= 100,
  };
}

/**
 * buildCatchUpContext(character)
 *
 * Returns a plain-English summary of how much time has passed
 * and what the character has been doing. Injected into LLM prompts
 * on first message after a gap, so the character speaks from
 * the correct elapsed state.
 */
export function buildCatchUpContext(character, now = new Date()) {
  const state = calculateElapsedState(character, now);
  const lines = [];

  if (state.elapsedSinceLastInteractionHours !== null) {
    const h = state.elapsedSinceLastInteractionHours;
    if (h > 24 * 7) {
      lines.push(`It has been about ${Math.round(h / 24)} days since you last spoke.`);
    } else if (h > 24) {
      lines.push(`It has been about ${Math.round(h / 24)} day(s) since you last spoke.`);
    } else if (h > 1) {
      lines.push(`About ${Math.round(h)} hours have passed since you last spoke.`);
    }
  }

  if (state.isSleeping) {
    lines.push(`${character.name?.split(' ')[0]} is currently asleep and should not be disturbed unless the user explicitly wakes them.`);
  } else if (state.isWorking) {
    lines.push(`${character.name?.split(' ')[0]} is currently at work.`);
  } else if (state.isTraveling) {
    lines.push(`${character.name?.split(' ')[0]} is currently traveling.`);
  } else if (state.travelArrived) {
    lines.push(`${character.name?.split(' ')[0]} has recently arrived at their destination.`);
  }

  if (state.taskProgressPercent !== null && !state.taskIsComplete) {
    lines.push(`Their current task is about ${state.taskProgressPercent}% complete.`);
  } else if (state.taskIsComplete) {
    lines.push(`Their current task should be complete by now.`);
  }

  return lines.length > 0 ? `[CATCH-UP CONTEXT]\n${lines.join('\n')}\n[END CATCH-UP]` : '';
}