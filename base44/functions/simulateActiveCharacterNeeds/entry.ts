import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

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
// ── SOCIAL NEED MODEL (corrected) ────────────────────────────────────────────
// Social measures FULFILLMENT — not current activity, not location type.
// A bartender who spent 8 hours with customers is socially fulfilled, not deprived.
// A character resting at home after a social day has HIGH social, not low.
// Social GAINS from interaction with people (work, school, events, family, calls).
// Social only DECAYS during genuine isolation (extended solitude with zero interaction).
// Being at home ≠ antisocial. Being in public ≠ automatically social.
// KEY INSIGHT: A character can be socially fulfilled AND want quiet time. These are not opposites.
const RATES = {
  sleeping:        { hunger: -1,   energy: +12.5, social:  0,   health: +0.5, mental: +3,   hygiene: 0,    comfort: +4   },
  passed_out:      { hunger: -0.5, energy: +12.5, social:  0,   health: +0.5, mental: +0.5, hygiene: 0,    comfort: +1   },
  hospitalized:    { hunger: -0.5, energy: +4,  social:  0,   health: +5,   mental: -0.3, hygiene: +1,   comfort: +2   },
  at_work:         { hunger: -4,   energy: -5,  social: +2,   health: -0.5, mental: -0.5, hygiene: -2,   comfort: -2   },
  at_work_medical: { hunger: -5,   energy: -7,  social: +2,   health: -0.5, mental: -1,   hygiene: -3,   comfort: -4   },
  at_work_service: { hunger: -5,   energy: -6,  social: +3,   health: -1,   mental: -0.75,hygiene: -3,   comfort: -3   },
  at_work_office:  { hunger: -3,   energy: -4,  social: +2,   health: -0.5, mental: -0.5, hygiene: -1,   comfort: -1   },
  work_off_shift:  { hunger: -3,   energy: -3,  social:  0,   health: -0.5, mental: -0.5, hygiene: -2,   comfort: -4   },
  at_school:       { hunger: -3,   energy: -4,  social: +3,   health: -0.5, mental:  0,   hygiene: -1,   comfort: -1   },
  gym:             { hunger: -6,   energy: -7,  social: +1,   health: +1,   mental: +1,   hygiene: -5,   comfort: -2   },
  bar_club:        { hunger: -2,   energy: -5,  social: +4,   health: -1,   mental: +0.5, hygiene: -1,   comfort: -1   },
  // home_resting: energy=0 (neutral). Awake resting does not restore energy.
  // Social=0: being home after a social day does NOT drain social fulfillment. Resting is not isolation.
  home_resting:    { hunger: -1,   energy:  0,  social:  0,   health: +0.5, mental: +2,   hygiene: 0,    comfort: +3   },
  home_active:     { hunger: -2,   energy: -3,  social:  0,   health: 0,    mental: +0.5, hygiene: -0.5, comfort: +1   },
  // hospital (visited, not admitted): energy=0. Admitted/hospitalized context is separate above.
  hospital:        { hunger: -1,   energy:  0,  social:  0,   health: +3,   mental: -0.5, hygiene: 0,    comfort: +1   },
  // food_drink: eating out. Energy=0 while awake.
  food_drink:      { hunger: +15,  energy:  0,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  social_out:      { hunger: -2,   energy: -4,  social: +3,   health: 0,    mental: +1,   hygiene: -1,   comfort: -0.5 },
  eating:          { hunger: +15,  energy:  0,  social: +1,   health: +0.5, mental: +1,   hygiene: 0,    comfort: +2   },
  // resting: energy=0 (neutral). Awake resting does not drain social — fulfillment persists.
  resting:         { hunger: -1,   energy:  0,  social:  0,   health: +1,   mental: +3,   hygiene: 0,    comfort: +3   },
  default:         { hunger: -2,   energy: -4,  social:  0,   health: 0,    mental: -0.3, hygiene: -1,   comfort: -1   },
};

// ── THRESHOLDS ────────────────────────────────────────────────────────────────
const T = {
  HUNGER_ER:         5,
  HUNGER_CRITICAL:  20,
  HUNGER_LOW:       35,
  ENERGY_MEDICAL:    5,   // hospitalization — sustained energy collapse requiring medical intervention
  ENERGY_PASSOUT:   10,   // character collapses from exhaustion (involuntary — bypasses decision pipeline)
  ENERGY_CRITICAL:  25,   // sleep urgent — sleep as soon as obligations and valid location allow
  ENERGY_LOW:       35,   // sleep/nap transition point — transition should occur if conditions valid
  ENERGY_NAP_PRESSURE: 40, // strong nap pressure — prefer nap/rest when conditions valid
  ENERGY_NAP_AVAILABLE: 50, // nap becomes an available option — does NOT force state change
  HEALTH_ER:        15,
  HEALTH_CRITICAL:  20,
  SOCIAL_CRITICAL:  20,   // social need critically low — must seek social contact
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

// ── OVERNIGHT SLEEP DRIVE ──────────────────────────────────────────────────
// Characters do not work overnight, attend overnight school, or generally live
// nocturnal schedules. From 10 PM onward, the system makes sleep increasingly
// attractive as an autonomous choice. By 3 AM, sleep is the dominant default
// unless a meaningful reason to stay awake exists.
//
// DESIGN: Drive multiplies energy thresholds — at night, characters feel
// tired faster. A character at 70 energy at 3 AM (drive 2.5) behaves like
// 28 energy → well below critical threshold → chooses sleep autonomously.
//
// EXCEPTIONS: Valid overnight activities (party, emergency, childcare, etc.)
// halve the drive so characters can stay awake for meaningful reasons.
// Night owl personality reduces drive by ~20% — they genuinely stay up later.
//
// AUTONOMY: No fixed bedtime is enforced. Characters choose sleep because
// it becomes the most attractive option, not because a clock says so.

function overnightSleepDriveMultiplier(nowET, character) {
  const hour = nowET.getHours();
  const minute = nowET.getMinutes();
  const frac = hour + minute / 60;

  // Night owl personality reduces drive — they naturally stay up later
  const personalityMod = character.trait_night_owl ? 0.8 : 1.0;

  // 3 AM – 6 AM: peak drive — characters should be asleep unless meaningful reason
  if (frac >= 3 && frac < 6) return 2.5 * personalityMod;
  // 2 AM – 3 AM: strong drive
  if (frac >= 2 && frac < 3) return 2.0 * personalityMod;
  // 1 AM – 2 AM: increased drive
  if (frac >= 1 && frac < 2) return 1.8 * personalityMod;
  // Midnight – 1 AM: moderate drive
  if (frac >= 0 && frac < 1) return 1.5 * personalityMod;
  // 11 PM – Midnight: starting drive
  if (frac >= 23) return 1.3 * personalityMod;
  // 10 PM – 11 PM: mild evening drive
  if (frac >= 22 && frac < 23) return 1.1 * personalityMod;

  return 1.0; // No drive before 10 PM
}

/**
 * hasMeaningfulOvernightActivity
 *
 * Checks if the character has a valid, meaningful reason to be awake
 * during overnight hours (past 11 PM). These reasons justify staying up
 * despite the increasing sleep drive.
 *
 * Valid reasons: parties, celebrations, romantic intimacy, childcare,
 * emergencies, emotional crises, important conversations, overnight work,
 * active travel, medical situations.
 *
 * Characters with these reasons get a halved overnight drive — fatigue
 * still matters, but the activity is worth staying awake for.
 */
function hasMeaningfulOvernightActivity(character) {
  const activity = (character.current_activity || '').toLowerCase();

  const validReasons = [
    // Social/celebration
    'party', 'celebration', 'wedding', 'reception', 'gathering', 'event',
    // Romantic
    'romantic', 'date', 'intimate', 'lover',
    // Childcare/family
    'child', 'baby', 'nursing', 'feeding', 'care',
    // Emergency/crisis
    'emergency', 'crisis', 'urgent', 'disaster',
    // Emotional
    'argument', 'fight', 'conflict', 'emotional', 'distress', 'grief', 'mourning',
    'crying', 'upset', 'breakdown',
    // Important conversation
    'important conversation', 'serious talk', 'discussion',
    // Overnight work (very rare — only for characters with legitimate night shifts)
    'night shift', 'overnight', 'graveyard',
    // Travel
    'traveling', 'road', 'driving', 'transit',
    // Medical
    'hospital', 'medical', 'sick', 'ill',
  ];

  for (const reason of validReasons) {
    if (activity.includes(reason)) return true;
  }

  // Active travel — character is in transit somewhere
  if (character.travel_status && character.travel_status !== 'not_traveling') return true;

  // Hospitalized — medical override
  if (character.resolved_presence_status === 'hospitalized') return true;

  return false;
}

// ── STALE PRESENCE THRESHOLD ─────────────────────────────────────────────────
const STALE_PRESENCE_MS = 4 * 60 * 60 * 1000; // 4 hours

const ENERGY_RESTORING_CONTEXTS = new Set(['sleeping', 'passed_out', 'hospitalized']);

function resolvePresenceStaleness(character, now) {
  const candidates = [
    character.last_need_simulated_at,
    character.resolved_last_updated_at,
  ].filter(Boolean).map(t => new Date(t).getTime());
  if (candidates.length === 0) return true;
  const mostRecent = Math.max(...candidates);
  return (now.getTime() - mostRecent) > STALE_PRESENCE_MS;
}

function getLocationContext(character, locationMap, now) {
  const activity = (character.current_activity || '').toLowerCase();
  const presenceStatus = character.resolved_presence_status || character.location_status;

  if (presenceStatus === 'hospitalized') return 'hospitalized';
  if (presenceStatus === 'passed_out') return 'passed_out';
  if (presenceStatus === 'sleeping' || presenceStatus === 'napping') return 'sleeping';
  if (activity.includes('passed out') || activity.includes('collapsed')) return 'passed_out';
  if (activity.includes('hospital') || activity.includes('er ') || activity.includes('emergency room') || activity.includes('urgent care')) return 'hospitalized';

  const presenceIsStale = now ? resolvePresenceStaleness(character, now) : false;

  if (isOnShift(character, locationMap)) {
    const workLocId = character.occupation_location_id || character.current_work_location_id;
    const workLoc = workLocId ? locationMap[workLocId] : null;
    if (workLoc) return getWorkContextFromLocation(workLoc);
    return 'at_work';
  }

  if (presenceStatus === 'at_school') return 'at_school';

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

  if (presenceStatus === 'at_work') return 'work_off_shift';

  const locId = character.resolved_current_location_id;
  if (!locId) {
    if (presenceIsStale) return 'default';
    if (presenceStatus === 'home' || !presenceStatus) return 'home_resting';
    return 'default';
  }
  const loc = locationMap[locId];
  if (!loc) return 'default';

  const workLocId = character.occupation_location_id || character.current_work_location_id;
  if (locId === workLocId) return 'work_off_shift';

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

  if (!presenceIsStale) {
    if (activity.includes('eat') || activity.includes('food') || activity.includes('cook') || activity.includes('meal') || activity.includes('lunch') || activity.includes('dinner') || activity.includes('breakfast') || activity.includes('snack')) return 'eating';
    if (activity.includes('rest') || activity.includes('nap') || activity.includes('relax')) return 'resting';
  }

  return 'default';
}

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

  if (context === 'sleeping' && (locCat === 'home' || locCat === 'hotel' || presence === 'home')) {
    modifier += 1;
  }
  if ((presence === 'napping' || activity.includes('nap')) && (locCat === 'home' || !locId)) {
    modifier += 0.5;
  }
  if (context === 'home_resting') {
    modifier += 1;
  }
  if (context === 'resting' && locCat !== 'gym' && locCat !== 'jail_prison') {
    modifier += 0.5;
  }

  if (loc) {
    const isUpscale = locFeatures.some(f => f.includes('upscale') || f.includes('luxury') || f.includes('fine dining') || f.includes('high-end'))
      || locDesc.includes('upscale') || locDesc.includes('luxury') || locDesc.includes('fine dining');
    if (isUpscale) modifier += 0.75;

    const isPleasant = locFeatures.some(f => f.includes('clean') || f.includes('pleasant') || f.includes('beautiful') || f.includes('relaxing') || f.includes('serene') || f.includes('cozy') || f.includes('comfortable'))
      || locDesc.includes('cozy') || locDesc.includes('relaxing') || locDesc.includes('comfortable') || locDesc.includes('beautiful');
    if (isPleasant) modifier += 0.5;

    if (locCat === 'jail_prison' || loc.is_confinement_facility) {
      modifier -= 1.5;
    }

    if (locCat === 'outdoor' || locCat === 'community') {
      modifier += 0.25;
    }
  }

  if (context === 'food_drink' || (activity.includes('eat') && locCat === 'food_drink')) {
    modifier += 0.5;
    if (loc) {
      const isNiceRestaurant = locFeatures.some(f => f.includes('upscale') || f.includes('fine dining') || f.includes('nice'))
        || locDesc.includes('upscale') || locDesc.includes('fine dining');
      if (isNiceRestaurant) modifier += 0.5;
    }
  }

  const relationships = char.fictional_relationships || [];
  const familyMembers = char.family_members || [];

  const isSocialContext = context === 'social_out' || context === 'bar_club' || context === 'food_drink';
  const isAtHome = context === 'home_resting' || context === 'home_active' || presence === 'home';

  if (isSocialContext || isAtHome) {
    let bestRelationshipComfort = 0;
    for (const r of relationships) {
      const friendship = r.friendship_level ?? 50;
      const trust      = r.trust_level      ?? 50;
      const romantic   = r.romantic_level   ?? 0;
      const tension    = r.tension_level    ?? 0;

      if (friendship < 25 || trust < 20 || tension > 70) {
        bestRelationshipComfort = Math.min(bestRelationshipComfort, -1);
        continue;
      }
      if (friendship > 80 || trust > 75 || romantic > 60) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 1);
      } else if (friendship > 60 || trust > 55) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
      }
    }

    if (isAtHome && familyMembers.length > 0) {
      bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    }

    modifier += bestRelationshipComfort;
  }



  const activityLower = activity;
  const isForcedEvent = activityLower.includes('mandatory') || activityLower.includes('forced') || activityLower.includes('awkward') || activityLower.includes('uncomfortable');
  if (isForcedEvent) modifier -= 0.5;

  const isStressfulActivity = activityLower.includes('argument') || activityLower.includes('confrontation') || activityLower.includes('conflict') || activityLower.includes('tense') || activityLower.includes('stressed');
  if (isStressfulActivity) modifier -= 1;

  return Math.max(-2, Math.min(2, modifier));
}

