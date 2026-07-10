/**
 * ════════════════════════════════════════════════════════════════════════════
 * SLEEP, ENERGY, NAP, CAFFEINE, AUTONOMY, AND REST-STATE SYSTEM
 * Authoritative design specification — all modules must comply
 * ════════════════════════════════════════════════════════════════════════════
 *
 * APPLIES ONLY TO: active_created_character records.
 * DOES NOT APPLY TO: npc_regular, npc_family_member, npc_fictitious,
 *   npc_world_service, service characters, system characters, or any
 *   non-active_created_character record. Applying this system to NPC types
 *   is a critical failure.
 *
 * ── CHARACTERS MANAGE ENERGY, NOT SLEEP ──────────────────────────────────
 * Characters are not managing a sleep timer. They are managing energy,
 * comfort, mood, responsibilities, and future plans. Sleep is one tool.
 * Naps, coffee, energy drinks, and proactive rest are also tools.
 *
 * A character is not thinking "it is sleep time so I must sleep."
 * A character is thinking "how much energy do I have, what do I still need
 * to do, what do I have coming up, and what is the smartest choice?"
 *
 * The system must not reduce this to a rigid sleep scheduler.
 * Different characters make different choices based on personality, schedule,
 * obligations, location, energy level, and future plans.
 * Energy influences the decision. Energy does not erase personality.
 *
 * ── SLEEP IS NECESSARY — TIMING IS FLEXIBLE ─────────────────────────────
 * Sleep is not optional. Sleep matters.
 * Characters understand sleep improves mood, comfort, focus, performance,
 * work, school, and well-being. Insufficient sleep causes irritability,
 * crankiness, reduced focus, and reduced performance.
 *
 * However, characters are not forced to sleep at one exact time.
 * The character has autonomy over WHEN they sleep, not WHETHER sleep matters.
 *
 * A character may:
 *   - sleep earlier because they have work in the morning
 *   - sleep later because they are finishing something important
 *   - stay up to finish an assignment, knowingly accepting consequences
 *   - shift to a later approved sleep window when energy still allows it
 *
 * A character must NEVER conclude: "I have energy, so I no longer need sleep."
 * The correct conclusion is: "I have energy, so I can sleep later."
 *
 * Never sleeping is not a valid choice. Sleeping at a different time is.
 *
 * ── REAL-PERSON SLEEP REASONING ─────────────────────────────────────────
 * Sleep decisions should reflect how real people reason:
 *   - "I need to be up early — I should sleep at 10 PM."
 *   - "I need to finish this — I am staying up even knowing tomorrow is harder."
 *   - "I have enough energy right now — I will sleep a bit later tonight."
 *
 * Characters understand benefits and consequences.
 * They may make responsible choices. They may make imperfect choices.
 * They may knowingly accept consequences.
 * The system creates believable behavior, not perfect behavior.
 *
 * ── FUTURE PLANS MUST INFLUENCE ENERGY DECISIONS ────────────────────────
 * Characters must consider future plans when deciding whether to sleep,
 * nap, drink coffee, or use an energy drink.
 *
 * Example: A character worked 9 AM–5 PM. They are tired but have plans to
 * go out until 2 AM. A realistic character may take a nap before going out
 * so they have energy to enjoy the night. That nap is a proactive autonomy
 * decision — not a system enforcement action.
 *
 * Characters may proactively consume caffeine around ~50% energy if they
 * know significant obligations remain ahead. This is valid planning behavior.
 *
 * ── APPROVED SLEEP WINDOWS ──────────────────────────────────────────────
 * Sleep windows are GUIDANCE, not commands, schedules, or appointments.
 * Sleep windows represent when a character normally prefers to sleep.
 * The existence of a sleep window does NOT trigger sleep.
 * The existence of a sleep window does NOT force sleep.
 * The existence of a sleep window does NOT override autonomy.
 *
 * Sleep windows MUST come from a predefined approved set.
 * Sleep windows MUST NEVER be generated dynamically.
 * Sleep windows MUST NEVER be invented, customized, or created on the fly.
 * Any generated sleep window is a critical failure.
 *
 * A sleep window is INVALID for a character if 3 or more hours of that
 * window overlap with recurring work obligations, school obligations, or
 * recurring mandatory commitments. The ENTIRE window must be evaluated —
 * not only the start time.
 *
 * Daytime sleep windows must exist for overnight workers.
 * The system must not assume all characters sleep at night.
 *
 * Characters may shift to a later approved sleep window when their energy
 * level and obligations make that a reasonable, autonomous choice.
 *
 * ── SLEEP AND NAPS ARE THE SUSPENSION OF ACTIVITIES ─────────────────────
 * This is a core architectural rule.
 *
 * Work, school, travel, shopping, socializing, and entertainment are activities.
 * Sleep is NOT an activity. Naps are NOT activities.
 * Sleep and naps are the SUSPENSION of activities.
 *
 * When a character enters a sleep or nap state:
 *   - Character-driven activities STOP
 *   - Energy recovery CONTINUES
 *   - Social, travel, entertainment, and activity systems do NOT fire
 *   - The system becomes QUIETER, not busier
 *
 * The system MUST NOT create sleep maintenance loops.
 * The system MUST NOT run extra processes to keep a character asleep.
 * The system MUST NOT increase processing because a character is resting.
 *
 * Sleep is like a computer entering sleep mode — the system quiets down.
 *
 * ── MAINTENANCE MUST NEVER DRIVE SLEEP ──────────────────────────────────
 * The system MAY use naturally occurring sleep periods for maintenance.
 * The system MUST NEVER force or extend sleep for maintenance purposes.
 * Characters MUST NEVER be kept asleep because maintenance is running.
 * Maintenance benefits from natural sleep. It never causes it.
 *
 * ── NAP RULES ───────────────────────────────────────────────────────────
 * Naps generally last 2–3 hours.
 * Naps exist to restore energy, improve comfort, and prepare for future plans.
 * Naps are NOT primary sleep periods.
 *
 * CONSECUTIVE NAPS (less than 2 hours awake between naps):
 *   Form a "nap chain" — total chain limited to ~1.5 naps of rest.
 *   A character may not use consecutive naps as a disguised 6-hour sleep.
 *   Example ALLOWED: 12 PM–3 PM nap, wake briefly, 3:15 PM–4:30 PM nap.
 *   Example FAILURE: 12 PM–3 PM nap, wake briefly, 3:05 PM–6:00 PM nap.
 *
 * NON-CONSECUTIVE NAPS (2+ hours awake between naps):
 *   Treated as a fresh separate nap — may be a full nap duration.
 *   Example ALLOWED: 12 PM–2 PM nap, awake until 6 PM, 6 PM–8 PM nap.
 *
 * No nap may begin if it would cause the character to miss a scheduled obligation.
 *
 * ── CAFFEINE RULES ──────────────────────────────────────────────────────
 * Coffee and energy drinks are support tools, not sleep replacements.
 * They help characters manage energy, remain alert, improve mood/patience/focus.
 * Characters with demanding schedules may intentionally use caffeine.
 * Proactive caffeine use around ~50% energy is valid planning behavior.
 *
 * HARD RULE: Caffeine MUST NEVER raise energy to 100%.
 *   Only actual rest may fully restore energy.
 *   Caffeine cap: approximately 95% maximum.
 *   The remaining recovery requires rest.
 *
 * Caffeine may delay fatigue. It does not eliminate the need for sleep.
 * Caffeine does not stop energy decay.
 * Excessive caffeine chaining is unhealthy and must NOT be treated as optimal.
 *
 * Coffee sources: home (via groceries — no individual transaction),
 *   workplace (free — no transaction), businesses (generates financial transaction).
 *
 * ── SOCIAL NEEDS AND SLEEP ───────────────────────────────────────────────
 * Social needs MUST NOT wake a sleeping character.
 * Entertainment needs MUST NOT wake a sleeping character.
 * Recreation needs MUST NOT wake a sleeping character.
 * Characters address those needs after waking.
 *
 * ── NPC PROMOTION CONTINUITY ─────────────────────────────────────────────
 * When a user promotes an NPC to active_created_character:
 *   - Existing habits, routines, behavior patterns, and sleep patterns are PRESERVED
 *   - The character should feel like the same character with more autonomy
 *   - Promotion adds autonomy — it does not erase continuity
 *   - Promotion MUST NOT create perpetual sleep, nap loops, or instability
 *   - The existing NPC sleep pattern should inform the preferred sleep behavior
 *   - Characters are ONLY promoted by explicit user choice — never automatically
 *
 * NPC sleep behavior is NOT modified by this system.
 * NPC sleep is NOT being redesigned.
 * NPC sleep is NOT being replaced.
 *
 * ── VICK OVERSIGHT ───────────────────────────────────────────────────────
 * Vick MAY: audit, report, verify, and explain sleep behavior.
 * Vick MAY: know who is asleep, napping, awake, or approaching low energy.
 * Vick MAY NOT: assign sleep windows, force sleep, force naps, or override autonomy.
 *
 * ── TIME AUTHORITY ───────────────────────────────────────────────────────
 * All sleep, nap, work, and school decisions use authoritative Eastern Time.
 * UTC is forbidden for all application logic. See custom instructions.
 *
 * ── SUCCESS STANDARD ─────────────────────────────────────────────────────
 * ✓ Characters sleep because sleep is beneficial — not because a timer fired
 * ✓ Sleep remains necessary; timing remains flexible
 * ✓ Sleep windows guide behavior without becoming schedules
 * ✓ Characters understand benefits and consequences
 * ✓ Characters make realistic, believable, sometimes imperfect choices
 * ✓ Sleep and naps quiet character activity instead of increasing it
 * ✓ Energy recovery continues during rest
 * ✓ Vick audits without controlling
 * ✓ NPC sleep remains untouched; promotion continuity is preserved
 * ✓ The user does not micromanage sleep
 *
 * ── FAILURE CONDITIONS (any of these is a critical system failure) ────────
 * ✗ Applying this system to NPCs
 * ✗ Automatically promoting characters
 * ✗ Generating sleep windows dynamically
 * ✗ Treating sleep windows as schedules, commands, or appointments
 * ✗ Forcing sleep because a window exists
 * ✗ Preventing sleep because a window was missed
 * ✗ Characters concluding they never need sleep because they have energy
 * ✗ Caffeine reaching 100% energy
 * ✗ Caffeine replacing sleep
 * ✗ Unlimited caffeine chaining
 * ✗ Sleep maintenance loops or nap maintenance loops
 * ✗ Sleep used for server load management
 * ✗ Maintenance causing or extending sleep
 * ✗ Social/entertainment needs waking sleeping characters
 * ✗ Sleep or naps interfering with work or school
 * ✗ User required to micromanage sleep, naps, caffeine, or sleep windows
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * SLEEP UTILITIES
 *
 * Active fields:
 * - sleep_interrupted_at: READ-ONLY flag. Records when sleep was cut short by alarm/message/emergency.
 *   Used to classify ongoing sleep as valid (recovery) and to reduce energy recovery on interrupted rest.
 *   Never written here. Written by alarm/wake systems when they interrupt sleep.
 *
 * Sleep operates through:
 * - Energy/needs system (simulateActiveCharacterNeeds) — primary sleep driver for active_created_character
 * - Explicit schedule (sleep_start_time + wake_up_time) — stored preference, context only
 * - Adaptive schedule (derived from work/school) — context only, not authority
 * - Interrupted sleep recovery (sleep_interrupted_at) — valid recovery reason
 * - Chat interruption (energy recovery calculated from last_sleep_start duration)
 * - Story/presence logic (user-controlled or schedule-controlled)
 *
 * All sleep decisions use Eastern Time. UTC is not used for any sleep logic.
 */

