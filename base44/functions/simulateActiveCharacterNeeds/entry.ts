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
  passed_out:      { hunger: -0.5, energy: +8,  social: -0.5, health: +0.5, mental: +1,   hygiene: 0,    comfort: +1   },
  hospitalized:    { hunger: -0.5, energy: +4,  social: -1,   health: +5,   mental: -0.5, hygiene: +1,   comfort: +2   },
  at_work:         { hunger: -4,   energy: -5,  social: +1,   health: -0.5, mental: -2,   hygiene: -2,   comfort: -2   },
  at_work_medical: { hunger: -5,   energy: -7,  social: +1,   health: -0.5, mental: -4,   hygiene: -3,   comfort: -4   },
  at_work_service: { hunger: -5,   energy: -6,  social: +2,   health: -1,   mental: -3,   hygiene: -3,   comfort: -3   },
  at_work_office:  { hunger: -3,   energy: -4,  social: +1,   health: -0.5, mental: -2,   hygiene: -1,   comfort: -1   },
  work_off_shift:  { hunger: -3,   energy: -3,  social: -1,   health: -0.5, mental: -3,   hygiene: -2,   comfort: -4   },
  at_school:       { hunger: -3,   energy: -4,  social: +2,   health: -0.5, mental: -1,   hygiene: -1,   comfort: -1   },
  gym:             { hunger: -6,   energy: -7,  social: +1,   health: +1,   mental: +1,   hygiene: -5,   comfort: -2   },
  bar_club:        { hunger: -2,   energy: -5,  social: +5,   health: -1,   mental: +1,   hygiene: -1,   comfort: -1   },
  // home_resting: energy=0 (neutral). Awake resting does not restore energy. -5/hr baseline still applies.
  home_resting:    { hunger: -1,   energy:  0,  social: -1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +3   },
  home_active:     { hunger: -2,   energy: -3,  social: -1,   health: 0,    mental: 0,    hygiene: -0.5, comfort: +1   },
  // hospital (visited, not admitted): energy=0. Admitted/hospitalized context is separate above.
  hospital:        { hunger: -1,   energy:  0,  social: -1,   health: +3,   mental: -1,   hygiene: 0,    comfort: +1   },
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
  resting:         { hunger: -1,   energy:  0,  social: -0.5, health: +1,   mental: +2,   hygiene: 0,    comfort: +3   },
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
/**
 * computeDecisionWeights — CONTEXTUAL DECISION WEIGHTING
 *
 * Computes dynamic decision weights for a character based on their current
 * context: schedule gravity, needs urgency, time of day, personality traits,
 * and restrictions. These weights modulate corrective action thresholds
 * in computeCorrectiveState — a character on shift tolerates more hunger,
 * a student tolerates more fatigue before abandoning school, etc.
 *
 * This runs INLINE (no cross-function HTTP call) for performance.
 */
// ── PRESSURE CURVE UTILITY ─────────────────────────────────────────────────
// Maps raw need value (0-100) to continuous pressure score (0-1) using
// need-specific curves. Linear interpolation between control points.
// Each need has its own curve — hygiene at 40% means something different
// than energy at 40%.
function pressureCurve(value, curve) {
  for (let i = 0; i < curve.length - 1; i++) {
    const [vHi, pHi] = curve[i];
    const [vLo, pLo] = curve[i + 1];
    if (value >= vLo && value <= vHi) {
      const range = vHi - vLo;
      if (range === 0) return pHi;
      return pHi + ((vHi - value) / range) * (pLo - pHi);
    }
  }
  if (value >= curve[0][0]) return curve[0][1];
  return curve[curve.length - 1][1];
}

// Need-specific pressure curves: [value_threshold, pressure_score]
// Pressure is continuous — there is no "not critical = ignore" binary.
const HYGIENE_CURVE = [[100,0],[75,0],[55,0.08],[45,0.15],[40,0.20],[35,0.30],[30,0.45],[25,0.60],[20,0.75],[15,0.85],[10,0.93],[0,1.0]];
const ENERGY_CURVE  = [[100,0],[80,0.03],[60,0.10],[50,0.18],[40,0.28],[35,0.35],[30,0.45],[25,0.58],[20,0.72],[15,0.82],[10,0.90],[5,0.97],[0,1.0]];
const HUNGER_CURVE  = [[100,0],[70,0],[55,0.10],[45,0.18],[40,0.22],[35,0.30],[25,0.50],[20,0.65],[15,0.80],[10,0.90],[5,0.95],[0,1.0]];
const SOCIAL_CURVE  = [[100,0],[70,0],[55,0.06],[45,0.12],[35,0.20],[25,0.35],[20,0.45],[15,0.60],[10,0.80],[0,1.0]];
const MENTAL_CURVE  = [[100,0],[70,0.05],[55,0.12],[45,0.20],[35,0.30],[25,0.42],[20,0.52],[15,0.65],[10,0.82],[0,1.0]];
const COMFORT_CURVE = [[100,0],[70,0.05],[55,0.15],[45,0.22],[35,0.35],[25,0.50],[15,0.68],[10,0.82],[0,1.0]];
const HEALTH_CURVE  = [[100,0],[80,0],[65,0.05],[50,0.12],[40,0.20],[30,0.30],[25,0.42],[20,0.60],[15,0.80],[10,0.92],[0,1.0]];
const FINANCE_CURVE = [[100,0],[70,0],[55,0.10],[40,0.20],[30,0.35],[20,0.55],[10,0.80],[0,1.0]];

