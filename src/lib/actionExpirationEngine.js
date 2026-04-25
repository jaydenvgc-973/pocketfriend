/**
 * ACTION EXPIRATION ENGINE
 * 
 * Enforces action duration limits + resolves expired actions with need updates.
 * MUST be called before generating any response or narrative.
 * 
 * Exported:
 *   classifyActionDuration(actionType, character) → { duration_ms, category }
 *   resolveExpiredAction(character, actionType, timestamp) → { expired: bool, needUpdates: obj, nextState: string }
 *   enforceTimeReconciliation(character, lastActionTimestamp) → { resolved: bool, updates: obj, expired: bool }
 */

/**
 * Maps action types to realistic durations in milliseconds.
 * Used to determine when an action is complete.
 */
const ACTION_DURATIONS = {
  // MICRO-ACTIONS: 2–20 minutes
  'making_coffee':      { min: 3, max: 7, ms: 5 * 60 * 1000 },
  'cooking_eggs':       { min: 3, max: 5, ms: 4 * 60 * 1000 },
  'cooking_breakfast':  { min: 10, max: 20, ms: 15 * 60 * 1000 },
  'eating_breakfast':   { min: 10, max: 20, ms: 15 * 60 * 1000 },
  'eating_lunch':       { min: 15, max: 45, ms: 30 * 60 * 1000 },
  'eating_dinner':      { min: 20, max: 60, ms: 40 * 60 * 1000 },
  'eating_snack':       { min: 5, max: 15, ms: 10 * 60 * 1000 },
  'drinking_coffee':    { min: 5, max: 15, ms: 10 * 60 * 1000 },
  'brushing_teeth':     { min: 2, max: 5, ms: 3 * 60 * 1000 },
  'washing_face':       { min: 2, max: 5, ms: 3 * 60 * 1000 },
  'quick_shower':       { min: 10, max: 20, ms: 15 * 60 * 1000 },
  'full_shower':        { min: 15, max: 30, ms: 20 * 60 * 1000 },
  'changing_clothes':   { min: 3, max: 10, ms: 6 * 60 * 1000 },
  'grabbing_item':      { min: 1, max: 5, ms: 3 * 60 * 1000 },

  // MEDIUM-ACTIONS: 30–180 minutes
  'cooking_meal':       { min: 30, max: 90, ms: 60 * 60 * 1000 },
  'full_meal':          { min: 30, max: 60, ms: 45 * 60 * 1000 },
  'workout':            { min: 30, max: 90, ms: 60 * 60 * 1000 },
  'gym_session':        { min: 45, max: 120, ms: 75 * 60 * 1000 },
  'errands':            { min: 30, max: 120, ms: 75 * 60 * 1000 },
  'shopping':           { min: 30, max: 120, ms: 75 * 60 * 1000 },
  'social_visit':       { min: 30, max: 180, ms: 90 * 60 * 1000 },
  'casual_hangout':     { min: 30, max: 120, ms: 75 * 60 * 1000 },
  'dinner_out':         { min: 60, max: 180, ms: 90 * 60 * 1000 },
  'commute':            { min: 15, max: 60, ms: 30 * 60 * 1000 },
  'travel_block':       { min: 30, max: 120, ms: 60 * 60 * 1000 },

  // LONG-ACTIONS: Schedule-based (hours)
  'work_shift':         { ms: null, note: 'Use schedule fields' },
  'school_class':       { ms: null, note: 'Use schedule fields' },
  'sleep':              { ms: null, note: 'Use schedule fields' },
  'resting':            { min: 20, max: 60, ms: 30 * 60 * 1000 },
  'napping':            { min: 30, max: 120, ms: 60 * 60 * 1000 },
};

/**
 * Classifies action duration by type.
 * Returns { duration_ms, category, min, max }
 */
export function classifyActionDuration(actionType, character = null) {
  const action = actionType?.toLowerCase().trim() || 'unknown';
  const entry = ACTION_DURATIONS[action];

  if (!entry) {
    // Unknown action — default to 15 minutes
    console.warn(`[actionExpiration] Unknown action type: "${actionType}" — defaulting to 15 min`);
    return { duration_ms: 15 * 60 * 1000, category: 'unknown', min: 10, max: 20 };
  }

  if (entry.ms === null) {
    // Schedule-based action
    console.log(`[actionExpiration] Action "${action}" is schedule-based — cannot expire by duration alone`);
    return { duration_ms: null, category: 'scheduled', min: null, max: null };
  }

  return {
    duration_ms: entry.ms,
    category: entry.min && entry.min <= 20 ? 'micro' : entry.min <= 180 ? 'medium' : 'long',
    min: entry.min,
    max: entry.max,
  };
}

/**
 * Determines if an action has expired and what needs to update.
 * 
 * Returns: { expired: bool, needUpdates: { field: change }, nextState: string }
 */
