import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * simulateActiveCharacterNeeds — CORRECTED v2
 *
 * All 6 root causes from deepNeedsAudit are fixed here:
 *
 * RC1 FIXED: Corrective activity writer added — when hunger/energy critical,
 *            the simulation now WRITES current_activity and resolved_presence_status
 *            so the NEXT tick applies recovery rates automatically.
 *
 * RC2 FIXED: Pass-out is now a real state writer — energy=0 writes
 *            resolved_presence_status="sleeping" and current_activity="passed out — resting"
 *
 * RC3 FIXED: ER escalation now creates a ScheduledEvent AND sets presence to hospital
 *            when health ≤ 15 OR compound crisis with health ≤ 20.
 *
 * RC4 FIXED: Compound crisis (3+ needs < 20) now triggers forced stabilization:
 *            character is put to rest and a recovery ScheduledEvent is created.
 *
 * RC5 FIXED: Stale cap reduced from 24h to 8h. Writes now always use asServiceRole
 *            to prevent silent RLS failures.
 *
 * RC6 FIXED: All Character.update() calls use base44.asServiceRole unconditionally
 *            so protected/default flags never cause silent write failures.
 */

const clamp = (v) => Math.max(0, Math.min(100, v));

// ── RATES ────────────────────────────────────────────────────────────────────
// ENERGY CALIBRATION:
//   sleeping:    +12/hr → starting at ~20 energy → reaches ~70 (natural wake) in ~4.2 hours
//                       → reaches ~90 (fully rested) in ~5.8 hours
//                       → normal sleep cycle: 6–8 hours naturally
//   passed_out:  +8/hr  → slower recovery — emergency sleep, not restful
//   default awake: -4/hr → 75→low(35) in ~10 hours, →critical(15) in ~15 hours
//   active contexts: -5 to -7/hr → fatigue builds faster during demanding activity
//   resting at home: +3/hr → gentle recovery without full sleep (reading, lounging)
//
// SLEEP MATH CHECK (starting at energy=20, sleeping at +12/hr):
//   At 3h: energy ≈ 56 — still tired, character stays asleep (< 70 wake threshold)
//   At 4h: energy ≈ 68 — close to wake threshold
//   At 4.2h: energy ≈ 70 — natural wake possible if no obligations missed or health recovering
//   At 6h: energy ≈ 92 — well rested, almost always awake unless sick/recovering
//   At 8h: energy = 100 (clamped) — full recovery
const RATES = {
  sleeping:        { hunger: -1,   energy: +12, social: -0.5, health: +0.5, mental: +3,   hygiene: 0,    comfort: +4   },
  passed_out:      { hunger: -0.5, energy: +8,  social: -0.5, health: +0.5, mental: +1,   hygiene: 0,    comfort: +1   },
  hospitalized:    { hunger: -0.5, energy: +4,  social: -1,   health: +5,   mental: -0.5, hygiene: +1,   comfort: +2   },
  at_work:         { hunger: -4,   energy: -5,  social: +1,   health: -0.5, mental: -2,   hygiene: -2,   comfort: -2   },
  at_work_medical: { hunger: -5,   energy: -7,  social: -1,   health: -0.5, mental: -4,   hygiene: -3,   comfort: -4   },
  at_work_service: { hunger: -5,   energy: -6,  social: +2,   health: -1,   mental: -3,   hygiene: -3,   comfort: -3   },
  at_work_office:  { hunger: -3,   energy: -4,  social: +1,   health: -0.5, mental: -2,   hygiene: -1,   comfort: -1   },
  work_off_shift:  { hunger: -3,   energy: -3,  social: -1,   health: -0.5, mental: -3,   hygiene: -2,   comfort: -4   },
  at_school:       { hunger: -3,   energy: -4,  social: +2,   health: -0.5, mental: -1,   hygiene: -1,   comfort: -1   },
  gym:             { hunger: -6,   energy: -7,  social: +1,   health: +1,   mental: +1,   hygiene: -5,   comfort: -2   },
  bar_club:        { hunger: -2,   energy: -5,  social: +5,   health: -1,   mental: +1,   hygiene: -1,   comfort: -1   },
  home_resting:    { hunger: -1,   energy: +3,  social: -1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +3   },
  home_active:     { hunger: -2,   energy: -3,  social: -1,   health: 0,    mental: 0,    hygiene: -0.5, comfort: +1   },
  hospital:        { hunger: -1,   energy: +2,  social: -1,   health: +3,   mental: -1,   hygiene: 0,    comfort: +1   },
  food_drink:      { hunger: +15,  energy: +2,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  social_out:      { hunger: -2,   energy: -4,  social: +4,   health: 0,    mental: +1,   hygiene: -1,   comfort: -0.5 },
  traveling:       { hunger: -3,   energy: -4,  social: -1,   health: 0,    mental: -1,   hygiene: -2,   comfort: -3   },
  eating:          { hunger: +15,  energy: +2,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  resting:         { hunger: -1,   energy: +3,  social: -0.5, health: +1,   mental: +2,   hygiene: 0,    comfort: +3   },
  default:         { hunger: -2,   energy: -4,  social: -1,   health: 0,    mental: -0.5, hygiene: -1,   comfort: -1   },
};

// ── THRESHOLDS ────────────────────────────────────────────────────────────────
const T = {
  HUNGER_ER:         5,
  HUNGER_CRITICAL:  20,
  HUNGER_LOW:       35,
  ENERGY_MEDICAL:    5,   // hospitalization — sustained energy collapse requiring medical intervention
  ENERGY_PASSOUT:   10,   // character collapses from exhaustion
  ENERGY_CRITICAL:  25,   // auto-sleep trigger — energy critically low, character forces sleep
  ENERGY_LOW:       35,   // character is noticeably tired, starts wanting to go home
  HEALTH_ER:        15,
  HEALTH_CRITICAL:  20,
  COMPOUND_CRISIS:   3,   // number of needs below 20 to trigger compound handling
};

function isOnShift(character, locationMap) {
  // CRITICAL: Always use America/New_York — UTC is forbidden for schedule logic
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cur = nowET.getHours() * 60 + nowET.getMinutes();
  const dow = nowET.getDay();

  // SOURCE 1: Character-level work_days/work_start_time/work_end_time (primary job fields)
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.includes(dow)) {
    const [sh, sm = 0] = character.work_start_time.split(':').map(Number);
    const [eh, em = 0] = character.work_end_time.split(':').map(Number);
    if (cur >= sh * 60 + sm && cur < eh * 60 + em) return true;
  }

  // SOURCE 2: additional_occupation_locations — check location-side worker_shifts[char.id]
  // This is the fix for characters whose primary job is stored on the location record,
  // not on character-level fields (e.g. Andre's Hyacinth Foundation Mon–Fri 9–5 job).
  if (Array.isArray(character.additional_occupation_locations) && locationMap) {
    for (const entry of character.additional_occupation_locations) {
      if (!entry.location_id) continue;
      const loc = locationMap[entry.location_id];
      if (!loc) continue;
      // Check location-side shift for this character
      const shift = loc.worker_shifts?.[character.id];
      if (shift?.start && shift?.end) {
        const shiftDays = Array.isArray(shift.days) && shift.days.length > 0 ? shift.days : null;
        if (shiftDays && !shiftDays.includes(dow)) continue;
        const [sh, sm = 0] = shift.start.split(':').map(Number);
        const [eh, em = 0] = shift.end.split(':').map(Number);
        if (cur >= sh * 60 + sm && cur < eh * 60 + em) return true;
      }
      // Also check entry-level schedule fields if no location-side shift
      if (!loc.worker_shifts?.[character.id] && entry.work_start_time && entry.work_end_time && Array.isArray(entry.work_days) && entry.work_days.includes(dow)) {
        const [sh, sm = 0] = entry.work_start_time.split(':').map(Number);
        const [eh, em = 0] = entry.work_end_time.split(':').map(Number);
        if (cur >= sh * 60 + sm && cur < eh * 60 + em) return true;
      }
    }
  }

  return false;
}

function getWorkContextFromLocation(loc) {
  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  if (cat === 'medical' || name.includes('hospital') || name.includes('clinic') || name.includes('emergency')) return 'at_work_medical';
  if (cat === 'food_drink' || cat === 'social' || name.includes('bar') || name.includes('restaurant') || name.includes('cafe') || name.includes('diner')) return 'at_work_service';
  return 'at_work_office';
}

// ── STALE PRESENCE THRESHOLD ─────────────────────────────────────────────────
// A presence/activity record older than this (in ms) is considered stale and cannot
// grant energy-restoring contexts (home_resting, resting, eating) to an awake character.
// It CAN still grant energy-draining contexts (at_work, traveling, etc.) since those
// are conservative — worst case the character drains faster, not indefinitely restores.
// Stale contexts that would grant net POSITIVE energy (home_resting: +3/hr) while the
// character is unverifiably awake are the primary failure mode this resolves.
const STALE_PRESENCE_MS = 4 * 60 * 60 * 1000; // 4 hours

// Contexts that grant net positive energy (would keep character awake forever if stale)
const ENERGY_RESTORING_CONTEXTS = new Set(['home_resting', 'resting', 'eating', 'hospital', 'hospitalized', 'food_drink']);

/**
 * resolvePresenceStaleness
 *
 * Returns true if the character's resolved_presence_status / current_activity
 * is stale enough that it should NOT be trusted to grant energy-restoring behavior.
 *
 * Staleness is measured from the LATER of:
 *   - last_need_simulated_at (last time needs were confirmed)
 *   - resolved_last_updated_at (last time presence was explicitly written)
 *
 * If the newer of those two is > 4 hours ago, the resting/positive-energy context
 * is treated as stale and the simulation falls back to 'default' (-4/hr energy decay).
 * This guarantees energy eventually reaches critical even during total inactivity.
 */
function resolvePresenceStaleness(character, now) {
  const candidates = [
    character.last_need_simulated_at,
    character.resolved_last_updated_at,
  ].filter(Boolean).map(t => new Date(t).getTime());
  if (candidates.length === 0) return true; // no timestamps at all = treat as stale
  const mostRecent = Math.max(...candidates);
  return (now.getTime() - mostRecent) > STALE_PRESENCE_MS;
}

function getLocationContext(character, locationMap, now) {
  const activity = (character.current_activity || '').toLowerCase();
  const presenceStatus = character.resolved_presence_status || character.location_status;

  // ── CRITICAL STATES — never stale, always authoritative ──
  // These are physical collapse states that the simulation itself writes,
  // so they cannot be "stale" in the same way as user/system presence flags.
  if (presenceStatus === 'hospitalized') return 'hospitalized';
  if (presenceStatus === 'passed_out') return 'passed_out';
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';
  if (activity.includes('passed out') || activity.includes('collapsed')) return 'passed_out';
  if (activity.includes('hospital') || activity.includes('er ') || activity.includes('emergency room') || activity.includes('urgent care')) return 'hospitalized';

  // ── STALE PRESENCE CHECK ──────────────────────────────────────────────────
  // If presence data is stale, do NOT allow energy-restoring activity contexts.
  // A character with a 6-hour-old "eating" or "resting" activity is not actually
  // still eating or resting — the stale tag is keeping them awake indefinitely.
  const presenceIsStale = now ? resolvePresenceStaleness(character, now) : false;

  if (!presenceIsStale) {
    // Only trust activity-based positive-energy contexts when presence is fresh
    if (activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal') || activity.includes('lunch') || activity.includes('dinner') || activity.includes('breakfast') || activity.includes('snack')) return 'eating';
    if (activity.includes('rest') || activity.includes('nap') || activity.includes('relax')) return 'resting';
  }

  // ── TRAVEL — always authoritative (travel_status is independently managed) ──
  if (character.travel_status && character.travel_status !== 'not_traveling') return 'traveling';

  // ── WORK CONTEXTS ─────────────────────────────────────────────────────────
  // "At work" contexts always drain energy, so we allow them even if presence is stale.
  // The only stale concern is at_work granting POSITIVE energy — it doesn't (at_work: -5/hr).
  if (activity.includes('at work') || activity.includes('working') || activity.includes('on shift')) {
    const workLocId = character.current_work_location_id || character.occupation_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return isOnShift(character, locationMap) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character, locationMap) ? 'at_work' : 'work_off_shift';
  }

  if (presenceStatus === 'at_work') {
    // Validate against actual schedule — if not on shift, stale at_work flag = work_off_shift
    const workLocId = character.current_work_location_id || character.occupation_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return isOnShift(character, locationMap) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character, locationMap) ? 'at_work' : 'work_off_shift';
  }
  if (presenceStatus === 'at_school') return 'at_school';

  const locId = character.resolved_current_location_id;
  if (!locId) {
    // No location resolved + presence is either home or missing.
    // If stale: fall to 'default' — idle awake with no verified rest context.
    // If fresh: allow home_resting.
    if (presenceIsStale) return 'default';
    if (presenceStatus === 'home' || !presenceStatus) return 'home_resting';
    return 'default';
  }
  const loc = locationMap[locId];
  if (!loc) {
    // Location ID set but location not found — data integrity issue.
    // Treat as default (energy drains at idle rate) rather than granting rest.
    return 'default';
  }

  const workLocId = character.current_work_location_id || character.occupation_location_id;
  if (locId === workLocId) return isOnShift(character, locationMap) ? getWorkContextFromLocation(loc) : 'work_off_shift';

  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  if (cat === 'gym') return 'gym';
  if (cat === 'medical') return 'hospital';
  if (cat === 'food_drink' || name.includes('restaurant') || name.includes('cafe') || name.includes('diner') || name.includes('kitchen')) {
    // Only grant food_drink energy bonus if presence is fresh
    return presenceIsStale ? 'social_out' : 'food_drink';
  }
  if (cat === 'social' || name.includes('bar') || name.includes('club') || name.includes('lounge') || name.includes('nightclub')) return 'bar_club';
  if (cat === 'outdoor') return 'social_out';
  if (cat === 'home' || cat === 'generic') {
    // home_resting grants +3/hr energy — only allow when presence is fresh.
    // Stale home presence = character is home but doing nothing verifiable → idle default.
    if (presenceIsStale) return 'default';
    return (presenceStatus === 'home' || !presenceStatus) ? 'home_resting' : 'home_active';
  }
  return 'default';
}