export const STALE_SLEEP_GRACE_MINUTES = 20;

/**
 * Determines if a character's DB sleeping/napping state is valid (character-driven)
 * or stale (system artifact that should be cleared).
 *
 * Classifies whether a character's DB sleep state is valid (character-driven) or stale.
 * Only explicit story/schedule/energy-driven sleep is valid.
 */
export function classifySleepState(character) {
  const dbSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';

  // For active_created_characters: sleep state is always valid if DB says sleeping.
  // The energy system wrote it. It is never "stale". Only NPCs use clock-window stale detection.
  if (!isNPCCharacterType(character)) {
    if (dbSleeping) {
      return { isStale: false, isValid: true, reason: 'energy_driven_sleep', consequence_tags: [] };
    }
    return { isStale: false, isValid: false, reason: 'not_sleeping_in_db', consequence_tags: [] };
  }

  // ── NPC: original clock-window stale detection (unchanged) ───────────────
  const canonicalAsleep = isCharacterAsleep(character);

  if (canonicalAsleep) {
    return { isStale: false, isValid: true, reason: 'within_canonical_sleep_window', consequence_tags: [] };
  }

  if (!dbSleeping) {
    return { isStale: false, isValid: false, reason: 'not_sleeping_in_db', consequence_tags: [] };
  }

  if (character.decided_to_stay_up_until) {
    const stayUntil = new Date(character.decided_to_stay_up_until);
    if (stayUntil > new Date(Date.now() - 8 * 3600 * 1000)) {
      return { isStale: false, isValid: true, reason: 'shifted_sleep_stay_up', consequence_tags: ['tired', 'shifted_schedule'] };
    }
  }

  const sleepSource = character.resolved_source_reason || '';
  if (sleepSource === 'user_directed_nap' || sleepSource.includes('nap')) {
    return { isStale: false, isValid: true, reason: 'user_directed_nap', consequence_tags: [] };
  }

  // sleep_interrupted_at: if character was woken early (alarm, message, emergency) within
  // the last 3 hours, their sleep is still valid — they are in interrupted-sleep recovery.
  // This is NOT sleep debt. It is a record that normal rest was cut short.
  if (character.sleep_interrupted_at) {
    const interruptedAt = new Date(character.sleep_interrupted_at);
    const hoursSinceInterrupt = (Date.now() - interruptedAt.getTime()) / 3600000;
    if (hoursSinceInterrupt < 3) {
      return { isStale: false, isValid: true, reason: 'interrupted_sleep_recovery', consequence_tags: ['tired', 'groggy'] };
    }
  }

  if ((character.health_value || 100) < 30) {
    return { isStale: false, isValid: true, reason: 'illness_sleep', consequence_tags: ['sick', 'tired'] };
  }

  if ((character.mental_value || 100) < 25) {
    return { isStale: false, isValid: true, reason: 'emotional_crash_sleep', consequence_tags: ['emotional', 'exhausted'] };
  }

  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const wakeMin = toMin(character.wake_up_time);
  if (wakeMin !== null) {
    let minutesPastWake = currentMin - wakeMin;
    if (minutesPastWake < 0) minutesPastWake += 1440;
    if (minutesPastWake < STALE_SLEEP_GRACE_MINUTES) {
      return { isStale: false, isValid: true, reason: 'within_wake_grace_period', consequence_tags: [] };
    }
  }

  return { isStale: true, isValid: false, reason: 'stale_system_sleep', consequence_tags: ['groggy'] };
}

