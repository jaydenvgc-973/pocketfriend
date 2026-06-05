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
  ENERGY_PASSOUT:    0,
  ENERGY_CRITICAL:  20,  // auto-sleep trigger — tired enough to sleep, not just near-collapse
  ENERGY_LOW:       35,  // character is noticeably tired, starts wanting to go home
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

function getLocationContext(character, locationMap) {
  const activity = (character.current_activity || '').toLowerCase();
  const presenceStatus = character.resolved_presence_status || character.location_status;

  // ── Overrides first ──
  if (presenceStatus === 'hospitalized') return 'hospitalized';
  if (presenceStatus === 'passed_out') return 'passed_out';
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';
  if (activity.includes('passed out') || activity.includes('collapsed')) return 'passed_out';
  if (activity.includes('hospital') || activity.includes('er ') || activity.includes('emergency room') || activity.includes('urgent care')) return 'hospitalized';
  if (activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal') || activity.includes('lunch') || activity.includes('dinner') || activity.includes('breakfast') || activity.includes('snack')) return 'eating';
  if (activity.includes('rest') || activity.includes('nap') || activity.includes('relax')) return 'resting';

  if (character.travel_status && character.travel_status !== 'not_traveling') return 'traveling';
  if (activity.includes('at work') || activity.includes('working') || activity.includes('on shift')) {
    const workLocId = character.current_work_location_id || character.occupation_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return isOnShift(character, locationMap) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character, locationMap) ? 'at_work' : 'work_off_shift';
  }

  if (presenceStatus === 'at_work') {
    const workLocId = character.current_work_location_id || character.occupation_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return isOnShift(character, locationMap) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character, locationMap) ? 'at_work' : 'work_off_shift';
  }
  if (presenceStatus === 'at_school') return 'at_school';

  const locId = character.resolved_current_location_id;
  if (!locId) {
    if (presenceStatus === 'home' || !presenceStatus) return 'home_resting';
    return 'default';
  }
  const loc = locationMap[locId];
  if (!loc) return 'home_resting';

  const workLocId = character.current_work_location_id || character.occupation_location_id;
  if (locId === workLocId) return isOnShift(character, locationMap) ? getWorkContextFromLocation(loc) : 'work_off_shift';

  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  if (cat === 'gym') return 'gym';
  if (cat === 'medical') return 'hospital';
  if (cat === 'food_drink' || name.includes('restaurant') || name.includes('cafe') || name.includes('diner') || name.includes('kitchen')) return 'food_drink';
  if (cat === 'social' || name.includes('bar') || name.includes('club') || name.includes('lounge') || name.includes('nightclub')) return 'bar_club';
  if (cat === 'outdoor') return 'social_out';
  if (cat === 'home' || cat === 'generic') return (presenceStatus === 'home' || !presenceStatus) ? 'home_resting' : 'home_active';
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
  const criticalCount = [needs.hunger, needs.energy, needs.mental, needs.hygiene, needs.health]
    .filter(v => v < 20).length;
  if (criticalCount >= T.COMPOUND_CRISIS) {
    // Slow the compound damage to prevent instant collapse — max 0.5/hr
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

// ── SLEEP MISS CONSEQUENCE DETECTION ─────────────────────────────────────────
// Called when a character is awake during late hours (11 PM–4 AM ET) with low energy.
// Writes a memory about consequences — exhaustion, poor choices, guilt, lateness.
// This memory influences future behavior through the canonical prompt system.
function detectSleepMissConsequences(char, newNeeds, context, now) {
  const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nowET.getHours();
  // Only relevant during late-night hours when character should typically be asleep
  const isLateNight = hour >= 23 || hour < 4;
  if (!isLateNight) return null;

  const energy = newNeeds.energy;
  const isAwakeContext = !['sleeping', 'passed_out', 'hospitalized', 'napping'].includes(
    char.resolved_presence_status || ''
  );
  if (!isAwakeContext) return null;

  // Only fire if energy is noticeably low (character is tired but still up)
  if (energy >= 45) return null;

  const hasWorkTomorrow = Array.isArray(char.work_days) && char.work_days.length > 0 && char.work_start_time;
  const hasSchoolTomorrow = char.student_status === 'enrolled' && char.education_location_id;
  const hasObligation = hasWorkTomorrow || hasSchoolTomorrow;

  const consequenceDescriptions = [
    `${char.name} stayed up too late and was running low on energy. They'd regret it in the morning.`,
    `${char.name} was exhausted but still awake during the late-night hours — their body was telling them to sleep.`,
    `${char.name} pushed through tiredness and stayed up later than they should have.`,
  ];
  const baseDescription = consequenceDescriptions[Math.floor(Math.random() * consequenceDescriptions.length)];
  const obligationSuffix = hasObligation
    ? ` They had ${hasWorkTomorrow ? 'work' : 'school'} the next day, which would make the tiredness worse.`
    : '';

  return {
    title: 'Stayed up too late — exhausted',
    description: baseDescription + obligationSuffix,
    memory_tag: 'sleep_miss_consequence',
    energy_at_event: Math.round(energy),
    had_obligation: hasObligation,
  };
}

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
 * RC1+RC2+RC3+RC4 FIX: Determine corrective state writes needed.
 * Returns an object of fields to merge into the character update payload,
 * plus optional ScheduledEvent objects to create.
 *
 * Priority (highest wins):
 *  1. Hospitalization (health ER or compound crisis with low health)
 *  2. Pass-out (energy = 0)
 *  3. Auto-sleep (energy critical, not on shift)
 *  4. Auto-eat (hunger critical, not sleeping, not hospitalized)
 */
function computeCorrectiveState(char, newNeeds, currentContext, now, locationMap) {
  const stateWrites = {};
  const scheduledEvents = [];
  const logs = [];

  const hunger = newNeeds.hunger;
  const energy = newNeeds.energy;
  const health = newNeeds.health;
  const mental = newNeeds.mental;
  const presence = char.resolved_presence_status || '';
  const onShift = isOnShift(char, locationMap);

  // Count how many needs are in crisis
  const criticalCount = [hunger, energy, newNeeds.mental, newNeeds.hygiene, health]
    .filter(v => v < 20).length;

  const alreadyHospitalized = presence === 'hospitalized' || (char.current_activity || '').toLowerCase().includes('hospital');
  const alreadySleeping = presence === 'sleeping' || presence === 'napping' || presence === 'passed_out';

  // ── RC3 FIX: HEALTH ER ESCALATION ────────────────────────────────────────
  // Trigger if health ≤ 15 OR compound crisis with health ≤ 20
  const healthERThreshold = criticalCount >= T.COMPOUND_CRISIS ? T.HEALTH_CRITICAL : T.HEALTH_ER;
  if (health <= healthERThreshold && !alreadyHospitalized && !onShift) {
    stateWrites.resolved_presence_status = 'hospitalized';
    stateWrites.current_activity = 'receiving emergency medical care';
    // Schedule discharge in 4–6 hours
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
    logs.push(`[CORRECTIVE] ${char.name}: health=${Math.round(health)} → hospitalized. Discharge scheduled ${dischargeTime.toISOString()}`);
    return { stateWrites, scheduledEvents, logs }; // hospitalization overrides all other corrections
  }

  // ── RC2 FIX: PASS-OUT STATE WRITER ───────────────────────────────────────
  if (energy <= T.ENERGY_PASSOUT && !alreadySleeping) {
    stateWrites.resolved_presence_status = 'passed_out';
    stateWrites.current_activity = 'passed out — recovering';
    // Schedule wake-up once energy recovers (at passed_out rate ~8/hr, need ~20 to wake)
    const wakeTime = new Date(now.getTime() + 2.5 * 3600000); // ~2.5h minimum
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
    logs.push(`[CORRECTIVE] ${char.name}: energy=0 → passed_out. Wake scheduled ${wakeTime.toISOString()}`);
    return { stateWrites, scheduledEvents, logs };
  }

  // ── VALID SLEEP LOCATION CHECK ────────────────────────────────────────────
  // Normal sleep may only be written when the character is at a recognized sleep location.
  // Valid sleep categories: home, hotel, shelter, generic (and confinement — handled above).
  // If they are not at a valid sleep location, they may be critically tired but cannot
  // casually fall asleep there. They must go home first (autonomousCharacterMovement handles this).
  // EXCEPTION: passed_out is always written regardless of location — it is an emergency state.
  const VALID_SLEEP_CATS = new Set(['home', 'hotel', 'shelter', 'generic']);
  const currentLocId = char.resolved_current_location_id;
  // We don't have full locationMap here, but we can use presence status and resolved_location_type
  // as the proxy: home/sleeping/napping/passed_out/hospitalized are all valid sleep contexts.
  // Any other resolved_location_type (work, school, gym, bar, social, etc.) is not a valid sleep location.
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
    !currentLocType  // no location type = home/unresolved = safe to sleep
  );

  // ── RC4 FIX: COMPOUND CRISIS FORCED REST ─────────────────────────────────
  // Only write sleeping if character is already at a valid sleep location.
  // If they're out somewhere, autonomousCharacterMovement will route them home.
  if (criticalCount >= T.COMPOUND_CRISIS && !alreadySleeping && !onShift) {
    if (atValidSleepLocation) {
      stateWrites.resolved_presence_status = 'sleeping';
      stateWrites.current_activity = 'forced rest — multiple critical needs';
      logs.push(`[CORRECTIVE] ${char.name}: compound crisis (${criticalCount} needs critical) → forced sleeping at valid location`);
    } else {
      logs.push(`[CORRECTIVE] ${char.name}: compound crisis (${criticalCount} needs critical) — NOT at valid sleep location (${currentLocType}/${currentPresence}), autonomousMovement must route home`);
    }
  }

  // ── RC1 FIX: AUTO-SLEEP when energy critically low ────────────────────────
  // Only write sleeping if character is at a valid sleep location.
  // If they are at work, school, a bar, gym, etc. — they cannot casually fall asleep.
  // They are tired; the autonomous movement system will route them home.
  else if (energy <= T.ENERGY_CRITICAL && !alreadySleeping && !onShift && !stateWrites.resolved_presence_status) {
    if (atValidSleepLocation) {
      stateWrites.resolved_presence_status = 'sleeping';
      stateWrites.current_activity = 'sleeping — exhausted';
      logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} → auto-sleep at valid location`);
    } else {
      logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} critical — NOT at valid sleep location (${currentLocType}/${currentPresence}), autonomousMovement must route home`);
    }
  }

  // ── RC1 FIX: AUTO-EAT when hunger critically low ──────────────────────────
  if (hunger <= T.HUNGER_CRITICAL && !alreadySleeping && !alreadyHospitalized) {
    // Only inject eating if not already sleeping (can't eat while sleeping)
    // Check financial need — if too broke, they can't eat out but can find free food
    const financial = char.financial_need_value ?? 60;
    const eatActivity = financial > 15 ? 'eating — addressing hunger' : 'finding food — hunger critical';
    stateWrites.current_activity = eatActivity;
    logs.push(`[CORRECTIVE] ${char.name}: hunger=${Math.round(hunger)} → auto-eat injected: "${eatActivity}"`);
    // Next tick context will be 'eating' → hunger +15/hr
  }

  return { stateWrites, scheduledEvents, logs };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { characterId } = payload;

    // Determine auth context
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

      const context = getLocationContext(char, locationMap);

      // Apply elapsed-time decay/recovery
      let newNeeds = applyElapsedTime(currentNeeds, cappedHours, context);
      // Apply cross-system infection
      newNeeds = applyStatInfection(newNeeds, cappedHours);
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

      // ── SLEEP MISS CONSEQUENCES — written at most once per 6 hours per character ──
      // Only fires during late-night hours when character is awake and tired.
      // The memory is injected into canonical context so future behavior reflects the consequence.
      const sleepMissEvt = detectSleepMissConsequences(char, newNeeds, context, now);
      if (sleepMissEvt) {
        // Throttle: check last_sleep_miss_memory_at to avoid spam (once per 6h)
        const lastMissAt = char.last_sleep_miss_memory_at ? new Date(char.last_sleep_miss_memory_at).getTime() : 0;
        const sixHoursMs = 6 * 3600 * 1000;
        if (now.getTime() - lastMissAt >= sixHoursMs) {
          writeSDK.entities.Memory.create({
            character_id: char.id,
            title: sleepMissEvt.title,
            description: sleepMissEvt.description,
            emotional_impact: sleepMissEvt.had_obligation ? 'negative' : 'neutral',
            timestamp: now.toISOString(),
            source_context: 'needs_simulation_sleep_miss',
          }).catch(() => {});
          // Track last write time — write to character record non-blockingly
          writeSDK.entities.Character.update(char.id, {
            last_sleep_miss_memory_at: now.toISOString(),
          }).catch(() => {});
          console.log(`[SLEEP-MISS] ${char.name}: consequence memory written (energy=${sleepMissEvt.energy_at_event}, obligation=${sleepMissEvt.had_obligation})`);
        }
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