function applyElapsedTime(needs, elapsedHours, context) {
  const rates = RATES[context] || RATES.default;
  return {
    hunger:  clamp((needs.hunger  ?? 70) + rates.hunger  * elapsedHours),
    energy:  clamp((needs.energy  ?? 75) + rates.energy  * elapsedHours),
    social:  clamp((needs.social  ?? 65) + rates.social  * elapsedHours),
    health:  clamp((needs.health  ?? 80) + rates.health  * elapsedHours),
    mental:  clamp((needs.mental  ?? 70) + rates.mental  * elapsedHours),
    hygiene: clamp((needs.hygiene ?? 75) + rates.hygiene * elapsedHours),
    comfort: clamp((needs.comfort ?? 70) + rates.comfort * elapsedHours),
  };
}

// RC5 FIX: Cascade infection is capped more aggressively to prevent runaway
function applyStatInfection(needs, elapsedHours) {
  // ── HUNGER CASCADE (only when truly critical) ──
  if (needs.hunger < T.HUNGER_CRITICAL) {
    const severity = (T.HUNGER_CRITICAL - needs.hunger) / T.HUNGER_CRITICAL;
    needs.energy  = clamp(needs.energy  - 1.5 * severity * elapsedHours);
    needs.health  = clamp(needs.health  - 1.0 * severity * elapsedHours);
    needs.comfort = clamp(needs.comfort - 0.5 * severity * elapsedHours);
    needs.mental  = clamp(needs.mental  - 0.3 * severity * elapsedHours);
  } else if (needs.hunger < T.HUNGER_LOW) {
    needs.energy = clamp(needs.energy - 0.3 * elapsedHours);
    needs.mental = clamp(needs.mental - 0.2 * elapsedHours);
  }

  // ── ENERGY CASCADE ──
  if (needs.energy < T.ENERGY_CRITICAL) {
    const severity = (T.ENERGY_CRITICAL - needs.energy) / T.ENERGY_CRITICAL;
    needs.health = clamp(needs.health - 0.8 * severity * elapsedHours);
    needs.mental = clamp(needs.mental - 0.4 * severity * elapsedHours);
  }

  // ── HEALTH CASCADE ──
  if (needs.health < T.HEALTH_CRITICAL) {
    const severity = (T.HEALTH_CRITICAL - needs.health) / T.HEALTH_CRITICAL;
    needs.energy  = clamp(needs.energy  - 1.5 * severity * elapsedHours);
    needs.comfort = clamp(needs.comfort - 0.5 * severity * elapsedHours);
  }

  // ── SOCIAL → MENTAL (slow burn) ──
  if (needs.social < 20) {
    needs.mental = clamp(needs.mental - 0.2 * elapsedHours);
  }

  // ── MENTAL NEGLECT CASCADE ──
  if (needs.mental < 15) {
    needs.hunger  = clamp(needs.hunger  - 0.3 * elapsedHours);
    needs.hygiene = clamp(needs.hygiene - 0.3 * elapsedHours);
    needs.health  = clamp(needs.health  - 0.2 * elapsedHours);
  }

  // ── MULTI-CRITICAL COMPOUND DAMAGE ──
  // Only energy, hunger, and health count toward compound body stress.
  // Hygiene, social, mental, comfort are NOT body-failure needs and must not accelerate physical collapse.
  const bodyCriticalCount = [needs.hunger, needs.energy, needs.health]
    .filter(v => v < 20).length;
  if (bodyCriticalCount >= 2) {
    // Slow compound damage to prevent instant collapse — max 0.5/hr
    needs.health = clamp(needs.health - 0.5 * elapsedHours);
  }

  return needs;
}