/**
 * Oversleep consequences are story-based: personality traits, emotional state, obligations.
 */
export function buildOversleepConsequences(character, nowET) {
  const tags = [];
  const dayOfWeek = nowET.getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();

  // Check if they're missing work right now
  const hasWork = character.work_start_time && character.work_end_time &&
    Array.isArray(character.work_days) && character.work_days.includes(dayOfWeek);
  if (hasWork) {
    const workStart = toMin(character.work_start_time);
    if (workStart !== null && currentMin > workStart) {
      tags.push('late_for_work');
      tags.push('missed_shift_start');
    }
  }

  // Check school
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const schoolStart = 8 * 60;
    if (currentMin > schoolStart && [1,2,3,4,5].includes(dayOfWeek)) {
      tags.push('late_for_school');
    }
  }

  // Personality-based consequence tags
  if (character.trait_workaholic) {
    tags.push('panicking', 'guilty', 'rushing');
  } else if (character.trait_anxious || (character.emotional_state || '').includes('anxious')) {
    tags.push('spiraling', 'rushing', 'apologetic');
  } else if (character.trait_lazy) {
    tags.push('dismissive', 'slow_moving', 'may_call_out');
  } else if (character.trait_rebellious || character.trait_rule_breaker) {
    tags.push('intentional_skip', 'unbothered');
  } else if (character.trait_conscientious) {
    tags.push('rushing', 'apologetic', 'self_critical');
  } else if (character.trait_stubborn) {
    tags.push('blaming_others', 'dismissive');
  } else {
    tags.push('groggy', 'adjusting');
  }

  // Energy-based consequence
  if ((character.energy_value || 75) < 30) tags.push('exhausted');

  return tags;
}

