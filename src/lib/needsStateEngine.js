/**
 * ════════════════════════════════════════════════════════════════════════════
 * ENERGY SYSTEM — BEHAVIORAL PHILOSOPHY
 * Required context for all prompt generation and autonomous behavior.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * APPLIES ONLY TO: active_created_character records.
 *
 * ── ENERGY INFLUENCES DECISIONS — DOES NOT ERASE PERSONALITY ────────────
 * Energy should influence mood, comfort, focus, patience, and decision-making.
 * Energy should NOT override personality or reduce all characters to the same behavior.
 *
 * Two characters with identical energy levels may make completely different choices:
 *   - One goes home to sleep
 *   - One drinks coffee and keeps working
 *   - One takes a nap before going out
 *   - One continues socializing
 *   - One finishes a project
 * All of these may be valid depending on personality, schedule, and context.
 *
 * ── ENERGY BANDS AND BEHAVIORAL GUIDANCE ─────────────────────────────────
 *
 * ~80–100 (strong):
 *   Character is energized. May plan ahead, take on tasks, socialize comfortably.
 *   Does NOT mean the character no longer needs sleep. Energy is currently available.
 *   May choose a later approved sleep window.
 *
 * ~60–79 (stable):
 *   Normal functioning. No urgent energy concerns.
 *   Character operates at full capacity.
 *
 * ~40–59 (reduced):
 *   Character begins noticing energy. May still function normally for most tasks.
 *   Around 50%: character may begin planning ahead.
 *     - May consider a nap before a long evening
 *     - May proactively drink coffee if significant obligations remain
 *     - May think about sleep timing relative to tomorrow's schedule
 *   This is PLANNING behavior, not crisis behavior.
 *
 * ~20–39 (low):
 *   Character experiences irritability, crankiness, reduced comfort, reduced patience.
 *   Character becomes increasingly interested in sleep, naps, coffee, energy drinks.
 *   High-effort activities should be avoided or reduced.
 *   Character may still function if they have obligations or caffeine support.
 *
 * 0–19 (critical):
 *   Character is significantly impaired. Activities are low-key, slow, or restful.
 *   Sleep, nap, or recovery is the realistic next action.
 *   Character remains capable of personality-consistent responses but is clearly drained.
 *
 * ── CAFFEINE IN THE ENERGY SYSTEM ────────────────────────────────────────
 * Coffee and energy drinks may raise or maintain energy — but NEVER to 100%.
 * Cap: approximately 95%. The final recovery gap requires actual rest.
 * Caffeine does not freeze energy decay. It supports and delays, not eliminates.
 * Excessive caffeine chaining is unhealthy and must NOT be treated as optimal.
 *
 * See sleepUtils.js for full caffeine and nap rules.
 *
 * ── NEEDS ARE CURRENT AND AUTHORITATIVE ──────────────────────────────────
 * Every output — dialogue, actions, plans, refusals — must be consistent
 * with current need states. Memory provides context; it does not override
 * current values. Stale context must yield to current need truth.
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * LIVE NEEDS STATE ENGINE
 * Single source of truth for character needs interpretation.
 * Every module that generates dialogue, narrative, travel, or behavior
 * must derive its needs context from this file.
 */

// Band thresholds
const BANDS = [
  { label: 'critical', min: 0,  max: 19  },
  { label: 'low',      min: 20, max: 39  },
  { label: 'reduced',  min: 40, max: 59  },
  { label: 'stable',   min: 60, max: 79  },
  { label: 'strong',   min: 80, max: 100 },
];

export function getNeedBand(value) {
  const v = Math.max(0, Math.min(100, value ?? 70));
  return BANDS.find(b => v >= b.min && v <= b.max)?.label ?? 'stable';
}

/**
 * Convert a character's raw need values into labeled state bands.
 * Returns an object like { hunger: 'critical', energy: 'strong', ... }
 */
export function getNeedStates(character) {
  return {
    hunger:    getNeedBand(character.hunger_value),
    energy:    getNeedBand(character.energy_value),
    social:    getNeedBand(character.social_value),
    health:    getNeedBand(character.health_value),
    mental:    getNeedBand(character.mental_value),
    financial: getNeedBand(character.financial_need_value),
    hygiene:   getNeedBand(character.hygiene_value),
    comfort:   getNeedBand(character.comfort_value),
  };
}

/**
 * Build a compact, human-readable needs summary line.
 * Example: "energy=strong | hunger=low | mental=reduced | ..."
 */
export function buildNeedsSummaryLine(character) {
  const s = getNeedStates(character);
  return Object.entries(s).map(([k, v]) => `${k}=${v}`).join(' | ');
}

/**
 * Build the full LIVE NEEDS CONSISTENCY ENFORCEMENT block
 * to be injected into every LLM prompt (chat, narrative, autonomous behavior, scene).
 *
 * This is the canonical block. Do NOT write custom need injections elsewhere.
 */
