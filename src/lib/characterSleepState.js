/**
 * getCharacterSleepState — DB-Only Sleep Classification
 *
 * ONE TRUTH RULE: resolved_presence_status is the SOLE source of truth for sleep state.
 * It is written by backend automations (enforceSlowdownSleep, simulateActiveCharacterNeeds, etc.)
 * and is the same field read by Travel, Text, Chat, Home, and the Map.
 *
 * FORBIDDEN: Inferring sleep from energy values, schedule windows, or any other derived logic.
 * Doing so creates a second truth that diverges from what Travel/Text/Map show → one-truth violation.
 *
 * If DB says sleeping  → isSleeping: true   (all pages agree)
 * If DB says napping   → isSleeping: true   (all pages agree)
 * If DB says anything else → isSleeping: false (all pages agree)
 */

export function getCharacterSleepState(character) {
  if (!character) {
    return {
      isSleeping: false,
      isNapping: false,
      displayLabel: 'unknown',
      contextLabel: null,
      visible_label: null,
      confirmed_reason: null,
      evidence_source: null,
      confidence: 0,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  const status = character.resolved_presence_status || '';
  const reason = character.resolved_source_reason || '';

  // ── SLEEPING ─────────────────────────────────────────────────────────────────
  if (status === 'sleeping') {
    return {
      isSleeping: true,
      isNapping: false,
      displayLabel: 'sleeping',
      contextLabel: 'Asleep',
      visible_label: 'Asleep',
      confirmed_reason: reason || 'db_sleeping',
      evidence_source: 'resolved_presence_status',
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── NAPPING ──────────────────────────────────────────────────────────────────
  if (status === 'napping') {
    return {
      isSleeping: true,
      isNapping: true,
      displayLabel: 'napping',
      contextLabel: 'Resting',
      visible_label: 'Resting',
      confirmed_reason: reason || 'db_napping',
      evidence_source: 'resolved_presence_status',
      confidence: 1,
      stale_risk: false,
      isLikelyStale: false,
      blockingCondition: null,
    };
  }

  // ── ALL OTHER STATES: AWAKE ───────────────────────────────────────────────────
  // This covers: home, at_work, at_school, visiting, traveling, and any other DB status.
  // Never infer sleep from energy, schedule windows, or time-of-day here.
  // If a character should be sleeping, the backend must write resolved_presence_status='sleeping'.
  return {
    isSleeping: false,
    isNapping: false,
    displayLabel: 'awake',
    contextLabel: null,
    visible_label: null,
    confirmed_reason: null,
    evidence_source: 'resolved_presence_status',
    confidence: 1,
    stale_risk: false,
    isLikelyStale: false,
    blockingCondition: null,
  };
}

export default getCharacterSleepState;