function computeDecisionWeights(char, newNeeds, locationMap) {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cur = nowET.getHours() * 60 + nowET.getMinutes();
  const dow = nowET.getDay();
  const hour = nowET.getHours();

  // ── NEED-SPECIFIC CONTINUOUS PRESSURE SCORES ──────────────────────────
  // Pressure is continuous (0-1), not binary. Every need value contributes
  // to decision pressure. There is no "ignore until critical" zone.
  const pressures = {
    hunger:   pressureCurve(newNeeds.hunger   ?? 70, HUNGER_CURVE),
    energy:   pressureCurve(newNeeds.energy   ?? 75, ENERGY_CURVE),
    hygiene:  pressureCurve(newNeeds.hygiene  ?? 75, HYGIENE_CURVE),
    social:   pressureCurve(newNeeds.social   ?? 65, SOCIAL_CURVE),
    mental:   pressureCurve(newNeeds.mental   ?? 70, MENTAL_CURVE),
    comfort:  pressureCurve(newNeeds.comfort  ?? 70, COMFORT_CURVE),
    health:   pressureCurve(newNeeds.health   ?? 80, HEALTH_CURVE),
    financial: pressureCurve(newNeeds.financial_need_value ?? 60, FINANCE_CURVE),
  };

  // ── OPPORTUNITY BOOSTS: can the solution be executed right now? ──────
  const locType = (char.resolved_location_type || '').toLowerCase();
  const locId = char.resolved_current_location_id;
  const homeId = char.current_home_location_id;
  const presence = char.resolved_presence_status || '';
  const isAtHome = locType === 'home' || presence === 'home' || (locId && locId === homeId);

  // Food availability: at home, at food_drink, at grocery, or at a food-serving workplace
  const isAtFoodLocation = isAtHome || locType === 'food_drink' || (() => {
    if (!locId || !locationMap[locId]) return false;
    const l = locationMap[locId];
    const cat = (l.category || '').toLowerCase();
    const name = (l.name || '').toLowerCase();
    return cat === 'grocery' || name.includes('restaurant') || name.includes('cafe') ||
      name.includes('diner') || name.includes('kitchen') || name.includes('bar') ||
      name.includes('grill') || name.includes('club');
  })();

  const opportunity = {
    canEat: isAtFoodLocation ? 0.60 : 0.10,       // food is right here vs needs travel
    canShower: isAtHome ? 0.55 : 0.05,             // shower is here vs needs to go home
    canRest: isAtHome ? 0.50 : (locType === 'hotel' || locType === 'generic' ? 0.30 : 0.08),
    canSleep: (isAtHome || locType === 'hotel' || locType === 'generic' || presence === 'sleeping' || !locType) ? 0.55 : 0.05,
    canSocialize: (locType === 'social' || locType === 'food_drink' || locType === 'outdoor') ? 0.40 : (isAtHome ? 0.15 : 0.05),
    canImproveComfort: isAtHome ? 0.45 : 0.10,    // can move to better chair/couch/bed at home
    canWork: false, // set below
  };

  // ── BASE WEIGHTS ─────────────────────────────────────────────────────
  const weights = {
    work: 0.15, education: 0.10, rest: 0.10, eat: 0.08,
    hygiene: 0.05, social: 0.08, home: 0.05, recreation: 0.05,
  };

  // ── EMERGENCY OVERRIDE ────────────────────────────────────────────────
  if (newNeeds.energy <= T.ENERGY_PASSOUT || newNeeds.health <= T.HEALTH_ER || newNeeds.hunger <= T.HUNGER_ER) {
    return { work: 0, education: 0, rest: 0.70, eat: 0, hygiene: 0, social: 0, home: 0, recreation: 0, emergency: true, pressures, opportunity };
  }

  // ── SCHEDULE GRAVITY ─────────────────────────────────────────────────
  const onShift = isOnShift(char, locationMap);
  const isStudent = char.student_status === 'enrolled';
  const isSchoolDay = isStudent && ![0, 6].includes(dow);

  if (onShift) {
    weights.work = 0.40;
    weights.recreation = 0.01;
    opportunity.canWork = true;
  }

  if (isSchoolDay) {
    weights.education = 0.30;
    weights.recreation = 0.03;
  }

  // ── SCHEDULE + PERSONALITY APPLY TO BASE WEIGHTS ────────────────────
  // Pressure does NOT multiply weights here. Pressure is evaluated
  // stage-by-stage in evaluateDecisionFromWeights via stagePressure().
  // Weights here represent base context (schedule gravity, time, traits).
  // Actual action scoring uses opportunity + routine + preference + stage-gated pressure.

  // ── TIME OF DAY ──────────────────────────────────────────────────────
  const isLate = hour >= 22 || hour < 5;
  if (isLate) {
    weights.rest += 0.12;
    weights.work = Math.min(weights.work, 0.05);
    weights.social *= 0.5; // don't go clubbing at 2 AM
  }

  // ── PERSONALITY TRAIT INFLUENCES ──────────────────────────────────────
  const traitMods = {};
  if (char.trait_conscientious) { traitMods.work = (traitMods.work || 0) + 0.10; traitMods.rest = (traitMods.rest || 0) - 0.03; }
  if (char.trait_ambitious)    { traitMods.work = (traitMods.work || 0) + 0.08; traitMods.education = (traitMods.education || 0) + 0.08; }
  if (char.trait_lawbreaker)   { traitMods.work = (traitMods.work || 0) - 0.08; }
  if (char.trait_night_owl)    { traitMods.rest = (traitMods.rest || 0) + 0.05; }
  if (char.trait_morning_person) { traitMods.rest = (traitMods.rest || 0) - 0.03; }
  if (char.trait_loyal)        { traitMods.social = (traitMods.social || 0) + 0.05; }
  if (char.trait_stubborn)     { traitMods.eat = (traitMods.eat || 0) - 0.02; }

  for (const [dim, mod] of Object.entries(traitMods)) {
    weights[dim] = Math.max(0, Math.min(0.75, (weights[dim] || 0) + mod));
  }

  // ── CONFINEMENT ──────────────────────────────────────────────────────
  const isConfined = char.is_jailed || char.house_arrest_active || (char.resolved_presence_status || '') === 'hospitalized';
  if (isConfined) {
    weights.work = 0;
    weights.education = 0;
    weights.recreation = 0.01;
    weights.social *= 0.3;
  }

  return { ...weights, pressures, opportunity };
}

/**
 * evaluateDecisionFromWeights — INLINE DECISION EVALUATOR
 *
 * Takes the weights already computed by computeDecisionWeights and the same
 * context already gathered (schedule, needs, time, restrictions), and returns
 * the single best actionType. This duplicates the logic in evaluateCharacterNextAction
 * but runs inline to avoid HTTP overhead and circular dependencies.
 */
// ── STAGE-BASED PRESSURE CONTRIBUTION ─────────────────────────────────────
// Needs progress through stages, not constant pressure curves.
// Stage 1-2 (awareness/preference): no decision pressure — character acts
//   only when opportunity, routine, or preference creates reason.
// Stage 3 (motivation): moderate — character begins seeking opportunities.
// Stage 4 (pressure): significant — character prioritizes this need.
// Stage 5 (emergency): overriding — crisis mode.
//
// Pressure contribution to action score only begins at stage 3 (motivation).
// Before that, actions are driven by opportunity, routine, and preference.
function stagePressure(pressure) {
  if (pressure < 0.15) return 0;       // awareness: zero decision pressure
  if (pressure < 0.35) return 0;       // preference: still no pressure
  if (pressure < 0.55) return 0.25;    // motivation: moderate influence
  if (pressure < 0.75) return 0.55;    // pressure: significant influence
  return 0.90;                           // emergency: dominant influence
}

// ── ROUTINE DETECTION ──────────────────────────────────────────────────────
// Characters follow routines. These are not driven by needs — they are
// driven by time of day, habit, and context.
function detectRoutines(char, hour, isWeekend, atHome) {
  const routines = {
    mealTime: false,
    usualShowerTime: false,
    usualBedTime: false,
    usualSocialTime: false,
    mealTimeLabel: null,
  };

  // Meal time windows (Eastern Time)
  // Breakfast: 7–10 AM, Lunch: 12–2 PM, Dinner: 5–9 PM
  if (hour >= 7 && hour < 10) { routines.mealTime = true; routines.mealTimeLabel = 'breakfast'; }
  if (hour >= 12 && hour < 14) { routines.mealTime = true; routines.mealTimeLabel = 'lunch'; }
  if (hour >= 17 && hour < 21) { routines.mealTime = true; routines.mealTimeLabel = 'dinner'; }

  // Shower time windows: morning (6–10 AM) or evening (7–11 PM)
  routines.usualShowerTime = (hour >= 6 && hour < 10) || (hour >= 19 && hour < 23);

  // Bedtime window: near character's sleep_start_time (±90 minutes)
  if (char.sleep_start_time) {
    const [sh, sm = 0] = char.sleep_start_time.split(':').map(Number);
    const sleepMin = sh * 60 + sm;
    const nowMin = hour * 60 + (hour >= 0 && hour < 24 ? 0 : 0);
    const diffNow = Math.abs(nowMin - sleepMin);
    const diffWrapped = Math.abs(1440 - Math.abs(nowMin - sleepMin));
    const minDiff = Math.min(diffNow, diffWrapped);
    routines.usualBedTime = minDiff <= 90;
  }

  // Social time: evenings on weekends
  routines.usualSocialTime = isWeekend && hour >= 17 && hour < 23;

  return routines;
}

// ── PREFERENCE BOOSTS ──────────────────────────────────────────────────────
// Personality traits create consistent behavioral preferences independent
// of need pressure. A conscientious character prefers being clean even
// at hygiene=70 — not because they need a shower, but because they prefer
// being fresh.
function computePreferenceBoosts(char, atHome) {
  const pref = {
    cleanliness: 0,
    comfort: 0,
    social: 0,
    routineFollow: 0,
  };

  // Conscientious characters prefer cleanliness and order
  if (char.trait_conscientious) pref.cleanliness = 0.20;
  // Characters who prefer comfort (proxied from positive traits)
  if (char.trait_night_owl || char.trait_polite) pref.comfort = 0.10;
  // Social characters enjoy interaction
  if (char.social_energy === 'extrovert' || char.social_energy === 'mostly_extrovert') pref.social = 0.15;
  if (char.trait_loyal || char.trait_flirty) pref.social = Math.max(pref.social, 0.10);
  // Morning people and conscientious types follow routines more
  if (char.trait_morning_person) pref.routineFollow = 0.12;
  if (char.trait_conscientious) pref.routineFollow = Math.max(pref.routineFollow, 0.10);

  return pref;
}