/**
 * Returns current sleep state based on resolved_presence_status and schedule validation.
 */
export function getSleepState(character) {
  const isAsleep = isCharacterAsleep(character);

  // Napping state
  if (character.resolved_presence_status === 'napping') {
    return { state: 'napping' };
  }

  if (isAsleep) {
    return { state: 'asleep' };
  }

  return { state: 'awake' };
}

/**
 * Call this when a user sends a message to a sleeping character (alarm, chat interrupt, emergency).
 * Calculates partial energy recovery from the sleep session so far.
 * Writes sleep_interrupted_at so subsequent systems know this rest was cut short.
 *
 * IMPORTANT: sleep_interrupted_at is NOT a cumulative fatigue tracker. It is a flag that says:
 *   "this character did not finish their sleep cycle — they may still be tired."
 * Consequence systems (classifySleepState, classifySleepStateInline) read it
 * to keep the character in valid-recovery sleep for up to 3 hours after interruption.
 */
export function buildSleepInterruptionUpdate(character) {
  const now = new Date();
  
  // Calculate how long they've been asleep
  const sleepStart = character.last_sleep_start ? new Date(character.last_sleep_start) : null;
  const sleptHours = sleepStart ? (now.getTime() - sleepStart.getTime()) / 3600000 : 0;

  // Was this sleep itself already interrupted? If so, recovery rate is reduced (groggy from prior interrupt)
  const wasAlreadyInterrupted = character.sleep_interrupted_at &&
    (now.getTime() - new Date(character.sleep_interrupted_at).getTime()) < 6 * 3600000;
  const recoveryRate = wasAlreadyInterrupted ? 8 : 12; // +8/hr if already interrupted, +12/hr normal

  return {
    // Partial energy recovery from however long they slept
    energy_value: Math.min(100, (character.energy_value || 50) + Math.round(sleptHours * recoveryRate)),
    // Record that this sleep was interrupted — read by classifySleepState for up to 3h
    sleep_interrupted_at: now.toISOString(),
  };
}