export function resolveExpiredAction(character, actionType, timestamp) {
  if (!character || !actionType || !timestamp) {
    return { expired: false, needUpdates: {}, nextState: null };
  }

  const elapsed = Date.now() - new Date(timestamp).getTime();
  const classified = classifyActionDuration(actionType, character);

  // Schedule-based actions do not auto-expire by duration
  if (classified.category === 'scheduled') {
    console.log(`[actionExpiration] Action "${actionType}" is schedule-based — skipping duration check`);
    return { expired: false, needUpdates: {}, nextState: null };
  }

  if (!classified.duration_ms) {
    return { expired: false, needUpdates: {}, nextState: null };
  }

  const isExpired = elapsed > classified.duration_ms;

  if (!isExpired) {
    const remaining = classified.duration_ms - elapsed;
    console.log(`[actionExpiration] Action "${actionType}" not expired — ${Math.round(remaining / 1000)}s remaining`);
    return { expired: false, needUpdates: {}, nextState: null };
  }

  // Action has expired — determine need updates
  const needUpdates = {};
  const normalizedAction = actionType.toLowerCase();

  // Eating actions improve hunger
  if (normalizedAction.includes('eat') || normalizedAction.includes('meal') || normalizedAction.includes('food')) {
    needUpdates.hunger_value = Math.min(100, (character.hunger_value || 70) + 30);
  }

  // Sleep/rest actions improve energy
  if (normalizedAction.includes('sleep') || normalizedAction.includes('nap') || normalizedAction.includes('rest')) {
    needUpdates.energy_value = Math.min(100, (character.energy_value || 75) + 40);
  }

  // Shower/hygiene improves hygiene
  if (normalizedAction.includes('shower') || normalizedAction.includes('wash') || normalizedAction.includes('bathe')) {
    needUpdates.hygiene_value = Math.min(100, (character.hygiene_value || 75) + 35);
  }

  // Social/hangout improves social
  if (normalizedAction.includes('social') || normalizedAction.includes('hangout') || normalizedAction.includes('visit')) {
    needUpdates.social_value = Math.min(100, (character.social_value || 65) + 25);
  }

  // Workout decreases energy, may improve health
  if (normalizedAction.includes('workout') || normalizedAction.includes('gym') || normalizedAction.includes('exercise')) {
    needUpdates.energy_value = Math.max(0, (character.energy_value || 75) - 20);
    needUpdates.health_value = Math.min(100, (character.health_value || 80) + 10);
  }

  console.log(`[actionExpiration] ✓ Action "${actionType}" EXPIRED after ${Math.round(elapsed / 60000)} min | Updates: ${JSON.stringify(needUpdates)}`);

  return {
    expired: true,
    needUpdates,
    nextState: 'completed_action',
  };
}

/**
 * MAIN RECONCILIATION FUNCTION
 * 
 * Called BEFORE any response generation.
 * Ensures character state reflects time passage + completed actions.
 * 
 * Returns: { resolved: bool, updates: obj, expired: bool, elapsedLabel: string }
 */
export function enforceTimeReconciliation(character, lastActionTimestamp) {
  if (!character || !lastActionTimestamp) {
    return { resolved: true, updates: {}, expired: false, elapsedLabel: 'unknown' };
  }

  const elapsed = Date.now() - new Date(lastActionTimestamp).getTime();
  const elapsedMin = Math.round(elapsed / 60000);
  const elapsedHours = Math.round(elapsed / 3600000);

  // Determine if significant time has passed
  const significantGap = elapsed > 5 * 60 * 1000; // > 5 minutes

  if (!significantGap) {
    console.log(`[timeReconciliation] Only ${elapsedMin}m elapsed — no reconciliation needed`);
    return {
      resolved: false,
      updates: {},
      expired: false,
      elapsedLabel: `${elapsedMin}m ago`,
    };
  }

  // Significant time passed — check current action + needs drift
  const currentAction = character.current_activity || null;
  const lastNeedsSnapshot = character.needs_snapshot || {};

  let needsUpdates = {};
  let expired = false;

  // If character has a current_activity and time has passed, it should be completed
  if (currentAction && elapsedMin > 30) {
    // Micro-action (cooking, eating, etc.) should be done by now
    const classified = classifyActionDuration(currentAction);
    if (classified.duration_ms && elapsed > classified.duration_ms) {
      console.log(`[timeReconciliation] Current action "${currentAction}" has EXPIRED (${elapsedMin}m elapsed)`);
      const resolution = resolveExpiredAction(character, currentAction, lastActionTimestamp);
      needsUpdates = resolution.needUpdates;
      expired = true;
    }
  }

  // General drift: if 2+ hours passed, force needs recalculation based on time-of-day
  // (this is handled by the narrative/response generation, not here)

  return {
    resolved: true,
    updates: needsUpdates,
    expired,
    elapsedLabel: elapsedHours > 0 ? `${elapsedHours}h ago` : `${elapsedMin}m ago`,
  };
}