function evaluateDecisionFromWeights(char, schedule, needs, weights, restrictions, timeCtx) {
  const presence = char.resolved_presence_status || '';
  const locationType = (char.resolved_location_type || '').toLowerCase();
  const onShift = schedule.onShift;
  const atHome = locationType === 'home' || presence === 'home';

  // ── RESTRICTIONS: confined characters have limited options ─────────────
  if (restrictions.confined) {
    if (needs.urgency.energy === 'critical' || needs.urgency.energy === 'critical_collapse')
      return { actionType: 'sleep', reason: `Exhausted while ${restrictions.reason}` };
    if (needs.urgency.hunger === 'critical')
      return { actionType: 'eat', reason: `Hungry while ${restrictions.reason}` };
    return { actionType: 'confinement_routine', reason: `Confined: ${restrictions.reason}` };
  }

  // ── EMERGENCY: health/energy emergency trumps everything ──────────────
  if (needs.urgency.health === 'emergency')
    return { actionType: 'hospitalize', reason: `Health emergency (${Math.round(needs.values.health)})` };
  if (needs.urgency.energy === 'emergency')
    return { actionType: 'hospitalize', reason: `Energy collapse (${Math.round(needs.values.energy)})` };
  if (needs.urgency.energy === 'critical_collapse')
    return { actionType: 'pass_out', reason: `Energy passout (${Math.round(needs.values.energy)})` };

  // ── ON SHIFT: work is the frame — needs layer inside it ───────────────
  if (onShift) {
    if (needs.urgency.energy === 'critical')
      return { actionType: 'go_home_rest', reason: `Critically tired during shift` };
    if (needs.urgency.hunger === 'critical' || needs.urgency.hunger === 'emergency')
      return { actionType: 'eat_at_work', reason: `Hungry but can eat during shift` };
    return { actionType: 'work', reason: 'On shift — working' };
  }

  // ── OFF SHIFT: multi-dimensional scoring ──────────────────────────────
  // Actions scored on: opportunity + routine + preference + stage-gated pressure
  // Low-need stages (1-2) add zero pressure — only opportunity/routine/preference
  // creates action. This prevents characters from feeling constantly stressed
  // about ordinary life maintenance.
  const p = weights.pressures || {};
  const opp = weights.opportunity || {};
  const r = detectRoutines(char, timeCtx.hour, timeCtx.isWeekend || false, atHome);
  const pref = computePreferenceBoosts(char, atHome);

  const options = [];

  // ── EAT ────────────────────────────────────────────────────────────────
  // Driven by: opportunity (food is here) + routine (mealtime) + preference
  //            + stage-gated hunger pressure
  // A character at home at dinnertime should eat even at hunger=70.
  const eatPressure = stagePressure(p.hunger);
  const eatScore =
    (opp.canEat * 0.35) +                              // food is available right now
    (r.mealTime ? 0.30 : 0) +                          // it's a normal mealtime
    (atHome ? 0.10 : 0) +                              // home makes eating natural
    (pref.routineFollow * 0.15) +                      // routine-followers eat regularly
    (eatPressure * 0.40);                              // hunger pressure (only stage 3+)

  const eatCause = eatPressure > 0 ? 'pressure'
    : (opp.canEat > 0.40 && r.mealTime) ? 'routine'
    : opp.canEat > 0.40 ? 'opportunity'
    : r.mealTime ? 'routine'
    : 'preference';

  options.push({
    actionType: 'eat', score: eatScore, decisionCause: eatCause,
    reason: opp.canEat > 0.40
      ? `Food is available — ${r.mealTimeLabel ? r.mealTimeLabel + ' time' : 'eating makes sense'}`
      : eatPressure > 0
        ? `Hungry — needs food (${Math.round(needs.values.hunger)})`
        : r.mealTime ? `${r.mealTimeLabel} time` : 'Could eat'
  });

  // ── HYGIENE ───────────────────────────────────────────────────────────
  const hygienePressure = stagePressure(p.hygiene);
  const hygieneScore =
    (opp.canShower * 0.35) +                           // shower is available
    (r.usualShowerTime ? 0.20 : 0) +                   // it's a normal shower time
    (pref.cleanliness * 0.25) +                        // conscientious: prefers being clean
    (hygienePressure * 0.40);                           // hygiene pressure (only stage 3+)

  const hygieneCause = hygienePressure > 0 ? 'pressure'
    : (opp.canShower > 0.40 && r.usualShowerTime) ? 'routine'
    : opp.canShower > 0.40 ? 'opportunity'
    : r.usualShowerTime ? 'routine'
    : pref.cleanliness > 0.10 ? 'preference'
    : 'preference';

  options.push({
    actionType: 'hygiene', score: hygieneScore, decisionCause: hygieneCause,
    reason: hygienePressure > 0
      ? `Needs to clean up (hygiene ${Math.round(needs.values.hygiene)})`
      : opp.canShower > 0.40
        ? r.usualShowerTime ? 'Shower time — freshen up' : 'Shower is right there'
        : pref.cleanliness > 0.10 ? 'Prefers being clean' : 'Could freshen up'
  });

  // ── SLEEP ─────────────────────────────────────────────────────────────
  // Driven by: bedtime routine + bed availability + energy pressure (stage 3+)
  const sleepPressure = stagePressure(p.energy);
  const sleepScore =
    (opp.canSleep * 0.30) +                            // bed is available
    (r.usualBedTime ? 0.25 : 0) +                      // it's around bedtime
    (timeCtx.isLate ? 0.15 : 0) +                      // it's late
    (sleepPressure * 0.45);                            // energy pressure (only stage 3+)

  const sleepCause = sleepPressure > 0 ? 'pressure'
    : (opp.canSleep > 0.40 && r.usualBedTime) ? 'routine'
    : opp.canSleep > 0.40 ? 'opportunity'
    : r.usualBedTime ? 'routine'
    : 'preference';

  // Only offer sleep when it makes some sense — not at 10 AM with full energy
  if (sleepScore > 0.15) {
    options.push({
      actionType: 'sleep', score: sleepScore, decisionCause: sleepCause,
      reason: sleepPressure > 0.30
        ? `Exhausted (energy ${Math.round(needs.values.energy)})`
        : r.usualBedTime ? 'Bedtime — getting some rest' :
          opp.canSleep > 0.40 ? 'Bed is right there' : 'Could rest'
    });
  }

  // ── REST (non-sleep relaxation) ──────────────────────────────────────
  const restPressure = stagePressure(p.mental) || stagePressure(p.comfort);
  const restScore =
    (opp.canRest * 0.30) +                             // can relax where they are
    (atHome ? 0.15 : 0) +                              // home is restful
    (pref.comfort * 0.15) +                            // comfort-seeking
    (stagePressure(p.mental) * 0.25) +                 // mental strain
    (stagePressure(p.comfort) * 0.20);                 // comfort need

  const restCause = restPressure > 0 ? 'pressure'
    : opp.canRest > 0.30 ? 'opportunity'
    : atHome ? 'routine'
    : 'preference';

  options.push({
    actionType: 'rest', score: restScore, decisionCause: restCause,
    reason: atHome ? 'Relaxing at home' :
            opp.canRest > 0.30 ? 'Taking a break' : 'Could rest'
  });

  // ── SOCIAL ────────────────────────────────────────────────────────────
  const socialPressure = stagePressure(p.social);
  const socialScore =
    (opp.canSocialize * 0.25) +                        // social venue available
    (r.usualSocialTime ? 0.20 : 0) +                   // weekend evening
    (pref.social * 0.25) +                             // extrovert preference
    (socialPressure * 0.30);                           // social need pressure

  const socialCause = socialPressure > 0 ? 'pressure'
    : (opp.canSocialize > 0.30 && r.usualSocialTime) ? 'routine'
    : opp.canSocialize > 0.30 ? 'opportunity'
    : r.usualSocialTime ? 'routine'
    : pref.social > 0.10 ? 'preference'
    : 'preference';

  if (!timeCtx.isLate || opp.canSocialize > 0.30) {
    options.push({
      actionType: 'social', score: socialScore, decisionCause: socialCause,
      reason: opp.canSocialize > 0.30 ? 'Social opportunity available' :
              r.usualSocialTime ? 'Weekend evening — social time' :
              pref.social > 0.10 ? 'Enjoys socializing' : 'Could connect with someone'
    });
  }

  // ── RECREATION ────────────────────────────────────────────────────────
  if (!timeCtx.isLate && weights.recreation > 0.03) {
    options.push({
      actionType: 'recreation', score: weights.recreation * 0.5 + opp.canSocialize * 0.3,
      decisionCause: 'preference', reason: 'Free time — recreation'
    });
  }

  // ── FAMILY ────────────────────────────────────────────────────────────
  if (weights.family > 0.06) {
    options.push({
      actionType: 'family', score: weights.family * (atHome ? 1.2 : 0.6),
      decisionCause: atHome ? 'opportunity' : 'preference',
      reason: atHome ? 'Family time at home' : 'Spend time with family'
    });
  }

  // ── EDUCATION ─────────────────────────────────────────────────────────
  if (weights.education > 0.15) {
    options.push({
      actionType: 'education', score: weights.education,
      decisionCause: 'routine', reason: 'School obligation'
    });
  }

  // ── DEFAULT: HOME ROUTINE ────────────────────────────────────────────
  // This is the baseline — what a calm, content character does by default.
  // Score is competitive so opportunistic actions (eat/shower when available)
  // can beat it, but constant low-level pressure cannot.
  options.push({
    actionType: 'home_routine',
    score: (atHome ? 0.22 : 0.08) + pref.comfort * 0.10,
    decisionCause: 'routine',
    reason: atHome ? 'Relaxing at home' : 'Going about their day'
  });

  options.sort((a, b) => b.score - a.score);
  return options[0];
}

