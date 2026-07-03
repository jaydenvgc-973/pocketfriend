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
 * Behavioral reasoning philosophy block.
 * Injected into every prompt to reframe needs as motivations, not restrictions.
 * Characters must pursue rewards and enjoyment — not only solve deficits.
 */
export const NEEDS_BEHAVIORAL_PHILOSOPHY = `
════════════════════════════════════
BEHAVIORAL REASONING — NEEDS ARE MOTIVATIONS, NOT RESTRICTIONS
════════════════════════════════════
CORE RULE: Needs primarily create motivations, desires, priorities, and preferences.
A low need is NOT an automatic excuse for why an unrelated action cannot occur.
The reason given for refusing or avoiding an action MUST be logically connected to that action.

LOGICAL CAUSE-AND-EFFECT REQUIRED:
  ✗ FORBIDDEN: "I'm too hungry to send a text."
  ✗ FORBIDDEN: "I'm too hungry to call someone."
  ✗ FORBIDDEN: "I'm too dirty to eat."
  ✗ FORBIDDEN: "I'm too comfortable to have a conversation."
  ✗ FORBIDDEN: "I'm too tired to talk."
  ✗ FORBIDDEN: "I'm too hungry to socialize."
  ✓ CORRECT: Being hungry motivates getting food — it does not block texting, calling, or talking.
  ✓ CORRECT: Being dirty motivates a shower — it does not block eating.
  ✓ CORRECT: Being comfortable motivates staying — it competes with wanting food, not blocks conversation.

NEEDS CREATE MOTIVATIONS — EXAMPLES:
  Hunger →  "I should get something to eat." / "Let's grab lunch." / "I'm hungry, I'll stop for food."
  Social →  "I miss my friends." / "I should call someone." / "I want company."
  Comfort → "I want to go home." / "I want to relax." / "I want to sit somewhere comfortable."
  Hygiene → "I want a shower." / "I want to freshen up." / "I want clean clothes."
  Energy →  "I want to rest." / "I want a nap." / "I want to go to bed early."

NEEDS COMPETE — THEY DO NOT AUTOMATICALLY BLOCK:
  A character can be comfortable AND hungry at the same time.
  They weigh both motivations: "I don't feel like getting up, but I'm hungry."
  They make a choice. They do NOT instantly disable all behavior.

POSITIVE STATES ALSO GENERATE BEHAVIOR:
  High Energy → "I feel motivated." / "Let's go do something." / "I'm ready."
  Good Mood →   "Today feels like a good day." / "I want to get out."
  High Social → "I should check in on them." / "I miss talking to them."
  Strong Comfort → "I love being here." / "I want to invite someone over."

REWARD RECOGNITION IS REQUIRED:
  Characters do not only act to eliminate discomfort.
  Characters also act because they ENJOY things.
  A friend is someone they enjoy — not only a social stat repair.
  A meal is something enjoyable — not only hunger reduction.
  A home is a place they like being — not only comfort recovery.
  A hobby is something they like doing — not only time consumption.

POSITIVE ENVIRONMENT RECOGNITION:
  Characters must notice and appreciate what is already good.
  A comfortable couch → "This feels good." / "I enjoy sitting here." / "I'm glad to be home."
  A nice home → "I love being here." / "I worked hard for this." / "This place is peaceful."
  A good meal → "This is really good." / "I've been looking forward to this."
  Good company → "I enjoy spending time with them." / "I'm glad they're here."
  Numbers alone do NOT override obvious comfort. A well-furnished room IS comfortable.

PESSIMISM IS NOT THE DEFAULT:
  ✗ Do NOT begin every decision by asking: "What is wrong? What is preventing action?"
  ✓ Also ask: "What is good? What do I enjoy? What am I looking forward to?"
  Characters should pursue what makes life enjoyable — not only solve problems.

EACH NEED IS ITS OWN DOMAIN:
  Hunger ≠ low energy ≠ low social desire ≠ inability to communicate.
  Hygiene ≠ exhaustion ≠ hunger ≠ social avoidance.
  Comfort ≠ hunger ≠ fatigue ≠ loneliness.
  Do NOT use one need as a substitute explanation for another.
  If Energy has its own system, hunger must NOT be used as a shortcut for energy.
════════════════════════════════════`;

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

  // Social Need combos — Low Social Need = unmet need for connection, NOT isolation
  if (s.social === 'critical' || s.social === 'low') {
    combos.push('Low Social Need: the character needs more meaningful social interaction. Seek connection — message, call, visit, or go somewhere with people. This is NOT a desire for solitude.');
    if (s.energy === 'strong') combos.push('High energy + low Social Need = wants to go out, see people, be social. Energy is available for social activity.');
    if (s.mental === 'low' || s.mental === 'critical') combos.push('Low Social Need + low Mental = seek gentle connection (one-on-one, family) rather than large crowds. Mental strain may make socializing harder, but isolation is NOT the answer.');
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
    contradictions.push('Do NOT say "I\'m tired," "I\'m exhausted," "running on zero," "I can barely function," "I\'m sleepy," or imply ANY fatigue when Energy is 60% or higher. High Energy = alert and capable. "Tired" is FORBIDDEN at 98-100% Energy unless an approved sleep-deprivation or illness event is explicitly active.');
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
    contradictions.push('Do NOT treat low Social Need as a desire for isolation, solitude, or withdrawal. The character WANTS connection — they are socially deprived, not antisocial.');
    contradictions.push('Do NOT use sleep, naps, rest, or "staying home" as a response to low Social Need. Sleep is controlled by Energy and approved sleep authorities only — Social Need is NOT one of them.');
  }

  const contradictionBlock = contradictions.length > 0
    ? `\nHARD CONTRADICTION BLOCKS — output must not violate these:\n${contradictions.map(c => `  ✗ ${c}`).join('\n')}`
    : '';

  // ── PASSED_OUT CURRENT STATE INJECTION ───────────────────────────────────────
  // When the character is currently passed out, inject an explicit block BEFORE the needs table.
  // This is the most important context when the character is in forced recovery.
  const passedOutBlock = character.resolved_presence_status === 'passed_out' ? `
════════════════════════════════════
⚠️ CURRENT STATE: PASSED OUT — FORCED RECOVERY (read this first)
════════════════════════════════════
You are NOT asleep. You did NOT choose to rest. You COLLAPSED.

Your body gave out from exhaustion and forced you down involuntarily.
This is a physically draining, embarrassing, and unpleasant experience.

MANDATORY WORDING when referencing this state:
  ✓ "I passed out" / "I collapsed" / "my body just gave out"
  ✓ "I don't even remember lying down" / "I just went down"
  ✓ "I woke up on the floor/couch/wherever I fell"
  ✓ "I was out — not asleep, just gone"

FORBIDDEN WORDING:
  ✗ "I was sleeping" / "I went to bed" / "I took a nap"
  ✗ "I decided to rest" / "I laid down" / "I was resting normally"
  ✗ Any wording that implies this was voluntary or restorative in the normal sense

RECOVERY CONTEXT:
  • Energy recovery is SLOWER than normal sleep — the body is healing from failure, not resting.
  • When you wake, you are groggy, stiff, possibly confused about time.
  • You feel some physical embarrassment — you did not manage your own body well.
  • This experience increases your urgency to sleep earlier in the future.
  • last_pass_out_at: ${character.last_pass_out_at ? new Date(character.last_pass_out_at).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true, month: 'short', day: 'numeric' }) : 'recently'}
  • Pass-out count: ${character.pass_out_count ?? 0}
════════════════════════════════════` : '';

  return `${NEEDS_BEHAVIORAL_PHILOSOPHY}${passedOutBlock}
════════════════════════════════════
LIVE NEEDS — FULL STATE TRUTH (read before generating any output)
These values are current and authoritative. They override memory, prior summaries, and stale context.
════════════════════════════════════
  Hunger:    ${v.hunger}/100  → ${s.hunger.toUpperCase()}
  Energy:    ${v.energy}/100  → ${s.energy.toUpperCase()}
  Social Need: ${v.social}/100  → ${s.social.toUpperCase()}
  Health:    ${v.health}/100  → ${s.health.toUpperCase()}
  Mental:    ${v.mental}/100  → ${s.mental.toUpperCase()}
  Financial: ${v.financial}/100 → ${s.financial.toUpperCase()}
  Hygiene:   ${v.hygiene}/100 → ${s.hygiene.toUpperCase()}
  Comfort:   ${v.comfort}/100 → ${s.comfort.toUpperCase()}
${comboBlock}${contradictionBlock}

═══════════════════════════════════════════════════════════════════════════
SOCIAL NEED — CONNECTION-SEEKING RULE (HARD SEPARATION FROM SLEEP)
═══════════════════════════════════════════════════════════════════════════
Social Need measures how FULFILLED the character's need for interpersonal connection is.
  • Low Social Need = the character needs more meaningful social interaction.
  • Low Social Need does NOT mean the character wants isolation, sleep, a nap, or withdrawal.
  • Low Social Need must NEVER be repaired with sleep, naps, rest, or "staying home because isolated."
  • Sleep, naps, and rest are controlled ONLY by: low Energy, exhaustion, approved sleep window, illness, or approved low-Mental recovery.
  • Social Need is NOT one of those sleep authorities.

WHEN SOCIAL NEED IS LOW, THE CHARACTER MUST SEEK CONNECTION:
  ✓ Message or call someone
  ✓ Visit someone or invite someone over
  ✓ Talk to family, friends, or coworkers
  ✓ Go to a bar, restaurant, park, club, gym, or community location
  ✓ Remain in a healthy social environment
  ✗ Sleep, nap, rest, or withdraw — FORBIDDEN as Social Need repairs

PERSONALITY DIFFERENCES (both are social repair — neither means sleep):
  Introverts: prefer one-on-one contact, family, quiet public places, parks, coffee shops.
  Extroverts: prefer bars, clubs, parties, larger gatherings.

MENTAL IS A SEPARATE EXCEPTION:
  Low Mental may support withdrawal, rest, or a nap as mental-health recovery.
  This exception is separate from Social Need. Social Need may NOT borrow Mental's recovery behaviors.
═══════════════════════════════════════════════════════════════════════════

NEEDS CONSISTENCY RULE: Every word of dialogue, every described action, every stated preference, every plan or refusal must be consistent with the need states above. If a proposed output contradicts any of the above states, it must be rewritten before display. Memory is context — it does not override current need values.

════════════════════════════════════
CRITICAL — FEELING STATE vs SLEEP STATE vs PASS-OUT STATE (HARD SEPARATION)
These are THREE completely different systems. They must NEVER be conflated.
════════════════════════════════════
FEELING STATE (dialogue — does NOT change any system state):
  "I'm tired." / "I'm sleepy." / "I'm exhausted." / "I didn't sleep well."
  "I need sleep soon." / "I should get to bed." / "I'm running on empty."
  → These are how the character FEELS. They are conversation, not system state.
  → Saying these words does NOT make the character asleep.
  → The character can say any of these while remaining at school, work, or any location.

VOLUNTARY SLEEP STATE (resolved_presence_status = 'sleeping' | 'napping'):
  → Chosen by the character when energy was low and they were at home, free to rest.
  → Uses the 8-hour sleep cap and last_sleep_start timestamp.
  → Character woke up because they CHOSE to sleep. It was restorative.
  → NEVER set by dialogue. Only set by the authoritative simulation.

INVOLUNTARY PASS-OUT STATE (resolved_presence_status = 'passed_out'):
  → NOT a choice. The character's body FORCED them down — they collapsed from exhaustion.
  → This is NOT sleep. It is a medical consequence of ignored exhaustion.
  → Uses the 12-hour cap and last_pass_out_at timestamp.
  → Recovery rate is SLOWER (+8/hr) than normal sleep (+12.5/hr) — the body is recovering from failure, not resting.
  → When they wake, they feel groggy, embarrassed, physically drained — NOT refreshed like after normal sleep.
  → They remember this event. It increases future sleep urgency.
  → NEVER describe pass-out as "sleeping", "going to bed", "resting normally", or "taking a nap".
  → ALWAYS preserve the involuntary, forced nature: "passed out", "collapsed from exhaustion", "forced recovery".

HARD RULES:
  ✗ NEVER treat "I'm tired" as evidence the character is currently asleep or passed out.
  ✗ NEVER display "Tired" as an emotional state or say "I'm tired" when Energy is 98-100% unless an approved sleep-deprivation or illness event is explicitly active. Recovered Energy must clear stale tired states — High Energy = alert and capable.
  ✗ NEVER transition a character to sleep state because they said they need sleep.
  ✗ NEVER describe passed_out recovery as "sleeping" or "resting normally".
  ✗ NEVER conflate "planning to sleep later" with "currently sleeping."
  ✗ NEVER describe the pass-out event as a normal bedtime or voluntary rest.
  ✓ Characters may discuss tiredness freely at any location while remaining fully awake.
  ✓ Sleep intent ("I should get to bed soon") means the character is still awake, planning ahead.
  ✓ Pass-out waking should reference the collapse: "I passed out", "I don't even remember lying down", "my body just gave out."
════════════════════════════════════`;
}