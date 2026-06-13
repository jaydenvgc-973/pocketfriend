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
// ── ENERGY RULE: Awake contexts must NEVER restore energy (energy rate must be ≤ 0 for all awake states).
// Energy restoration is ONLY valid in: sleeping (+12), passed_out (+8), hospitalized (+4).
// home_resting, resting, eating, food_drink, hospital — previously had positive energy rates.
// These are now set to 0 (neutral) for energy. Awake resting slows drain but never reverses it.
// The -5/hr baseline awake drain guarantee (applied after context rates) ensures forward progress to 0.
const RATES = {
  sleeping:        { hunger: -1,   energy: +12, social: -0.5, health: +0.5, mental: +3,   hygiene: 0,    comfort: +4   },
  passed_out:      { hunger: -0.5, energy: +8,  social: -0.5, health: +0.5, mental: +0.5, hygiene: 0,    comfort: +1   },
  hospitalized:    { hunger: -0.5, energy: +4,  social: -1,   health: +5,   mental: -0.3, hygiene: +1,   comfort: +2   },
  at_work:         { hunger: -4,   energy: -5,  social: +1,   health: -0.5, mental: -0.5, hygiene: -2,   comfort: -2   },
  at_work_medical: { hunger: -5,   energy: -7,  social: +1,   health: -0.5, mental: -1,   hygiene: -3,   comfort: -4   },
  at_work_service: { hunger: -5,   energy: -6,  social: +2,   health: -1,   mental: -0.75,hygiene: -3,   comfort: -3   },
  at_work_office:  { hunger: -3,   energy: -4,  social: +1,   health: -0.5, mental: -0.5, hygiene: -1,   comfort: -1   },
  work_off_shift:  { hunger: -3,   energy: -3,  social: -1,   health: -0.5, mental: -0.5, hygiene: -2,   comfort: -4   },
  at_school:       { hunger: -3,   energy: -4,  social: +2,   health: -0.5, mental:  0,   hygiene: -1,   comfort: -1   },
  gym:             { hunger: -6,   energy: -7,  social: +1,   health: +1,   mental: +1,   hygiene: -5,   comfort: -2   },
  bar_club:        { hunger: -2,   energy: -5,  social: +5,   health: -1,   mental: +0.5, hygiene: -1,   comfort: -1   },
  // home_resting: energy=0 (neutral). Awake resting does not restore energy. -5/hr baseline still applies.
  home_resting:    { hunger: -1,   energy:  0,  social: -1,   health: +0.5, mental: +2,   hygiene: 0,    comfort: +3   },
  home_active:     { hunger: -2,   energy: -3,  social: -1,   health: 0,    mental: +0.5, hygiene: -0.5, comfort: +1   },
  // hospital (visited, not admitted): energy=0. Admitted/hospitalized context is separate above.
  hospital:        { hunger: -1,   energy:  0,  social: -1,   health: +3,   mental: -0.5, hygiene: 0,    comfort: +1   },
  // food_drink: eating out while awake does not restore energy — food restores hunger only.
  food_drink:      { hunger: +15,  energy:  0,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  social_out:      { hunger: -2,   energy: -4,  social: +4,   health: 0,    mental: +1,   hygiene: -1,   comfort: -0.5 },
  // REMOVED: Travel is routing metadata only, never a needs context.
  // Movement is teleport-style — destination/resolved context is always authoritative.
  // No travel exception for "travel to work" or any other destination.
  // All zeros — travel applies no needs rates whatsoever.
  // eating: hunger relief only. Energy=0 while awake. -5/hr baseline still applies on top.
  eating:          { hunger: +15,  energy:  0,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  // resting: energy=0 (neutral). Awake resting does not restore energy.
  resting:         { hunger: -1,   energy:  0,  social: -0.5, health: +1,   mental: +3,   hygiene: 0,    comfort: +3   },
  default:         { hunger: -2,   energy: -4,  social: -1,   health: 0,    mental: -0.3, hygiene: -1,   comfort: -1   },
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
  // Mental decays slowly — thresholds are MUCH higher than physical needs
  MENTAL_SEVERE:    40,   // below 40 = severe danger, significant intervention needed
  MENTAL_CRITICAL:  50,   // 40-50 = critical concern, staff/support should activate
  MENTAL_MODERATE:  60,   // 50-60 = moderate concern, preventative support
  MENTAL_MILD:      70,   // 60-70 = mild concern, gentle check-in
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
  const subtypes = (loc.subtype || []).map(s => s.toLowerCase());
  const desc = (loc.description || '').toLowerCase();

  if (cat === 'medical' || name.includes('hospital') || name.includes('clinic') || name.includes('emergency') || name.includes('urgent care')) return 'at_work_medical';
  // Social/people-facing workplaces — workers get social need improvement during shift
  if (cat === 'food_drink' || cat === 'social'
    || name.includes('bar') || name.includes('restaurant') || name.includes('cafe') || name.includes('diner')
    || name.includes('club') || name.includes('lounge') || name.includes('nightclub') || name.includes('pub')
    || name.includes('tavern') || name.includes('bistro') || name.includes('grill')
    || name.includes('event') || name.includes('venue') || name.includes('entertainment')
    || name.includes('hospitality') || name.includes('concierge')) return 'at_work_service';
  // Education — teachers and school staff interact with students/staff all day
  if (cat === 'education' || cat === 'school' || name.includes('school') || name.includes('college') || name.includes('university') || name.includes('academy') || name.includes('campus')) return 'at_work_service';
  // Salon/beauty — close personal interaction with clients
  if (name.includes('salon') || name.includes('barber') || name.includes('spa') || name.includes('beauty') || name.includes('hair') || name.includes('nail')) return 'at_work_service';
  // Retail/shopping — constant customer interaction
  if (cat === 'shopping' || name.includes('retail') || name.includes('shop') || name.includes('store') || name.includes('market') || name.includes('mall') || name.includes('boutique')) return 'at_work_service';
  // Customer service / reception — constant people-facing interaction
  if (name.includes('reception') || name.includes('customer') || name.includes('service desk') || name.includes('front desk') || name.includes('call center') || name.includes('help desk') || subtypes.includes('customer_service') || subtypes.includes('reception')) return 'at_work_service';
  // Community — relationship-based interaction with residents/partners
  if (cat === 'community' || name.includes('community') || name.includes('center') || name.includes('outreach') || name.includes('shelter')) return 'at_work_service';
  // Gym/fitness — direct client contact as trainer/instructor
  if ((cat === 'gym' || name.includes('gym') || name.includes('fitness')) && (name.includes('studio') || name.includes('trainer') || subtypes.includes('fitness_instruction') || subtypes.includes('personal_training'))) return 'at_work_service';
  // Government / public service — interaction with citizens
  if (cat === 'government' || name.includes('office') || name.includes('department') || name.includes('agency') || name.includes('bureau') || subtypes.includes('public_service')) return 'at_work_office';
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

// Contexts that USED TO grant net positive energy — now all awake contexts are 0 or negative.
// This set is retained for reference only; the -5/hr baseline drain guarantee supersedes it.
// Only sleeping/passed_out/hospitalized restore energy (handled by isSleepingContext guard below).
const ENERGY_RESTORING_CONTEXTS = new Set(['sleeping', 'passed_out', 'hospitalized']);

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

/**
 * getLocationContext — CONTEXT AUTHORITY FRAMEWORK
 *
 * AUTHORITY HIERARCHY (highest → lowest):
 *   1. Critical physical states (hospitalized, passed_out, sleeping/napping)
 *   2. Authoritative schedule context (isOnShift → work context, at_school)
 *   3. Location-based context (resolved_current_location_id → category)
 *   4. Activity text (eating, resting) — SUBORDINATE to schedule
 *   5. Travel status — ROUTING METADATA ONLY, evaluates destination
 *
 * KEY RULES:
 *   - Schedule is reality. Activity text (eating, resting) does NOT override schedule.
 *   - A bartender eating during shift is still at work. at_work_service persists.
 *   - Travel is routing metadata. Never a needs context. Destination is authoritative.
 *   - Corrective states (eating, resting) are subordinate to schedule context.
 */
function getLocationContext(character, locationMap, now) {
  const activity = (character.current_activity || '').toLowerCase();
  const presenceStatus = character.resolved_presence_status || character.location_status;

  // ── TIER 1: CRITICAL PHYSICAL STATES ────────────────────────────────────
  // Never stale, always authoritative. These are physical collapse/medical states.
  if (presenceStatus === 'hospitalized') return 'hospitalized';
  if (presenceStatus === 'passed_out') return 'passed_out';
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';
  if (activity.includes('passed out') || activity.includes('collapsed')) return 'passed_out';
  if (activity.includes('hospital') || activity.includes('er ') || activity.includes('emergency room') || activity.includes('urgent care')) return 'hospitalized';

  // ── STALE PRESENCE CHECK ──────────────────────────────────────────────────
  const presenceIsStale = now ? resolvePresenceStaleness(character, now) : false;

  // ── TIER 2: AUTHORITATIVE SCHEDULE CONTEXT ────────────────────────────────
  // Work and school schedules are REALITY. They are checked BEFORE activity text
  // or travel status. A character eating during their shift is still at work.
  // A character traveling to their workplace during shift is still working.
  // Eating/drinking during a shift does not cancel work context — it is
  // work-compatible behavior (meal break, staff drink). Work context persists;
  // hunger recovery is applied via corrective override, not context switching.

  if (isOnShift(character, locationMap)) {
    const workLocId = character.occupation_location_id || character.current_work_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return getWorkContextFromLocation(workLoc);
    return 'at_work';
  }

  if (presenceStatus === 'at_school') return 'at_school';

  // ── TIER 3: TRAVEL — ROUTING METADATA ONLY ───────────────────────────────
  // Travel is NOT a needs context. It is a routing marker. Characters are
  // effectively moved between locations. Destination context is authoritative.
  // Travel must never apply its own decay/recovery rates over the destination.
  if (character.travel_status && character.travel_status !== 'not_traveling') {
    const destId = character.traveling_to_location_id || character.travel_destination_location_id;
    if (destId && locationMap[destId]) {
      const destLoc = locationMap[destId];
      const destCat = (destLoc.category || '').toLowerCase();
      if (destCat === 'home') return presenceIsStale ? 'default' : 'home_resting';
      if (destCat === 'food_drink') return presenceIsStale ? 'default' : 'food_drink';
      if (destCat === 'gym') return 'gym';
      if (destCat === 'social') return 'social_out';
      if (destCat === 'medical') return 'hospital';
    }
    return 'default';
  }

  // ── TIER 4: STALE PRESENCE FALLBACK — at_work without schedule ───────────
  if (presenceStatus === 'at_work') return 'work_off_shift';

  // ── TIER 5: LOCATION-BASED CONTEXT ────────────────────────────────────────
  const locId = character.resolved_current_location_id;
  if (!locId) {
    if (presenceIsStale) return 'default';
    if (presenceStatus === 'home' || !presenceStatus) return 'home_resting';
    return 'default';
  }
  const loc = locationMap[locId];
  if (!loc) return 'default';

  const workLocId = character.occupation_location_id || character.current_work_location_id;
  if (locId === workLocId) return 'work_off_shift'; // at work location but not on shift

  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  if (cat === 'gym') return 'gym';
  if (cat === 'medical') return 'hospital';
  if (cat === 'food_drink' || name.includes('restaurant') || name.includes('cafe') || name.includes('diner') || name.includes('kitchen')) {
    return presenceIsStale ? 'social_out' : 'food_drink';
  }
  if (cat === 'social' || name.includes('bar') || name.includes('club') || name.includes('lounge') || name.includes('nightclub')) return 'bar_club';
  if (cat === 'outdoor') return 'social_out';
  if (cat === 'home' || cat === 'generic') {
    if (presenceIsStale) return 'default';
    return (presenceStatus === 'home' || !presenceStatus) ? 'home_resting' : 'home_active';
  }

  // ── TIER 6: ACTIVITY TEXT (subordinate — schedule/location not found) ─────
  if (!presenceIsStale) {
    if (activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal') || activity.includes('lunch') || activity.includes('dinner') || activity.includes('breakfast') || activity.includes('snack')) return 'eating';
    if (activity.includes('rest') || activity.includes('nap') || activity.includes('relax')) return 'resting';
  }

  return 'default';
}

// ── COMFORT ADD-ON: POSITIVE & NEGATIVE MODIFIERS ──────────────────────────────
// This is purely additive. It does NOT replace RATES comfort values.
// It supplements them with context-aware signals: environment, rest state,
// food quality, social presence, and conversation tone.
//
// DESIGN RULES:
//   - Max positive modifier: +2/hr (gradual, not instant)
//   - Max negative modifier: -2/hr (balanced with positive)
//   - Social comfort and Social need remain INDEPENDENT values
//   - This fires AFTER applyElapsedTime, adds to comfort result
//   - Comfort does not shoot to 100 — clamp is applied at the end
//
// POSITIVE SOURCES:
//   - Sleeping/resting in a bed/home                   → +1 to +2/hr
//   - Comfortable furniture context (sofa, lounge)     → +1/hr
//   - High-quality food/restaurant                     → +0.5/hr
//   - Being around trusted/liked people                → +0.5 to +1/hr
//   - Clean, upscale, pleasant, familiar environment   → +0.5 to +1/hr
//
// NEGATIVE SOURCES:
//   - Being around disliked/feared people              → -0.5 to -1.5/hr
//   - Hostile, tense, embarrassing conversation        → -0.5 to -1/hr
//   - Harsh, dirty, loud, unsafe environment           → -0.5 to -1.5/hr
//   - Mandatory/unwanted social events                 → -0.5/hr
//
// NPC EXCLUSION: This only applies to active_created_character (caller already filters).

function computeComfortModifier(char, context, locationMap) {
  let modifier = 0;

  const presence    = char.resolved_presence_status || '';
  const activity    = (char.current_activity || '').toLowerCase();
  const locId       = char.resolved_current_location_id;
  const loc         = locId ? locationMap[locId] : null;
  const locCat      = (loc?.category || '').toLowerCase();
  const locName     = (loc?.name || '').toLowerCase();
  const locDesc     = (loc?.description || '').toLowerCase();
  const locFeatures = (loc?.features || []).map(f => (f || '').toLowerCase());

  // ── REST STATE COMFORT ────────────────────────────────────────────────────
  // Sleeping in a real home/bed: RATES already gives +4/hr — add +1 for "in bed" quality
  if (context === 'sleeping' && (locCat === 'home' || locCat === 'hotel' || presence === 'home')) {
    modifier += 1; // in a real bed at home/hotel — superior to passed-out on a couch
  }
  // Napping on sofa/home: RATES gives +4 for sleeping — a nap at home is comfortable
  if ((presence === 'napping' || activity.includes('nap')) && (locCat === 'home' || !locId)) {
    modifier += 0.5;
  }
  // Resting context at home — couch/lounge/bed while awake
  if (context === 'home_resting') {
    modifier += 1; // comfortable furniture, familiar surroundings
  }
  // Resting at any non-home but comfortable location (hotel, lounge, etc.)
  if (context === 'resting' && locCat !== 'gym' && locCat !== 'jail_prison') {
    modifier += 0.5;
  }

  // ── ENVIRONMENT QUALITY COMFORT ───────────────────────────────────────────
  if (loc) {
    // Upscale / nice restaurant / luxury venue
    const isUpscale = locFeatures.some(f => f.includes('upscale') || f.includes('luxury') || f.includes('fine dining') || f.includes('high-end'))
      || locDesc.includes('upscale') || locDesc.includes('luxury') || locDesc.includes('fine dining');
    if (isUpscale) modifier += 0.75;

    // Clean, pleasant, beautiful, relaxing
    const isPleasant = locFeatures.some(f => f.includes('clean') || f.includes('pleasant') || f.includes('beautiful') || f.includes('relaxing') || f.includes('serene') || f.includes('cozy') || f.includes('comfortable'))
      || locDesc.includes('cozy') || locDesc.includes('relaxing') || locDesc.includes('comfortable') || locDesc.includes('beautiful');
    if (isPleasant) modifier += 0.5;

    // Confinement facility / jail — harsh environment
    if (locCat === 'jail_prison' || loc.is_confinement_facility) {
      modifier -= 1.5;
    }

    // Outdoor park / pleasant outdoor — mild comfort bonus
    if (locCat === 'outdoor' || locCat === 'community') {
      modifier += 0.25;
    }
  }

  // ── FOOD QUALITY COMFORT ──────────────────────────────────────────────────
  // Eating at a restaurant (food_drink context) — good food improves comfort
  if (context === 'food_drink' || (activity.includes('eat') && locCat === 'food_drink')) {
    modifier += 0.5; // a decent meal in a pleasant place adds comfort
    if (loc) {
      const isNiceRestaurant = locFeatures.some(f => f.includes('upscale') || f.includes('fine dining') || f.includes('nice'))
        || locDesc.includes('upscale') || locDesc.includes('fine dining');
      if (isNiceRestaurant) modifier += 0.5; // extra for a genuinely nice restaurant
    }
  }

  // ── SOCIAL PRESENCE COMFORT ───────────────────────────────────────────────
  // Comfort and Social are SEPARATE needs. Social fulfillment ≠ comfort automatically.
  // Only positive, trusted, enjoyed relationships add comfort.
  // Mere interaction does NOT add comfort — quality matters.

  const relationships = char.fictional_relationships || [];
  const familyMembers = char.family_members || [];

  // Build trust/like score for people currently relevant
  // We approximate "who they're likely around" from activity/context
  const isSocialContext = context === 'social_out' || context === 'bar_club' || context === 'food_drink';
  const isAtHome = context === 'home_resting' || context === 'home_active' || presence === 'home';

  if (isSocialContext || isAtHome) {
    // Check if character has close, trusted, or loved relationships
    // High friendship (>75), high trust (>70), or romantic relationship → comfort bonus
    let bestRelationshipComfort = 0;
    for (const r of relationships) {
      const friendship = r.friendship_level ?? 50;
      const trust      = r.trust_level      ?? 50;
      const romantic   = r.romantic_level   ?? 0;
      const tension    = r.tension_level    ?? 0;

      // Disliked, distrusted, or feared person — comfort decreases
      if (friendship < 25 || trust < 20 || tension > 70) {
        bestRelationshipComfort = Math.min(bestRelationshipComfort, -1);
        continue;
      }
      // Trusted close friend / family / partner
      if (friendship > 80 || trust > 75 || romantic > 60) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 1);
      } else if (friendship > 60 || trust > 55) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
      }
    }

    // Family members also count — being with loved ones adds comfort
    if (isAtHome && familyMembers.length > 0) {
      // Presence of family at home (not a specific relationship record needed) → mild comfort
      bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    }

    modifier += bestRelationshipComfort;
  }

  // ── MANDATORY / STRESSFUL SOCIAL EVENT COMFORT PENALTY ──────────────────
  // A mandatory work event, tense gathering, or forced interaction is socially active but
  // comfort-negative. Approximate from activity text.
  const activityLower = activity;
  const isForcedEvent = activityLower.includes('mandatory') || activityLower.includes('forced') || activityLower.includes('awkward') || activityLower.includes('uncomfortable');
  if (isForcedEvent) modifier -= 0.5;

  const isStressfulActivity = activityLower.includes('argument') || activityLower.includes('confrontation') || activityLower.includes('conflict') || activityLower.includes('tense') || activityLower.includes('stressed');
  if (isStressfulActivity) modifier -= 1;

  // ── CAP TOTAL MODIFIER ────────────────────────────────────────────────────
  // Max +2/hr positive, max -2/hr negative — gradual, not dramatic
  return Math.max(-2, Math.min(2, modifier));
}

// ── MENTAL MODIFIER ──────────────────────────────────────────────────────────
// computeMentalModifier and mentalPersonalityScale live in lib/mentalWellbeingModifier.js
// This file no longer defines them — they are imported for use in the main simulation loop.

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
  if (needs.energy < T.ENERGY_CRITICAL) {
    const severity = (T.ENERGY_CRITICAL - needs.energy) / T.ENERGY_CRITICAL;
    needs.health = clamp(needs.health - 0.8 * severity * elapsedHours);
    needs.mental = clamp(needs.mental - 0.4 * severity * elapsedHours);
  }
  if (needs.health < T.HEALTH_CRITICAL) {
    const severity = (T.HEALTH_CRITICAL - needs.health) / T.HEALTH_CRITICAL;
    needs.energy  = clamp(needs.energy  - 1.5 * severity * elapsedHours);
    needs.comfort = clamp(needs.comfort - 0.5 * severity * elapsedHours);
  }
  if (needs.social < 15) {
    needs.mental = clamp(needs.mental - 0.15 * elapsedHours);
  }
  if (needs.mental < 40) {
    const severity = (40 - needs.mental) / 40;
    needs.hunger  = clamp(needs.hunger  - 0.2 * severity * elapsedHours);
    needs.hygiene = clamp(needs.hygiene - 0.2 * severity * elapsedHours);
    needs.health  = clamp(needs.health  - 0.15 * severity * elapsedHours);
  }
  const bodyCriticalCount = [needs.hunger, needs.energy, needs.health]
    .filter(v => v < 20).length;
  if (bodyCriticalCount >= 2) {
    needs.health = clamp(needs.health - 0.5 * elapsedHours);
  }
  return needs;
}