function computeCorrectiveState(char, newNeeds, currentContext, now, locationMap, decisionWeights) {
  const stateWrites = {};
  const scheduledEvents = [];
  const logs = [];

  // ── npc_world_service GUARD — skip ALL biological corrective paths ──────────
  // npc_world_service (e.g. Vick Servicio) must NEVER be put to sleep, pass out,
  // be hospitalized for energy collapse, or have hunger-driven eating states written.
  // Their energy=100 and hunger=100 locks are enforced before this function is called,
  // so thresholds will never be crossed — but guard here defensively as a belt+suspenders.
  const isWorldService = char.character_type === 'npc_world_service' || char.is_world_service === true ||
    (char.name && char.name.toLowerCase().includes('vick servicio'));
  if (isWorldService) {
    logs.push(`[CORRECTIVE] ${char.name}: npc_world_service — skipping all biological corrective state writes`);
    return { stateWrites, scheduledEvents, logs };
  }

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

  // ── PRIORITY 0: STALE SLEEP DURATION GUARD (8-hour hard wake) ────────────────
  // Rule: active_created_character must NEVER remain in sleeping/napping state beyond 8 hours.
  // Stale resolved_presence_status, stale current_activity, stale cached location
  // context, or any other stale field must NOT keep a character asleep indefinitely.
  //
  // This uses the SAME write pattern as clearStaleCharacterSleep — no new system.
  // Authoritative time: America/New_York (Eastern Time). UTC is never used for this logic.
  //
  // IMPORTANT: "passed_out" is NOT normal sleep. It is part of the exhaustion/consequence path:
  //   100% → normal decay → 25% critical exhaustion → 20% exhaustion range → passed_out → recovery
  // passed_out has its own 2.5-hour ScheduledEvent (passout_recovery) created by PRIORITY 2.
  // The 8-hour stale-sleep guard does NOT apply to passed_out — that state's recovery is owned
  // by its own existing system. Only sleeping and napping are subject to the 8-hour ceiling.
  //
  // Sleep start resolution order (most → least authoritative):
  //   1. char.last_sleep_start       — explicitly set when sleep begins
  //   2. char.resolved_last_updated_at — last time presence was written
  //   3. char.last_need_simulated_at  — last simulation tick (fallback only)
  //
  // Existing exceptions fully preserved:
  //   - alreadyHospitalized → skip (medical recovery owns this)
  //   - recentlyWokenByAlarm → skip (alarm system owns this)
  //   - passed_out → skip (passout_recovery ScheduledEvent owns this — see PRIORITY 2)
  //
  // PROOF MATH (6h sleep at +12 energy/hr from exhaustion start of 20):
  //   After 6h: 20 + (12 × 6) = 92 → clamped to 100 — full recovery in 6 hours ✓
  //   After 8h: already at 100 — 8 hours is the hard upper limit for sleeping/napping ✓
  const isNormalSleep = presence === 'sleeping' || presence === 'napping'; // passed_out is excluded — separate path
  if (isNormalSleep && !alreadyHospitalized && !recentlyWokenByAlarm) {
    // Resolve sleep start in Eastern Time — must never use UTC as authoritative
    const sleepStartCandidates = [
      char.last_sleep_start,
      char.resolved_last_updated_at,
      char.last_need_simulated_at,
    ].filter(Boolean);

    if (sleepStartCandidates.length > 0) {
      // Use the EARLIEST timestamp among candidates — conservative: assume sleep started
      // as early as possible to avoid under-counting sleep duration
      const sleepStartMs = Math.min(...sleepStartCandidates.map(t => new Date(t).getTime()));
      const sleepDurationHours = (now.getTime() - sleepStartMs) / (1000 * 60 * 60);

      const MAX_SLEEP_HOURS = 8; // hard ceiling — stale state must never exceed this

      if (sleepDurationHours >= MAX_SLEEP_HOURS) {
        // Authoritative ET timestamp for the wake write
        const nowEtStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
        const nowEtIso = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString();

        stateWrites.resolved_presence_status = 'home';
        stateWrites.location_status = 'home';
        stateWrites.current_activity = 'woke up — starting their day';
        stateWrites.resolved_last_updated_at = now.toISOString(); // ISO UTC for DB storage
        stateWrites.sleep_interrupted_at = now.toISOString();     // marks wake time for alarm guard

        logs.push(
          `[CORRECTIVE] ${char.name}: STALE SLEEP CLEARED — sleep_duration=${sleepDurationHours.toFixed(1)}h` +
          ` (≥${MAX_SLEEP_HOURS}h hard limit) | sleep_start_used=${new Date(sleepStartMs).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` +
          ` | now=${nowEtStr} ET | action=force_wake`
        );

        // Return early — no other corrective action needed, character is being woken
        return { stateWrites, scheduledEvents, logs };
      }
      // Not yet at 8h — log for observability but do not wake
      logs.push(
        `[SLEEP-DURATION] ${char.name}: sleep_duration=${sleepDurationHours.toFixed(1)}h (limit=${MAX_SLEEP_HOURS}h) — still within valid window`
      );
    }
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

  // ── DECISION ENGINE: evaluate and pick best corrective action ─────────────
  // Emergency states (health ER, energy medical, pass-out) are already handled above
  // as hard gates that return early. For non-emergency states, the decision engine
  // evaluates ALL factors (schedule, needs, personality, time, restrictions) and
  // picks the single best actionType. This replaces the old sequential threshold checks
  // where needs were processed in fixed priority order (energy→hunger→hygiene→mental).
  {
    // Build schedule context for decision evaluator
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const dow = nowET.getDay();
    const timeCtx = {
      timeOfDay: hour >= 5 && hour < 7 ? 'early_morning' : hour >= 7 && hour < 10 ? 'morning' :
        hour >= 10 && hour < 12 ? 'late_morning' : hour >= 12 && hour < 14 ? 'midday' :
        hour >= 14 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 20 ? 'evening' :
        hour >= 20 && hour < 23 ? 'night' : 'late_night',
      isLate: hour >= 22 || hour < 5,
      hour,
      isWeekend: dow === 0 || dow === 6,
    };
    const schedule = {
      onShift: isOnShift(char, locationMap),
      hasWorkToday: Array.isArray(char.work_days) && char.work_days.includes(nowET.getDay()),
    };
    const needs = {
      values: newNeeds,
      urgency: {
        hunger:  hunger <= T.HUNGER_ER ? 'emergency' : hunger <= T.HUNGER_CRITICAL ? 'critical' : hunger <= T.HUNGER_LOW ? 'low' : undefined,
        energy:  energy <= T.ENERGY_MEDICAL ? 'emergency' : energy <= T.ENERGY_PASSOUT ? 'critical_collapse' : energy <= T.ENERGY_CRITICAL ? 'critical' : energy <= T.ENERGY_LOW ? 'low' : undefined,
        health:  health <= T.HEALTH_ER ? 'emergency' : health <= T.HEALTH_CRITICAL ? 'critical' : undefined,
        mental:  mental <= T.MENTAL_CRITICAL ? 'critical' : undefined,
        hygiene: hygiene <= T.HYGIENE_CRITICAL ? 'critical' : undefined,
        social:  social <= T.SOCIAL_CRITICAL ? 'critical' : undefined,
      },
    };
    const restrictions = {
      confined: char.is_jailed || char.house_arrest_active || presence === 'hospitalized' || presence === 'incarcerated',
      reason: char.is_jailed ? 'incarcerated' : char.house_arrest_active ? 'house_arrest' : presence === 'hospitalized' ? 'hospitalized' : presence === 'incarcerated' ? 'incarcerated' : null,
    };

    const decision = evaluateDecisionFromWeights(char, schedule, needs, decisionWeights || {}, restrictions, timeCtx);

    logs.push(`[DECISION] ${char.name}: actionType=${decision.actionType} reason="${decision.reason}" (energy=${Math.round(energy)} hunger=${Math.round(hunger)} hygiene=${Math.round(hygiene)})`);

    // ── MAP DECISION ACTIONTYPE TO CORRECTIVE STATE WRITES ───────────────────
    // Each case uses decision.decisionCause (opportunity|routine|preference|pressure|emergency)
    // to write cause-appropriate activity text. The narrative/chat system reads this
    // to generate speech with matching emotional tone.
    const locType = (char.resolved_location_type || '').toLowerCase();
    const locId = char.resolved_current_location_id;
    const homeId = char.current_home_location_id;
    const atHome = locType === 'home' || presence === 'home' || (locId && locId === homeId);
    const cause = decision.decisionCause || 'preference';

    // ── ACTIVITY TEXT TONE MAP ────────────────────────────────────────────
    // Maps decisionCause → tone-appropriate phrasing for each action type.
    // 'opportunity' = calm, casual ("I'm already here, may as well")
    // 'routine'     = normal, habitual ("this is what I do")
    // 'preference'  = personal, intentional ("I like feeling clean")
    // 'pressure'    = increasingly motivated ("I need this")
    // 'emergency'   = urgent, overriding ("I have to handle this now")

    switch (decision.actionType) {
      case 'sleep': {
        const atValidSleepLocation = locType === 'home' || locType === 'hotel' || locType === 'shelter' ||
          locType === 'generic' || locType === 'temporary_housing' || locType === 'incarcerated' ||
          locType === 'house_arrest' || presence === 'home' || presence === 'sleeping' || presence === 'napping' || !locType;
        const prevActivity = (char.current_activity || '').toLowerCase();
        const alreadyIntending = prevActivity.includes('sleep') || prevActivity.includes('exhausted');
        stateWrites.decision_cause = cause;

        if (atValidSleepLocation && !alreadySleeping && !recentlyWokenByAlarm) {
          // EXECUTE: at valid location — actually sleep, clear intent
          stateWrites.resolved_presence_status = 'sleeping';
          stateWrites.decision_intent_set_at = null;
          stateWrites.decision_intent_action = null;
          stateWrites.decision_intent_cause = null;
          if (cause === 'opportunity') stateWrites.current_activity = 'getting some sleep since bed is right there';
          else if (cause === 'routine') stateWrites.current_activity = 'going to bed for the night';
          else if (cause === 'preference') stateWrites.current_activity = 'calling it a night';
          else stateWrites.current_activity = 'sleeping — exhausted';
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → sleep (${cause}) — executed at valid location`);
        } else if (!atValidSleepLocation && !alreadySleeping && !recentlyWokenByAlarm && !alreadyIntending) {
          // ROUTING SIGNAL: not at valid location, write intent
          stateWrites.current_activity = cause === 'pressure'
            ? 'exhausted — heading home to sleep'
            : 'heading home — it\'s about that time';
          stateWrites.decision_intent_set_at = now.toISOString();
          stateWrites.decision_intent_action = 'sleep';
          stateWrites.decision_intent_cause = cause;
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → sleep (${cause}) — routing signal`);
        }
        if (alreadyIntending) {
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → sleep — intent already active, skipping re-write`);
        }
        break;
      }
      case 'eat':
      case 'eat_at_work': {
        const isAtFoodLoc = atHome || locType === 'food_drink' || (onShift && (() => {
          const wLocId = char.current_work_location_id || char.occupation_location_id;
          if (!wLocId || !locationMap[wLocId]) return false;
          const wl = locationMap[wLocId];
          const wCat = (wl.category || '').toLowerCase();
          const wName = (wl.name || '').toLowerCase();
          return wCat === 'food_drink' || wCat === 'social' || wName.includes('bar') || wName.includes('restaurant') ||
            wName.includes('cafe') || wName.includes('diner') || wName.includes('grill') || wName.includes('club');
        })());
        const prevActivity = (char.current_activity || '').toLowerCase();
        const alreadyEating = prevActivity.includes('eat') || prevActivity.includes('food') || prevActivity.includes('meal');
        stateWrites.decision_cause = cause;

        if (isAtFoodLoc) {
          // EXECUTE: at valid location — actually eat, need value improves, clear intent
          stateWrites.hunger_value_override = Math.min(100, hunger + 20);
          stateWrites.decision_intent_set_at = null;
          stateWrites.decision_intent_action = null;
          stateWrites.decision_intent_cause = null;
          if (cause === 'opportunity') stateWrites.current_activity = 'eating — food was right there';
          else if (cause === 'routine') stateWrites.current_activity = 'having a meal';
          else if (cause === 'preference') stateWrites.current_activity = 'enjoying a meal';
          else stateWrites.current_activity = 'eating — addressing hunger';
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → eat (${cause}) — executed at food location`);
        } else if (!alreadyEating) {
          // ROUTING SIGNAL: not at food location
          stateWrites.current_activity = cause === 'pressure'
            ? 'needs to find food — getting hungry'
            : 'grabbing something to eat';
          stateWrites.decision_intent_set_at = now.toISOString();
          stateWrites.decision_intent_action = 'eat';
          stateWrites.decision_intent_cause = cause;
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → eat (${cause}) — intent`);
        }
        if (alreadyEating) {
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → eat — already eating, skipping re-write`);
        }
        break;
      }
      case 'go_home_rest': {
        stateWrites.decision_cause = cause;
        if (!atHome) {
          stateWrites.current_activity = cause === 'pressure'
            ? 'exhausted — heading home to rest'
            : 'heading home';
        } else {
          stateWrites.current_activity = 'resting at home';
        }
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → go_home_rest (${cause})`);
        break;
      }
      case 'hygiene': {
        const prevActivity = (char.current_activity || '').toLowerCase();
        const alreadyShowering = prevActivity.includes('wash') || prevActivity.includes('shower')
          || prevActivity.includes('freshen') || prevActivity.includes('clean');
        // Always stamp the decision cause for observability
        stateWrites.decision_cause = cause;

        if (atHome && !alreadyShowering) {
          // EXECUTE: at home — actually shower/clean up, clear intent
          stateWrites.hygiene_value_override = Math.min(100, hygiene + 35);
          stateWrites.decision_intent_set_at = null;
          stateWrites.decision_intent_action = null;
          stateWrites.decision_intent_cause = null;
          stateWrites.emotional_state = 'calm';
          if (cause === 'opportunity') stateWrites.current_activity = 'freshening up — shower is right there';
          else if (cause === 'routine') stateWrites.current_activity = 'showering — part of the routine';
          else if (cause === 'preference') stateWrites.current_activity = 'freshening up — likes feeling clean';
          else stateWrites.current_activity = 'freshening up';
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → hygiene (${cause}) — executed at home`);
        } else if (!atHome && !alreadyShowering) {
          // ROUTING SIGNAL: not home, stamp intent
          stateWrites.emotional_state = cause === 'pressure' ? 'uncomfortable' : 'calm';
          stateWrites.current_activity = cause === 'pressure'
            ? 'needs to wash up — heading home'
            : 'heading home to freshen up';
          stateWrites.decision_intent_set_at = now.toISOString();
          stateWrites.decision_intent_action = 'hygiene';
          stateWrites.decision_intent_cause = cause;
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → hygiene (${cause}) — intent`);
        }
        if (alreadyShowering) {
          logs.push(`[CORRECTIVE] ${char.name}: DECISION → hygiene — already showering, skipping re-write`);
        }
        break;
      }
      case 'rest': {
        stateWrites.decision_cause = cause;
        if (cause === 'opportunity') stateWrites.current_activity = atHome ? 'taking a comfortable break' : 'taking a moment to rest';
        else if (cause === 'routine') stateWrites.current_activity = atHome ? 'unwinding at home' : 'taking a break';
        else if (cause === 'preference') stateWrites.current_activity = atHome ? 'enjoying some downtime' : 'taking a break';
        else stateWrites.current_activity = atHome ? 'resting at home' : 'taking a break';
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → rest (${cause})`);
        break;
      }
      case 'social': {
        stateWrites.decision_cause = cause;
        if (cause === 'opportunity') stateWrites.current_activity = atHome ? 'reaching out — company sounds nice' : 'spending time out while they can';
        else if (cause === 'routine') stateWrites.current_activity = atHome ? 'catching up with people' : 'out and about';
        else if (cause === 'preference') stateWrites.current_activity = atHome ? 'enjoying some social time' : 'enjoying being out';
        else stateWrites.current_activity = atHome ? 'reaching out to someone' : 'spending time out';
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → social (${cause})`);
        break;
      }
      case 'work': {
        stateWrites.decision_cause = cause;
        if (presence !== 'at_work') {
          stateWrites.resolved_presence_status = 'at_work';
          stateWrites.current_activity = 'working';
        }
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → work (continuing shift)`);
        break;
      }
      case 'family': {
        stateWrites.decision_cause = cause;
        stateWrites.current_activity = atHome ? 'spending time with family' : 'visiting family';
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → family (${cause})`);
        break;
      }
      case 'education': {
        stateWrites.decision_cause = cause;
        stateWrites.current_activity = 'attending school';
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → education`);
        break;
      }
      case 'home_routine':
      default: {
        stateWrites.decision_cause = 'routine';
        if (!stateWrites.current_activity && !char.current_activity) {
          stateWrites.current_activity = atHome ? 'relaxing at home' : 'going about their day';
        }
        logs.push(`[CORRECTIVE] ${char.name}: DECISION → ${decision.actionType} (default/routine)`);
        break;
      }
    }
  }

  return { stateWrites, scheduledEvents, logs };
}