/**
 * mentalPersonalityScale
 *
 * Maps character personality traits to a scaling factor for each mental wellbeing dimension.
 * Each dimension ranges 0.3–2.0. Higher = this character is MORE sensitive to
 * this dimension's sources/drains. Extroverts care more about social; conscientious
 * characters care more about stability; competitive characters care more about
 * achievement and purpose.
 */
function mentalPersonalityScale(char) {
  const socialEnergy = char.social_energy || 'ambivert';
  const traits = {
    conscientious:   char.trait_conscientious   || false,
    loyal:           char.trait_loyal           || false,
    competitive:     char.trait_competitive     || false,
    morningPerson:   char.trait_morning_person  || false,
    empathetic:      char.trait_empathetic      || false,
    adaptable:       char.trait_adaptable       || false,
    cynical:         char.trait_cynical         || false,
    compassionate:   char.trait_compassionate   || false,
    stubborn:        char.trait_stubborn        || false,
    generous:        char.trait_generous        || false,
    nightOwl:        char.trait_night_owl       || false,
    leader:          char.trait_leader          || false,
  };

  // Base: 1.0 for all dimensions
  const scale = {
    social:           1.0,
    rest:             1.0,
    achievement:      1.0,
    resilience:       1.0,
    confidence:       1.0,
    purpose:          1.0,
    characterValues:  1.0,
    stability:        1.0,
    selfCare:         1.0,
  };

  // Social energy: extroverts care MORE about social, introverts LESS
  if (socialEnergy === 'extrovert' || socialEnergy === 'mostly_extrovert') {
    scale.social *= 1.5;
    scale.rest   *= 0.8;  // less restorative from alone time
  } else if (socialEnergy === 'introvert' || socialEnergy === 'mostly_introvert') {
    scale.social *= 0.6;  // less sensitive to social events
    scale.rest   *= 1.3;  // more restorative from alone time
  }

  // Conscientious: cares about stability, routine, achievement
  if (traits.conscientious) {
    scale.stability    *= 1.5;
    scale.achievement  *= 1.3;
    scale.purpose      *= 1.2;
    scale.selfCare     *= 1.3;
  }

  // Loyal: values relationships, character values
  if (traits.loyal) {
    scale.social           *= 1.3;
    scale.characterValues  *= 1.5;
  }

  // Competitive: cares about achievement, purpose, confidence
  if (traits.competitive) {
    scale.achievement  *= 1.6;
    scale.purpose      *= 1.3;
    scale.confidence   *= 1.4;
  }

  // Empathetic: deeply affected by social dynamics
  if (traits.empathetic) {
    scale.social  *= 1.4;
    scale.confidence *= 1.2;
  }

  // Adaptable: more resilient, but less affected by stability
  if (traits.adaptable) {
    scale.resilience  *= 1.5;
    scale.stability   *= 0.7;  // doesn't need rigid structure
  }

  // Cynical: resistant to positive social, low resilience
  if (traits.cynical) {
    scale.social      *= 0.5;  // doesn't buy social positivity
    scale.resilience  *= 0.6;
  }

  // Compassionate: more affected by helping others
  if (traits.compassionate) {
    scale.characterValues  *= 1.4;
    scale.social           *= 1.2;
  }

  // Stubborn: high confidence but lower resilience to setbacks
  if (traits.stubborn) {
    scale.confidence   *= 1.5;
    scale.resilience   *= 0.7;  // breaks harder when broken
  }

  // Generous: values giving back
  if (traits.generous) {
    scale.characterValues  *= 1.3;
    scale.social           *= 1.2;
  }

  // Night owl: less benefit from morning routines
  if (traits.nightOwl) {
    scale.rest      *= 0.8;   // less restorative from standard sleep
    scale.stability *= 0.8;   // routines may not match standard hours
  }

  // Morning person: more benefit from morning routines
  if (traits.morningPerson) {
    scale.rest      *= 1.2;
    scale.stability *= 1.2;
    scale.selfCare  *= 1.1;
  }

  // Leader: cares about purpose, confidence, achievement
  if (traits.leader) {
    scale.purpose      *= 1.4;
    scale.confidence   *= 1.3;
    scale.achievement  *= 1.3;
  }

  // Clamp all scales to [0.3, 2.0]
  for (const k of Object.keys(scale)) {
    scale[k] = Math.max(0.3, Math.min(2.0, scale[k]));
  }

  return scale;
}

/**
 * computeMentalModifier
 *
 * Evaluates the character's current context and activity to determine
 * a mental wellbeing modifier. Positive = mental health improving.
 * Negative = mental health declining. The modifier is ADDED to RATES mental.
 *
 * Each section is scaled by the character's personality profile so that
 * identical activities affect two characters differently.
 */