// NPC character types that use forced sleep windows
const NPC_SLEEP_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious', 'npc']);

/**
 * Returns true if this character record is an NPC type that uses forced sleep windows.
 * Exported so locationResolutionEngine and other callers can use it consistently.
 */
export function isNPCCharacterType(character) {
  return NPC_SLEEP_TYPES.has(character?.character_type);
}

/**
 * Returns true if this character is an NPC resident of VGC Towers.
 *
 * RESIDENCY PROOF:
 *   character.current_home_location_id must point to a LocationReference whose
 *   name === 'VGC Towers'. This is the sole canonical residency source.
 *   No name matching on characters. No created_by. No heuristics.
 *
 * locationMap: { [locationId]: LocationReference } — must include VGC Towers entry.
 * Returns false when locationMap is not provided (safe fallback → generic NPC path).
 *
 * VGC Towers NPC residents are routed to the dedicated resident sleep window
 * (2:30 AM → 8:30 AM) instead of the generic npc_forced_default (0:00 → 8:00).
 * This keeps them available for the VGC Towers Travel system which sends residents
 * out into the world starting at 10 AM (DEPARTURE block).
 *
 * APPLIES ONLY to NPC-type characters. active_created_character is never affected.
 */
export function isVGCTowersNPCResident(character, locationMap) {
  if (!character || !locationMap) return false;
  if (!isNPCCharacterType(character)) return false;
  const homeId = character.current_home_location_id;
  if (!homeId) return false;
  const homeLoc = locationMap[homeId];
  if (!homeLoc) return false;
  return homeLoc.name === 'VGC Towers';
}

// VGC Towers resident sleep window (ET minutes-since-midnight)
//   Residents return home ~2:00 AM via returnVGCResidentsHome automation
//   Sleep begins ~2:30 AM (30-min wind-down after return)
//   Wake time   ~8:30 AM
//   Morning DEPARTURE travel block fires at 10:00 AM — fully clear of sleep by then
export const VGC_RESIDENT_SLEEP_START_MIN = 2 * 60 + 30;  // 150 min (2:30 AM)
export const VGC_RESIDENT_WAKE_TIME_MIN   = 8 * 60 + 30;  // 510 min (8:30 AM)