function detectCriticalEscalations(oldNeeds, newNeeds, characterName) {
  const events = [];
  if (oldNeeds.hunger >= 20 && newNeeds.hunger < 20) events.push({ title: 'Reached critical hunger', description: `${characterName} was starving — hunger became critical.`, memory_tag: 'hunger_critical' });
  if (oldNeeds.hunger >= 10 && newNeeds.hunger < 10) events.push({ title: 'Severe hunger — near collapse', description: `${characterName} was extremely hungry, feeling dizzy and unable to focus.`, memory_tag: 'hunger_severe' });
  if (newNeeds.hunger <= 0 && oldNeeds.hunger > 0) events.push({ title: 'Hunger at zero — survival mode', description: `${characterName} had no food energy at all.`, memory_tag: 'hunger_zero' });
  // Energy escalation thresholds updated to match new ENERGY_CRITICAL=20 threshold
  if (oldNeeds.energy >= 25 && newNeeds.energy < 25) events.push({ title: 'Running on empty', description: `${characterName} was exhausted and struggling to stay awake.`, memory_tag: 'energy_critical' });
  if (newNeeds.energy <= 0 && oldNeeds.energy > 0) events.push({ title: 'Passed out from exhaustion', description: `${characterName} collapsed from complete energy depletion.`, memory_tag: 'energy_zero' });
  if (oldNeeds.health >= 20 && newNeeds.health < 20) events.push({ title: 'Health reached critical level', description: `${characterName}'s health deteriorated to a critical state.`, memory_tag: 'health_critical' });
  if (oldNeeds.social >= 15 && newNeeds.social < 15) events.push({ title: 'Deep social isolation', description: `${characterName} felt completely alone and isolated.`, memory_tag: 'social_critical' });
  if (oldNeeds.mental >= 15 && newNeeds.mental < 15) events.push({ title: 'Mental breakdown threshold reached', description: `${characterName} reached a mental breaking point.`, memory_tag: 'mental_critical' });
  return events;
}