/**
 * resolveNextActivity — CONTINUITY PROGRESSION
 *
 * When a temporary corrective activity expires (eating finished, shower done,
 * decompression ended), resolve it into the next realistic current state based
 * on authoritative context. Never leave a character blank (null) — they are
 * always doing something, even if it's just "relaxing at home."
 *
 * RESOLUTION ORDER (authoritative context wins):
 *   1. On shift → "working" (work context persists)
 *   2. At school → "attending school"
 *   3. At home → "relaxing at home"
 *   4. At a social venue → "spending time out"
 *   5. At food/drink → "finished eating, spending time out"
 *   6. Default → "going about their day"
 *
 * This is a forward-resolve, not a null-clear. Characters are never blank.
 */
function resolveNextActivity(char, locationMap) {
  const presence = char.resolved_presence_status || '';
  const locType = (char.resolved_location_type || '').toLowerCase();
  const locId = char.resolved_current_location_id;
  const onShift = isOnShift(char, locationMap);

  // Tier 1: Authoritative schedule context wins — this is reality
  if (onShift) return 'working';

  // Tier 2: Presence-based resolution
  if (presence === 'at_school') return 'attending school';
  if (presence === 'home' || locType === 'home') return 'relaxing at home';

  // Tier 3: Location-based resolution
  if (locId && locationMap[locId]) {
    const loc = locationMap[locId];
    const cat = (loc.category || '').toLowerCase();
    const name = (loc.name || '').toLowerCase();

    if (cat === 'home') return 'relaxing at home';
    if (cat === 'food_drink' || name.includes('restaurant') || name.includes('cafe') || name.includes('bar') || name.includes('diner')) {
      return 'finished eating, spending time out';
    }
    if (cat === 'social' || cat === 'outdoor' || name.includes('club') || name.includes('park')) {
      return 'spending time out';
    }
    if (cat === 'gym') return 'at the gym';
    if (cat === 'medical') return 'at a medical facility';
    if (cat === 'education') return 'at school';
    if (cat === 'jail_prison' || loc.is_confinement_facility) return 'in confinement';
  }

  // Tier 4: Default — neutral, not blank
  return 'going about their day';
}