/**
 * Computes the sleep window for a character.
 * Schedule-based only. Energy-driven for active_created_character.
 *
 * ONE TRUTH RULE: This is the single canonical sleep-window resolver.
 *
 * SOURCE LABELS (returned as `source` field):
 *   'stored_schedule'        — explicit sleep_start_time + wake_up_time on the record
 *   'vgc_resident_schedule'  — VGC Towers NPC resident window 02:30–08:30 AM
 *   'npc_forced_default'     — generic NPC fallback 00:00–08:00 (non-VGC-resident NPCs only)
 *   'overnight_work'         — derived from overnight work shift connected to a selected work day
 *   'work_schedule'          — derived from day shift; today or tomorrow is a selected work day
 *   'school_enrollment'      — derived from enrollment override start time
 *   'school_hours'           — documented fallback (08:00) when enrollment has no override time
 *   'no_structured_timing'   — no explicit schedule, no work, no school of any kind
 *
 * KEY RULES:
 *   - VGC Towers NPC residents use 'vgc_resident_schedule', NOT 'npc_forced_default'.
 *     Residency is proven by character.current_home_location_id → location.name === 'VGC Towers'.
 *   - Non-VGC NPC types still use 'npc_forced_default' (00:00–08:00). Unchanged.
 *   - Work-derived sleep applies ONLY on selected work days (and adjacent overnight logic).
 *   - Non-selected work days are not "no schedule" — but they are also not work days.
 *     Saturday for a Mon–Fri worker is simply not a work day. Do not invent timing for it.
 *   - The one overnight exception: if yesterday was a selected work day and the overnight
 *     shift crossed midnight, post-shift sleep applies this morning.
 *   - School enrolled characters: enrollment override → school hours → fallback.
 *   - Midnight (00:00) as a sleep start is arithmetic: 07:00 wake - 7h = 00:00.
 *   - Wake time is ALWAYS: sleepStart + SLEEP_DURATION. Never shiftStart - prepBuffer.
 *     Those are separate concepts (sleepWakeTime vs nextShiftPrepTime vs nextShiftStartTime).
 *
 * @param {object} character
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, used to identify VGC Towers residency. When absent, VGC residents
 *   fall through to npc_forced_default (safe, conservative fallback).
 */