function computeMentalModifier(char, context, locationMap) {
  let modifier = 0;
  const scale = mentalPersonalityScale(char);

  const activity    = (char.current_activity || '').toLowerCase();
  const presence    = char.resolved_presence_status || '';
  const locId       = char.resolved_current_location_id;
  const loc         = locId ? locationMap[locId] : null;
  const locCat      = (loc?.category || '').toLowerCase();
  const locName     = (loc?.name || '').toLowerCase();
  const locDesc     = (loc?.description || '').toLowerCase();
  const locFeatures = (loc?.features || []).map(f => (f || '').toLowerCase());
  const locSubtypes = (loc?.subtype || []).map(s => (s || '').toLowerCase());

  const relationships = char.fictional_relationships || [];
  const familyMembers = char.family_members || [];

  const isSocialContext = context === 'social_out' || context === 'bar_club' || context === 'food_drink';
  const isAtHome = context === 'home_resting' || context === 'home_active' || presence === 'home';

  if (isSocialContext || isAtHome) {
    let bestRelationshipComfort = 0;
    for (const r of relationships) {
      const friendship = r.friendship_level ?? 50;
      const trust      = r.trust_level      ?? 50;
      const romantic   = r.romantic_level   ?? 0;
      const tension    = r.tension_level    ?? 0;

      if (friendship < 25 || trust < 20 || tension > 70) {
        bestRelationshipComfort = Math.min(bestRelationshipComfort, -1);
        continue;
      }
      if (friendship > 80 || trust > 75 || romantic > 60) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 1);
      } else if (friendship > 60 || trust > 55) {
        bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
      }
    }

    if (isAtHome && familyMembers.length > 0) {
      bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    }

    modifier += bestRelationshipComfort;
  }

  const hasJob    = !!(char.occupation || char.work_start_time || char.occupation_location_id);
  const hasHome   = !!(char.current_home_location_id || char.resolved_current_location_id);
  const atHome    = locCat === 'home' || presence === 'home';
  const atSchool  = locCat === 'school' || locCat === 'education' || presence === 'at_school';
  const onShift   = isOnShift(char, locationMap);

  const hasCloseRel = relationships.some(r => (r.friendship_level ?? 0) > 70 || (r.trust_level ?? 0) > 70 || (r.romantic_level ?? 0) > 50);

  // ═══════════════════════════════════════════════════════════════════════
  // REST & RECOVERY + MOVEMENT & EXERCISE
  // ═══════════════════════════════════════════════════════════════════════
  const mQualitySleep = context === 'sleeping' && (locCat === 'home' || locCat === 'hotel');
  const mNap          = presence === 'napping' || activity.includes('nap') || activity.includes('siesta');
  const mRestRecover  = activity.includes('rest') || activity.includes('recover') || activity.includes('recharge') || activity.includes('rested');
  const mAfterEffort  = activity.includes('after') && (activity.includes('work') || activity.includes('effort') || activity.includes('day'));
  const mGym          = context === 'gym' || activity.includes('exercise') || activity.includes('workout');
  const mWalk         = activity.includes('walk') || activity.includes('stroll') || activity.includes('jog') || activity.includes('run');

  if (mQualitySleep) modifier += 1.25 * scale.rest;
  if (mNap)          modifier += 0.75 * scale.rest;
  if (mRestRecover)  modifier += 0.75 * scale.rest;
  if (mAfterEffort)  modifier += 0.5 * scale.rest;
  if (context === 'home_resting' || context === 'resting') modifier += 1.0 * scale.rest;
  if (context === 'eating' || context === 'food_drink') modifier += 0.75 * scale.rest;
  if (mGym)          modifier += 1.0;  // exercise is universally beneficial
  if (mWalk)         modifier += 0.75;

  // ═══════════════════════════════════════════════════════════════════════
  // CHARACTER & PERSONAL VALUES
  // ═══════════════════════════════════════════════════════════════════════
  const mHelping     = activity.includes('help') || activity.includes('volunteer') || activity.includes('donate') || activity.includes('assist');
  const mKind        = activity.includes('kind') || activity.includes('nice') || activity.includes('generous');
  const mRespectful  = activity.includes('respect') || activity.includes('pleasant') || activity.includes('polite');
  const mProud       = activity.includes('proud') || activity.includes('right decision') || activity.includes('good choice');
  const mValues      = activity.includes('values') || activity.includes('integrity') || activity.includes('principle') || activity.includes('honest');

  if (mHelping)    modifier += 1.25 * scale.characterValues;
  if (mKind)       modifier += 0.75 * scale.characterValues;
  if (mRespectful) modifier += 0.5 * scale.characterValues;
  if (mProud)      modifier += 1.0 * scale.characterValues;
  if (mValues)     modifier += 0.75 * scale.characterValues;

  // ═══════════════════════════════════════════════════════════════════════
  // PERSONAL CONFIDENCE & SELF-WORTH
  // ═══════════════════════════════════════════════════════════════════════
  const mPepTalk     = activity.includes('pep talk') || (activity.includes('positive') && activity.includes('self'));
  const mProgress    = activity.includes('progress') || activity.includes('better') || activity.includes('improve');
  const mCapable     = activity.includes('capable') || activity.includes('competent') || activity.includes('confident');
  const mRespected   = activity.includes('respect') || activity.includes('reputation') || activity.includes('trust');
  const mAdvised     = activity.includes('advice sought') || activity.includes('come to me') || activity.includes('asked for help');
  const mUseful      = activity.includes('useful') || activity.includes('valued') || activity.includes('needed') || activity.includes('depended');

  if (mPepTalk)   modifier += 1.0 * scale.confidence;
  if (mProgress)  modifier += 0.75 * scale.confidence;
  if (mCapable)   modifier += 0.75 * scale.confidence;
  if (mRespected) modifier += 1.0 * scale.confidence;
  if (mAdvised)   modifier += 0.75 * scale.confidence;
  if (mUseful)    modifier += 1.0 * scale.confidence;
  if (hasCloseRel) modifier += 0.2 * scale.confidence;

  // ═══════════════════════════════════════════════════════════════════════
  // GOALS & PURPOSE
  // ═══════════════════════════════════════════════════════════════════════
  const mGoals     = activity.includes('goal') || activity.includes('plan') || activity.includes('future');
  const mPurpose   = activity.includes('purpose') || activity.includes('direction') || activity.includes('meaning');
  const mWorking   = activity.includes('working toward') || activity.includes('making progress');
  const mMilestone = activity.includes('milestone') || activity.includes('achieve');

  if (mGoals)     modifier += 0.5 * scale.purpose;
  if (mPurpose)   modifier += 1.0 * scale.purpose;
  if (mWorking)   modifier += 0.75 * scale.purpose;
  if (mMilestone) modifier += 1.25 * scale.purpose;
  if (atSchool)   modifier += 0.4 * scale.purpose;
  if (hasJob)     modifier += 0.2 * scale.purpose;

  // ═══════════════════════════════════════════════════════════════════════
  // DAILY STABILITY & ROUTINE
  // ═══════════════════════════════════════════════════════════════════════
  const mRoutine     = activity.includes('routine') || activity.includes('habit') || activity.includes('consistent');
  const mProductive  = activity.includes('productive') || activity.includes('getting things done');
  const mOrganized   = activity.includes('organize') || activity.includes('tidy') || activity.includes('clean');
  const mPrepared    = activity.includes('prepare') || activity.includes('ready') || activity.includes('set up');
  const mCommitment  = activity.includes('commitment') || activity.includes('responsibilit') || activity.includes('reliable');
  const mEnvOk       = locFeatures.some(f => f.includes('clean') || f.includes('tidy') || f.includes('stable') || f.includes('safe'));
  const hasStructure = onShift || atSchool;

  if (mRoutine)    modifier += 0.5 * scale.stability;
  if (mProductive) modifier += 0.75 * scale.stability;
  if (mOrganized)  modifier += 0.5 * scale.stability;
  if (mPrepared)   modifier += 0.5 * scale.stability;
  if (mCommitment) modifier += 0.5 * scale.stability;
  if (mEnvOk)      modifier += 0.35 * scale.stability;
  if (hasStructure) modifier += 0.15 * scale.stability;
  if (onShift)     modifier += 0.25 * scale.stability;

  // ═══════════════════════════════════════════════════════════════════════
  // HEALTHY THINKING & RESILIENCE
  // ═══════════════════════════════════════════════════════════════════════
  const mOutlook  = activity.includes('positive outlook') || activity.includes('optimistic') || activity.includes('hopeful');
  const mHope     = activity.includes('hope') || activity.includes('better days') || activity.includes('looking forward');
  const mNotWorst = activity.includes('not assuming worst') || activity.includes('staying calm') || activity.includes('realistic');
  const mResilient = activity.includes('resilient') || activity.includes('bounce back') || activity.includes('cope');

  if (mOutlook)   modifier += 0.75 * scale.resilience;
  if (mHope)      modifier += 1.0 * scale.resilience;
  if (mNotWorst)  modifier += 0.5 * scale.resilience;
  if (mResilient) modifier += 1.0 * scale.resilience;

  // ═══════════════════════════════════════════════════════════════════════
  // LOCATION-BASED (environmental context)
  // ═══════════════════════════════════════════════════════════════════════
  if (locCat === 'outdoor') modifier += 0.75;
  if (atHome && (locFeatures.some(f => f.includes('clean') || f.includes('tidy') || f.includes('cozy')) || !locFeatures.length)) modifier += 0.5;
  if (locName.includes('park') || locName.includes('garden') || locName.includes('trail') || locName.includes('nature')) modifier += 0.75;
  if (locDesc.includes('peaceful') || locDesc.includes('calm') || locDesc.includes('serene') || locDesc.includes('quiet')) modifier += 0.5;
  if (locCat === 'religion' || locName.includes('church') || locName.includes('temple') || locName.includes('mosque') || locName.includes('synagogue') || locName.includes('worship')) modifier += 1.0;
  if (activity.includes('pray') || activity.includes('worship') || activity.includes('spiritual')) modifier += 1.25;
  if (locCat === 'community' || activity.includes('community') || activity.includes('fellowship') || activity.includes('gathering')) modifier += 0.5;

  // ═══════════════════════════════════════════════════════════════════════
  // DRAINS (safety, conflict, isolation, grief)
  // ═══════════════════════════════════════════════════════════════════════
  if (locCat === 'jail_prison' || (loc && loc.is_confinement_facility)) modifier -= 1.5;
  if (activity.includes('fear') || activity.includes('threat') || activity.includes('danger') || activity.includes('unsafe')) modifier -= 1.5;
  if (activity.includes('conflict') || activity.includes('argument') || activity.includes('fight')) modifier -= 1.25;
  if (activity.includes('grief') || activity.includes('loss') || activity.includes('mourn')) modifier -= 1.5;
  if (activity.includes('isolat') || activity.includes('lonely') || activity.includes('alone')) modifier -= 1.0;
  if (activity.includes('critic') && activity.includes('self')) modifier -= 0.5;
  if (activity.includes('worst') && activity.includes('outcome')) modifier -= 0.5;

  // ═══════════════════════════════════════════════════════════════════════
  // PERSONALITY-MATCHED PREFERENCES
  // ═══════════════════════════════════════════════════════════════════════
  if (char.trait_conscientious && (mOrganized || activity.includes('clean'))) modifier += 0.75;
  if (char.social_energy === 'extrovert' || char.social_energy === 'mostly_extrovert') {
    if (context === 'social_out' || context === 'bar_club' || activity.includes('social')) modifier += 0.5;
  }
  if (char.trait_competitive && (mGym || activity.includes('compete') || activity.includes('game') || activity.includes('sport'))) modifier += 0.5;
  if (char.trait_morning_person && activity.includes('morning')) modifier += 0.35;
  if ((locCat === 'grocery' || locSubtypes.includes('clothing') || locSubtypes.includes('shopping') || locName.includes('shop') || locName.includes('store') || locName.includes('mall') || locName.includes('boutique'))) modifier += 0.3;
  if ((locName.includes('cafe') || locName.includes('coffee') || activity.includes('coffee') || activity.includes('cafe')) && !char.trait_night_owl) modifier += 0.35;
  if ((char.social_energy === 'introvert' || char.social_energy === 'mostly_introvert') && atHome && context === 'home_resting') modifier += 0.35;

  return modifier;
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