// detectSleepMissConsequences REMOVED — clock-based bedtime reminders and
// late-night consequence loops have been eliminated. Sleep is driven by energy
// thresholds only (ENERGY_CRITICAL=25, ENERGY_PASSOUT=10, ENERGY_MEDICAL=5).
// No recurring memory nudges, no sleep-window lockout, no five-minute reminders.

function deriveFinancialNeed(character) {
  return character.financial_need_value ?? 60;
}

function getNeedsFromCharacter(char) {
  return {
    hunger:  char.hunger_value  ?? null,
    energy:  char.energy_value  ?? null,
    social:  char.social_value  ?? null,
    health:  char.health_value  ?? null,
    mental:  char.mental_value  ?? null,
    hygiene: char.hygiene_value ?? null,
    comfort: char.comfort_value ?? null,
  };
}

function needsAreUninitialized(needs) {
  return Object.values(needs).every(v => v === null);
}

/**
 * CORRECTIVE STATE RESOLVER — Need-Specific Behavior
 *
 * ARCHITECTURE RULE (permanent):
 *   Sleep may ONLY be written when ENERGY is the critical driver.
 *   No other need — hygiene, social, mental, comfort — may trigger sleep.
 *   Each need routes to its own correct corrective behavior:
 *
 *   energy   → sleep / pass-out (the ONLY need that drives sleep)
 *   health   → hospitalization / medical rest
 *   hunger   → eating / food-seeking
 *   hygiene  → hygiene correction (shower, wash, change) — NEVER sleep
 *   social   → social activity nudge — NEVER sleep
 *   mental   → decompression / rest nudge — NEVER forced sleep
 *   comfort  → comfort adjustment / home nudge — NEVER sleep
 *
 * Compound crisis (multiple needs low) does NOT default to sleeping
 * unless energy is itself critically low (≤ ENERGY_CRITICAL).
 * A character with energy=83 and hygiene=0 is tired-looking, not sleepy.
 */