function computeAdaptiveSleepWindow(character, locationMap) {
  const SLEEP_DURATION_MIN = 7 * 60;  // 7 hours
  const PRE_SHIFT_BUFFER   = 60;       // 1h prep before shift (determines wake time for day workers)
  const DECOMPRESSION_MIN  = 60;       // 1h wind-down after overnight shift
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Stored explicit schedule — always wins for ALL character types
  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMin(character.sleep_start_time);
    const w = toMin(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  // PRIORITY 2 (NPC types): Separate VGC Towers residents from generic NPCs.
  //
  //   VGC Towers NPC residents → 'vgc_resident_schedule' (2:30 AM–8:30 AM)
  //   All other NPC types     → 'npc_forced_default'    (0:00 AM–8:00 AM)
  //
  // VGC residents participate in forced world travel (DEPARTURE block at 10 AM).
  // The generic 0:00–8:00 window is acceptable for background NPCs, but for VGC
  // residents it would suppress travel availability in ways inconsistent with the
  // VGC Travel system design: residents return home at ~1 AM, need wind-down time,
  // then sleep 2:30–8:30, fully awake and eligible for 10 AM departure.
  if (isNPCCharacterType(character)) {
    if (isVGCTowersNPCResident(character, locationMap)) {
      return {
        sleepStartMin: VGC_RESIDENT_SLEEP_START_MIN,
        wakeMin: VGC_RESIDENT_WAKE_TIME_MIN,
        source: 'vgc_resident_schedule',
      };
    }
    // Generic NPC (non-VGC-resident) — unchanged behavior
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  // PRIORITY 3: Derive from work schedule (active_created_character).
  // Work-derived sleep timing ONLY applies on selected work days (and adjacent overnight logic).
  // Non-selected work days are not "no schedule" — but they are also not work days.
  // The system must NOT apply work sleep timing on days the character is not scheduled to work,
  // except for one legitimate case: an overnight shift that began on a selected work day and
  // ended after midnight into the next morning.
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMin(character.work_start_time);
    const endMin   = toMin(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const nowET     = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const today     = nowET.getDay();
      const yesterday = (today + 6) % 7;
      const isOvernightShift = endMin < startMin;

      if (isOvernightShift) {
        const workedLastNight = character.work_days.includes(yesterday);
        const worksTonight    = character.work_days.includes(today);
        if (workedLastNight || worksTonight) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin       = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
      } else {
        // Day shift: only derive sleep from TODAY's work day.
        // Only today's work day is used — adjacent days do not influence today's sleep window.
        const worksToday = character.work_days.includes(today);
        if (worksToday) {
          const wakeMin       = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'work_schedule' };
        }
      }
    }
  }

  // PRIORITY 4: School-enrolled character (no work schedule).
  // Uses canonical school schedule resolver (enrollment override → location hours → unresolved)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const dayOfWeek = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
    // Inline resolver (avoid module imports here)
    let schoolStartMin = null, schoolEndMin = null;
    
    // Priority 1: Enrollment override
    if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
      const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
      if (active) {
        schoolStartMin = toMin(active.start_time);
        schoolEndMin = toMin(active.end_time);
      }
    }
    
    // Priority 2: School location operating hours (requires locationMap — passed from caller)
    if (schoolStartMin === null && locationMap && locationMap[character.education_location_id]) {
      const schoolLoc = locationMap[character.education_location_id];
      if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
        const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
        const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
        const entry = todayEntries[0] || dayAgnosticEntries[0];
        if (entry) {
          schoolStartMin = toMin(entry.open_time);
          schoolEndMin = toMin(entry.close_time);
        }
      }
    }

    if (schoolStartMin !== null && schoolEndMin !== null) {
      const wakeMin       = (schoolStartMin - 60 + 1440) % 1440;
      const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
      return { sleepStartMin, wakeMin, source: 'school_resolved' };
    }
    // No valid school schedule
    return { sleepStartMin: null, wakeMin: null, source: 'school_schedule_unresolved' };
  }

  // PRIORITY 5: No structured timing at all.
  // For active_created_character: return null — no clock window can be assumed.
  // Sleep for these characters is driven by energy/needs (simulateActiveCharacterNeeds + autonomousCharacterMovement).
  // Returning a clock window here would create a hidden schedule-based sleep controller.
  if (!isNPCCharacterType(character)) {
    return { sleepStartMin: null, wakeMin: null, source: 'no_structured_timing' };
  }
  // NPCs with no structured timing: fallback 11 PM–7 AM (unchanged)
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'no_structured_timing' };
}



/**
 * Determines if a character is currently asleep based on schedule only.
 * ONE TRUTH: This is the canonical sleep gate used by locationResolutionEngine,
 * getCharacterLivePresence, and travelPresenceResolver.
 *
 * OBLIGATION GUARD RULE:
 * Any active scheduled obligation blocks sleep classification entirely.
 * Obligations are resolved before any sleep window or fallback is evaluated.
 * This includes: work shift, school attendance, travel commitment, active confinement.
 *
 * Guards (in order):
 *   1. decided_to_stay_up_until override → awake
 *   2. Active obligation (work shift, school, travel, confinement) → awake
 *   3. Sleep window check via computeAdaptiveSleepWindow → asleep/awake
 *
 * @param {object} character
 * @param {object} [locationMap] — optional { [locationId]: LocationReference }
 *   When provided, enables VGC Towers residency detection so residents use the
 *   correct 2:30 AM–8:30 AM window instead of the generic 0:00–8:00 window.
 */