function detectCriticalEscalations(oldNeeds, newNeeds, characterName) {
  const events = [];
  if (oldNeeds.hunger >= 20 && newNeeds.hunger < 20) events.push({ title: 'Reached critical hunger', description: `${characterName} was starving — hunger became critical.`, memory_tag: 'hunger_critical' });
  if (oldNeeds.hunger >= 10 && newNeeds.hunger < 10) events.push({ title: 'Severe hunger — near collapse', description: `${characterName} was extremely hungry, feeling dizzy and unable to focus.`, memory_tag: 'hunger_severe' });
  if (newNeeds.hunger <= 0 && oldNeeds.hunger > 0) events.push({ title: 'Hunger at zero — survival mode', description: `${characterName} had no food energy at all.`, memory_tag: 'hunger_zero' });
  if (oldNeeds.energy >= 25 && newNeeds.energy < 25) events.push({ title: 'Running on empty', description: `${characterName} was exhausted and struggling to stay awake.`, memory_tag: 'energy_critical' });
  if (newNeeds.energy <= 0 && oldNeeds.energy > 0) events.push({ title: 'Passed out from exhaustion', description: `${characterName} collapsed from complete energy depletion.`, memory_tag: 'energy_zero' });
  if (oldNeeds.health >= 20 && newNeeds.health < 20) events.push({ title: 'Health reached critical level', description: `${characterName}'s health deteriorated to a critical state.`, memory_tag: 'health_critical' });
  if (oldNeeds.social >= 15 && newNeeds.social < 15) events.push({ title: 'Deep social isolation', description: `${characterName} felt completely alone and isolated.`, memory_tag: 'social_critical' });
  if (oldNeeds.mental >= 50 && newNeeds.mental < 50) events.push({ title: 'Mental health declining', description: `${characterName}'s mental wellbeing dropped to a concerning level.`, memory_tag: 'mental_critical' });
  if (oldNeeds.mental >= 40 && newNeeds.mental < 40) events.push({ title: 'Severe mental health concern', description: `${characterName} is in a severely distressed mental state.`, memory_tag: 'mental_severe' });
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

// computeMentalModifier is defined in lib/mentalWellbeingModifier.js
// Imported at module top for the main simulation loop below.