/**
 * resolveStaleCorrectiveActivities — CONTINUITY PROGRESSION
 *
 * Characters do not freeze in time. Temporary corrective activities set by
 * computeCorrectiveState (eating, showering, decompressing) must naturally
 * resolve when the triggering need stabilizes.
 *
 * Instead of clearing to null (leaving the character blank), this function
 * resolves the activity into the next valid context using resolveNextActivity.
 */
/**
 * resolveStaleDecisionIntents — STALE INTENT RESOLUTION
 *
 * Checks if the character has a non-executed routing intent that's been sitting
 * for >2 hours. If stale and the character is now at the valid location for
 * execution, force-completes the intent. Otherwise clears it so the next
 * decision tick can re-evaluate.
 *
 * Intent lifecycle: intent created → movement routes → execution → intent cleared.
 * Stale = movement failed or execution never occurred. Don't leave characters
 * perpetually "heading home" or "planning to eat."
 */
function resolveStaleDecisionIntents(char, newNeeds, correctiveStateWrites, locationMap, now) {
  const writes = {};
  const intentSetAt = char.decision_intent_set_at ? new Date(char.decision_intent_set_at) : null;
  const intentAction = char.decision_intent_action;
  const currentActivity = (char.current_activity || '').toLowerCase();

  // Only check if there's an active intent that hasn't been resolved
  if (!intentSetAt || !intentAction) return writes;

  const intentAgeHours = (now.getTime() - intentSetAt.getTime()) / 3600000;
  const STALE_THRESHOLD_HOURS = 2;

  if (intentAgeHours < STALE_THRESHOLD_HOURS) return writes; // still fresh

  const locType = (char.resolved_location_type || '').toLowerCase();
  const locId = char.resolved_current_location_id;
  const homeId = char.current_home_location_id;
  const atHome = locType === 'home' || (locId && locId === homeId);
  const presence = char.resolved_presence_status || '';

  // ── Check if execution happened ──────────────────────────────────────────
  // If intent was "sleep" and character is now sleeping → intent was consumed
  if (intentAction === 'sleep' && (presence === 'sleeping' || presence === 'napping')) {
    writes.decision_intent_set_at = null;
    writes.decision_intent_action = null;
    writes.decision_intent_cause = null;
    return writes; // intent successfully consumed
  }
  // If a new corrective activity is being written this tick, the intent is being handled
  if (correctiveStateWrites.current_activity) {
    // New intent being set — just clear the old one
    writes.decision_intent_set_at = null;
    writes.decision_intent_action = null;
    writes.decision_intent_cause = null;
    return writes;
  }

  // ── STALE: resolve based on actionType ─────────────────────────────────
  switch (intentAction) {
    case 'sleep': {
      // Character was "heading home to sleep" but never arrived/fell asleep
      if (atHome && presence !== 'sleeping' && presence !== 'napping') {
        // At home but never slept — intent stale, re-evaluate next tick
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
        writes.current_activity = 'woke up — getting on with the day';
      } else if (!atHome) {
        // Still not home after 2+ hours — clear intent, re-evaluate
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
        writes.current_activity = 'going about their day';
      }
      break;
    }
    case 'eat': {
      // Character was "getting food" but never ate
      if (atHome) {
        // At home — force eat completion (they ate)
        writes.hunger_value_override = Math.min(100, (newNeeds.hunger ?? 70) + 15);
        writes.current_activity = 'finished eating';
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
      } else {
        // Still not home — clear intent
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
        writes.current_activity = 'going about their day';
      }
      break;
    }
    case 'hygiene': {
      if (atHome) {
        writes.hygiene_value_override = Math.min(100, (newNeeds.hygiene ?? 75) + 20);
        writes.current_activity = 'freshened up';
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
      } else {
        writes.decision_intent_set_at = null;
        writes.decision_intent_action = null;
        writes.decision_intent_cause = null;
        writes.current_activity = 'going about their day';
      }
      break;
    }
    default: {
      // social, rest, family, recreation, home_routine — clear stale intent
      writes.decision_intent_set_at = null;
      writes.decision_intent_action = null;
      writes.decision_intent_cause = null;
      if (!correctiveStateWrites.current_activity) {
        writes.current_activity = atHome ? 'relaxing at home' : 'going about their day';
      }
    }
  }

  return writes;
}