function applyStatInfection(needs, elapsedHours) {
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
  // Social < 15 = genuine isolation (not "at home resting"). Only truly isolated
  // characters reach this threshold under the corrected fulfillment model.
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

// ── CORRECTIVE STATE RESOLVER ──────────────────────────────────────────────
// When needs cross critical thresholds, the simulation writes a corrective
// current_activity so that the NEXT tick picks up recovery rates automatically.

// ── CORRECTIVE STATE RESOLVER ──────────────────────────────────────────────
// Behavioral pipeline: Need → Pressure → Decision → Action → State
// Energy thresholds create PRESSURE, not direct state changes.
// State is only written when ALL conditions in the decision chain are validated.
//
// EXCEPTIONS (bypass the pipeline — involuntary physical failure):
//   Pass-out (≤10% energy): Need → Physical Failure → State
//   Medical danger (≤5% energy): Need → Physical Failure → State

function computeCorrectiveState(needs, character, locationMap) {
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';

  const isInRestState = presence === 'sleeping' || presence === 'napping' ||
    presence === 'passed_out' || presence === 'hospitalized';

  // ═══════════════════════════════════════════════════════════════════════
  // PASS-OUT (≤10%): bypass pipeline — involuntary physical collapse
  // ═══════════════════════════════════════════════════════════════════════
  if (needs.energy <= T.ENERGY_PASSOUT && !isInRestState && !character.sleep_lock) {
    return {
      resolved_presence_status: 'sleeping',
      current_activity: 'passed out — resting',
      last_sleep_start: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MEDICAL DANGER (≤5%): bypass pipeline — AWAKE CHARACTERS ONLY.
  // Sleeping/napping characters get +12.5/hr energy recovery — that is
  // the correct treatment. Hospitalization override is only for AWAKE
  // characters whose energy crashed below 5 while conscious.
  // ═══════════════════════════════════════════════════════════════════════
  if (needs.energy <= T.ENERGY_MEDICAL && !isInRestState) {
    return {
      resolved_presence_status: 'hospitalized',
      current_activity: 'hospitalized — energy collapse',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ENERGY 25-50%: DECISION PIPELINE REQUIRED
  // State only written if: at home + no obligations + no sleep lock
  // Blocked characters: return null, re-evaluate next tick
  // ═══════════════════════════════════════════════════════════════════════

  if (needs.energy <= T.ENERGY_NAP_AVAILABLE && needs.energy > T.ENERGY_PASSOUT && !isInRestState) {
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // ── OVERNIGHT SLEEP DRIVE ──────────────────────────────────────────
    // From 10 PM onward, sleep becomes autonomously attractive.
    // Energy thresholds are effectively lowered: a character's energy is
    // divided by the drive so they feel tired faster at night.
    //
    // Character at 70 energy, 3 AM (drive 2.5): effective ≈ 28 → critical.
    // Character at 90 energy, 3 AM (drive 2.5): effective ≈ 36 → nap transition.
    //
    // Characters with meaningful overnight activities (party, emergency,
    // childcare) get halved drive — fatigue matters but the activity
    // is worth staying awake for. Night owl personalities get 20% less drive.
    const overnightDrive = overnightSleepDriveMultiplier(nowET, character);
    const hasOvernightReason = hasMeaningfulOvernightActivity(character);

    // Meaningful overnight activities halve the drive — character stays up
    const effectiveDrive = hasOvernightReason
      ? Math.max(1.0, overnightDrive * 0.5)
      : overnightDrive;

    // ── PASS-OUT MEMORY AMPLIFICATION ──────────────────────────────
    // Characters who passed out recently feel exhaustion more intensely.
    // They remember that pass-out was unpleasant and don't want to repeat it.
    // This amplifies sleep pressure without removing autonomy — the character
    // still chooses sleep, but the pressure to do so is stronger.
    //
    // Recent pass-out (< 7 days): energy feels 30% lower (multiplier 0.70)
    // Recent pass-out (< 30 days): energy feels 15% lower (multiplier 0.85)
    // Multiple pass-outs (≥ 2): additional 10% amplification per extra pass-out
    let passOutAmp = 1.0;
    if (character.last_pass_out_at) {
      const daysSincePassOut = (nowET.getTime() - new Date(character.last_pass_out_at).getTime()) / (24 * 3_600_000);
      if (daysSincePassOut < 7) {
        passOutAmp = 0.70; // recent trauma — strong avoidance
      } else if (daysSincePassOut < 30) {
        passOutAmp = 0.85; // still fresh memory — moderate avoidance
      }
      // Repeated pass-outs compound the effect
      const extraCount = Math.max(0, (character.pass_out_count ?? 0) - 1);
      if (extraCount > 0) {
        passOutAmp *= Math.max(0.5, 1.0 - extraCount * 0.1); // each extra pass-out adds 10% amplification
      }
    }

    // Effective energy: raw energy divided by drive AND pass-out memory amp.
    // At night, characters feel fatigue faster. After pass-out, they feel it
    // even faster because they remember the consequence of ignoring it.
    const effectiveEnergy = (needs.energy / effectiveDrive) * passOutAmp;

    // ── HARD BLOCKERS ──────────────────────────────────────────────────
    const inObligation = isOnShift(character, locationMap) ||
      presence === 'at_school' ||
      (character.travel_status && character.travel_status !== 'not_traveling') ||
      character.is_jailed ||
      character.house_arrest_active;

    const atHome = character.resolved_current_location_id === character.current_home_location_id ||
      presence === 'home' ||
      (character.resolved_location_type || '').toLowerCase() === 'home';

    // Overnight obligation override: between 3 AM-6 AM, "at_school" and
    // stale work shifts are nearly impossible. Still respect jail/house_arrest.
    const hour = nowET.getHours();
    const isOvernightViolationWindow = hour >= 3 && hour < 6;
    const staleOvernightObligation = isOvernightViolationWindow &&
      (presence === 'at_school' || (inObligation && hour >= 3 && hour < 6));

    // If stale overnight obligation without a meaningful reason, ignore it
    const effectiveInObligation = staleOvernightObligation && !hasOvernightReason
      ? false
      : inObligation;

    const isBlocked = effectiveInObligation || !atHome || character.sleep_lock;

    // ── SLEEP WINDOW PROXIMITY ──────────────────────────────────────────
    const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();

    let sleepStartMin = null;
    if (character.sleep_start_time) {
      sleepStartMin = toMin(character.sleep_start_time);
    } else if (character.work_start_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
      const workStart = toMin(character.work_start_time);
      if (workStart !== null) {
        const wakeMin = (workStart - 60 + 1440) % 1440;
        sleepStartMin = (wakeMin - 7 * 60 + 1440) % 1440;
      }
    }
    if (sleepStartMin === null && character.student_status === 'enrolled' && [1, 2, 3, 4, 5].includes(dayOfWeek)) {
      sleepStartMin = 23 * 60;
    }
    if (sleepStartMin === null) {
      sleepStartMin = 23 * 60;
    }

    let minutesToSleep = sleepStartMin - nowMin;
    if (minutesToSleep < 0) minutesToSleep += 1440;
    const closeToSleepWindow = minutesToSleep <= 90;

    // ═══════════════════════════════════════════════════════════════════
    // Effective energy ≤ 25: SLEEP URGENT
    // Sleep is urgent but NEVER abandon real obligations.
    // If at home + free → sleep now. If at work/school → return null.
    //
    // At night (3 AM drive=2.5): raw energy of ~63 triggers this.
    // ═══════════════════════════════════════════════════════════════════
    if (effectiveEnergy <= T.ENERGY_CRITICAL) {
      if (!isBlocked) {
        return {
          resolved_presence_status: 'sleeping',
          current_activity: 'sleeping — energy critically low',
          last_sleep_start: new Date().toISOString(),
        };
      }
      return null; // blocked by obligation or not home — re-evaluate next tick; pass-out will happen naturally if energy drains to ≤10
    }

    // ═══════════════════════════════════════════════════════════════════
    // Effective energy ≤ 35: NAP/SLEEP TRANSITION
    //
    // At night (3 AM drive=2.5): raw energy of ~88 triggers this.
    // Close to sleep window → sleep. Otherwise → nap.
    // ═══════════════════════════════════════════════════════════════════
    if (effectiveEnergy <= T.ENERGY_LOW) {
      if (!isBlocked) {
        if (closeToSleepWindow) {
          return {
            resolved_presence_status: 'sleeping',
            current_activity: 'sleeping — low energy near bedtime',
            last_sleep_start: new Date().toISOString(),
          };
        }
        return {
          resolved_presence_status: 'napping',
          current_activity: 'napping — low energy recovery',
          last_nap_time: new Date().toISOString(),
        };
      }
      return null; // blocked — re-evaluate next tick
    }

    // ═══════════════════════════════════════════════════════════════════
    // Effective energy ≤ 40: STRONG NAP PRESSURE
    //
    // At midnight (drive=1.5): raw energy of ~60 triggers this.
    // ═══════════════════════════════════════════════════════════════════
    if (effectiveEnergy <= T.ENERGY_NAP_PRESSURE) {
      if (!isBlocked) {
        return {
          resolved_presence_status: 'napping',
          current_activity: 'napping — strong energy pressure',
          last_nap_time: new Date().toISOString(),
        };
      }
      return null; // blocked — re-evaluate next tick; character will drain naturally
    }

    // ═══════════════════════════════════════════════════════════════════
    // Effective energy ≤ 50: NAP AVAILABLE — NO automatic state change
    // Nap is an available option. Decision engine weighs options.
    //
    // At 11 PM (drive=1.3): raw energy of ~65 triggers awareness.
    // ═══════════════════════════════════════════════════════════════════
    if (effectiveEnergy <= T.ENERGY_NAP_AVAILABLE) {
      return null; // Pressure exists but no automatic state change
    }

    return null;
  }

  // Hunger-critical triggers eating
  if (needs.hunger <= T.HUNGER_CRITICAL && !activity.includes('eat')) {
    return { current_activity: 'eating — hunger drove them to food' };
  }

  // Health ER triggers hospitalization
  if (needs.health <= T.HEALTH_ER && presence !== 'hospitalized') {
    return { resolved_presence_status: 'hospitalized', current_activity: 'hospitalized — health collapsed' };
  }

  // Social-critical
  if (needs.social <= T.SOCIAL_CRITICAL && !isInRestState
      && !character.is_jailed && !character.house_arrest_active) {
    return { current_activity: 'seeking social contact — isolated too long' };
  }

  // Compound crisis
  const criticalCount = [needs.hunger, needs.energy, needs.health, needs.social, needs.mental]
    .filter(v => v < 20).length;
  if (criticalCount >= T.COMPOUND_CRISIS && !isInRestState) {
    return {
      resolved_presence_status: 'sleeping',
      current_activity: 'forced rest — compound crisis',
      last_sleep_start: new Date().toISOString(),
    };
  }

  return null;
}

// ── DECISION WEIGHTS ──────────────────────────────────────────────────────
// Character decides what to do based on current needs and context.

const HYGIENE_CURVE = [
  { threshold: 20, weight: 3.5 },
  { threshold: 35, weight: 2.0 },
  { threshold: 50, weight: 1.0 },
  { threshold: 65, weight: 0.4 },
  { threshold: 80, weight: 0.1 },
];

const ENERGY_CURVE = [
  { threshold: 15, weight: 5.0 },
  { threshold: 25, weight: 4.0 },
  { threshold: 35, weight: 2.5 },
  { threshold: 50, weight: 1.0 },
  { threshold: 70, weight: 0.2 },
];

const HUNGER_CURVE = [
  { threshold: 10, weight: 5.0 },
  { threshold: 20, weight: 4.0 },
  { threshold: 35, weight: 2.0 },
  { threshold: 50, weight: 1.0 },
  { threshold: 70, weight: 0.2 },
];

const SOCIAL_CURVE = [
  { threshold: 10, weight: 3.0 },
  { threshold: 25, weight: 2.0 },
  { threshold: 40, weight: 1.0 },
  { threshold: 60, weight: 0.4 },
  { threshold: 80, weight: 0.1 },
];

const HEALTH_CURVE = [
  { threshold: 15, weight: 5.0 },
  { threshold: 30, weight: 3.0 },
  { threshold: 50, weight: 1.5 },
  { threshold: 70, weight: 0.5 },
  { threshold: 85, weight: 0.1 },
];

const MENTAL_CURVE = [
  { threshold: 30, weight: 4.0 },
  { threshold: 45, weight: 2.5 },
  { threshold: 60, weight: 1.5 },
  { threshold: 75, weight: 0.5 },
  { threshold: 90, weight: 0.1 },
];

function pressureCurve(value, curve) {
  for (const entry of curve) {
    if (value <= entry.threshold) return entry.weight;
  }
  return 0;
}

function computeDecisionWeights(needs, character) {
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';

  // If already sleeping or hospitalized, no autonomous decisions
  if (presence === 'sleeping' || presence === 'napping' || presence === 'hospitalized') return null;

  const hygieneW  = pressureCurve(needs.hygiene, HYGIENE_CURVE);
  let   energyW   = pressureCurve(needs.energy,  ENERGY_CURVE);
  const hungerW   = pressureCurve(needs.hunger,  HUNGER_CURVE);
  const socialW   = pressureCurve(needs.social,  SOCIAL_CURVE);
  const healthW   = pressureCurve(needs.health,   HEALTH_CURVE);
  const mentalW   = pressureCurve(needs.mental,   MENTAL_CURVE);

  // ── PASS-OUT LEARNING: PRACTICAL AVOIDANCE, NOT DEPRESSION ────────────
  // A character who passed out remembers it was unpleasant, embarrassing,
  // and physically draining. They become more likely to choose rest earlier
  // when tired because they do not want to repeat the experience.
  //
  // This ONLY affects energy pressure (sleep priority). It does NOT affect
  // mental health, confidence, social confidence, or emotional baseline.
  // This is learned body-signal caution, not depression.
  //
  // Recent pass-out (< 7 days): energy pressure +50%
  // Recent pass-out (< 30 days): energy pressure +30%
  // Repeated pass-outs: +15% per extra pass-out
  // Decay: beyond 30 days, amplification fades to zero
  if (character.last_pass_out_at) {
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const daysSince = (nowET.getTime() - new Date(character.last_pass_out_at).getTime()) / (24 * 3_600_000);
    if (daysSince < 30) {
      let amp = daysSince < 7 ? 1.5 : 1.3;
      const extraCount = Math.max(0, (character.pass_out_count ?? 0) - 1);
      if (extraCount > 0) amp += extraCount * 0.15;
      energyW *= amp;
    }
  }

  return { hygieneW, energyW, hungerW, socialW, healthW, mentalW };
}

/**
 * buildPressureProfile — CORRECTED
 *
 * Needs create PRESSURE. Needs do NOT create actions, destinations, or restrictions.
 *
 * Returns a structured pressure profile indicating which needs are pressing.
 * The profile is a diagnostic input for downstream decision systems.
 * It does NOT prescribe a single action.
 *
 * Pressure thresholds:
 *   > 2.0  = dominant pressure — this need is the loudest
 *   1.0-2.0 = elevated pressure — this need is calling for attention
 *   0.5-1.0 = mild pressure — this need is whispering
 *   < 0.5   = satisfied — no pressure from this need
 *
 * The decision system (autonomousMovement, LLM, etc.) uses this profile
 * alongside personality, relationships, schedules, goals, and context
 * to select appropriate behavior. Different characters with the same
 * pressure profile should make DIFFERENT choices.
 */
function buildPressureProfile(weights) {
  if (!weights) return null;

  const { hygieneW, energyW, hungerW, socialW, healthW, mentalW } = weights;

  const profile = {
    pressures: [
      { need: 'health',  weight: healthW },
      { need: 'energy',  weight: energyW },
      { need: 'hunger',  weight: hungerW },
      { need: 'hygiene', weight: hygieneW },
      { need: 'mental',  weight: mentalW },
      { need: 'social',  weight: socialW },
    ].sort((a, b) => b.weight - a.weight),
    dominant: null,
    elevated: [],
    satisfied: true,
  };

  profile.pressures.forEach(p => {
    if (p.weight > 2.0) {
      profile.dominant = profile.dominant || p.need;
    }
    if (p.weight > 0.5) {
      profile.satisfied = false;
    }
    if (p.weight >= 1.0) {
      profile.elevated.push(p.need);
    }
  });

  return profile;
}

/**
 * resolveNextActivity — CORRECTED
 *
 * Returns a PRESSURE PROFILE, not a single action.
 *
 * The pressure profile tells downstream systems which needs are pressing.
 * It does NOT tell them what to do.
 *
 * Personality-aware evaluation:
 *   - Extroverts amplify social pressure (they feel isolation more acutely)
 *   - Introverts dampen social pressure (solitude is restorative)
 *   - Conscientious characters amplify hygiene/stability pressure
 *   - The pressure is the pressure — the character decides the response
 *
 * The pressure profile includes a `character_factors` diagnostic field
 * showing how personality influenced the pressure calculation.
 */
function resolveNextActivity(needs, character) {
  const weights = computeDecisionWeights(needs, character);
  if (!weights) return null;

  // Apply personality modulation to the raw pressure weights
  const socialEnergy = character.social_energy || 'ambivert';
  const personalityMod = {
    social: 1.0,
    hygiene: 1.0,
    mental: 1.0,
  };

  if (socialEnergy === 'extrovert' || socialEnergy === 'mostly_extrovert') {
    personalityMod.social = 1.3;
  } else if (socialEnergy === 'introvert' || socialEnergy === 'mostly_introvert') {
    personalityMod.social = 0.7;
  }

  if (character.trait_conscientious) {
    personalityMod.hygiene = 1.3;
    personalityMod.mental = 1.2;
  }

  if (character.trait_adaptable) {
    personalityMod.mental = 0.8;
  }

  // Build modulated weights
  const modulated = {
    hygieneW: weights.hygieneW * personalityMod.hygiene,
    energyW:  weights.energyW,
    hungerW:  weights.hungerW,
    socialW:  weights.socialW * personalityMod.social,
    healthW:  weights.healthW,
    mentalW:  weights.mentalW * personalityMod.mental,
  };

  const profile = buildPressureProfile(modulated);

  if (profile) {
    profile.character_factors = {
      social_energy: socialEnergy,
      personality_mod: personalityMod,
    };
  }

  return profile;
}

// ── STALE CORRECTIVE CLEANUP ──────────────────────────────────────────────
// Clears stale corrective activities so character doesn't appear permanently
// "eating" or "sleeping" when they're actually awake.

function resolveStaleCorrectiveActivities(character, needs) {
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';

  const correctivePatterns = [
    'eating — hunger drove them to food',
    'forced sleep — exhausted',
    'forced rest — compound crisis',
    'hospitalized — health collapsed',
    'seeking social contact — isolated too long',
  ];

  const isCorrective = correctivePatterns.some(p => activity.includes(p || activity === p));
  if (!isCorrective) return null;

  // Check if the underlying need has recovered enough to clear the corrective state
  if (activity.includes('eat') && needs.hunger > 40) {
    return { current_activity: '', resolved_presence_status: presence === 'sleeping' ? 'home' : presence };
  }
  if ((activity.includes('forced sleep') || activity.includes('forced rest')) && needs.energy > 50) {
    return { current_activity: '', resolved_presence_status: 'home' };
  }

  // Social corrective cleared once social has recovered enough
  if (activity.includes('seeking social contact') && needs.social > 40) {
    return { current_activity: '' };
  }

  return null;
}

function resolveStaleDecisionIntents(character) {
  // Clear stale decision intents from previous simulation runs
  // Only valid for one tick (5 min), then cleared
  const activity = (character.current_activity || '').toLowerCase();
  if (activity.includes('seek_') && !activity.includes(' — ')) {
    return { current_activity: '' };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════
// SCOPE: Only active_created_character (character_type filter).
// Vick Servicio and other world_service / fictitious NPCs are excluded.
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    // Parse payload for optional ownerEmail override (admin-only testing path)
    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body / GET request */ }
    const ownerEmailOverride = payload.ownerEmail || null;

    // When ownerEmail is provided in payload, use it directly (admin/testing path)
    // Requires authenticated user — ownerEmail alone is not sufficient
    if (!user && !ownerEmailOverride) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = ownerEmailOverride || user?.email;
    const now = new Date();
    const nowIso = now.toISOString();

    // ── LOAD CHARACTERS ──────────────────────────────────────────────────
    // Scope: active_created_character only. NPCs and world-service are excluded.
    // owner_email is NOT used in the filter — legacy records may lack the field.
    // Use non-service-role list() — asServiceRole has known issues in test harness.
    let charFilterError = null;
    const allCharacters = await base44.entities.Character.list(
      null,
      200
    ).catch((err) => { charFilterError = err?.message || 'Unknown filter error'; return []; });

    // Filter in code: active + active_created_character + matching owner_email
    const characters = allCharacters.filter(c =>
      c.status === 'active' &&
      c.character_type === 'active_created_character' &&
      !c.is_world_service &&
      (c.owner_email === ownerEmail || ownerEmailOverride)  // ownerEmailOverride bypasses owner check for admin/testing
    );

    if (characters.length === 0) {
      if (charFilterError) {
        return Response.json({ success: false, simulated: 0, message: 'Character fetch failed — rate limit or API error prevented simulation', error: charFilterError });
      }
      return Response.json({ success: true, simulated: 0, totalLoaded: allCharacters.length, totalFiltered: characters.length, message: 'No matching active_created_characters found', debug: { ownerEmail, ownerEmailOverride: !!ownerEmailOverride, sampleTypes: [...new Set(allCharacters.slice(0, 20).map(c => c.character_type))], sampleStatuses: [...new Set(allCharacters.slice(0, 20).map(c => c.status))] }});
    }

    // ── LOAD LOCATION MAP ────────────────────────────────────────────────
    // Legacy records may lack owner_email — load all, scope in loop
    let locFilterError = null;
    const locations = await base44.entities.LocationReference.list(
      null,
      200
    ).catch((err) => { locFilterError = err?.message || 'Unknown location filter error'; return []; });

    const locationMap = {};
    for (const loc of locations) {
      locationMap[loc.id] = loc;
    }

    const results = [];

    // ═══════════════════════════════════════════════════════════════════════
    // PER-CHARACTER SIMULATION LOOP
    // ═══════════════════════════════════════════════════════════════════════
    for (const char of characters) {
      try {
        const charName = char.name || char.display_name || char.id;

        // ── WORLD SERVICE GUARD ──────────────────────────────────────────
        // World service characters (Vick Servicio, etc.) are not simulated
        // here — they are managed by their own dedicated pipelines.
        // is_world_service flag is the authoritative marker — character_type
        // or legacy type fields may disagree but the flag controls exclusion.
        if (char.is_world_service) {
          continue;
        }

        // ── SKIP LOCKED CHARACTERS ───────────────────────────────────────
        // Diagnostic/test characters are excluded from simulation.
        if (char.is_test_character || char.diagnostic_only) {
          continue;
        }

        // ── SKIP INCARCERATED ────────────────────────────────────────────
        // Incarcerated characters have their own needs pipeline.
        if (char.is_jailed || char.resolved_presence_status === 'incarcerated') {
          continue;
        }

        // ── FIRST-TIME INITIALIZATION ────────────────────────────────────
        let needs = getNeedsFromCharacter(char);
        if (needsAreUninitialized(needs) || !char.needs_initialized) {
          await base44.entities.Character.update(char.id, {
            hunger_value:  70,
            energy_value:  75,
            social_value:  65,
            health_value:  80,
            mental_value:  70,
            hygiene_value: 75,
            comfort_value: 70,
            financial_need_value: deriveFinancialNeed(char),
            needs_initialized: true,
            last_need_simulated_at: nowIso,
          });
          results.push({ character: charName, status: 'initialized' });
          continue;
        }

        // ── ELAPSED TIME ─────────────────────────────────────────────────
        const lastSim = char.last_need_simulated_at
          ? new Date(char.last_need_simulated_at).getTime()
          : Date.now();
        const elapsedMs = now.getTime() - lastSim;

        // RC5: Cap elapsed time at 8 hours
        const elapsedHours = Math.min(elapsedMs / (1000 * 60 * 60), 8);

        // Skip if too recent (less than ~3 minutes)
        if (elapsedHours < 0.05) {
          results.push({ character: charName, status: 'skipped', reason: 'too_recent', elapsed_minutes: Math.round(elapsedHours * 60) });
          continue;
        }

        // ── VICK LOCKED HUNGER/SLEEP ─────────────────────────────────────
        // If Vick has explicitly locked hunger or sleep for this character,
        // those values are frozen — no decay, no recovery.
        // Energy is still simulated if sleep_lock is off.
        const hungerLocked = char.hunger_lock === true;
        const sleepLocked  = char.sleep_lock  === true;

        // ── RESOLVE CONTEXT ───────────────────────────────────────────────
        const context = getLocationContext(char, locationMap, now);

        // ── HOME FOOD CONSUMPTION ─────────────────────────────────────────
        // When character is at home and hungry, consume food from HouseholdResource
        // before applying rates. Snack=0.5 serving(+16.5 hunger), Meal=1 serving(+33 hunger).
        // Does NOT create a financial charge — food was already purchased.
        if (!hungerLocked && (context === 'home_resting' || context === 'home_active') &&
            (needs.hunger ?? 70) < 50 && char.current_home_location_id) {
          try {
            const hrArr = await base44.entities.HouseholdResource.filter(
              { owner_email: ownerEmail, home_location_id: char.current_home_location_id, resource_type: 'food' }, null, 1
            ).catch(() => []);
            const hr = hrArr[0];
            const foodAvailable = hr ? (hr.home_food_value || 0) : 0;

            if (foodAvailable > 0) {
              // Determine meal vs snack based on hunger severity
              const isMeal = (needs.hunger ?? 70) < 30;
              const consumed = isMeal ? 1 : 0.5;
              const hungerRestore = isMeal ? 33 : 16.5;
              const actualConsumed = Math.min(consumed, foodAvailable);
              const newFood = Math.max(0, Math.round((foodAvailable - actualConsumed) * 100) / 100);

              // Update HouseholdResource
              await base44.entities.HouseholdResource.update(hr.id, {
                home_food_value: newFood,
                last_consumed_at: nowIso,
              }).catch(() => {});

              // Apply hunger restoration directly
              needs.hunger = clamp((needs.hunger ?? 70) + (actualConsumed / consumed) * hungerRestore);

              results.push({
                character: charName,
                event: isMeal ? 'home_meal_consumed' : 'home_snack_consumed',
                food_consumed: actualConsumed,
                food_remaining: newFood,
                hunger_before: char.hunger_value ?? 70,
                hunger_after: Math.round(needs.hunger),
              });
            }
          } catch (e) {
            // Non-fatal — fall through to normal rate application
          }
        }

        // ── RC2: PASS-OUT DETECTION (energy ≤ ENERGY_PASSOUT) ────────────
        // Character collapses from exhaustion. Written BEFORE the normal
        // rate application so the NEXT tick uses passed_out rates (+8/hr).
        const energyBefore = char.energy_value ?? 75;
        if (energyBefore <= T.ENERGY_PASSOUT && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'passed_out'
            && !sleepLocked) {
          // ── PASS-OUT RECOVERY CORRECTION ──────────────────────────
          // Pass-out is forced sleep the body demands after the character
          // failed to choose sleep voluntarily. It IS rest — energy MUST
          // recover using sleeping rates on subsequent ticks. It is NOT
          // a permanent zero-energy state and must NOT bounce to awake.
          //
          // Stay lock prevents other automations from clearing this state
          // before recovery begins. Release condition: energy > 35.
          //
          // Pass-out tracking: last_pass_out_at and pass_out_count record
          // the event so future sleep decisions amplify pressure — the
          // character remembers this was unpleasant and avoids repeating.
          const passOutCount = (char.pass_out_count ?? 0) + 1;
          await base44.entities.Character.update(char.id, {
            resolved_presence_status: 'sleeping',
            current_activity: 'passed out — resting',
            last_sleep_start: nowIso,
            last_need_simulated_at: nowIso,
            last_pass_out_at: nowIso,
            pass_out_count: passOutCount,
            // Stay lock: block other automations from clearing pass-out recovery
            presence_stay_lock: true,
            presence_stay_lock_reason: 'pass_out_recovery',
            presence_stay_lock_authority: 'simulateActiveCharacterNeeds',
            presence_stay_lock_set_at: nowIso,
            presence_stay_lock_created_by: 'system_automation',
            presence_stay_lock_release_condition: 'energy_above_35',
            // Needs values: write current state so next tick has consistent data
            hunger_value:  Math.round(needs.hunger ?? 70),
            energy_value:  Math.round(energyBefore),
            social_value:  Math.round(needs.social ?? 65),
            health_value:  Math.round(needs.health ?? 80),
            mental_value:  Math.round(needs.mental ?? 70),
            hygiene_value: Math.round(needs.hygiene ?? 75),
            comfort_value: Math.round(needs.comfort ?? 70),
          });
          // ── PASS-OUT CONSEQUENCES ─────────────────────────────────
          // Pass-out is not neutral rest — it has real consequences.
          // The character collapsed involuntarily due to ignored exhaustion.
          // These consequences are recorded so the character remembers
          // and future sleep decisions treat exhaustion more seriously.
          await base44.entities.LifeEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'medical_event',
            valence: 'negative',
            severity: 'major',
            title: 'Passed out from exhaustion',
            description: `${charName} collapsed from complete energy depletion. Energy was at ${Math.round(energyBefore)} when their body forced sleep. They will wake groggy, embarrassed, and with lowered comfort. This is their ${passOutCount === 1 ? 'first' : passOutCount === 2 ? 'second' : `${passOutCount}rd`} pass-out event — each one makes future exhaustion feel more threatening.`,
            emotional_impact: 'physical collapse, embarrassment, loss of control',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
            context_tags: ['passed_out', 'forced_sleep', passOutCount > 1 ? 'repeat_pass_out' : 'first_pass_out'],
          }).catch(() => {});

          // ── PASS-OUT BEHAVIORAL MEMORY ───────────────────────────
          // CharacterMemory records the experience so the character
          // learns from it. Future sleep pressure is amplified when
          // energy gets low because they remember pass-out was bad.
          await base44.entities.CharacterMemory.create({
            character_id: char.id,
            memory_type: 'event',
            memory_text: `${charName} passed out from exhaustion when their energy dropped to ${Math.round(energyBefore)}. They collapsed involuntarily — their body forced sleep because they ignored exhaustion too long. The experience was physically draining, embarrassing, and emotionally stressful. They remember how bad it felt and do not want to repeat it.`,
            memory_summary: `Passed out at energy ${Math.round(energyBefore)} — body forced sleep. Unpleasant, embarrassing, physically draining.`,
            importance_score: 8,
            permanence: 'long_term',
            related_character_id: char.id,
          }).catch(() => {});

          results.push({
            character: charName,
            context: 'passed_out',
            event: 'pass_out',
            needs: {
              hunger:  Math.round(needs.hunger ?? 70),
              energy:  Math.round(energyBefore),
              social:  Math.round(needs.social ?? 65),
              health:  Math.round(needs.health ?? 80),
              mental:  Math.round(needs.mental ?? 70),
              hygiene: Math.round(needs.hygiene ?? 75),
              comfort: Math.round(needs.comfort ?? 70),
            },
          });
          continue;
        }

        // ── APPLY TIME-BASED RATES ────────────────────────────────────────
        let newNeeds = applyElapsedTime(needs, elapsedHours, context);

        // ── VICK HUNGER/SLEEP LOCK OVERRIDE ──────────────────────────────
        // If Vick locked hunger, restore original value — no decay.
        if (hungerLocked || char.needs_locks?.hunger) {
          newNeeds.hunger = needs.hunger ?? 70;
        }
        // If Vick locked sleep, restore original energy — no decay or recovery.
        if (sleepLocked || char.needs_locks?.energy) {
          newNeeds.energy = needs.energy ?? 75;
        }

        if(char.needs_locks?.hygiene) newNeeds.hygiene = needs.hygiene ?? 75;
        if(char.needs_locks?.comfort) newNeeds.comfort = needs.comfort ?? 70;
        if(char.needs_locks?.social) newNeeds.social = needs.social ?? 65;
        if(char.needs_locks?.mental) newNeeds.mental = needs.mental ?? 70;
        if(char.needs_locks?.health) newNeeds.health = needs.health ?? 80;

        // SOCIAL FULFILLMENT MODEL: Social measures fulfillment, not current activity.
        // A bartender who worked 8h with customers is socially fulfilled (+3/hr → +24/shift).
        // A character resting at home after a social day does NOT lose social (rate=0).
        // Social only decays during genuine isolation — extended solitude with zero interaction.
        // Being home ≠ antisocial. Being in public ≠ automatically social.
        // Social and Energy are independent: a character can be fulfilled AND tired.

        // ── RC5: CASCADE INFECTION ────────────────────────────────────────
        newNeeds = applyStatInfection(newNeeds, elapsedHours);

        // ── MENTAL MODIFIER ───────────────────────────────────────────────
        if (!hungerLocked) {
          const mentalMod = computeMentalModifier(char, context, locationMap);
          newNeeds.mental = clamp(newNeeds.mental + mentalMod * elapsedHours);
        }

        // ── COMFORT MODIFIER ──────────────────────────────────────────────
        const comfortMod = computeComfortModifier(char, context, locationMap);
        newNeeds.comfort = clamp(newNeeds.comfort + comfortMod * elapsedHours);

        // ── PRESENCE STAY LOCK ────────────────────────────────────────────
        // If character has a stay lock (user chose STAY at scene exit),
        // the resolved location is frozen — do not override presence.
        const hasStayLock = char.presence_stay_lock === true;

        let nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

        // ── HARD SLEEP & NAP CAPS + 19-HOUR AWAKE ENFORCEMENT ─────────────
        // CRITICAL: Sleep and nap timestamps are tracked separately.
        // last_sleep_start → only for actual sleep (resolved_presence_status='sleeping')
        // last_nap_time   → only for naps (resolved_presence_status='napping')
        // The 19-hour awake timer uses last_sleep_start ONLY — naps do NOT reset it.
        // ─────────────────────────────────────────────────────────────────────

        const dbIsSleeping = char.resolved_presence_status === 'sleeping';
        const dbIsNapping  = char.resolved_presence_status === 'napping';

        // ── HARD 8-HOUR SLEEP CAP ──────────────────────────────────────────
        // Uses last_sleep_start ONLY. Generic timestamps are NEVER sleep-start evidence.
        // If last_sleep_start is missing, this is a state violation — apply safe correction
        // by setting last_sleep_start=now (resets the 8h timer, conservative but safe).
        if (dbIsSleeping && char.resolved_presence_status !== 'passed_out'
            && char.resolved_presence_status !== 'hospitalized' && !sleepLocked) {
          if (char.last_sleep_start) {
            const sleepStartMs = new Date(char.last_sleep_start).getTime();
            const sleepDurationHours = (nowET.getTime() - sleepStartMs) / 3_600_000;
            if (sleepDurationHours >= 8) {
              const wakePayload = {
                resolved_presence_status: 'home',
                current_activity: '',
                last_wake_time: nowIso,
                hunger_value:  Math.round(newNeeds.hunger),
                energy_value:  Math.round(newNeeds.energy),
                social_value:  Math.round(newNeeds.social),
                health_value:  Math.round(newNeeds.health),
                mental_value:  Math.round(newNeeds.mental),
                hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort),
                last_need_simulated_at: nowIso,
              };
              await base44.entities.Character.update(char.id, wakePayload);
              results.push({
                character: charName, context,
                event: 'hard_8h_sleep_wake',
                sleep_duration_hours: Math.round(sleepDurationHours * 100) / 100,
                needs: {
                  hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy),
                  social: Math.round(newNeeds.social), health: Math.round(newNeeds.health),
                  mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene),
                  comfort: Math.round(newNeeds.comfort),
                },
              });
              continue;
            }
          } else {
            // Safe correction: set last_sleep_start directly (before updatePayload is built)
            await base44.entities.Character.update(char.id, {
              last_sleep_start: nowIso,
              last_need_simulated_at: nowIso,
            });
            base44.entities.LifeEvent.create({
              character_id: char.id, character_name: charName,
              event_type: 'medical_event', valence: 'neutral', severity: 'significant',
              title: 'Missing last_sleep_start — safe correction applied',
              description: `${charName} is sleeping but missing last_sleep_start. Set to now (${nowIso}) as safe correction. Prior writer failed to record sleep-start evidence.`,
              emotional_impact: 'system diagnostic',
              triggered_by: 'life_simulation',
              timestamp: nowIso,
              context_tags: ['missing_timestamp', 'last_sleep_start', 'simulateActiveCharacterNeeds'],
            }).catch(() => {});
          }
        }

        // ── HARD 3-HOUR NAP CAP ───────────────────────────────────────────
        // Uses last_nap_time ONLY. If missing, state violation — apply safe
        // correction by setting last_nap_time=now (resets timer, conservative).
        // Naps do NOT write last_wake_time — nap end is not an actual-sleep wake.
        if (dbIsNapping) {
          if (char.last_nap_time) {
            const napStartMs = new Date(char.last_nap_time).getTime();
            const napDurationHours = (nowET.getTime() - napStartMs) / 3_600_000;
            if (napDurationHours >= 3) {
              const napWakePayload = {
                resolved_presence_status: 'home',
                current_activity: '',
                hunger_value:  Math.round(newNeeds.hunger),
                energy_value:  Math.round(newNeeds.energy),
                social_value:  Math.round(newNeeds.social),
                health_value:  Math.round(newNeeds.health),
                mental_value:  Math.round(newNeeds.mental),
                hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort),
                last_need_simulated_at: nowIso,
              };
              await base44.entities.Character.update(char.id, napWakePayload);
              results.push({
                character: charName, context,
                event: 'hard_3h_nap_wake',
                nap_duration_hours: Math.round(napDurationHours * 100) / 100,
                needs: {
                  hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy),
                  social: Math.round(newNeeds.social), health: Math.round(newNeeds.health),
                  mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene),
                  comfort: Math.round(newNeeds.comfort),
                },
              });
              continue;
            }
          } else {
            // Safe correction: set last_nap_time directly (before updatePayload is built)
            await base44.entities.Character.update(char.id, {
              last_nap_time: nowIso,
              last_need_simulated_at: nowIso,
            });
            base44.entities.LifeEvent.create({
              character_id: char.id, character_name: charName,
              event_type: 'medical_event', valence: 'neutral', severity: 'significant',
              title: 'Missing last_nap_time — safe correction applied',
              description: `${charName} is napping but missing last_nap_time. Set to now (${nowIso}) as safe correction. Prior writer failed to record nap-start evidence.`,
              emotional_impact: 'system diagnostic',
              triggered_by: 'life_simulation',
              timestamp: nowIso,
              context_tags: ['missing_timestamp', 'last_nap_time', 'simulateActiveCharacterNeeds'],
            }).catch(() => {});
          }
        }

        // ── 19-HOUR AWAKE ENFORCEMENT ─────────────────────────────────────
        // Uses last_wake_time ONLY — marks when character last completed actual
        // sleep (not nap). Naps do NOT reset this timer. If last_wake_time is
        // missing, state violation — apply safe correction by setting
        // last_wake_time=now (assumes they just woke, giving a full 19h window).
        if (!dbIsSleeping && !dbIsNapping && char.resolved_presence_status !== 'passed_out'
            && char.resolved_presence_status !== 'hospitalized' && !sleepLocked && !hasStayLock) {
          if (char.last_wake_time) {
            const lastWakeMs = new Date(char.last_wake_time).getTime();
            const awakeHours = (nowET.getTime() - lastWakeMs) / 3_600_000;
            if (awakeHours >= 19) {
              // ── 19-HOUR FORCED EXHAUSTION = PASS-OUT / FORCED RECOVERY ────────
              // A character awake for 19+ hours has hit the biological limit.
              // This is NOT a chosen sleep — it is the same consequence as pass-out.
              // Treat it identically: record last_pass_out_at, increment pass_out_count,
              // write CharacterMemory, set stay lock, and redirect to assigned home.
              // The user-facing distinction must be preserved: current_activity = 'passed out — forced exhaustion'
              // NOT 'sleeping — bedtime'. This is a collapse, not a choice.
              const passOutCount19h = (char.pass_out_count ?? 0) + 1;

              // ── HOME PRIORITY: redirect to assigned home before sleeping ──────
              // A character who collapses from exhaustion should be found at home,
              // not wherever they happened to be (park, street, random location).
              // Only redirect if they have an assigned home and are NOT already home.
              const homeLocId = char.current_home_location_id;
              const isAlreadyAtHome = char.resolved_current_location_id === homeLocId ||
                (char.resolved_location_type || '').toLowerCase() === 'home' ||
                char.resolved_presence_status === 'home';
              const homeRedirectFields = (homeLocId && !isAlreadyAtHome) ? {
                resolved_current_location_id: homeLocId,
                resolved_location_type: 'home',
                resolved_presence_status: 'home', // will be overwritten to sleeping below
              } : {};

              const awakeLimitPayload = {
                ...homeRedirectFields,
                resolved_presence_status: 'sleeping',
                current_activity: 'passed out — forced exhaustion (19-hour limit)',
                last_sleep_start: nowIso,
                last_pass_out_at: nowIso,
                pass_out_count: passOutCount19h,
                // Stay lock: prevent other automations from clearing recovery
                presence_stay_lock: true,
                presence_stay_lock_reason: 'pass_out_recovery',
                presence_stay_lock_authority: 'simulateActiveCharacterNeeds',
                presence_stay_lock_set_at: nowIso,
                presence_stay_lock_created_by: 'system_automation',
                presence_stay_lock_release_condition: 'energy_above_35',
                hunger_value:  Math.round(newNeeds.hunger),
                energy_value:  Math.round(newNeeds.energy),
                social_value:  Math.round(newNeeds.social),
                health_value:  Math.round(newNeeds.health),
                mental_value:  Math.round(newNeeds.mental),
                hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort),
                last_need_simulated_at: nowIso,
              };
              await base44.entities.Character.update(char.id, awakeLimitPayload);

              await base44.entities.LifeEvent.create({
                character_id: char.id, character_name: charName,
                event_type: 'sleep_deprivation_event', valence: 'negative', severity: 'significant',
                title: 'Passed out — 19-hour forced exhaustion',
                description: `${charName} was awake for ${Math.round(awakeHours)} hours and collapsed from exhaustion. Their body forced sleep — this was not a choice. This is their ${passOutCount19h === 1 ? 'first' : passOutCount19h === 2 ? 'second' : `${passOutCount19h}th`} pass-out event.${homeLocId && !isAlreadyAtHome ? ' Returned to assigned home for recovery.' : ''}`,
                emotional_impact: 'forced collapse, embarrassment, loss of control', triggered_by: 'life_simulation',
                timestamp: nowIso, context_tags: ['awake_limit', 'passed_out', 'forced_exhaustion', passOutCount19h > 1 ? 'repeat_pass_out' : 'first_pass_out'],
              }).catch(() => {});

              // CharacterMemory: 19h pass-out increases future sleep pressure identically to energy pass-out
              await base44.entities.CharacterMemory.create({
                character_id: char.id,
                memory_type: 'event',
                memory_text: `${charName} stayed awake for over ${Math.round(awakeHours)} hours and collapsed from exhaustion — their body forced sleep. This was not voluntary. The experience was draining, embarrassing, and physically difficult. They do not want to repeat it. They should sleep earlier when tired rather than pushing past their limit.`,
                memory_summary: `Passed out at ${Math.round(awakeHours)}h awake — forced exhaustion, not voluntary sleep.`,
                importance_score: 8,
                permanence: 'long_term',
                related_character_id: char.id,
              }).catch(() => {});

              results.push({
                character: charName, context,
                event: '19h_pass_out_forced_exhaustion',
                awake_hours: Math.round(awakeHours * 100) / 100,
                home_redirected: !!(homeLocId && !isAlreadyAtHome),
                pass_out_count: passOutCount19h,
                needs: {
                  hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy),
                  social: Math.round(newNeeds.social), health: Math.round(newNeeds.health),
                  mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene),
                  comfort: Math.round(newNeeds.comfort),
                },
              });
              continue;
            }
          } else {
            // Safe correction: set last_wake_time directly (before updatePayload is built)
            await base44.entities.Character.update(char.id, {
              last_wake_time: nowIso,
              last_need_simulated_at: nowIso,
            });
            base44.entities.LifeEvent.create({
              character_id: char.id, character_name: charName,
              event_type: 'medical_event', valence: 'neutral', severity: 'significant',
              title: 'Missing last_wake_time — safe correction applied',
              description: `${charName} is awake but missing last_wake_time. Set to now (${nowIso}) as safe correction. Prior wake writer failed to record wake evidence.`,
              emotional_impact: 'system diagnostic',
              triggered_by: 'life_simulation',
              timestamp: nowIso,
              context_tags: ['missing_timestamp', 'last_wake_time', 'simulateActiveCharacterNeeds'],
            }).catch(() => {});
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // BUILD UPDATE PAYLOAD
        // ═══════════════════════════════════════════════════════════════════
        const updatePayload = {
          hunger_value:  Math.round(newNeeds.hunger),
          energy_value:  Math.round(newNeeds.energy),
          social_value:  Math.round(newNeeds.social),
          health_value:  Math.round(newNeeds.health),
          mental_value:  Math.round(newNeeds.mental),
          hygiene_value: Math.round(newNeeds.hygiene),
          comfort_value: Math.round(newNeeds.comfort),
          last_need_simulated_at: nowIso,
        };

        // ── RC1: CORRECTIVE ACTIVITY WRITER ───────────────────────────────
        // When needs cross critical thresholds during simulation, write
        // corrective states so the NEXT tick uses recovery rates.
        const corrective = computeCorrectiveState(newNeeds, char, locationMap);
        if (corrective) {
          Object.assign(updatePayload, corrective);
          // Write sleep/nap timestamp and stay lock for authoritative state transitions
          if (corrective.resolved_presence_status === 'sleeping' || corrective.resolved_presence_status === 'napping') {
            if (corrective.resolved_presence_status === 'sleeping') {
              updatePayload.last_sleep_start = nowIso;
              updatePayload.presence_stay_lock_reason = "sleep_state";
            } else {
              updatePayload.last_nap_time = nowIso;
              updatePayload.presence_stay_lock_reason = "nap_state";
            }
            updatePayload.presence_stay_lock = true;
            updatePayload.presence_stay_lock_authority = "simulateActiveCharacterNeeds";
            updatePayload.presence_stay_lock_set_at = nowIso;
            updatePayload.presence_stay_lock_created_by = "system_automation";
          }
        }

        // ── RC2 (continued): ENERGY ZERO → PASSED OUT ────────────────────
        // If energy reached zero during this simulation tick, character
        // collapses. Write presence and activity immediately.
        if (newNeeds.energy <= 0 && !sleepLocked && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'passed_out') {
          Object.assign(updatePayload, {
            resolved_presence_status: 'sleeping',
            current_activity: 'passed out — resting',
            last_sleep_start: nowIso,
          });
        }

        // ── RC3: ER ESCALATION — HEALTH COLLAPSE ─────────────────────────
        // When health ≤ HEALTH_ER (15) OR compound crisis with health ≤ 20,
        // create a ScheduledEvent for medical intervention and write
        // hospitalized presence.
        const compoundCrisisHealth = newNeeds.health <= T.HEALTH_CRITICAL &&
          [newNeeds.hunger, newNeeds.energy, newNeeds.health]
            .filter(v => v < T.HEALTH_CRITICAL).length >= 2;

        if ((newNeeds.health <= T.HEALTH_ER || compoundCrisisHealth)
            && char.resolved_presence_status !== 'hospitalized') {
          // Write hospitalized state — medical recovery, NOT sleep.
          // Do NOT write last_sleep_start here. Hospitalization is not ordinary sleep
          // and must not reset the 19h awake timer nor confuse sleep cap logic.
          Object.assign(updatePayload, {
            resolved_presence_status: 'hospitalized',
            current_activity: 'hospitalized — health collapsed',
          });

          // Create a ScheduledEvent for the hospital recovery
          await base44.entities.ScheduledEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'medical_emergency',
            title: 'Emergency hospitalization',
            description: `${charName} was hospitalized due to critical health collapse (health: ${Math.round(newNeeds.health)})`,
            scheduled_time: nowIso,
            status: 'active',
            owner_email: ownerEmail,
          }).catch(() => {});

          // Log the ER escalation
          await base44.entities.LifeEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'medical_event',
            valence: 'negative',
            severity: 'major',
            title: 'Emergency hospitalization',
            description: `${charName} was rushed to the hospital — health collapsed to ${Math.round(newNeeds.health)}.`,
            emotional_impact: 'critical medical event',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
            context_tags: ['er_escalation', 'hospitalized'],
          }).catch(() => {});
        }

        // ── RC4: COMPOUND CRISIS — FORCED STABILIZATION ───────────────────
        // 3+ needs below 20 triggers forced rest and a recovery event.
        const criticalNeeds = [newNeeds.hunger, newNeeds.energy, newNeeds.health, newNeeds.social, newNeeds.mental]
          .filter(v => v < T.HUNGER_CRITICAL).length;
        if (criticalNeeds >= T.COMPOUND_CRISIS
            && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'hospitalized'
            && !sleepLocked) {
          Object.assign(updatePayload, {
            resolved_presence_status: 'sleeping',
            current_activity: 'forced rest — compound crisis',
            last_sleep_start: nowIso,
          });

          // Create recovery ScheduledEvent
          await base44.entities.ScheduledEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'compound_crisis_recovery',
            title: 'Compound crisis — forced rest',
            description: `${charName} was put to rest — ${criticalNeeds} needs below critical threshold.`,
            scheduled_time: nowIso,
            status: 'active',
            owner_email: ownerEmail,
          }).catch(() => {});

          await base44.entities.LifeEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'medical_event',
            valence: 'negative',
            severity: 'major',
            title: 'Compound crisis — forced rest',
            description: `${charName}'s body gave out — ${criticalNeeds} needs were critical. Forced to rest.`,
            emotional_impact: 'physical collapse',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
            context_tags: ['compound_crisis'],
          }).catch(() => {});
        }

        // ── PASS-OUT STAY LOCK RELEASE ────────────────────────────────────
        // Pass-out locks the character in sleeping state for recovery.
        // When energy recovers above 35, the body has enough reserves to
        // function — release the lock so natural wake/sleep rules apply.
        if (char.presence_stay_lock &&
            char.presence_stay_lock_reason === 'pass_out_recovery' &&
            newNeeds.energy > 35) {
          Object.assign(updatePayload, {
            presence_stay_lock: false,
            presence_stay_lock_reason: null,
            presence_stay_lock_release_condition: null,
          });
        }

        // ── STALE CORRECTIVE CLEANUP ───────────────────────────────────────
        const staleCleanup = resolveStaleCorrectiveActivities(char, newNeeds);
        if (staleCleanup) {
          Object.assign(updatePayload, staleCleanup);
        }

        const staleIntent = resolveStaleDecisionIntents(char);
        if (staleIntent) {
          Object.assign(updatePayload, staleIntent);
        }

        // ── RC6: ALWAYS USE asServiceRole FOR WRITES ──────────────────────
        await base44.entities.Character.update(char.id, updatePayload);

        // ── CRITICAL ESCALATION LOGGING ────────────────────────────────────
        const escalations = detectCriticalEscalations(needs, newNeeds, charName);
        for (const esc of escalations) {
          await base44.entities.LifeEvent.create({
            character_id: char.id,
            character_name: charName,
            event_type: 'medical_event',
            valence: 'negative',
            severity: 'significant',
            title: esc.title,
            description: esc.description,
            emotional_impact: 'physical distress',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
            context_tags: [esc.memory_tag],
          }).catch(() => {});
        }

        // ── FINANCIAL NEED DERIVATION ──────────────────────────────────────
        updatePayload.financial_need_value = deriveFinancialNeed(char);

        // ── AUTONOMOUS DECISION INTENT ────────────────────────────────────
        const nextActivity = resolveNextActivity(newNeeds, char);
        const isCorrectiveActive = corrective &&
          (corrective.current_activity || '').includes(' — ');

        results.push({
          character: charName,
          context,
          needs: {
            hunger:  Math.round(newNeeds.hunger),
            energy:  Math.round(newNeeds.energy),
            social:  Math.round(newNeeds.social),
            health:  Math.round(newNeeds.health),
            mental:  Math.round(newNeeds.mental),
            hygiene: Math.round(newNeeds.hygiene),
            comfort: Math.round(newNeeds.comfort),
          },
          corrective_applied: corrective ? Object.keys(corrective) : null,
          escalations: escalations.length,
          pressure_profile: nextActivity,
          stale_corrective_cleared: staleCleanup ? Object.keys(staleCleanup) : null,
          elapsed_hours: Math.round(elapsedHours * 100) / 100,
        });

        // Throttle between characters
        await new Promise(r => setTimeout(r, 200));
      } catch (charError) {
        console.error(`[simulateActiveCharacterNeeds] Error for ${char.name || char.id}: ${charError.message}`);
        results.push({ character: char.name || char.id, status: 'error', error: charError.message });
      }
    }

    return Response.json({
      success: true,
      simulated: results.filter(r => r.status !== 'error' && r.status !== 'skipped').length,
      ownerEmail,
      timestamp: nowIso,
      results,
    });

  } catch (error) {
    console.error(`[simulateActiveCharacterNeeds] Fatal: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});