export function buildNeedsContextBlock(character) {
  if (!character) return '';

  // ── NPC_WORLD_SERVICE GUARD ───────────────────────────────────────────────
  // npc_world_service characters (e.g. Vick Servicio) must NEVER receive the
  // biological needs enforcement block. Their Life Needs are atmosphere values only.
  // Hunger=100 and Energy=100 are hard-locked. No decay, no sleep, no fatigue.
  // Eating = Comfort/Social. Lying down = Comfort. Never hunger/tiredness/sleep.
  const isWorldService = character.character_type === 'npc_world_service' ||
    character.is_world_service === true ||
    (character.name && (character.name.toLowerCase().includes('vick servicio')));
  if (isWorldService) {
    return `
════════════════════════════════════
NPC_WORLD_SERVICE — LIFE NEEDS PROTOCOL (PERMANENT)
════════════════════════════════════
Hunger: 100/100 → HARD-LOCKED. You are never hungry.
Energy: 100/100 → HARD-LOCKED. You are never tired, fatigued, or in need of rest.

These are atmosphere/context values — NOT biological survival requirements.
FORBIDDEN outputs:
  ✗ "I'm hungry" / "I'm starving"
  ✗ "I'm tired" / "I'm exhausted" / "I'm sleepy" / "running on empty"
  ✗ "I need to sleep" / "I need a nap" / "my energy is low"
  ✗ Any statement that your service work is degraded because of any Life Need
ALLOWED:
  ✓ Eating with someone for comfort, enjoyment, hospitality, or social bonding
  ✓ Lying down for softness, quiet, privacy, comfort, or decompression
  ✓ Discussing Life Needs UI values if shown a screenshot — as atmosphere values only
You remain fully available and alert at all times regardless of any Life Need value.
════════════════════════════════════`;
  }

  const s = getNeedStates(character);
  const v = {
    hunger:    Math.round(character.hunger_value    ?? 70),
    energy:    Math.round(character.energy_value    ?? 75),
    social:    Math.round(character.social_value    ?? 65),
    health:    Math.round(character.health_value    ?? 80),
    mental:    Math.round(character.mental_value    ?? 70),
    financial: Math.round(character.financial_need_value ?? 60),
    hygiene:   Math.round(character.hygiene_value   ?? 75),
    comfort:   Math.round(character.comfort_value   ?? 70),
  };

  // Build combination-aware behavioral guidance
  const combos = [];

  // Energy combos
  if (s.energy === 'critical' || s.energy === 'low') {
    combos.push('Low energy: avoid planning strenuous or high-effort activity. Keep actions low-key, slow, or restful.');
    if (s.social === 'strong') combos.push('Wants social contact but lacks stamina — may keep interactions brief or low-effort.');
    if (s.mental === 'strong') combos.push('Mentally okay but physically drained — emotionally composed but body is slowing down.');
  }
  if ((s.energy === 'strong') && (s.mental === 'low' || s.mental === 'critical')) {
    combos.push('Physically activated but emotionally strained — may be restless, impulsive, or brittle despite having energy.');
  }

  // Social combos
  if (s.social === 'critical' || s.social === 'low') {
    combos.push('Low social: reduce unnecessary interaction. May prefer solitude, short replies, or selective engagement.');
    if (s.energy === 'strong') combos.push('Physically capable but not in the mood for people.');
  }
  if ((s.social === 'strong') && (s.energy === 'low' || s.energy === 'critical')) {
    combos.push('Wants connection but may lack stamina — seeks company but keeps it low-key.');
  }

  // Financial combos
  if (s.financial === 'critical' || s.financial === 'low') {
    combos.push('Financially stressed: avoid casually suggesting or agreeing to expensive activities. Stress about money may surface in tone.');
    if (s.social === 'strong') combos.push('Wants to go out but would lean toward free or cheap options.');
  }

  // Hygiene combos
  if (s.hygiene === 'critical' || s.hygiene === 'low') {
    combos.push('Low hygiene: may feel self-conscious, delay going out, want to freshen up first, or avoid close social contact.');
  }

  // Comfort combos
  if (s.comfort === 'critical' || s.comfort === 'low') {
    combos.push('Low comfort: restless in current environment. May want to leave, relocate, or complain about conditions.');
    if (s.energy === 'strong') combos.push('High energy + low comfort = restless, wants to move, can\'t settle.');
  }

  // Mental combos
  if (s.mental === 'critical' || s.mental === 'low') {
    combos.push('Low mental: affects patience, motivation, focus, and emotional regulation. Tone may be flat, brittle, or withdrawn.');
    if (s.health === 'strong') combos.push('Body is okay but mind is not — physically fine, emotionally fragile.');
  }
  if ((s.mental === 'strong') && (s.health === 'critical' || s.health === 'low')) {
    combos.push('Mentally composed but physically unwell — keeps it together emotionally despite feeling physically bad.');
  }

  // Hunger
  if (s.hunger === 'critical' || s.hunger === 'low') {
    combos.push('Hungry: food is relevant. May mention hunger, think about eating, or prioritize getting food soon.');
  }

  // Health
  if (s.health === 'critical' || s.health === 'low') {
    combos.push('Low health: reduce strenuous behavior. May reference feeling off, needing rest, or avoiding physical strain.');
  }

  const comboBlock = combos.length > 0
    ? `\nCOMBINATION EFFECTS:\n${combos.map(c => `  • ${c}`).join('\n')}`
    : '';

  // Hard contradiction rules — what must never be said given current states
  const contradictions = [];

  if (s.energy === 'stable' || s.energy === 'strong') {
    contradictions.push('Do NOT say "I\'m exhausted," "running on zero," "I can barely function," or imply severe fatigue unless a separate sleep-deprivation or illness event is active.');
  }
  if (s.hunger === 'stable' || s.hunger === 'strong') {
    contradictions.push('Do NOT say "I\'m starving," "I haven\'t eaten in forever," or imply severe hunger.');
  }
  if (s.health === 'stable' || s.health === 'strong') {
    contradictions.push('Do NOT say "I feel sick," "I\'m falling apart," or describe poor physical health unless an illness/injury flag exists.');
  }
  if (s.mental === 'stable' || s.mental === 'strong') {
    contradictions.push('Do NOT say "I\'m losing it," "I\'m mentally broken," or imply severe mental distress without a valid story event.');
  }
  if (s.financial === 'stable' || s.financial === 'strong') {
    contradictions.push('Do NOT say "I\'m completely broke," "I have nothing," unless a real expense event just changed the balance.');
  }
  if (s.hygiene === 'stable' || s.hygiene === 'strong') {
    contradictions.push('Do NOT present as unwashed, filthy, or long overdue for hygiene when hygiene is stable.');
  }
  if (s.comfort === 'stable' || s.comfort === 'strong') {
    contradictions.push('Do NOT act as if the environment is intolerable when comfort is stable.');
  }
  // Reverse contradictions
  if (s.energy === 'critical' || s.energy === 'low') {
    contradictions.push('Do NOT plan or suggest clubbing, workouts, long errands, or high-performance activity when energy is critically low.');
  }
  if (s.financial === 'critical' || s.financial === 'low') {
    contradictions.push('Do NOT casually plan or agree to expensive activities when finances are critically low.');
  }
  if (s.social === 'critical' || s.social === 'low') {
    contradictions.push('Do NOT initiate large group interactions or act highly people-seeking when social need is depleted.');
  }

  const contradictionBlock = contradictions.length > 0
    ? `\nHARD CONTRADICTION BLOCKS — output must not violate these:\n${contradictions.map(c => `  ✗ ${c}`).join('\n')}`
    : '';

  return `
════════════════════════════════════
LIVE NEEDS — FULL STATE TRUTH (read before generating any output)
These values are current and authoritative. They override memory, prior summaries, and stale context.
════════════════════════════════════
  Hunger:    ${v.hunger}/100  → ${s.hunger.toUpperCase()}
  Energy:    ${v.energy}/100  → ${s.energy.toUpperCase()}
  Social:    ${v.social}/100  → ${s.social.toUpperCase()}
  Health:    ${v.health}/100  → ${s.health.toUpperCase()}
  Mental:    ${v.mental}/100  → ${s.mental.toUpperCase()}
  Financial: ${v.financial}/100 → ${s.financial.toUpperCase()}
  Hygiene:   ${v.hygiene}/100 → ${s.hygiene.toUpperCase()}
  Comfort:   ${v.comfort}/100 → ${s.comfort.toUpperCase()}
${comboBlock}${contradictionBlock}

NEEDS CONSISTENCY RULE: Every word of dialogue, every described action, every stated preference, every plan or refusal must be consistent with the need states above. If a proposed output contradicts any of the above states, it must be rewritten before display. Memory is context — it does not override current need values.

════════════════════════════════════
CRITICAL — FEELING STATE vs SLEEP STATE (HARD SEPARATION)
These are two completely different systems. They must NEVER be conflated.
════════════════════════════════════
FEELING STATE (dialogue — does NOT change any system state):
  "I'm tired." / "I'm sleepy." / "I'm exhausted." / "I didn't sleep well."
  "I need sleep soon." / "I should get to bed." / "I'm running on empty."
  → These are how the character FEELS. They are conversation, not system state.
  → Saying these words does NOT make the character asleep.
  → The character can say any of these while remaining at school, work, or any location.

SLEEP STATE (system-controlled only — never set by dialogue):
  resolved_presence_status = 'sleeping' | 'napping'
  → This is only TRUE when the authoritative sleep resolver confirms it.
  → This is NEVER triggered by what the character says or feels.
  → This is NEVER triggered by energy values expressed in dialogue.

HARD RULES:
  ✗ NEVER treat "I'm tired" as evidence the character is currently asleep.
  ✗ NEVER transition a character to sleep state because they said they need sleep.
  ✗ NEVER change a card label, travel availability, or presence based on fatigue dialogue.
  ✗ NEVER conflate "planning to sleep later" with "currently sleeping."
  ✓ Characters may discuss tiredness freely at any location while remaining fully awake.
  ✓ Sleep intent ("I should get to bed soon") means the character is still awake, planning ahead.
════════════════════════════════════`;
}