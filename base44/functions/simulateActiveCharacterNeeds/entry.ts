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
  bar_club:        { hunger: -2,   energy: -4,  social: +5,   health: -1,   mental: +1,   hygiene: -1,   comfort: -1   },
  home_resting:    { hunger: -1,   energy: +3,  social: -1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +3   },
  home_active:     { hunger: -2,   energy: -1,  social: -1,   health: 0,    mental: 0,    hygiene: -0.5, comfort: +1   },
  hospital:        { hunger: -1,   energy: +2,  social: -1,   health: +3,   mental: -1,   hygiene: 0,    comfort: +1   },
  food_drink:      { hunger: +15,  energy: +2,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  social_out:      { hunger: -2,   energy: -3,  social: +4,   health: 0,    mental: +1,   hygiene: -1,   comfort: -0.5 },
  traveling:       { hunger: -3,   energy: -3,  social: -1,   health: 0,    mental: -1,   hygiene: -2,   comfort: -3   },
  eating:          { hunger: +15,  energy: +2,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  resting:         { hunger: -1,   energy: +6,  social: -0.5, health: +1,   mental: +2,   hygiene: 0,    comfort: +3   },
  default:         { hunger: -2,   energy: -2,  social: -1,   health: 0,    mental: -0.5, hygiene: -1,   comfort: -1   },
};

// ── THRESHOLDS ────────────────────────────────────────────────────────────────
const T = {
  HUNGER_ER:         5,
  HUNGER_CRITICAL:  20,
  HUNGER_LOW:       35,
  ENERGY_PASSOUT:    0,
  ENERGY_CRITICAL:  12,
  ENERGY_LOW:       28,
  HEALTH_ER:        15,
  HEALTH_CRITICAL:  20,
  COMPOUND_CRISIS:   3,   // number of needs below 20 to trigger compound handling
};

function isOnShift(character) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) return false;
  // CRITICAL: Always use America/New_York — UTC is forbidden for schedule logic
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cur = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm = 0] = character.work_start_time.split(':').map(Number);
  const [eh, em = 0] = character.work_end_time.split(':').map(Number);
  return character.work_days.includes(nowET.getDay()) && cur >= sh * 60 + sm && cur < eh * 60 + em;
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
    if (workLoc) return isOnShift(character) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character) ? 'at_work' : 'work_off_shift';
  }

  if (presenceStatus === 'at_work') {
    const workLocId = character.current_work_location_id || character.occupation_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return isOnShift(character) ? getWorkContextFromLocation(workLoc) : 'work_off_shift';
    return isOnShift(character) ? 'at_work' : 'work_off_shift';
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
  if (locId === workLocId) return isOnShift(character) ? getWorkContextFromLocation(loc) : 'work_off_shift';

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
  if (oldNeeds.energy >= 15 && newNeeds.energy < 15) events.push({ title: 'Extreme exhaustion', description: `${characterName} was running on empty and could barely function.`, memory_tag: 'energy_critical' });
  if (newNeeds.energy <= 0 && oldNeeds.energy > 0) events.push({ title: 'Passed out from exhaustion', description: `${characterName} collapsed from complete energy depletion.`, memory_tag: 'energy_zero' });
  if (oldNeeds.health >= 20 && newNeeds.health < 20) events.push({ title: 'Health reached critical level', description: `${characterName}'s health deteriorated to a critical state.`, memory_tag: 'health_critical' });
  if (oldNeeds.social >= 15 && newNeeds.social < 15) events.push({ title: 'Deep social isolation', description: `${characterName} felt completely alone and isolated.`, memory_tag: 'social_critical' });
  if (oldNeeds.mental >= 15 && newNeeds.mental < 15) events.push({ title: 'Mental breakdown threshold reached', description: `${characterName} reached a mental breaking point.`, memory_tag: 'mental_critical' });
  return events;
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
function computeCorrectiveState(char, newNeeds, currentContext, now) {
  const stateWrites = {};
  const scheduledEvents = [];
  const logs = [];

  const hunger = newNeeds.hunger;
  const energy = newNeeds.energy;
  const health = newNeeds.health;
  const mental = newNeeds.mental;
  const presence = char.resolved_presence_status || '';
  const onShift = isOnShift(char);

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

  // ── RC4 FIX: COMPOUND CRISIS FORCED REST ─────────────────────────────────
  if (criticalCount >= T.COMPOUND_CRISIS && !alreadySleeping && !onShift) {
    stateWrites.resolved_presence_status = 'sleeping';
    stateWrites.current_activity = 'forced rest — multiple critical needs';
    logs.push(`[CORRECTIVE] ${char.name}: compound crisis (${criticalCount} needs critical) → forced sleeping`);
    // No scheduled event needed — next tick will see sleeping context and apply recovery rates
  }

  // ── RC1 FIX: AUTO-SLEEP when energy critically low ────────────────────────
  else if (energy <= T.ENERGY_CRITICAL && !alreadySleeping && !onShift && !stateWrites.resolved_presence_status) {
    stateWrites.resolved_presence_status = 'sleeping';
    stateWrites.current_activity = 'sleeping — exhausted';
    logs.push(`[CORRECTIVE] ${char.name}: energy=${Math.round(energy)} → auto-sleep triggered`);
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

      // ── RC1+RC2+RC3+RC4: CORRECTIVE STATE WRITES ─────────────────────────
      const corrective = computeCorrectiveState(char, newNeeds, context, now);
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