export function isCharacterAsleep(character, locationMap) {
  if (!character) return false;

  // ── ACTIVE_CREATED_CHARACTER: schedule-anchored sleep validation ──────────
  // Ordinary sleep is valid ONLY when ALL of the following pass:
  //   1. Explicit sleep_start_time + wake_up_time window exists and current time is inside it
  //   2. Sleep duration has not reached 8 hours
  //   3. No active work shift
  //   4. No active school window
  // passed_out is a consequence state — not ordinary sleep — and is returned separately.
  if (!isNPCCharacterType(character)) {
    const status = character.resolved_presence_status || '';

    // passed_out is a medical consequence state, not ordinary sleep. Always trust it.
    if (status === 'passed_out') return true;

    // PASS_OUT_RECOVERY STAY LOCK: Even if resolved_presence_status was externally
    // cleared to 'home' by another writer, an active pass_out_recovery stay lock
    // proves the character is still in forced recovery — treat as asleep.
    if (character.presence_stay_lock === true && character.presence_stay_lock_reason === 'pass_out_recovery') return true;

    // Only evaluate ordinary sleep/napping
    if (status !== 'sleeping' && status !== 'napping') return false;

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();
    const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

    // RULE 1: Explicit sleep window is required. No window = not valid sleep.
    const sleepStartMin = toMin(character.sleep_start_time);
    const wakeMin = toMin(character.wake_up_time);
    if (sleepStartMin === null || wakeMin === null) return false;

    const insideWindow = sleepStartMin > wakeMin
      ? (currentMin >= sleepStartMin || currentMin < wakeMin)
      : (currentMin >= sleepStartMin && currentMin < wakeMin);
    if (!insideWindow) return false;

    // RULE 2: 8-hour cap — reject if sleep started 8+ hours ago
    const sleepStartCandidates = [
      character.last_sleep_start,
      character.resolved_last_updated_at,
      character.last_need_simulated_at,
    ].filter(Boolean);
    if (sleepStartCandidates.length > 0) {
      const sleepStartMs = Math.min(...sleepStartCandidates.map(t => new Date(t).getTime()));
      if ((nowET.getTime() - sleepStartMs) / 3_600_000 >= 8) return false;
    }

    // RULE 3 (REMOVED): Work-shift and school-window overrides.
    // The backend enforceCharacterWorkSchedule already has a sleep guard (isBlockedFromWork).
    // If the backend let the character sleep through a shift, that is the authoritative decision.
    // Frontend overrides here caused the card to show "at work" when the character was in bed.
    // The 8-hour cap (RULE 2) already handles truly stale sleep.

    return true; // All rules passed — ordinary sleep is valid
  }

  // ── NPC types: evaluate clock window as before ────────────────────────────

  // Guard 1: explicit stay-up override
  if (character.decided_to_stay_up_until) {
    const stayUpUntil = new Date(character.decided_to_stay_up_until);
    if (new Date() < stayUpUntil) return false;
  }

  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
  const dayOfWeek = nowET.getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // Guard 2a: live work shift — never asleep during own active shift
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    if (character.work_days.includes(dayOfWeek)) {
      const startMin = toMin(character.work_start_time);
      const endMin   = toMin(character.work_end_time);
      if (startMin !== null && endMin !== null) {
        const onShift = endMin < startMin
          ? (currentMinutes >= startMin || currentMinutes < endMin)
          : (currentMinutes >= startMin && currentMinutes < endMin);
        if (onShift) return false;
      }
    }
  }

  // Guard 2b: school attendance window — enrolled students are not asleep during school hours
  // Uses canonical school schedule resolver (enrollment override → location hours)
  if (character.student_status === 'enrolled' && character.education_location_id) {
    const weekday = [1, 2, 3, 4, 5].includes(dayOfWeek);
    if (weekday) {
      let schoolStartMin = null, schoolEndMin = null;
      
      // Priority 1: Enrollment override
      if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
        const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
        if (active) {
          schoolStartMin = toMin(active.start_time);
          schoolEndMin = toMin(active.end_time);
        }
      }
      
      // Priority 2: School location operating hours
      if (schoolStartMin === null && locationMap && locationMap[character.education_location_id]) {
        const schoolLoc = locationMap[character.education_location_id];
        if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
          const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
          const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);
          const entry = todayEntries[0] || dayAgnosticEntries[0];
          if (entry) {
            schoolStartMin = toMin(entry.open_time);
            schoolEndMin = toMin(entry.close_time);
          }
        }
      }

      if (schoolStartMin !== null && schoolEndMin !== null) {
        const inSchool = currentMinutes >= schoolStartMin && currentMinutes < schoolEndMin;
        if (inSchool) return false;
      }
    }
  }

  // Guard 2c: confinement — jailed or house arrest characters follow facility schedule, not sleep
  if (character.is_jailed || character.house_arrest_active) return false;

  // Guard 3: sleep window — pass locationMap so VGC residents get the correct window
  const window = computeAdaptiveSleepWindow(character, locationMap);
  if (!window || window.sleepStartMin == null || window.wakeMin == null) return false;

  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) {
    return currentMinutes >= sleepStartMin || currentMinutes < wakeMin;
  }
  return currentMinutes >= sleepStartMin && currentMinutes < wakeMin;
}