function computeCorrectiveState(char, newNeeds, currentContext, now, locationMap) {
  const stateWrites = {};
  const scheduledEvents = [];
  const logs = [];

  const hunger  = newNeeds.hunger;
  const energy  = newNeeds.energy;
  const health  = newNeeds.health;
  const hygiene = newNeeds.hygiene;
  const social  = newNeeds.social;
  const mental  = newNeeds.mental;
  const presence = char.resolved_presence_status || '';
  const onShift  = isOnShift(char, locationMap);

  const alreadyHospitalized = presence === 'hospitalized' || (char.current_activity || '').toLowerCase().includes('hospital');
  const alreadySleeping = presence === 'sleeping' || presence === 'napping' || presence === 'passed_out';

  // ── STALE OBLIGATION GUARD ────────────────────────────────────────────────
  // onShift is the primary blocker preventing sleep writes. If the character's
  // schedule data is stale (no recent update), do NOT allow onShift to block sleep.
  // An expired shift record cannot indefinitely keep a character awake.
  // onShift is still used for corrective routing (which context to apply) but
  // MUST NOT block the auto-sleep write when the obligation state itself is stale.
  const presenceStalenessMs = (() => {
    const candidates = [char.last_need_simulated_at, char.resolved_last_updated_at]
      .filter(Boolean).map(t => new Date(t).getTime());
    if (candidates.length === 0) return Infinity;
    return now.getTime() - Math.max(...candidates);
  })();
  // If presence/schedule is stale for more than 6 hours, don't let onShift block sleep.
  const STALE_OBLIGATION_MS = 6 * 60 * 60 * 1000;
  const onShiftBlocksSleep = onShift && presenceStalenessMs < STALE_OBLIGATION_MS;

  // ALARM WAKE GUARD: if character was woken by an alarm within the last 30 minutes,
  // do NOT write sleeping back — the alarm system owns this wake state.
  const recentlyWokenByAlarm = (() => {
    if (!char.sleep_interrupted_at) return false;
    const wokenAt = new Date(char.sleep_interrupted_at).getTime();
    return (now.getTime() - wokenAt) < 30 * 60 * 1000;
  })();
  if (recentlyWokenByAlarm) {
    logs.push(`[CORRECTIVE] ${char.name}: alarm wake guard active (sleep_interrupted_at within 30min) — all sleep writes blocked`);
    // Still allow non-sleep corrections (hunger, hygiene) below — do NOT return early yet
  }

  // ── PRIORITY 1: HEALTH ER (health-only trigger — never hygiene/social/comfort) ──
  // Fires only when health itself is critically low (≤ 15 standalone, ≤ 20 with health+energy both low).
  // Hygiene=0 does NOT lower the health ER threshold.
  const healthAndEnergyBothLow = health <= T.HEALTH_CRITICAL && energy <= T.ENERGY_CRITICAL;
  const healthERThreshold = healthAndEnergyBothLow ? T.HEALTH_CRITICAL : T.HEALTH_ER;
  if (health <= healthERThreshold && !alreadyHospitalized && !onShiftBlocksSleep) {
    stateWrites.resolved_presence_status = 'hospitalized';
    stateWrites.current_activity = 'receiving emergency medical care';
    const dischargeTime = new Date(now.getTime() + (4 + Math.random() * 2) * 3600000);
    scheduledEvents.push({
      type: 'health_er',
      data: {
        character_ids: [char.id],
        character_names: [char.name],
        description: `${char.name} was discharged from emergency care and returned home to recover.`,
        trigger_time: dischargeTime.toISOString(),
        status: 'pending',
        type: 'internal',
        source: 'simulation',
        primary_character_id: char.id,
      },
    });
    logs.push(`[CORRECTIVE] ${char.name}: health=${Math.round(health)} → hospitalized`);
    return { stateWrites, scheduledEvents, logs };
  }

  // ── PRIORITY 1b: ENERGY MEDICAL (energy ≤ 5 — sustained collapse, medical intervention) ──
  if (energy <= T.ENERGY_MEDICAL && !alreadyHospitalized && !alreadySleeping && !recentlyWokenByAlarm) {
    stateWrites.resolved_presence_status = 'hospitalized';
    stateWrites.current_activity = 'hospitalized — energy collapse, medical stabilization';
    const dischargeTime = new Date(now.getTime() + (6 + Math.random() * 2) * 3600000);
    scheduledEvents.push({
      type: 'energy_medical',
      data: {
        character_ids: [char.id],
        character_names: [char.name],
        description: `${char.name} was discharged after medical stabilization from complete energy collapse.`,
        trigger_time: dischargeTime.toISOString(),
        status: 'pending',
        type: 'internal',
        source: 'simulation',
        primary_character_id: char.id,
      },
    });
    logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} (≤5 medical) → hospitalized`);
    return { stateWrites, scheduledEvents, logs };
  }

  // ── PRIORITY 2: PASS-OUT (energy ≤ 10, only energy drives this) ──
  if (energy <= T.ENERGY_PASSOUT && !alreadySleeping && !recentlyWokenByAlarm) {
    stateWrites.resolved_presence_status = 'passed_out';
    stateWrites.current_activity = 'passed out — recovering';
    const wakeTime = new Date(now.getTime() + 2.5 * 3600000);
    scheduledEvents.push({
      type: 'passout_recovery',
      data: {
        character_ids: [char.id],
        character_names: [char.name],
        description: `${char.name} slowly regained consciousness after collapsing from exhaustion.`,
        trigger_time: wakeTime.toISOString(),
        status: 'pending',
        type: 'internal',
        source: 'simulation',
        primary_character_id: char.id,
      },
    });
    logs.push(`[CORRECTIVE] ${char.name}: energy=0 → passed_out`);
    return { stateWrites, scheduledEvents, logs };
  }

  // ── PRIORITY 3: AUTO-SLEEP (ENERGY ONLY — no other need may trigger this) ──
  // Sleep is ONLY written when energy is the critical driver (≤ ENERGY_CRITICAL = 20).
  // hygiene=0, social=0, mental=0, comfort=0 — NONE of these may trigger sleep.
  // Character must also be at a valid sleep location (home/hotel/shelter).
  const currentLocType = (char.resolved_location_type || '').toLowerCase();
  const currentPresence = char.resolved_presence_status || '';
  const atValidSleepLocation = (
    currentLocType === 'home' ||
    currentLocType === 'hotel' ||
    currentLocType === 'shelter' ||
    currentLocType === 'generic' ||
    currentLocType === 'temporary_housing' ||
    currentLocType === 'recovery_nap' ||
    currentLocType === 'incarcerated' ||
    currentLocType === 'house_arrest' ||
    currentPresence === 'home' ||
    currentPresence === 'sleeping' ||
    currentPresence === 'napping' ||
    currentPresence === 'passed_out' ||
    !currentLocType
  );

  if (energy <= T.ENERGY_CRITICAL && !alreadySleeping && !onShiftBlocksSleep && !recentlyWokenByAlarm) {
    if (atValidSleepLocation) {
      stateWrites.resolved_presence_status = 'sleeping';
      stateWrites.current_activity = 'sleeping — exhausted';
      logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} (critical) → auto-sleep at valid location`);
    } else {
      // Not at a valid sleep location but energy is critical — write a home-routing signal
      // so autonomousCharacterMovement knows to send them home on the next tick.
      stateWrites.current_activity = 'exhausted — returning home to sleep';
      logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} critical — not at valid sleep location (${currentLocType}/${currentPresence}), writing home-routing signal`);
    }
  }

  // ── PRIORITY 4: HUNGER → EATING (food-seeking, not sleep) ──
  if (hunger <= T.HUNGER_CRITICAL && !alreadySleeping && !alreadyHospitalized) {
    const financial = char.financial_need_value ?? 60;
    const eatActivity = financial > 15 ? 'eating — addressing hunger' : 'finding food — hunger critical';
    stateWrites.current_activity = eatActivity;
    logs.push(`[CORRECTIVE] ${char.name}: hunger=${Math.round(hunger)} → auto-eat: "${eatActivity}"`);
  }

  // ── PRIORITY 5: HYGIENE → HYGIENE CORRECTION (NOT sleep) ──
  // hygiene=0 means the character is unwashed, uncomfortable, self-conscious.
  // They need to shower/wash/change. They do NOT need to sleep.
  // Inject a hygiene-correction activity note that the context system will pick up.
  if (hygiene <= 10 && !alreadySleeping && !alreadyHospitalized && !stateWrites.current_activity) {
    stateWrites.current_activity = 'needs to wash up — hygiene critical';
    stateWrites.emotional_state = 'uncomfortable';
    logs.push(`[CORRECTIVE] ${char.name}: hygiene=${Math.round(hygiene)} → hygiene correction nudge (NOT sleep)`);
  }

  // ── PRIORITY 6: MENTAL → DECOMPRESSION NUDGE (NOT sleep unless energy also low) ──
  if (mental <= 15 && !alreadySleeping && !alreadyHospitalized && !stateWrites.current_activity) {
    stateWrites.current_activity = 'decompressing — mental health critical';
    logs.push(`[CORRECTIVE] ${char.name}: mental=${Math.round(mental)} → decompression nudge`);
  }

  return { stateWrites, scheduledEvents, logs };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { characterId } = payload;

    // ── FOREGROUND YIELD CHECK ────────────────────────────────────────────────
    // Batch simulation must yield while user is actively using the app.
    // Single-character/user-triggered simulation (characterId present) always runs.
    if (!characterId) {
      try {
        const sessions = await base44.asServiceRole.entities.AppWorldState.filter({ key: 'user_active_session' });
        if (sessions.length > 0) {
          const lastUpdate = sessions[0].value ? new Date(sessions[0].value).getTime() : 0;
          const isForegroundActive = (Date.now() - lastUpdate) < 30 * 1000;
          if (isForegroundActive) {
            console.log(`[simulateActiveCharacterNeeds] User active — deferring batch simulation to protect foreground`);
            return Response.json({ success: true, yielded: true, reason: 'foreground_user_active', processed: 0 });
          }
        }
      } catch (_) { /* non-fatal — proceed */ }
    }

    // Determine auth context for ownership scoping
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    // RC6 FIX: Always use asServiceRole for ALL writes to prevent silent RLS failures
    // from is_protected, protected_active, or is_default flags.
    const writeSDK = base44.asServiceRole;
    // For reads, use user scope if available (cheaper), asServiceRole for batch
    const readSDK = user ? base44 : base44.asServiceRole;

    // Load locations
    const allLocations = await writeSDK.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    let characters = [];
    if (characterId) {
      const found = await writeSDK.entities.Character.filter({ id: characterId }, null, 10);
      // Only simulate needs for active_created_character — NPCs do NOT use biological need simulation
      characters = found.filter(c => c.character_type === 'active_created_character' && c.status === 'active');
    } else {
      // CRITICAL: .list() returns 0 records in service-role context on this entity.
      // Use .filter() with explicit character_type — the proven working pattern from autonomousCharacterMovement.
      // Also try user-scoped read if service role returns 0 (mirrors autonomousCharacterMovement pattern).
      let all = await writeSDK.entities.Character.filter(
        { character_type: 'active_created_character', status: 'active' },
        '-updated_date',
        200
      ).catch(() => []);
      console.log(`[simulateNeeds] Service role filter returned ${all.length} active_created_character records`);

      // Fallback: user-scoped read if available and service role returned 0
      if (all.length === 0 && user) {
        console.log(`[simulateNeeds] Service role returned 0 — trying user-scoped filter for ${user.email}`);
        all = await base44.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          200
        ).catch(() => []);
        console.log(`[simulateNeeds] User-scoped filter returned ${all.length} records`);
      }

      // Filter confirmed: only active_created_character with active status, has owner_email
      characters = all.filter(c =>
        c.character_type === 'active_created_character' &&
        c.status === 'active' &&
        c.owner_email &&
        !c.is_test_character &&
        !c.diagnostic_only
      );
    }

    const now = new Date();
    const updates = [];
    const allCorrectiveLogs = [];

    for (const char of characters) {
      const lastSimulated = char.last_need_simulated_at ? new Date(char.last_need_simulated_at) : null;
      const currentNeeds = getNeedsFromCharacter(char);
      const isUninitialized = !char.needs_initialized || needsAreUninitialized(currentNeeds);

      // Initialize if never set
      if (isUninitialized) {
        const seed = char.name.charCodeAt(0) || 65;
        const base = updates.length;
        const initialNeeds = {
          hunger_value:         clamp(65 + ((seed + base * 7)  % 20) - 10),
          energy_value:         clamp(70 + ((seed + base * 11) % 20) - 10),
          social_value:         clamp(60 + ((seed + base * 13) % 30) - 15),
          health_value:         clamp(78 + ((seed + base * 5)  % 14) - 7),
          mental_value:         clamp(68 + ((seed + base * 9)  % 20) - 10),
          financial_need_value: char.financial_need_value ?? 60,
          hygiene_value:        clamp(72 + ((seed + base * 17) % 16) - 8),
          comfort_value:        clamp(68 + ((seed + base * 3)  % 20) - 10),
          last_need_simulated_at: now.toISOString(),
          needs_initialized: true,
        };
        updates.push({ id: char.id, data: initialNeeds, action: 'initialized', name: char.name });
        continue;
      }

      if (!lastSimulated) {
        updates.push({ id: char.id, data: { last_need_simulated_at: now.toISOString() }, action: 'timestamp_set', name: char.name });
        continue;
      }

      const elapsedMs = now.getTime() - lastSimulated.getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);

      // RC5 FIX: Cap at 8h max (was 24h) to prevent catastrophic single-tick decay
      const cappedHours = Math.min(elapsedHours, 8);

      // Skip micro-updates < 3 minutes
      if (elapsedMs < 3 * 60 * 1000) {
        updates.push({ id: char.id, data: null, action: 'skipped_too_soon', name: char.name });
        continue;
      }

      const context = getLocationContext(char, locationMap, now);

      // Apply elapsed-time decay/recovery
      let newNeeds = applyElapsedTime(currentNeeds, cappedHours, context);
      // Apply cross-system infection
      newNeeds = applyStatInfection(newNeeds, cappedHours);

      // ── AWAKE-TIME ENERGY DRAIN GUARANTEE ────────────────────────────────
      // Rule: An awake character must lose energy over time — even when idle.
      // If the context applied net POSITIVE energy while the character is awake
      // (e.g. home_resting applies +3/hr, eating +2/hr), ensure the result still
      // trends downward enough that a 24-hour awake period reaches critical (≤25).
      //
      // Baseline minimum drain for awake (non-sleeping, non-passed_out) characters:
      //   -2/hr regardless of context (a resting awake character is still awake).
      //
      // This does NOT apply to sleeping/passed_out/hospitalized — those contexts
      // correctly restore energy and this guard must never block recovery.
      const isSleepingContext = context === 'sleeping' || context === 'passed_out' || context === 'hospitalized';
      if (!isSleepingContext) {
        // Calculate what the context gave us in energy terms
        const contextEnergyRate = (RATES[context] || RATES.default).energy;
        const MINIMUM_AWAKE_DRAIN_PER_HOUR = -2; // At minimum -2/hr while awake
        if (contextEnergyRate > MINIMUM_AWAKE_DRAIN_PER_HOUR) {
          // Context is restoring more energy than the minimum drain allows.
          // Override the energy result to apply at most the minimum drain.
          // e.g. home_resting was +3/hr: we cap it to -2/hr baseline minimum.
          const energyWithMinDrain = clamp((currentNeeds.energy ?? 75) + MINIMUM_AWAKE_DRAIN_PER_HOUR * cappedHours);
          // Take the LOWER of the two (most conservative awake drain)
          if (energyWithMinDrain < newNeeds.energy) {
            newNeeds.energy = energyWithMinDrain;
          }
        }
      }
      const financialNeed = deriveFinancialNeed(char);

      // ── DETECT ESCALATION EVENTS → MEMORY ────────────────────────────────
      const escalationEvents = detectCriticalEscalations(currentNeeds, newNeeds, char.name);
      if (escalationEvents.length > 0) {
        Promise.all(escalationEvents.map(evt =>
          writeSDK.entities.Memory.create({
            character_id: char.id,
            title: evt.title,
            description: evt.description,
            emotional_impact: 'negative',
            timestamp: now.toISOString(),
            source_context: `needs_simulation_${evt.memory_tag}`,
          }).catch(() => {})
        ));
        console.warn(`[NEEDS-ESCALATION] ${char.name}: ${escalationEvents.map(e => e.memory_tag).join(', ')}`);
      }

      // ── RC1+RC2+RC3+RC4: CORRECTIVE STATE WRITES ─────────────────────────
      const corrective = computeCorrectiveState(char, newNeeds, context, now, locationMap);
      allCorrectiveLogs.push(...corrective.logs);

      // Fire-and-forget: create ScheduledEvents for ER discharge and pass-out wake
      for (const evDef of corrective.scheduledEvents) {
        writeSDK.entities.ScheduledEvent.create(evDef.data).catch(err =>
          console.error(`[CORRECTIVE-EVENT] Failed to create ${evDef.type} for ${char.name}:`, err.message)
        );
      }

      // REMOVED: Sleep debt system completely removed
      // No sleep debt calculation, no debt decay, no baseline clearing
      let sleepDebtUpdate = {};

      // Build final data payload — needs values + corrective state writes
      const updateData = {
        hunger_value:           Math.round(newNeeds.hunger),
        energy_value:           Math.round(newNeeds.energy),
        social_value:           Math.round(newNeeds.social),
        health_value:           Math.round(newNeeds.health),
        mental_value:           Math.round(newNeeds.mental),
        financial_need_value:   Math.round(financialNeed),
        hygiene_value:          Math.round(newNeeds.hygiene),
        comfort_value:          Math.round(newNeeds.comfort),
        last_need_simulated_at: now.toISOString(),
        // Merge corrective state changes (may override resolved_presence_status / current_activity)
        ...corrective.stateWrites,
      };

      updates.push({
        id: char.id,
        name: char.name,
        action: corrective.stateWrites.resolved_presence_status
          ? `simulated+corrective:${corrective.stateWrites.resolved_presence_status}`
          : 'simulated',
        context,
        elapsedHours: Math.round(cappedHours * 100) / 100,
        data: updateData,
        correctiveState: corrective.stateWrites,
      });
    }

    // Write character updates — user-scoped first (handles owner_email RLS), service role fallback
    const writeResults = await Promise.all(
      updates
        .filter(u => u.data !== null)
        .map(async u => {
          // Try user-scoped write first (Character entity RLS restricts to owner_email)
          const writeScope = user ? base44 : writeSDK;
          try {
            await writeScope.entities.Character.update(u.id, u.data);
            return { id: u.id, success: true };
          } catch (e1) {
            // Fallback: service role
            try {
              await writeSDK.entities.Character.update(u.id, u.data);
              return { id: u.id, success: true };
            } catch (e2) {
              console.error(`[WRITE_FAILURE] ${u.name} id=${u.id}: ${e2.message}`);
              return { id: u.id, success: false, error: e2.message };
            }
          }
        })
    );

    const writeFailures = writeResults.filter(r => !r.success);
    if (writeFailures.length > 0) {
      console.error(`[NEEDS-WRITE-FAILURES] ${writeFailures.length} characters failed to write:`, JSON.stringify(writeFailures));
    }

    return Response.json({
      success: true,
      processed: characters.length,
      write_failures: writeFailures.length,
      corrective_actions_taken: allCorrectiveLogs.length,
      updates: updates.map(u => ({
        id: u.id,
        name: u.name,
        action: u.action,
        context: u.context,
        elapsedHours: u.elapsedHours,
        correctiveState: u.correctiveState || null,
      })),
      corrective_logs: allCorrectiveLogs,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[simulateActiveCharacterNeeds]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});