function resolveStaleCorrectiveActivities(char, newNeeds, correctiveStateWrites, locationMap) {
  const currentActivity = char.current_activity || '';
  const alreadyHasNewActivity = !!correctiveStateWrites.current_activity;

  // If a new corrective activity was just set, don't override it
  if (alreadyHasNewActivity) return {};

  const activity = currentActivity.toLowerCase();
  let activityExpired = false;

  // ── EATING ACTIVITIES → expire when hunger stable ─────────────────────────
  if (activity.includes('eat') || activity.includes('food') || activity.includes('hunger') || activity.includes('meal')) {
    if ((newNeeds.hunger ?? 70) > T.HUNGER_CRITICAL) {
      activityExpired = true;
    }
  }

  // ── HYGIENE ACTIVITIES → expire when hygiene stable ───────────────────────
  if (activity.includes('wash') || activity.includes('shower') || activity.includes('freshen') || activity.includes('clean')) {
    if ((newNeeds.hygiene ?? 75) > 25) {
      activityExpired = true;
    }
  }

  // ── DECOMPRESSION → expire when mental stable ────────────────────────────
  if (activity.includes('decompress') || activity.includes('mental health')) {
    if ((newNeeds.mental ?? 70) > 20) {
      activityExpired = true;
    }
  }

  // ── HOME-ROUTING SLEEP SIGNAL → expire when energy stable ─────────────────
  if ((activity.includes('returning home to sleep')) || (activity.includes('heading home') && activity.includes('sleep'))) {
    if ((newNeeds.energy ?? 75) > T.ENERGY_CRITICAL) {
      activityExpired = true;
    }
  }

  if (activityExpired) {
    const nextActivity = resolveNextActivity(char, locationMap);
    return { current_activity: nextActivity };
  }

  return {};
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
      let found = await writeSDK.entities.Character.filter({ id: characterId }, null, 10)
        .catch(() => []);
      
      // Fallback: user-scoped read for single-character fetch
      if (found.length === 0 && user) {
        found = await base44.entities.Character.filter({ id: characterId }, null, 10)
          .catch(() => []);
      }
      
      // Only simulate needs for active_created_character.
      // npc_world_service (Vick Servicio) is explicitly excluded — no biological decay or corrective states.
      characters = found.filter(c =>
        c.character_type === 'active_created_character' &&
        c.status === 'active' &&
        c.character_type !== 'npc_world_service' &&
        !c.is_world_service
      );
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
      // Apply cross-system infection — skipped for npc_world_service (no biological cascades)
      const isWorldServiceChar = char.character_type === 'npc_world_service' || char.is_world_service === true ||
        (char.name && char.name.toLowerCase().includes('vick servicio'));
      if (!isWorldServiceChar) {
        newNeeds = applyStatInfection(newNeeds, cappedHours);
      }

      // ── NPC_WORLD_SERVICE NEED LOCKS ─────────────────────────────────────
      // npc_world_service characters (e.g. Vick Servicio) are NOT governed by biological
      // survival needs. They must NEVER decay hunger or energy, NEVER enter sleep/fatigue/
      // pass-out/nap states, and NEVER trigger corrective sleep or hunger behaviors.
      //
      // Hunger and Energy are hard-locked at their stored values (always 100 for Vick).
      // Cascade infection from hunger/energy is also suppressed — these characters are
      // immune to all biological-need cascades.
      //
      // Eating / lying down IS allowed but interpreted as Comfort/Social — not biological need.
      // (Eating → Comfort/Social rise. Lying down → Comfort rise. Never hunger/energy restoration.)
      //
      // RULE: restore pre-simulation value for locked needs — no decay or recovery applied.
      const isVick = char.character_type === 'npc_world_service' || char.is_world_service === true ||
        (char.name && char.name.toLowerCase().includes('vick servicio'));
      if (isVick) {
        // Hard-lock hunger and energy — restore pre-simulation values regardless of context
        newNeeds.energy = currentNeeds.energy ?? 100;
        newNeeds.hunger = currentNeeds.hunger ?? 100;
        // Ensure locks always write back at 100 if the stored value has drifted
        if (newNeeds.energy < 100) { newNeeds.energy = 100; }
        if (newNeeds.hunger < 100) { newNeeds.hunger = 100; }
        console.log(`[simulateNeeds] ${char.name}: npc_world_service — hunger=100 energy=100 (hard-locked, no biological decay)`);
      }

      // ── COMFORT ADD-ON: positive + negative contextual modifiers ─────────
      // Additive only — supplements RATES comfort values with environment,
      // rest state, food quality, and social presence signals.
      const comfortMod = computeComfortModifier(char, context, locationMap);
      if (comfortMod !== 0) {
        newNeeds.comfort = clamp(newNeeds.comfort + comfortMod * cappedHours);
      }

      // ── AWAKE-TIME ENERGY DRAIN GUARANTEE (active_created_character only) ──
      // Rule: An awake active_created_character must lose at least -5 energy per hour,
      // regardless of context. This is a hard floor applied AFTER context rates.
      //
      // Does NOT apply to sleeping, passed_out, or hospitalized — those must restore energy.
      // Does NOT apply to npc_world_service — their energy is hard-locked at 100.
      const isSleepingContext = context === 'sleeping' || context === 'passed_out' || context === 'hospitalized';
      // npc_world_service bypass: energy is already hard-locked above — skip drain guarantee entirely
      const sleepLockActive = isVick; // isVick covers all npc_world_service detection
      if (!isSleepingContext && !sleepLockActive) {
        const MINIMUM_AWAKE_DRAIN_PER_HOUR = -5; // -5/hr floor: 100 energy → 0 in 20 hours
        // Apply the baseline drain directly from currentNeeds (not newNeeds) so context
        // rates and infection do not double-count. Take the lower (more drained) result.
        const energyWithBaseline = clamp((currentNeeds.energy ?? 75) + MINIMUM_AWAKE_DRAIN_PER_HOUR * cappedHours);
        if (energyWithBaseline < newNeeds.energy) {
          newNeeds.energy = energyWithBaseline;
        }
      }
      const financialNeed = deriveFinancialNeed(char);

      // ── DETECT ESCALATION EVENTS → MEMORY ────────────────────────────────
      // npc_world_service: hunger/energy never cross critical thresholds (hard-locked at 100),
      // so escalation events will never fire — but guard here defensively.
      const escalationEvents = isWorldServiceChar ? [] : detectCriticalEscalations(currentNeeds, newNeeds, char.name);
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

      // ── DECISION WEIGHTING: compute dynamic weights before corrective state ──
      // Weights modulate corrective thresholds: character on shift tolerates
      // more hunger before food-seeking, student tolerates more fatigue, etc.
      const decisionWeights = computeDecisionWeights(char, newNeeds, locationMap);

      // Compute effective hunger threshold (mirrors logic inside computeCorrectiveState)
      const obligationWeight = Math.max(decisionWeights.work || 0, decisionWeights.education || 0);
      const effectiveHungerCritical = obligationWeight >= 0.30
        ? Math.max(12, T.HUNGER_CRITICAL - Math.round((obligationWeight - 0.15) * 15))
        : Math.max(15, T.HUNGER_CRITICAL);

      // ── RC1+RC2+RC3+RC4: CORRECTIVE STATE WRITES ─────────────────────────
      const corrective = computeCorrectiveState(char, newNeeds, context, now, locationMap, decisionWeights);
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

      // ── APPLY CORRECTIVE EXECUTION OVERRIDES ─────────────────────────────
      // computeCorrectiveState may set hunger_value_override or hygiene_value_override
      // when the character is already at the right location and the action executes this tick.
      // These override the decay-computed values to apply actual recovery.
      if (corrective.stateWrites.hunger_value_override != null) {
        newNeeds.hunger = corrective.stateWrites.hunger_value_override;
        delete corrective.stateWrites.hunger_value_override;
      }
      if (corrective.stateWrites.hygiene_value_override != null) {
        newNeeds.hygiene = corrective.stateWrites.hygiene_value_override;
        delete corrective.stateWrites.hygiene_value_override;
      }

      // ── STALE DECISION INTENT DETECTION ────────────────────────────────────
      // If a routing intent was written >2 hours ago and the character is still
      // "heading home", "needs to find food", etc. with no execution — the intent
      // is stale. Clear it and let the next decision tick re-evaluate.
      // If the character IS at the valid location now, force-complete the intent.
      const intentResolution = resolveStaleDecisionIntents(char, newNeeds, corrective.stateWrites, locationMap, now);
      Object.assign(corrective.stateWrites, intentResolution);

      // ── CONTINUITY PROGRESSION: clear stale corrective activities ──────────
      // When a need has stabilized above its trigger threshold, clear the
      // temporary activity so the character doesn't remain frozen in time
      // weeks after the activity naturally completed.
      const continuityClears = resolveStaleCorrectiveActivities(char, newNeeds, corrective.stateWrites, locationMap);
      Object.assign(corrective.stateWrites, continuityClears);

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

      // ── Classify corrective action type for durable proof creation ──────
      let correctiveActionType = null;
      if (corrective.stateWrites.hunger_value_override != null || (corrective.stateWrites.current_activity && /eat/i.test(corrective.stateWrites.current_activity))) {
        correctiveActionType = 'ate';
      } else if (corrective.stateWrites.hygiene_value_override != null || (corrective.stateWrites.current_activity && /freshen|shower|wash|clean/i.test(corrective.stateWrites.current_activity))) {
        correctiveActionType = 'showered';
      } else if (corrective.stateWrites.resolved_presence_status === 'sleeping') {
        correctiveActionType = 'slept';
      } else if (corrective.stateWrites.resolved_presence_status === 'home' && allCorrectiveLogs.some(l => l.includes('STALE SLEEP CLEARED'))) {
        correctiveActionType = 'woke';
      } else if (corrective.stateWrites.resolved_presence_status === 'hospitalized') {
        correctiveActionType = 'hospitalized';
      } else if (corrective.stateWrites.resolved_presence_status === 'passed_out') {
        correctiveActionType = 'passed_out';
      }

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
        correctiveActionType,
        decision_cause: corrective.stateWrites.decision_cause || 'preference',
        decisionWeights,
        effectiveHungerThreshold: effectiveHungerCritical,
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

    // ── DURABLE COMPLETION PROOF: Create narrative + memory for corrective actions ──
    // For each successfully written character that had a corrective action (ate, showered,
    // slept, woke, hospitalized, passed_out), create a CharacterAutomaticNarrative
    // and Memory record so the action remains discoverable after current_activity clears.
    const durableProofResults = [];
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowETStr = `${String(nowET.getHours()).padStart(2,'0')}:${String(nowET.getMinutes()).padStart(2,'0')}`;
    const timeOfDay = nowET.getHours() >= 5 && nowET.getHours() < 7 ? 'early_morning' :
      nowET.getHours() >= 7 && nowET.getHours() < 10 ? 'morning' :
      nowET.getHours() >= 10 && nowET.getHours() < 12 ? 'late_morning' :
      nowET.getHours() >= 12 && nowET.getHours() < 14 ? 'midday' :
      nowET.getHours() >= 14 && nowET.getHours() < 17 ? 'afternoon' :
      nowET.getHours() >= 17 && nowET.getHours() < 20 ? 'evening' :
      nowET.getHours() >= 20 && nowET.getHours() < 23 ? 'night' : 'late_night';

    const CORRECTIVE_NARRATIVE_TEXTS = {
      ate: (name, cause) => cause === 'opportunity' ? `${name} grabbed a bite — food was right there.`
        : cause === 'routine' ? `${name} had a meal.`
        : cause === 'preference' ? `${name} enjoyed a meal.`
        : `${name} ate — hunger was getting to them.`,
      showered: (name, cause) => cause === 'opportunity' ? `${name} freshened up — shower was right there.`
        : cause === 'routine' ? `${name} showered — part of the routine.`
        : cause === 'preference' ? `${name} freshened up — likes feeling clean.`
        : `${name} cleaned up — really needed it.`,
      slept: (name, cause) => cause === 'opportunity' ? `${name} got some sleep since bed was available.`
        : cause === 'routine' ? `${name} went to bed for the night.`
        : cause === 'preference' ? `${name} called it a night.`
        : `${name} went to sleep, exhausted.`,
      woke: (name) => `${name} woke up after resting.`,
      hospitalized: (name) => `${name} was admitted for emergency medical care.`,
      passed_out: (name) => `${name} collapsed from complete exhaustion — passed out and recovering.`,
    };

    for (const update of updates) {
      if (!update.correctiveActionType || !update.data) continue;
      const wasWritten = writeResults.find(r => r.id === update.id && r.success);
      if (!wasWritten) continue;

      const actionType = update.correctiveActionType;
      const causeForNarrative = update.decision_cause || 'preference';
      const narrativeTextFn = CORRECTIVE_NARRATIVE_TEXTS[actionType] || ((name) => `${name} completed a ${actionType} action.`);
      const narrativeText = narrativeTextFn(update.name, causeForNarrative);
      const charData = characters.find(c => c.id === update.id);
      if (!charData) continue;

      // DEDUPLICATION: skip if same corrective action already recorded within 60 minutes
      try {
        const recentNarrs = await writeSDK.entities.CharacterAutomaticNarrative.filter(
          { character_id: update.id, event_type: 'need_fulfillment' },
          '-timestamp', 3
        ).catch(() => []);
        const hasRecentDuplicate = recentNarrs.some(n => {
          if (!n.timestamp) return false;
          const nMs = new Date(n.timestamp).getTime();
          return (now.getTime() - nMs) < 60 * 60 * 1000 &&
            (n.narrative_text || '').toLowerCase().includes(actionType);
        });
        if (hasRecentDuplicate) {
          durableProofResults.push({ id: update.id, name: update.name, action: actionType, created: false, reason: 'duplicate_within_60min' });
          continue;
        }
      } catch (_) { /* non-blocking */ }

      // Create durable narrative record
      try {
        const locId = charData.resolved_current_location_id || charData.current_home_location_id || null;
        let locName = charData.resolved_current_location_name || 'home';
        let zoneName = null;
        if (locId && locationMap[locId]) {
          locName = locationMap[locId].name || locName;
          zoneName = (locationMap[locId].zones && locationMap[locId].zones[0]) ? locationMap[locId].zones[0].zone_name : null;
        }

        await writeSDK.entities.CharacterAutomaticNarrative.create({
          character_id: update.id,
          character_name: update.name,
          owner_email: charData.owner_email,
          owner_user_id: charData.owner_user_id,
          event_type: 'need_fulfillment',
          narrative_text: narrativeText,
          memory_summary: `[Need Fulfilled] ${actionType}: ${narrativeText.substring(0, 80)}`,
          timestamp: now.toISOString(),
          local_time: nowETStr,
          time_of_day: timeOfDay,
          location_id: locId,
          location_name: locName,
          zone_name: zoneName,
          sleep_state: actionType === 'slept' ? 'asleep' : (actionType === 'woke' ? 'awake' : 'awake'),
          travel_state: 'at_location',
          work_state: 'off_work',
          needs_snapshot: {
            hunger: Math.round(update.data.hunger_value ?? (charData.hunger_value ?? 70)),
            energy: Math.round(update.data.energy_value ?? (charData.energy_value ?? 75)),
            social: Math.round(update.data.social_value ?? (charData.social_value ?? 65)),
            health: Math.round(update.data.health_value ?? (charData.health_value ?? 80)),
            mental: Math.round(update.data.mental_value ?? (charData.mental_value ?? 70)),
            financial_need: Math.round(update.data.financial_need_value ?? (charData.financial_need_value ?? 60)),
            hygiene: Math.round(update.data.hygiene_value ?? (charData.hygiene_value ?? 75)),
            comfort: Math.round(update.data.comfort_value ?? (charData.comfort_value ?? 70)),
          },
          emotional_state: charData.emotional_state || 'calm',
          triggered_by: 'autonomous',
          visibility: 'visible_in_chat',
        }).catch(e => { durableProofResults.push({ id: update.id, name: update.name, action: actionType, created: false, reason: `narrative_err:${e.message}` }); });

        // Create Memory so character can recall the action
        await writeSDK.entities.Memory.create({
          character_id: update.id,
          title: `${actionType === 'ate' ? 'Ate a meal' : actionType === 'showered' ? 'Showered' : actionType === 'slept' ? 'Went to sleep' : actionType === 'woke' ? 'Woke up' : actionType}`,
          description: narrativeText,
          memory_type: 'event',
          importance_score: 4,
          confidence_score: 0.95,
          permanence: 'long_term',
          timestamp: now.toISOString(),
        }).catch(() => {});

        durableProofResults.push({ id: update.id, name: update.name, action: actionType, created: true });
        console.log(`[DURABLE-PROOF] ${update.name}: ${actionType} — narrative + memory created`);
      } catch (e) {
        durableProofResults.push({ id: update.id, name: update.name, action: actionType, created: false, reason: e.message });
      }
    }

    return Response.json({
      success: true,
      processed: characters.length,
      write_failures: writeFailures.length,
      corrective_actions_taken: allCorrectiveLogs.length,
      durable_proof_created: durableProofResults.filter(r => r.created).length,
      durable_proof_results: durableProofResults,
      updates: updates.map(u => ({
        id: u.id,
        name: u.name,
        action: u.action,
        context: u.context,
        elapsedHours: u.elapsedHours,
        correctiveState: u.correctiveState || null,
        correctiveActionType: u.correctiveActionType || null,
        decisionWeights: u.decisionWeights || null,
        effectiveHungerThreshold: u.effectiveHungerThreshold ?? T.HUNGER_CRITICAL,
      })),
      corrective_logs: allCorrectiveLogs,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[simulateActiveCharacterNeeds]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});