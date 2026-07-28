import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

// simulateActiveCharacterNeeds — needs/sleep simulation.
// Every state transition (sleep/nap/pass_out/hospitalized) is atomic:
// Character write + SleepTransition proof record both succeed or the
// Character write is reverted. Consequences (LifeEvent/CharacterMemory/
// ScheduledEvent) only fire after the proof record is confirmed.

// ═══════════════════════════════════════════════════════════════════════
// MANDATORY TEMPORARY SHUTDOWN — EXHAUSTION & 19-HOUR PASS-OUT
// Both prohibited categories are disabled until the user explicitly
// authorizes reactivation. Energy and awake-time values continue to
// calculate and display normally, but reaching the former thresholds
// must NOT change presence, activity, location, sleep, wake, health,
// or recovery state.
//
// DISABLED (blocked at every execution boundary in this function):
//   1. Energy-threshold pass-out (energy ≤ ENERGY_PASSOUT or energy ≤ 0)
//   2. 19-hour-awake pass-out (continuous awake ≥ 19 hours)
//
// PRESERVED (unrelated causes, NOT blocked):
//   - Compound crisis pass-out (3+ needs below 20 — separate cause)
//   - Hospitalization (energy ≤ ENERGY_MEDICAL — medical, not pass-out)
//   - All ordinary sleep, nap, wake, work, school, travel systems
//   - Recovery from pass-outs that occurred BEFORE this shutdown
// ═══════════════════════════════════════════════════════════════════════
const PASSOUT_EXHAUSTION_DISABLED = true;
const PASSOUT_19HOUR_DISABLED = true;

const clamp = (v) => Math.max(0, Math.min(100, v));

// ── RATES ──────────────────────────────────────────────────────────────────
// sleeping +12.5/hr (voluntary, 8h cap) vs passed_out +8/hr (involuntary
// collapse, 12h cap, never becomes 'sleeping') vs hospitalized +4/hr.
// Awake contexts never restore energy. Social measures fulfillment, not
// activity — it gains from interaction and only decays during isolation.
const RATES = {
  // VOLUNTARY sleep: chosen rest, full restorative rate, normal sleep cap (8h), normal wake logic.
  sleeping:        { hunger: -1,   energy: +12.5, social:  0,   health: +0.5, mental: +3,   hygiene: 0,    comfort: +4   },
  // INVOLUNTARY collapse: passed_out is NOT sleeping. Distinct rate (+8 NOT +12.5), distinct cap (12h),
  // distinct completion (energy > 35 OR 12h → home, NEVER → sleeping), distinct event/memory records.
  passed_out:      { hunger: -0.5, energy: +8.0,  social:  0,   health: +0.5, mental: +0.5, hygiene: 0,    comfort: +1   },
  // NOTE: The former `hospitalized` recurring rate has been REMOVED from this table.
  // Those values are now one-time stabilization amounts applied exclusively at
  // admission by enforceCharacterLocationPresence (HOSPITAL_STABILIZATION).
  // This table no longer contains a hospitalization entry — elapsed-time
  // processing cannot apply it. Hospitalized characters recover through
  // existing activity contexts (sleeping, resting, eating) resolved by
  // getLocationContext, not through a hospitalized rate.
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
  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const [sh, sm = 0] = character.work_start_time.split(':').map(Number);
    const [eh, em = 0] = character.work_end_time.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin < startMin) {
      // Overnight interval — crosses midnight. The shift starts on the day
      // listed in work_days and continues past midnight into the next day.
      if (cur >= startMin && character.work_days.includes(dow)) return true;
      if (cur < endMin && character.work_days.includes((dow + 6) % 7)) return true;
    } else {
      if (cur >= startMin && cur < endMin && character.work_days.includes(dow)) return true;
    }
  }

  // SOURCE 2: additional_occupation_locations — check location-side worker_shifts[char.id]
  if (Array.isArray(character.additional_occupation_locations) && locationMap) {
    const prevDow = (dow + 6) % 7;
    for (const entry of character.additional_occupation_locations) {
      if (!entry.location_id) continue;
      const loc = locationMap[entry.location_id];
      if (!loc) continue;
      const shift = loc.worker_shifts?.[character.id];
      if (shift?.start && shift?.end) {
        const [sh, sm = 0] = shift.start.split(':').map(Number);
        const [eh, em = 0] = shift.end.split(':').map(Number);
        const sMin = sh * 60 + sm;
        const eMin = eh * 60 + em;
        const shiftDays = Array.isArray(shift.days) && shift.days.length > 0 ? shift.days : null;
        if (eMin < sMin) {
          if (cur >= sMin && (!shiftDays || shiftDays.includes(dow))) return true;
          if (cur < eMin && (!shiftDays || shiftDays.includes(prevDow))) return true;
        } else {
          if (cur >= sMin && cur < eMin && (!shiftDays || shiftDays.includes(dow))) return true;
        }
      }
      if (!loc.worker_shifts?.[character.id] && entry.work_start_time && entry.work_end_time && Array.isArray(entry.work_days) && entry.work_days.length > 0) {
        const [sh, sm = 0] = entry.work_start_time.split(':').map(Number);
        const [eh, em = 0] = entry.work_end_time.split(':').map(Number);
        const sMin = sh * 60 + sm;
        const eMin = eh * 60 + em;
        if (eMin < sMin) {
          if (cur >= sMin && entry.work_days.includes(dow)) return true;
          if (cur < eMin && entry.work_days.includes(prevDow)) return true;
        } else {
          if (cur >= sMin && cur < eMin && entry.work_days.includes(dow)) return true;
        }
      }
    }
  }

  return false;
}

// ── LIVE SCHOOL-SESSION AUTHORITY ─────────────────────────────────────────
// Mirrors the canonical resolution in src/lib/schoolScheduleResolver.js
// (resolveSchoolSchedule): enrollment override → school location operating
// hours → unresolved. A persisted 'at_school' presence label is NOT schedule
// authority — a character may live at a school location and be outside class
// hours. This function returns true ONLY when the current Eastern Time falls
// within the resolved live school session window.
function isInSchoolSession(character, locationMap) {
  if (!character || character.student_status !== 'enrolled') return false;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cur = nowET.getHours() * 60 + nowET.getMinutes();
  const dow = nowET.getDay();
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

  // PRIORITY 1: Enrollment override times on character
  if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
    const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time && e.end_time);
    if (active) {
      const s = toMin(active.start_time);
      const e = toMin(active.end_time);
      if (s !== null && e !== null) {
        const inWindow = e < s ? (cur >= s || cur < e) : (cur >= s && cur < e);
        if (inWindow) return true;
      }
    }
  }

  // PRIORITY 2: School location operating hours (from LocationReference)
  if (character.education_location_id && locationMap && locationMap[character.education_location_id]) {
    const schoolLoc = locationMap[character.education_location_id];
    if (schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
      const prevDow = (dow + 6) % 7;
      for (const h of schoolLoc.operating_hours) {
        const s = toMin(h.open_time);
        const e = toMin(h.close_time);
        if (s === null || e === null) continue;
        const dayMatches = h.day_of_week == null || h.day_of_week === dow;
        const prevDayMatches = h.day_of_week == null || h.day_of_week === prevDow;
        if (e < s) {
          // Overnight interval — crosses midnight
          if (cur >= s && dayMatches) return true;
          if (cur < e && prevDayMatches) return true;
        } else {
          if (cur >= s && cur < e && dayMatches) return true;
        }
      }
    }
  }

  // PRIORITY 3: No valid school schedule resolved — not an active obligation
  return false;
}

function getWorkContextFromLocation(loc) {
  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  const subtypes = (loc.subtype || []).map(s => s.toLowerCase());
  const desc = (loc.description || '').toLowerCase();

  if (cat === 'medical' || name.includes('hospital') || name.includes('clinic') || name.includes('emergency') || name.includes('urgent care')) return 'at_work_medical';
  if (cat === 'food_drink' || cat === 'social'
    || name.includes('bar') || name.includes('restaurant') || name.includes('cafe') || name.includes('diner')
    || name.includes('club') || name.includes('lounge') || name.includes('nightclub') || name.includes('pub')
    || name.includes('tavern') || name.includes('bistro') || name.includes('grill')
    || name.includes('event') || name.includes('venue') || name.includes('entertainment')
    || name.includes('hospitality') || name.includes('concierge')) return 'at_work_service';
  if (cat === 'education' || cat === 'school' || name.includes('school') || name.includes('college') || name.includes('university') || name.includes('academy') || name.includes('campus')) return 'at_work_service';
  if (name.includes('salon') || name.includes('barber') || name.includes('spa') || name.includes('beauty') || name.includes('hair') || name.includes('nail')) return 'at_work_service';
  if (cat === 'shopping' || name.includes('retail') || name.includes('shop') || name.includes('store') || name.includes('market') || name.includes('mall') || name.includes('boutique')) return 'at_work_service';
  if (name.includes('reception') || name.includes('customer') || name.includes('service desk') || name.includes('front desk') || name.includes('call center') || name.includes('help desk') || subtypes.includes('customer_service') || subtypes.includes('reception')) return 'at_work_service';
  if (cat === 'community' || name.includes('community') || name.includes('center') || name.includes('outreach') || name.includes('shelter')) return 'at_work_service';
  if ((cat === 'gym' || name.includes('gym') || name.includes('fitness')) && (name.includes('studio') || name.includes('trainer') || subtypes.includes('fitness_instruction') || subtypes.includes('personal_training'))) return 'at_work_service';
  if (cat === 'government' || name.includes('office') || name.includes('department') || name.includes('agency') || name.includes('bureau') || subtypes.includes('public_service')) return 'at_work_office';
  return 'at_work_office';
}

// ── OVERNIGHT SLEEP DRIVE ────────────────────────────────────────────────
function overnightSleepDriveMultiplier(nowET, character) {
  const hour = nowET.getHours();
  const minute = nowET.getMinutes();
  const frac = hour + minute / 60;
  const personalityMod = character.trait_night_owl ? 0.8 : 1.0;
  if (frac >= 3 && frac < 6) return 2.5 * personalityMod;
  if (frac >= 2 && frac < 3) return 2.0 * personalityMod;
  if (frac >= 1 && frac < 2) return 1.8 * personalityMod;
  if (frac >= 0 && frac < 1) return 1.5 * personalityMod;
  if (frac >= 23) return 1.3 * personalityMod;
  if (frac >= 22 && frac < 23) return 1.1 * personalityMod;
  return 1.0;
}

function hasMeaningfulOvernightActivity(character) {
  const activity = (character.current_activity || '').toLowerCase();
  const validReasons = [
    'party', 'celebration', 'wedding', 'reception', 'gathering', 'event',
    'romantic', 'date', 'intimate', 'lover',
    'child', 'baby', 'nursing', 'feeding', 'care',
    'emergency', 'crisis', 'urgent', 'disaster',
    'argument', 'fight', 'conflict', 'emotional', 'distress', 'grief', 'mourning',
    'crying', 'upset', 'breakdown',
    'important conversation', 'serious talk', 'discussion',
    'night shift', 'overnight', 'graveyard',
    'traveling', 'road', 'driving', 'transit',
    'hospital', 'medical', 'sick', 'ill',
  ];
  for (const reason of validReasons) {
    if (activity.includes(reason)) return true;
  }
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

  // Hospitalized: context is determined by the character's current recovery
  // activity — NOT by hospitalization status. No passive recovery from being
  // hospitalized alone. The activity (set by computeCorrectiveState) selects an
  // existing context (sleeping, resting, eating), and that context's existing
  // rate applies. If no recovery activity is set, context is 'default' (decay).
  if (presenceStatus === 'hospitalized') {
    if (activity.includes('sleep') || activity.includes('asleep')) return 'sleeping';
    if (activity.includes('rest') || activity.includes('relax') || activity.includes('recover')) return 'resting';
    if (activity.includes('eat') || activity.includes('food') || activity.includes('meal')) return 'eating';
    // Hospitalized characters with no explicit recovery activity are recovering
    // through sleep — the medical emergency requires rest. The existing 'sleeping'
    // context rate applies (+12.5 energy, +0.5 health, +3 mental, +4 comfort per
    // hour). The 8h sleep cap explicitly excludes hospitalized characters, so the
    // rate applies without being capped. 'default' (decay) must never apply to a
    // hospitalized character — that traps them in a non-recovery loop.
    return 'sleeping';
  }
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

  // Persisted presence is not schedule authority. Only use at_school context
  // when the live school session check confirms an active obligation.
  if (presenceStatus === 'at_school' && isInSchoolSession(character, locationMap)) return 'at_school';

  // Stale "at_work" presence must NOT establish work_off_shift context when
  // isOnShift returns false. The authoritative live schedule controls work
  // status. Fall through to location-based context resolution regardless of
  // where the character is — home, hotel, shelter, park, or any other place.
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

  if (context === 'sleeping' && (locCat === 'home' || locCat === 'hotel' || presence === 'home')) modifier += 1;
  if ((presence === 'napping' || activity.includes('nap')) && (locCat === 'home' || !locId)) modifier += 0.5;
  if (context === 'home_resting') modifier += 1;
  if (context === 'resting' && locCat !== 'gym' && locCat !== 'jail_prison') modifier += 0.5;

  if (loc) {
    const isUpscale = locFeatures.some(f => f.includes('upscale') || f.includes('luxury') || f.includes('fine dining') || f.includes('high-end'))
      || locDesc.includes('upscale') || locDesc.includes('luxury') || locDesc.includes('fine dining');
    if (isUpscale) modifier += 0.75;
    const isPleasant = locFeatures.some(f => f.includes('clean') || f.includes('pleasant') || f.includes('beautiful') || f.includes('relaxing') || f.includes('serene') || f.includes('cozy') || f.includes('comfortable'))
      || locDesc.includes('cozy') || locDesc.includes('relaxing') || locDesc.includes('comfortable') || locDesc.includes('beautiful');
    if (isPleasant) modifier += 0.5;
    if (locCat === 'jail_prison' || loc.is_confinement_facility) modifier -= 1.5;
    if (locCat === 'outdoor' || locCat === 'community') modifier += 0.25;
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
      const tension    = r.tension_level    ?? 0;
      if (friendship < 25 || trust < 20 || tension > 70) { bestRelationshipComfort = Math.min(bestRelationshipComfort, -1); continue; }
      if (friendship > 80 || trust > 75 || r.romantic_level > 60) bestRelationshipComfort = Math.max(bestRelationshipComfort, 1);
      else if (friendship > 60 || trust > 55) bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    }
    if (isAtHome && familyMembers.length > 0) bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    modifier += bestRelationshipComfort;
  }

  const isForcedEvent = activity.includes('mandatory') || activity.includes('forced') || activity.includes('awkward') || activity.includes('uncomfortable');
  if (isForcedEvent) modifier -= 0.5;
  const isStressfulActivity = activity.includes('argument') || activity.includes('confrontation') || activity.includes('conflict') || activity.includes('tense') || activity.includes('stressed');
  if (isStressfulActivity) modifier -= 1;

  return Math.max(-2, Math.min(2, modifier));
}

function mentalPersonalityScale(char) {
  const socialEnergy = char.social_energy || 'ambivert';
  const traits = {
    conscientious: char.trait_conscientious, loyal: char.trait_loyal, competitive: char.trait_competitive,
    morningPerson: char.trait_morning_person, empathetic: char.trait_empathetic, adaptable: char.trait_adaptable,
    cynical: char.trait_cynical, compassionate: char.trait_compassionate, stubborn: char.trait_stubborn,
    generous: char.trait_generous, nightOwl: char.trait_night_owl, leader: char.trait_leader,
  };
  const scale = { social: 1.0, rest: 1.0, achievement: 1.0, resilience: 1.0, confidence: 1.0, purpose: 1.0, characterValues: 1.0, stability: 1.0, selfCare: 1.0 };
  if (socialEnergy === 'extrovert' || socialEnergy === 'mostly_extrovert') { scale.social *= 1.5; scale.rest *= 0.8; }
  else if (socialEnergy === 'introvert' || socialEnergy === 'mostly_introvert') { scale.social *= 0.6; scale.rest *= 1.3; }
  if (traits.conscientious) { scale.stability *= 1.5; scale.achievement *= 1.3; scale.purpose *= 1.2; scale.selfCare *= 1.3; }
  if (traits.loyal) { scale.social *= 1.3; scale.characterValues *= 1.5; }
  if (traits.competitive) { scale.achievement *= 1.6; scale.purpose *= 1.3; scale.confidence *= 1.4; }
  if (traits.empathetic) { scale.social *= 1.4; scale.confidence *= 1.2; }
  if (traits.adaptable) { scale.resilience *= 1.5; scale.stability *= 0.7; }
  if (traits.cynical) { scale.social *= 0.5; scale.resilience *= 0.6; }
  if (traits.compassionate) { scale.characterValues *= 1.4; scale.social *= 1.2; }
  if (traits.stubborn) { scale.confidence *= 1.5; scale.resilience *= 0.7; }
  if (traits.generous) { scale.characterValues *= 1.3; scale.social *= 1.2; }
  if (traits.nightOwl) { scale.rest *= 0.8; scale.stability *= 0.8; }
  if (traits.morningPerson) { scale.rest *= 1.2; scale.stability *= 1.2; scale.selfCare *= 1.1; }
  if (traits.leader) { scale.purpose *= 1.4; scale.confidence *= 1.3; scale.achievement *= 1.3; }
  for (const k of Object.keys(scale)) scale[k] = Math.max(0.3, Math.min(2.0, scale[k]));
  return scale;
}

function computeMentalModifier(char, context, locationMap) {
  let modifier = 0;
  const scale = mentalPersonalityScale(char);
  const activity = (char.current_activity || '').toLowerCase();
  const presence = char.resolved_presence_status || '';
  const locId = char.resolved_current_location_id;
  const loc = locId ? locationMap[locId] : null;
  const locCat = (loc?.category || '').toLowerCase();
  const locName = (loc?.name || '').toLowerCase();
  const locDesc = (loc?.description || '').toLowerCase();
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
      const trust = r.trust_level ?? 50;
      const tension = r.tension_level ?? 0;
      if (friendship < 25 || trust < 20 || tension > 70) { bestRelationshipComfort = Math.min(bestRelationshipComfort, -1); continue; }
      if (friendship > 80 || trust > 75 || r.romantic_level > 60) bestRelationshipComfort = Math.max(bestRelationshipComfort, 1);
      else if (friendship > 60 || trust > 55) bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    }
    if (isAtHome && familyMembers.length > 0) bestRelationshipComfort = Math.max(bestRelationshipComfort, 0.5);
    modifier += bestRelationshipComfort;
  }

  const hasJob = !!(char.occupation || char.work_start_time || char.occupation_location_id);
  const atHome = locCat === 'home' || presence === 'home';
  const atSchool = locCat === 'school' || locCat === 'education' || presence === 'at_school';
  const onShift = isOnShift(char, locationMap);
  const hasCloseRel = relationships.some(r => (r.friendship_level ?? 0) > 70 || (r.trust_level ?? 0) > 70 || (r.romantic_level ?? 0) > 50);

  const mQualitySleep = context === 'sleeping' && (locCat === 'home' || locCat === 'hotel');
  const mNap = presence === 'napping' || activity.includes('nap') || activity.includes('siesta');
  const mRestRecover = activity.includes('rest') || activity.includes('recover') || activity.includes('recharge') || activity.includes('rested');
  const mGym = context === 'gym' || activity.includes('exercise') || activity.includes('workout');

  if (mQualitySleep) modifier += 1.25 * scale.rest;
  if (mNap) modifier += 0.75 * scale.rest;
  if (mRestRecover) modifier += 0.75 * scale.rest;
  if (context === 'home_resting' || context === 'resting') modifier += 1.0 * scale.rest;
  if (context === 'eating' || context === 'food_drink') modifier += 0.75 * scale.rest;
  if (mGym) modifier += 1.0;

  if (activity.includes('help') || activity.includes('volunteer')) modifier += 1.25 * scale.characterValues;
  if (activity.includes('proud') || activity.includes('right decision')) modifier += 1.0 * scale.characterValues;
  if (activity.includes('goal') || activity.includes('plan') || activity.includes('future')) modifier += 0.5 * scale.purpose;
  if (activity.includes('purpose') || activity.includes('direction')) modifier += 1.0 * scale.purpose;
  if (activity.includes('routine') || activity.includes('productive')) modifier += 0.5 * scale.stability;
  if (atSchool) modifier += 0.4 * scale.purpose;
  if (hasJob) modifier += 0.2 * scale.purpose;
  if (onShift) modifier += 0.25 * scale.stability;
  if (hasCloseRel) modifier += 0.2 * scale.confidence;

  if (locCat === 'outdoor') modifier += 0.75;
  if (locCat === 'jail_prison' || (loc && loc.is_confinement_facility)) modifier -= 1.5;
  if (activity.includes('fear') || activity.includes('threat')) modifier -= 1.5;
  if (activity.includes('conflict') || activity.includes('argument')) modifier -= 1.25;
  if (activity.includes('grief') || activity.includes('loss')) modifier -= 1.5;
  if (activity.includes('isolat') || activity.includes('lonely')) modifier -= 1.0;

  return modifier;
}

function applyElapsedTime(needs, elapsedHours, context) {
  // No hospitalized branch. The former RATES.hospitalized has been removed from
  // the rate table. Hospitalized characters recover ONLY through existing
  // activity contexts (sleeping, resting, eating) resolved by getLocationContext
  // based on their current_activity. Stabilization is a one-time admission event
  // committed by enforceCharacterLocationPresence — never a recurring rate here.
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
  if (needs.social < 15) needs.mental = clamp(needs.mental - 0.15 * elapsedHours);
  if (needs.mental < 40) {
    const severity = (40 - needs.mental) / 40;
    needs.hunger  = clamp(needs.hunger  - 0.05 * severity * elapsedHours);
    needs.hygiene = clamp(needs.hygiene - 0.05 * severity * elapsedHours);
    needs.health  = clamp(needs.health  - 0.03 * severity * elapsedHours);
  }
  const bodyCriticalCount = [needs.hunger, needs.energy, needs.health].filter(v => v < 20).length;
  if (bodyCriticalCount >= 2) needs.health = clamp(needs.health - 0.5 * elapsedHours);
  return needs;
}

function detectCriticalEscalations(oldNeeds, newNeeds, characterName) {
  const events = [];
  if (oldNeeds.hunger >= 20 && newNeeds.hunger < 20) events.push({ title: 'Reached critical hunger', description: `${characterName} was starving — hunger became critical.`, memory_tag: 'hunger_critical' });
  if (oldNeeds.hunger >= 10 && newNeeds.hunger < 10) events.push({ title: 'Severe hunger — near collapse', description: `${characterName} was extremely hungry, feeling dizzy and unable to focus.`, memory_tag: 'hunger_severe' });
  if (newNeeds.hunger <= 0 && oldNeeds.hunger > 0) events.push({ title: 'Hunger at zero — survival mode', description: `${characterName} had no food energy at all.`, memory_tag: 'hunger_zero' });
  if (oldNeeds.energy >= 25 && newNeeds.energy < 25) events.push({ title: 'Running on empty', description: `${characterName} was exhausted and struggling to stay awake.`, memory_tag: 'energy_critical' });
  // NOTE: "Passed out from exhaustion" escalation is NOT a pass-out initiation — it only logs a LifeEvent
  // describing that energy reached zero. The actual pass-out STATE transition is blocked by
  // PASSOUT_EXHAUSTION_DISABLED. This escalation event is retained for diagnostic visibility only.
  if (newNeeds.energy <= 0 && oldNeeds.energy > 0) events.push({ title: 'Energy depleted to zero', description: `${characterName}'s energy was completely depleted.`, memory_tag: 'energy_zero' });
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

// ── SLEEP-LOCATION AUTHORITY ─────────────────────────────────────────────
// Sleep-location validity is NOT determined locally. The canonical authority
// enforceCharacterLocationPresence owns this determination through its
// isValidSleepLocation(location) / VALID_SLEEP_CATEGORIES. simulateActiveCharacterNeeds
// routes every sleep/nap request through that authority, passing the character's
// current resolved location as the requested location. The authority accepts a
// valid sleep location (home, hotel, shelter, generic, confinement categories)
// or redirects to a valid sleep home when the current location is invalid.
// No duplicate category list, helper, or parallel source of truth is maintained here.

// ── CORRECTIVE STATE RESOLVER ────────────────────────────────────────────
function computeCorrectiveState(needs, character, locationMap) {
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';

  const isInRestState = presence === 'sleeping' || presence === 'napping' ||
    presence === 'passed_out' || presence === 'hospitalized';

  // HOSPITALIZED: No hospital-specific activity engine. Hospitalized characters
  // are at a hospital location and recover through the EXISTING activity system
  // (triggerAutonomousActions), which selects activities by need level and
  // applies the existing needsEffect (hygiene +20, social +30, mental +20,
  // comfort +15, health +20, hunger +35). Those activities fire for all active
  // characters regardless of presence. triggerAutonomousActions does NOT change
  // resolved_presence_status, so the character stays hospitalized during
  // activities. autonomousCharacterMovement has a Tier 0 hard stop that blocks
  // movement for hospitalized characters. The getLocationContext function maps
  // the current_activity to an existing rate context (sleeping, resting,
  // eating, default) so elapsed-time rates apply correctly. No new activities,
  // rates, or recovery systems are created here.
  //
  // Hospitalized is a rest state (isInRestState below), so the subsequent
  // energy/nap/pass-out/compound-crisis checks are all blocked. Only the
  // eating corrective (hunger ≤ 20) can fire — a valid activity at a hospital.

  // PASS-OUT (≤10%): bypass pipeline — involuntary physical collapse. NOT sleeping.
  // ── DISABLED: Exhaustion-threshold pass-out is blocked per mandatory shutdown.
  // Energy may reach any value without triggering pass-out. The threshold
  // definition is retained for future restoration but the execution path is blocked.
  if (!PASSOUT_EXHAUSTION_DISABLED && needs.energy <= T.ENERGY_PASSOUT && !isInRestState && !character.sleep_lock) {
    return {
      resolved_presence_status: 'passed_out',
      current_activity: 'passed out from exhaustion — critical energy depletion',
    };
  }

  // MEDICAL DANGER (≤5%): AWAKE CHARACTERS ONLY. Sleeping chars get +12.5/hr recovery.
  // This is hospitalization, NOT pass-out — preserved per shutdown rules.
  if (needs.energy <= T.ENERGY_MEDICAL && !isInRestState) {
    return {
      resolved_presence_status: 'hospitalized',
      current_activity: 'hospitalized — energy collapse',
    };
  }

  // ENERGY 25-50%: DECISION PIPELINE REQUIRED — state only if at home + no obligations
  if (needs.energy <= T.ENERGY_NAP_AVAILABLE && needs.energy > T.ENERGY_PASSOUT && !isInRestState) {
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const overnightDrive = overnightSleepDriveMultiplier(nowET, character);
    const hasOvernightReason = hasMeaningfulOvernightActivity(character);
    const effectiveDrive = hasOvernightReason ? Math.max(1.0, overnightDrive * 0.5) : overnightDrive;

    let passOutAmp = 1.0;
    if (character.last_pass_out_at) {
      const daysSincePassOut = (Date.now() - new Date(character.last_pass_out_at).getTime()) / (24 * 3_600_000);
      if (daysSincePassOut < 7) passOutAmp = 0.70;
      else if (daysSincePassOut < 30) passOutAmp = 0.85;
      const extraCount = Math.max(0, (character.pass_out_count ?? 0) - 1);
      if (extraCount > 0) passOutAmp *= Math.max(0.5, 1.0 - extraCount * 0.1);
    }

    const effectiveEnergy = (needs.energy / effectiveDrive) * passOutAmp;

    // OBLIGATION CHECK — live schedule authority only. Employment, enrollment,
    // schedule existence, persisted presence, and stale locks do NOT block
    // sleep. Only a currently active scheduled work/school interval blocks.
    const inObligation = isOnShift(character, locationMap) ||
      isInSchoolSession(character, locationMap) ||
      character.is_jailed ||
      character.house_arrest_active;

    // LOCATION CHECK — delegated to the canonical authority. The sleep/nap
    // request is routed through enforceCharacterLocationPresence, which applies
    // its own isValidSleepLocation determination to the character's current
    // resolved location. A valid non-primary-home sleep location (hotel, shelter,
    // generic, confinement) is accepted by the authority; an invalid location is
    // redirected to a valid sleep home. No local duplicate of that authority runs here.
    const isBlocked = inObligation || character.sleep_lock;

    const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
    const dayOfWeek = nowET.getDay();

    let sleepStartMin = null;
    if (character.sleep_start_time) sleepStartMin = toMin(character.sleep_start_time);
    else if (character.work_start_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
      const workStart = toMin(character.work_start_time);
      if (workStart !== null) { const wakeMin = (workStart - 60 + 1440) % 1440; sleepStartMin = (wakeMin - 7 * 60 + 1440) % 1440; }
    }
    if (sleepStartMin === null && character.student_status === 'enrolled' && [1, 2, 3, 4, 5].includes(dayOfWeek)) sleepStartMin = 23 * 60;
    if (sleepStartMin === null) sleepStartMin = 23 * 60;

    let minutesToSleep = sleepStartMin - nowMin;
    if (minutesToSleep < 0) minutesToSleep += 1440;
    const closeToSleepWindow = minutesToSleep <= 90;

    if (effectiveEnergy <= T.ENERGY_CRITICAL) {
      if (!isBlocked) {
        const wakeMinCrit = character.wake_up_time ? toMin(character.wake_up_time) : null;
        let insideSleepWindowCrit = false;
        if (sleepStartMin !== null && wakeMinCrit !== null) {
          insideSleepWindowCrit = sleepStartMin > wakeMinCrit ? (nowMin >= sleepStartMin || nowMin < wakeMinCrit) : (nowMin >= sleepStartMin && nowMin < wakeMinCrit);
        }
        if (insideSleepWindowCrit || closeToSleepWindow) {
          return { resolved_presence_status: 'sleeping', current_activity: 'sleeping — energy critically low', last_sleep_start: new Date().toISOString() };
        }
        return { resolved_presence_status: 'napping', current_activity: 'napping — energy critically low recovery', last_nap_time: new Date().toISOString() };
      }
      return null;
    }

    if (effectiveEnergy <= T.ENERGY_LOW) {
      if (!isBlocked) {
        if (closeToSleepWindow) return { resolved_presence_status: 'sleeping', current_activity: 'sleeping — low energy near bedtime', last_sleep_start: new Date().toISOString() };
        return { resolved_presence_status: 'napping', current_activity: 'napping — low energy recovery', last_nap_time: new Date().toISOString() };
      }
      return null;
    }

    if (effectiveEnergy <= T.ENERGY_NAP_PRESSURE) {
      if (!isBlocked) return { resolved_presence_status: 'napping', current_activity: 'napping — strong energy pressure', last_nap_time: new Date().toISOString() };
      return null;
    }

    if (effectiveEnergy <= T.ENERGY_NAP_AVAILABLE) return null;
    return null;
  }

  if (needs.hunger <= T.HUNGER_CRITICAL && !activity.includes('eat')) return { current_activity: 'eating — hunger drove them to food' };
  if (needs.health <= T.HEALTH_ER && presence !== 'hospitalized') return { resolved_presence_status: 'hospitalized', current_activity: 'hospitalized — health collapsed' };
  if (needs.social <= T.SOCIAL_CRITICAL && !isInRestState && !character.is_jailed && !character.house_arrest_active) return { current_activity: 'seeking social contact — isolated too long' };

  // Compound crisis — involuntary collapse, NOT voluntary sleep.
  // PRESERVED: This is a separate cause (3+ needs below 20), NOT exhaustion or 19-hour.
  const criticalCount = [needs.hunger, needs.energy, needs.health, needs.social, needs.mental].filter(v => v < 20).length;
  if (criticalCount >= T.COMPOUND_CRISIS && !isInRestState) {
    return {
      resolved_presence_status: 'passed_out',
      current_activity: 'passed out from compound crisis — forced recovery',
      last_pass_out_at: new Date().toISOString(),
    };
  }

  return null;
}

// ── DECISION WEIGHTS ──────────────────────────────────────────────────────
const HYGIENE_CURVE = [{ threshold: 20, weight: 3.5 }, { threshold: 35, weight: 2.0 }, { threshold: 50, weight: 1.0 }, { threshold: 65, weight: 0.4 }, { threshold: 80, weight: 0.1 }];
const ENERGY_CURVE = [{ threshold: 15, weight: 5.0 }, { threshold: 25, weight: 4.0 }, { threshold: 35, weight: 2.5 }, { threshold: 50, weight: 1.0 }, { threshold: 70, weight: 0.2 }];
const HUNGER_CURVE = [{ threshold: 10, weight: 5.0 }, { threshold: 20, weight: 4.0 }, { threshold: 35, weight: 2.0 }, { threshold: 50, weight: 1.0 }, { threshold: 70, weight: 0.2 }];
const SOCIAL_CURVE = [{ threshold: 10, weight: 3.0 }, { threshold: 25, weight: 2.0 }, { threshold: 40, weight: 1.0 }, { threshold: 60, weight: 0.4 }, { threshold: 80, weight: 0.1 }];
const HEALTH_CURVE = [{ threshold: 15, weight: 5.0 }, { threshold: 30, weight: 3.0 }, { threshold: 50, weight: 1.5 }, { threshold: 70, weight: 0.5 }, { threshold: 85, weight: 0.1 }];
const MENTAL_CURVE = [{ threshold: 30, weight: 4.0 }, { threshold: 45, weight: 2.5 }, { threshold: 60, weight: 1.5 }, { threshold: 75, weight: 0.5 }, { threshold: 90, weight: 0.1 }];

function pressureCurve(value, curve) {
  for (const entry of curve) { if (value <= entry.threshold) return entry.weight; }
  return 0;
}

function computeDecisionWeights(needs, character) {
  const presence = character.resolved_presence_status || '';
  if (presence === 'sleeping' || presence === 'napping' || presence === 'hospitalized' || presence === 'passed_out') return null;

  const hygieneW  = pressureCurve(needs.hygiene, HYGIENE_CURVE);
  let   energyW   = pressureCurve(needs.energy,  ENERGY_CURVE);
  const hungerW   = pressureCurve(needs.hunger,  HUNGER_CURVE);
  const socialW   = pressureCurve(needs.social,  SOCIAL_CURVE);
  const healthW   = pressureCurve(needs.health,   HEALTH_CURVE);
  const mentalW   = pressureCurve(needs.mental,   MENTAL_CURVE);

  // Pass-out learning amplification — preserved (affects sleep pressure, not pass-out initiation)
  if (character.last_pass_out_at) {
    const daysSince = (Date.now() - new Date(character.last_pass_out_at).getTime()) / (24 * 3_600_000);
    if (daysSince < 30) {
      let amp = daysSince < 7 ? 1.5 : 1.3;
      const extraCount = Math.max(0, (character.pass_out_count ?? 0) - 1);
      if (extraCount > 0) amp += extraCount * 0.15;
      energyW *= amp;
    }
  }

  return { hygieneW, energyW, hungerW, socialW, healthW, mentalW };
}

function buildPressureProfile(weights) {
  if (!weights) return null;
  const { hygieneW, energyW, hungerW, socialW, healthW, mentalW } = weights;
  const profile = {
    pressures: [
      { need: 'health',  weight: healthW }, { need: 'energy',  weight: energyW },
      { need: 'hunger',  weight: hungerW }, { need: 'hygiene', weight: hygieneW },
      { need: 'mental',  weight: mentalW }, { need: 'social',  weight: socialW },
    ].sort((a, b) => b.weight - a.weight),
    dominant: null, elevated: [], satisfied: true,
  };
  profile.pressures.forEach(p => {
    if (p.weight > 2.0) profile.dominant = profile.dominant || p.need;
    if (p.weight > 0.5) profile.satisfied = false;
    if (p.weight >= 1.0) profile.elevated.push(p.need);
  });
  return profile;
}

function resolveNextActivity(needs, character) {
  const weights = computeDecisionWeights(needs, character);
  if (!weights) return null;
  const socialEnergy = character.social_energy || 'ambivert';
  const personalityMod = { social: 1.0, hygiene: 1.0, mental: 1.0 };
  if (socialEnergy === 'extrovert' || socialEnergy === 'mostly_extrovert') personalityMod.social = 1.3;
  else if (socialEnergy === 'introvert' || socialEnergy === 'mostly_introvert') personalityMod.social = 0.7;
  if (character.trait_conscientious) { personalityMod.hygiene = 1.3; personalityMod.mental = 1.2; }
  if (character.trait_adaptable) personalityMod.mental = 0.8;
  const modulated = {
    hygieneW: weights.hygieneW * personalityMod.hygiene, energyW: weights.energyW,
    hungerW: weights.hungerW, socialW: weights.socialW * personalityMod.social,
    healthW: weights.healthW, mentalW: weights.mentalW * personalityMod.mental,
  };
  const profile = buildPressureProfile(modulated);
  if (profile) profile.character_factors = { social_energy: socialEnergy, personality_mod: personalityMod };
  return profile;
}

// ── STALE CORRECTIVE CLEANUP ──────────────────────────────────────────────
function resolveStaleCorrectiveActivities(character, needs) {
  const activity = (character.current_activity || '').toLowerCase();
  const presence = character.resolved_presence_status || '';
  const correctivePatterns = ['eating — hunger drove them to food', 'forced sleep — exhausted', 'forced rest — compound crisis', 'hospitalized — health collapsed', 'seeking social contact — isolated too long'];
  const isCorrective = correctivePatterns.some(p => activity.includes(p || activity === p));
  if (!isCorrective) return null;
  if (activity.includes('eat') && needs.hunger > 40) return { current_activity: '', resolved_presence_status: presence === 'sleeping' ? 'home' : presence };
  if (activity.includes('forced sleep') || activity.includes('forced rest')) {
    if (presence !== 'sleeping' && presence !== 'napping' && presence !== 'passed_out') {
      if (needs.energy > 50) return { current_activity: '', resolved_presence_status: 'home' };
    }
    if (character.last_sleep_start) {
      const elapsedSleepHours = (Date.now() - new Date(character.last_sleep_start).getTime()) / 3600000;
      if (elapsedSleepHours < 6) return null;
    }
    if (needs.energy > 50) return { current_activity: '', resolved_presence_status: 'home' };
    return null;
  }
  if (activity.includes('seeking social contact') && needs.social > 40) return { current_activity: '' };
  return null;
}

function resolveStaleDecisionIntents(character) {
  const activity = (character.current_activity || '').toLowerCase();
  if (activity.includes('seek_') && !activity.includes(' — ')) return { current_activity: '' };
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body / GET request */ }
    const ownerEmailOverride = payload.ownerEmail || null;

    if (!user && !ownerEmailOverride) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = ownerEmailOverride || user?.email;
    const now = new Date();
    const nowIso = now.toISOString();

    let charFilterError = null;
    const allCharacters = await base44.entities.Character.list(null, 200)
      .catch((err) => { charFilterError = err?.message || 'Unknown filter error'; return []; });

    const characters = allCharacters.filter(c =>
      c.status === 'active' &&
      c.character_type === 'active_created_character' &&
      !c.is_world_service &&
      c.owner_email === ownerEmail
    );

    if (characters.length === 0) {
      if (charFilterError) return Response.json({ success: false, simulated: 0, message: 'Character fetch failed — rate limit or API error prevented simulation', error: charFilterError });
      return Response.json({ success: true, simulated: 0, totalLoaded: allCharacters.length, totalFiltered: characters.length, message: 'No matching active_created_characters found', debug: { ownerEmail, ownerEmailOverride: !!ownerEmailOverride, sampleTypes: [...new Set(allCharacters.slice(0, 20).map(c => c.character_type))], sampleStatuses: [...new Set(allCharacters.slice(0, 20).map(c => c.status))] }});
    }

    let locFilterError = null;
    const locations = await base44.entities.LocationReference.list(null, 200)
      .catch((err) => { locFilterError = err?.message || 'Unknown location filter error'; return []; });
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    const results = [];

    for (const char of characters) {
      try {
        const charName = char.name || char.display_name || char.id;
        let sleepTransitionsToRecord = [];
        let pendingConsequences = [];

        if (char.is_world_service) continue;
        if (char.is_test_character || char.diagnostic_only) continue;
        if (char.is_jailed || char.resolved_presence_status === 'incarcerated') continue;

        let needs = getNeedsFromCharacter(char);
        if (needsAreUninitialized(needs) || !char.needs_initialized) {
          await base44.entities.Character.update(char.id, {
            hunger_value: 70, energy_value: 75, social_value: 65, health_value: 80,
            mental_value: 70, hygiene_value: 75, comfort_value: 70,
            financial_need_value: deriveFinancialNeed(char), needs_initialized: true, last_need_simulated_at: nowIso,
          });
          results.push({ character: charName, status: 'initialized' });
          continue;
        }

        const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at).getTime() : Date.now();
        const elapsedMs = now.getTime() - lastSim;
        const elapsedHours = Math.min(elapsedMs / (1000 * 60 * 60), 8);
        if (elapsedHours < 0.05) { results.push({ character: charName, status: 'skipped', reason: 'too_recent', elapsed_minutes: Math.round(elapsedHours * 60) }); continue; }

        const hungerLocked = char.hunger_lock === true;
        const sleepLocked  = char.sleep_lock  === true;

        const context = getLocationContext(char, locationMap, now);

        // ── EATING: HOME ($0) AND WORK ($0) ─────────────────────────────
        // Active created characters may eat at home or at work. Both are $0
        // transactions — they must NOT be skipped because no money is charged,
        // and must NOT be assigned restaurant/bar costs. Restaurant/bar eating
        // (separate paths) uses location-specific costs. Eating fires whenever
        // hunger is low and the character is awake at their home location or on
        // shift; it never depends on a pantry balance.
        if (!hungerLocked && !char.needs_locks?.hunger && (needs.hunger ?? 70) < 50) {
          const _awake = !['sleeping','napping','passed_out'].includes(char.resolved_presence_status || '');
          const _atHome = _awake && !!char.resolved_current_location_id &&
            (char.resolved_current_location_id === char.current_home_location_id ||
             char.resolved_current_location_id === char.temporary_housing_location_id);
          const _atWork = _awake && isOnShift(char, locationMap);
          const _atHospital = _awake && char.resolved_presence_status === 'hospitalized';
          if (_atHome || _atWork || _atHospital) {
            const isMeal = (needs.hunger ?? 70) < 30;
            const hungerRestore = isMeal ? 33 : 16.5;
            // Home: deplete pantry if a HouseholdResource food record exists,
            // but never block eating on pantry balance (eating at home is $0).
            if (_atHome) {
              try {
                const hrArr = await base44.entities.HouseholdResource.filter(
                  { owner_email: ownerEmail, home_location_id: char.current_home_location_id, resource_type: 'food' }, null, 1
                ).catch(() => []);
                const hr = hrArr[0];
                const foodAvailable = hr ? (hr.home_food_value || 0) : 0;
                if (hr && foodAvailable > 0) {
                  const consumed = isMeal ? 1 : 0.5;
                  const actualConsumed = Math.min(consumed, foodAvailable);
                  const newFood = Math.max(0, Math.round((foodAvailable - actualConsumed) * 100) / 100);
                  await base44.entities.HouseholdResource.update(hr.id, { home_food_value: newFood, last_consumed_at: nowIso }).catch(() => {});
                }
              } catch (e) { /* Non-fatal — eating still proceeds at $0 */ }
            }
            needs.hunger = clamp((needs.hunger ?? 70) + hungerRestore);
            results.push({ character: charName, event: isMeal ? (_atHome ? 'home_meal_consumed' : 'work_meal_consumed') : (_atHome ? 'home_snack_consumed' : 'work_snack_consumed'), eating_location: _atHome ? 'home' : 'work', cost: 0, hunger_before: char.hunger_value ?? 70, hunger_after: Math.round(needs.hunger) });
          }
        }

        // ── RC2: PASS-OUT DETECTION (energy ≤ ENERGY_PASSOUT) ────────────
        // ── DISABLED: Exhaustion-threshold pass-out is blocked per mandatory shutdown.
        // Energy may reach ≤10 without triggering pass-out. The threshold definition
        // is retained for future restoration but the execution path is blocked.
        const energyBefore = char.energy_value ?? 75;
        if (!PASSOUT_EXHAUSTION_DISABLED && energyBefore <= T.ENERGY_PASSOUT && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'passed_out'
            && !sleepLocked) {
          const passOutCount = (char.pass_out_count ?? 0) + 1;
          const passOutRevertPayload = {
            resolved_presence_status: char.resolved_presence_status, current_activity: char.current_activity,
            last_pass_out_at: char.last_pass_out_at, pass_out_count: char.pass_out_count,
            presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
            presence_stay_lock_authority: char.presence_stay_lock_authority, presence_stay_lock_set_at: char.presence_stay_lock_set_at,
            presence_stay_lock_created_by: char.presence_stay_lock_created_by, presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
            hunger_value: char.hunger_value, energy_value: char.energy_value, social_value: char.social_value,
            health_value: char.health_value, mental_value: char.mental_value, hygiene_value: char.hygiene_value,
            comfort_value: char.comfort_value, last_need_simulated_at: char.last_need_simulated_at,
          };
          await base44.entities.Character.update(char.id, {
            resolved_presence_status: 'passed_out',
            current_activity: 'passed out from exhaustion — critical energy depletion',
            last_pass_out_at: nowIso, last_need_simulated_at: nowIso, pass_out_count: passOutCount,
            presence_stay_lock: true, presence_stay_lock_reason: 'pass_out_recovery',
            presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso,
            presence_stay_lock_created_by: 'system_automation', presence_stay_lock_release_condition: 'energy_above_35',
            hunger_value: Math.round(needs.hunger ?? 70), energy_value: Math.round(energyBefore),
            social_value: Math.round(needs.social ?? 65), health_value: Math.round(needs.health ?? 80),
            mental_value: Math.round(needs.mental ?? 70), hygiene_value: Math.round(needs.hygiene ?? 75),
            comfort_value: Math.round(needs.comfort ?? 70),
          });
          try {
            await base44.entities.SleepTransition.create({
              character_id: char.id, character_name: charName, owner_email: ownerEmail,
              transition_type: 'pass_out_start', from_status: char.resolved_presence_status || 'unknown',
              to_status: 'passed_out', authority: 'energy_passout',
              reason: `Energy reached ${Math.round(energyBefore)} (threshold ${T.ENERGY_PASSOUT}).`, timestamp: nowIso,
            });
          } catch (transitionError) {
            let revertError = null;
            try { await base44.entities.Character.update(char.id, passOutRevertPayload); } catch (e) { revertError = e.message; }
            results.push({ character: charName, event: 'unverified_state_write', reason: 'pass_out_start SleepTransition write failed — Character state reverted, event is UNVERIFIED', transition_error: transitionError.message, revert_error: revertError });
            continue;
          }
          try {
            await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'medical_event', valence: 'negative', severity: 'major', title: 'Passed out from exhaustion', description: `${charName} collapsed from complete energy depletion. Energy was at ${Math.round(energyBefore)}.`, emotional_impact: 'physical collapse, embarrassment, loss of control', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['passed_out', 'forced_sleep', passOutCount > 1 ? 'repeat_pass_out' : 'first_pass_out'] });
            await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} passed out from exhaustion when their energy dropped to ${Math.round(energyBefore)}.`, memory_summary: `Passed out at energy ${Math.round(energyBefore)}.`, importance_score: 8, permanence: 'long_term', related_character_id: char.id });
          } catch (consequenceError) {
            results.push({ character: charName, event: 'consequence_write_failed', reason: 'pass_out LifeEvent/CharacterMemory failed for a verified transition', error: consequenceError.message });
            continue;
          }
          results.push({ character: charName, context: 'passed_out', event: 'pass_out', needs: { hunger: Math.round(needs.hunger ?? 70), energy: Math.round(energyBefore), social: Math.round(needs.social ?? 65), health: Math.round(needs.health ?? 80), mental: Math.round(needs.mental ?? 70), hygiene: Math.round(needs.hygiene ?? 75), comfort: Math.round(needs.comfort ?? 70) } });
          continue;
        }

        // ── APPLY TIME-BASED RATES ────────────────────────────────────────
        let newNeeds = applyElapsedTime(needs, elapsedHours, context);

        if (hungerLocked || char.needs_locks?.hunger) newNeeds.hunger = needs.hunger ?? 70;
        if (sleepLocked || char.needs_locks?.energy) newNeeds.energy = needs.energy ?? 75;
        if(char.needs_locks?.hygiene) newNeeds.hygiene = needs.hygiene ?? 75;
        if(char.needs_locks?.comfort) newNeeds.comfort = needs.comfort ?? 70;
        if(char.needs_locks?.social) newNeeds.social = needs.social ?? 65;
        if(char.needs_locks?.mental) newNeeds.mental = needs.mental ?? 70;
        if(char.needs_locks?.health) newNeeds.health = needs.health ?? 80;

        // ── QUIRK NUDGES — influence need decay, never force ──────────────────
        // Self-Care Focused maintains personal hygiene consistently → slower net hygiene decay.
        // Clean Freak keeps environment (and self after dirty activities) tidy → slower hygiene decay.
        // Health Conscious makes generally healthier choices → slightly slower health decay.
        // Subtle retention bonuses per elapsed hour; locks above still win.
        if (char.trait_self_care_focused) newNeeds.hygiene = clamp(newNeeds.hygiene + 1.5 * elapsedHours);
        if (char.trait_clean_freak) newNeeds.hygiene = clamp(newNeeds.hygiene + 0.75 * elapsedHours);
        if (char.trait_health_conscious) newNeeds.health = clamp(newNeeds.health + 0.5 * elapsedHours);

        // Hospitalized characters are in a protected recovery state. Cross-need
        // infection decay would reverse recovery — a stabilized need must not
        // begin decaying again merely because another need is still recovering.
        // This check uses presence (not context) so it applies regardless of
        // which activity context the character is currently in (sleeping/resting).
        if (char.resolved_presence_status !== 'hospitalized') {
          newNeeds = applyStatInfection(newNeeds, elapsedHours);
        }

        if (!hungerLocked) {
          const mentalMod = computeMentalModifier(char, context, locationMap);
          newNeeds.mental = clamp(newNeeds.mental + mentalMod * elapsedHours);
        }
        const comfortMod = computeComfortModifier(char, context, locationMap);
        newNeeds.comfort = clamp(newNeeds.comfort + comfortMod * elapsedHours);

        // Hospitalized characters: no need may decay while admitted. The sleeping
        // context (forced by getLocationContext) already increases energy (+12.5),
        // health (+0.5), mental (+3), and comfort (+4) per hour. Only two needs need
        // correction — hunger decays at -1/hr in the sleeping context (hospital
        // provides meals/IV, so clamp it to not decrease), and hygiene is flat at 0
        // (hospital staff maintain patient hygiene, so add a modest direct boost).
        // No new rate table, no new pulse — uses only the existing clamp and
        // direct-adjustment patterns already in this function (same as the eating
        // block). The eating block above already handles active hunger recovery
        // when hunger < 50; this clamp prevents passive decay between meals.
        if (char.resolved_presence_status === 'hospitalized') {
          newNeeds.hunger = Math.max(newNeeds.hunger, needs.hunger ?? 70);
          newNeeds.hygiene = clamp(newNeeds.hygiene + 2 * elapsedHours);
        }

        const hasStayLock = char.presence_stay_lock === true;
        let nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

        const dbIsSleeping  = char.resolved_presence_status === 'sleeping';
        const dbIsNapping   = char.resolved_presence_status === 'napping';
        const dbIsPassedOut = char.resolved_presence_status === 'passed_out';

        // ── HARD 8-HOUR SLEEP CAP ──────────────────────────────────────────
        if (dbIsSleeping && char.resolved_presence_status !== 'passed_out'
            && char.resolved_presence_status !== 'hospitalized' && !sleepLocked) {
          if (char.last_sleep_start) {
            const sleepStartMs = new Date(char.last_sleep_start).getTime();
            const sleepDurationHours = (Date.now() - sleepStartMs) / 3_600_000;
            if (sleepDurationHours >= 8) {
              // ── ONE TRUTH: Route the wake transition through the authority ──
              // Need values are written directly (noncanonical). The canonical wake
              // (presence, lock release, last_wake_time) is committed by the authority.
              let _wakeAuthResult = null;
              try {
                const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
                  character_id: char.id, owner_email: ownerEmail,
                  requested_presence_status: 'home',
                  requested_source_reason: 'sleep_cap_8h',
                  requested_authority: 'simulateActiveCharacterNeeds',
                  requested_timestamp: nowIso,
                });
                _wakeAuthResult = _ir?.data || _ir;
              } catch (invokeErr) {
                results.push({ character: charName, context, event: 'authority_invoke_failed', error: invokeErr.message });
                continue;
              }
              if (_wakeAuthResult?.disposition !== 'accepted' && _wakeAuthResult?.disposition !== 'redirected' && _wakeAuthResult?.disposition !== 'modified') {
                results.push({ character: charName, context, event: 'authority_disposition', disposition: _wakeAuthResult?.disposition, reason: _wakeAuthResult?.reason });
                continue;
              }
              // Write only noncanonical need values directly
              await base44.entities.Character.update(char.id, {
                current_activity: '',
                hunger_value: Math.round(newNeeds.hunger), energy_value: Math.round(newNeeds.energy),
                social_value: Math.round(newNeeds.social), health_value: Math.round(newNeeds.health),
                mental_value: Math.round(newNeeds.mental), hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort), last_need_simulated_at: nowIso,
              });
              try {
                await base44.entities.SleepTransition.create({ character_id: char.id, character_name: charName, owner_email: ownerEmail, transition_type: 'sleep_end', from_status: 'sleeping', to_status: _wakeAuthResult.committed_result?.resolved_presence_status || 'home', authority: 'sleep_cap_8h', reason: `Sleep completed 8-hour cap. state_start_ref=${char.last_sleep_start}.`, timestamp: nowIso, state_start_ref: char.last_sleep_start || null, elapsed_hours: Math.round(sleepDurationHours * 100) / 100 });
              } catch (transitionError) {
                results.push({ character: charName, context, event: 'proof_write_failed', reason: 'sleep_end SleepTransition write failed (canonical state already committed by authority)', transition_error: transitionError.message });
              }
              try { await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up after full sleep', description: `${charName} slept ${Math.round(sleepDurationHours * 100) / 100}h, energy at ${Math.round(newNeeds.energy)}.`, emotional_impact: 'rested', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['sleep_end', 'woke_up'] });
                await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} slept ${Math.round(sleepDurationHours * 100) / 100}h and woke rested.`, memory_summary: `Slept ${Math.round(sleepDurationHours * 100) / 100}h — woke rested.`, importance_score: 4, permanence: 'short_term', related_character_id: char.id }); } catch (e) { results.push({ character: charName, event: 'consequence_write_failed', error: e.message }); }
              results.push({ character: charName, context, event: 'hard_8h_sleep_wake', sleep_duration_hours: Math.round(sleepDurationHours * 100) / 100, needs: { hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy), social: Math.round(newNeeds.social), health: Math.round(newNeeds.health), mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene), comfort: Math.round(newNeeds.comfort) } });
              continue;
            }
          } else {
            let sleepStartReconstructed = false;
            try {
              const sleepStartRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'sleep_start', owner_email: ownerEmail }, '-timestamp', 1);
              if (sleepStartRecs.length > 0 && sleepStartRecs[0].timestamp) {
                const startTs = sleepStartRecs[0].timestamp;
                const sleepEndRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'sleep_end', owner_email: ownerEmail }, '-timestamp', 1);
                const noContradictingEnd = sleepEndRecs.length === 0 || new Date(sleepEndRecs[0].timestamp).getTime() < new Date(startTs).getTime();
                if (noContradictingEnd) { await base44.entities.Character.update(char.id, { last_sleep_start: startTs, last_need_simulated_at: nowIso }); sleepStartReconstructed = true; results.push({ character: charName, context, event: 'lifecycle_timestamp_reconstructed', reason: 'last_sleep_start reconstructed from SleepTransition sleep_start evidence', field: 'last_sleep_start', evidence: 'sleep_start', evidence_timestamp: startTs }); }
              }
            } catch (e) { /* fall through */ }
            if (!sleepStartReconstructed) { await base44.entities.Character.update(char.id, { last_need_simulated_at: nowIso }); results.push({ character: charName, context, event: 'unresolved_lifecycle_timestamp', reason: 'last_sleep_start missing — 8h sleep cap blocked, no fabricated history', field: 'last_sleep_start', status: 'sleeping' }); }
          }
        }

        // ── HARD 12-HOUR PASS-OUT CAP (recovery from EXISTING pass-out — PRESERVED) ─────────────────────────
        // This handles recovery FROM pass-outs that already occurred (including pre-shutdown).
        // It does NOT initiate new pass-outs. It is preserved per shutdown rules.
        if (dbIsPassedOut && !sleepLocked) {
          const passOutStart = char.last_pass_out_at;
          if (passOutStart) {
            const passOutDurationHours = (Date.now() - new Date(passOutStart).getTime()) / 3_600_000;
            if (passOutDurationHours >= 12) {
              // ── ONE TRUTH: Route the pass-out recovery wake through the authority ──
              let _poWakeAuth = null;
              try {
                const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
                  character_id: char.id, owner_email: ownerEmail,
                  requested_presence_status: 'home',
                  requested_source_reason: 'pass_out_cap_12h',
                  requested_authority: 'simulateActiveCharacterNeeds',
                  requested_timestamp: nowIso,
                });
                _poWakeAuth = _ir?.data || _ir;
              } catch (invokeErr) {
                results.push({ character: charName, context, event: 'authority_invoke_failed', error: invokeErr.message });
                continue;
              }
              if (_poWakeAuth?.disposition !== 'accepted' && _poWakeAuth?.disposition !== 'redirected' && _poWakeAuth?.disposition !== 'modified') {
                results.push({ character: charName, context, event: 'authority_disposition', disposition: _poWakeAuth?.disposition, reason: _poWakeAuth?.reason });
                continue;
              }
              // Write only noncanonical need values directly
              await base44.entities.Character.update(char.id, {
                current_activity: '',
                hunger_value: Math.round(newNeeds.hunger), energy_value: Math.round(newNeeds.energy),
                social_value: Math.round(newNeeds.social), health_value: Math.round(newNeeds.health),
                mental_value: Math.round(newNeeds.mental), hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort), last_need_simulated_at: nowIso,
              });
              try {
                await base44.entities.SleepTransition.create({ character_id: char.id, character_name: charName, owner_email: ownerEmail, transition_type: 'pass_out_end', from_status: 'passed_out', to_status: _poWakeAuth.committed_result?.resolved_presence_status || 'home', authority: 'pass_out_cap_12h', reason: `Pass-out recovery completed 12-hour cap. state_start_ref=${passOutStart}.`, timestamp: nowIso, state_start_ref: passOutStart || null, elapsed_hours: Math.round(passOutDurationHours * 100) / 100 });
              } catch (transitionError) {
                results.push({ character: charName, context, event: 'proof_write_failed', reason: 'pass_out_end SleepTransition write failed (canonical state already committed by authority)', transition_error: transitionError.message });
              }
              try { await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'recovery_event', valence: 'positive', severity: 'moderate', title: 'Recovered from pass-out', description: `${charName} woke after ${Math.round(passOutDurationHours * 100) / 100}h of recovery. Energy at ${Math.round(newNeeds.energy)}.`, emotional_impact: 'groggy, relieved', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['pass_out_end', 'recovery'] });
                await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} woke after ${Math.round(passOutDurationHours * 100) / 100}h of recovery from passing out. Groggy. Energy at ${Math.round(newNeeds.energy)}.`, memory_summary: `Recovered from pass-out after ${Math.round(passOutDurationHours * 100) / 100}h.`, importance_score: 6, permanence: 'long_term', related_character_id: char.id }); } catch (e) { results.push({ character: charName, event: 'consequence_write_failed', error: e.message }); }
              results.push({ character: charName, context, event: 'hard_12h_passout_wake', passout_duration_hours: Math.round(passOutDurationHours * 100) / 100, needs: { hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy), social: Math.round(newNeeds.social), health: Math.round(newNeeds.health), mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene), comfort: Math.round(newNeeds.comfort) } });
              continue;
            }
          } else {
            let passOutStartReconstructed = false;
            try {
              const passOutStartRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'pass_out_start', owner_email: ownerEmail }, '-timestamp', 1);
              if (passOutStartRecs.length > 0 && passOutStartRecs[0].timestamp) {
                const startTs = passOutStartRecs[0].timestamp;
                const passOutEndRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'pass_out_end', owner_email: ownerEmail }, '-timestamp', 1);
                const noContradictingEnd = passOutEndRecs.length === 0 || new Date(passOutEndRecs[0].timestamp).getTime() < new Date(startTs).getTime();
                if (noContradictingEnd) { await base44.entities.Character.update(char.id, { last_pass_out_at: startTs, last_need_simulated_at: nowIso }); passOutStartReconstructed = true; results.push({ character: charName, context, event: 'lifecycle_timestamp_reconstructed', reason: 'last_pass_out_at reconstructed from SleepTransition pass_out_start evidence', field: 'last_pass_out_at', evidence: 'pass_out_start', evidence_timestamp: startTs }); }
              }
            } catch (e) { /* fall through */ }
            if (!passOutStartReconstructed) { await base44.entities.Character.update(char.id, { last_need_simulated_at: nowIso }); results.push({ character: charName, context, event: 'unresolved_lifecycle_timestamp', reason: 'last_pass_out_at missing — 12h pass-out cap blocked, no fabricated history', field: 'last_pass_out_at', status: 'passed_out' }); }
          }
        }

        // ── HARD 3-HOUR NAP CAP ───────────────────────────────────────────
        if (dbIsNapping) {
          if (char.last_nap_time) {
            const napStartMs = new Date(char.last_nap_time).getTime();
            const napDurationHours = (Date.now() - napStartMs) / 3_600_000;
            if (napDurationHours >= 3) {
              // ── ONE TRUTH: Route the nap-end wake through the authority ──
              let _napWakeAuth = null;
              try {
                const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
                  character_id: char.id, owner_email: ownerEmail,
                  requested_presence_status: 'home',
                  requested_source_reason: 'nap_cap_3h',
                  requested_authority: 'simulateActiveCharacterNeeds',
                  requested_timestamp: nowIso,
                });
                _napWakeAuth = _ir?.data || _ir;
              } catch (invokeErr) {
                results.push({ character: charName, context, event: 'authority_invoke_failed', error: invokeErr.message });
                continue;
              }
              if (_napWakeAuth?.disposition !== 'accepted' && _napWakeAuth?.disposition !== 'redirected' && _napWakeAuth?.disposition !== 'modified') {
                results.push({ character: charName, context, event: 'authority_disposition', disposition: _napWakeAuth?.disposition, reason: _napWakeAuth?.reason });
                continue;
              }
              // Write only noncanonical need values directly
              await base44.entities.Character.update(char.id, {
                current_activity: '',
                hunger_value: Math.round(newNeeds.hunger), energy_value: Math.round(newNeeds.energy),
                social_value: Math.round(newNeeds.social), health_value: Math.round(newNeeds.health),
                mental_value: Math.round(newNeeds.mental), hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort), last_need_simulated_at: nowIso,
              });
              try {
                await base44.entities.SleepTransition.create({ character_id: char.id, character_name: charName, owner_email: ownerEmail, transition_type: 'nap_end', from_status: 'napping', to_status: _napWakeAuth.committed_result?.resolved_presence_status || 'home', authority: 'nap_cap_3h', reason: `Nap completed 3-hour cap. state_start_ref=${char.last_nap_time}.`, timestamp: nowIso, state_start_ref: char.last_nap_time || null, elapsed_hours: Math.round(napDurationHours * 100) / 100 });
              } catch (transitionError) {
                results.push({ character: charName, context, event: 'proof_write_failed', reason: 'nap_end SleepTransition write failed (canonical state already committed by authority)', transition_error: transitionError.message });
              }
              try { await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up from a nap', description: `${charName} napped ${Math.round(napDurationHours * 100) / 100}h, energy at ${Math.round(newNeeds.energy)}.`, emotional_impact: 'refreshed', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['nap_end', 'woke_up'] });
                await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} napped ${Math.round(napDurationHours * 100) / 100}h and woke refreshed.`, memory_summary: `Napped ${Math.round(napDurationHours * 100) / 100}h — woke refreshed.`, importance_score: 3, permanence: 'short_term', related_character_id: char.id }); } catch (e) { results.push({ character: charName, event: 'consequence_write_failed', error: e.message }); }
              results.push({ character: charName, context, event: 'hard_3h_nap_wake', nap_duration_hours: Math.round(napDurationHours * 100) / 100, needs: { hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy), social: Math.round(newNeeds.social), health: Math.round(newNeeds.health), mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene), comfort: Math.round(newNeeds.comfort) } });
              continue;
            }
          } else {
            let napStartReconstructed = false;
            try {
              const napStartRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'nap_start', owner_email: ownerEmail }, '-timestamp', 1);
              if (napStartRecs.length > 0 && napStartRecs[0].timestamp) {
                const startTs = napStartRecs[0].timestamp;
                const napEndRecs = await base44.entities.SleepTransition.filter({ character_id: char.id, transition_type: 'nap_end', owner_email: ownerEmail }, '-timestamp', 1);
                const noContradictingEnd = napEndRecs.length === 0 || new Date(napEndRecs[0].timestamp).getTime() < new Date(startTs).getTime();
                if (noContradictingEnd) { await base44.entities.Character.update(char.id, { last_nap_time: startTs, last_need_simulated_at: nowIso }); napStartReconstructed = true; results.push({ character: charName, context, event: 'lifecycle_timestamp_reconstructed', reason: 'last_nap_time reconstructed from SleepTransition nap_start evidence', field: 'last_nap_time', evidence: 'nap_start', evidence_timestamp: startTs }); }
              }
            } catch (e) { /* fall through */ }
            if (!napStartReconstructed) { await base44.entities.Character.update(char.id, { last_need_simulated_at: nowIso }); results.push({ character: charName, context, event: 'unresolved_lifecycle_timestamp', reason: 'last_nap_time missing — 3h nap cap blocked, no fabricated history', field: 'last_nap_time', status: 'napping' }); }
          }
        }

        // ── 19-HOUR AWAKE ENFORCEMENT ─────────────────────────────────────
        // ── DISABLED: 19-hour-awake pass-out is blocked per mandatory shutdown.
        // Awake-time continues to be tracked (last_wake_time is still written by
        // legitimate wake sources), but reaching 19+ hours must NOT trigger pass-out.
        // The threshold definition is retained for future restoration.
        if (!PASSOUT_19HOUR_DISABLED && !dbIsSleeping && !dbIsNapping && char.resolved_presence_status !== 'passed_out'
            && char.resolved_presence_status !== 'hospitalized' && !sleepLocked && !hasStayLock) {
          const awakeTimerCandidates = [];
          if (char.last_wake_time) awakeTimerCandidates.push(new Date(char.last_wake_time).getTime());
          if (char.last_nap_time) awakeTimerCandidates.push(new Date(char.last_nap_time).getTime());
          if (awakeTimerCandidates.length > 0) {
            const awakeTimerStartMs = Math.max(...awakeTimerCandidates);
            const awakeHours = (Date.now() - awakeTimerStartMs) / 3_600_000;
            if (awakeHours >= 19) {
              const passOutCount19h = (char.pass_out_count ?? 0) + 1;
              const homeLocId = char.current_home_location_id;
              const isAlreadyAtHome = char.resolved_current_location_id === homeLocId ||
                (char.resolved_location_type || '').toLowerCase() === 'home' ||
                char.resolved_presence_status === 'home';
              const homeRedirectFields = (homeLocId && !isAlreadyAtHome) ? { resolved_current_location_id: homeLocId, resolved_location_type: 'home', resolved_presence_status: 'home' } : {};
              const awakeLimitPayload = {
                ...homeRedirectFields,
                resolved_presence_status: 'passed_out',
                current_activity: 'passed out from forced exhaustion — 19-hour limit',
                last_pass_out_at: nowIso, pass_out_count: passOutCount19h,
                presence_stay_lock: true, presence_stay_lock_reason: 'pass_out_recovery',
                presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso,
                presence_stay_lock_created_by: 'system_automation', presence_stay_lock_release_condition: 'energy_above_35',
                hunger_value: Math.round(newNeeds.hunger), energy_value: Math.round(newNeeds.energy),
                social_value: Math.round(newNeeds.social), health_value: Math.round(newNeeds.health),
                mental_value: Math.round(newNeeds.mental), hygiene_value: Math.round(newNeeds.hygiene),
                comfort_value: Math.round(newNeeds.comfort), last_need_simulated_at: nowIso,
              };
              const awakeLimitRevertPayload = {
                resolved_presence_status: char.resolved_presence_status, current_activity: char.current_activity,
                last_pass_out_at: char.last_pass_out_at, pass_out_count: char.pass_out_count,
                presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
                presence_stay_lock_authority: char.presence_stay_lock_authority, presence_stay_lock_set_at: char.presence_stay_lock_set_at,
                presence_stay_lock_created_by: char.presence_stay_lock_created_by, presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
                resolved_current_location_id: char.resolved_current_location_id, resolved_location_type: char.resolved_location_type,
                hunger_value: char.hunger_value, energy_value: char.energy_value, social_value: char.social_value,
                health_value: char.health_value, mental_value: char.mental_value, hygiene_value: char.hygiene_value,
                comfort_value: char.comfort_value, last_need_simulated_at: char.last_need_simulated_at,
              };
              await base44.entities.Character.update(char.id, awakeLimitPayload);
              try {
                await base44.entities.SleepTransition.create({ character_id: char.id, character_name: charName, owner_email: ownerEmail, transition_type: 'pass_out_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'passed_out', authority: 'awake_limit_19h', reason: `Continuous awake time reached ${Math.round(awakeHours)}h (limit 19h). awake_timer_start=${new Date(awakeTimerStartMs).toISOString()}.`, timestamp: nowIso, state_start_ref: new Date(awakeTimerStartMs).toISOString(), awake_hours_at_pass_out: Math.round(awakeHours * 100) / 100 });
              } catch (transitionError) {
                let revertError = null;
                try { await base44.entities.Character.update(char.id, awakeLimitRevertPayload); } catch (e) { revertError = e.message; }
                results.push({ character: charName, context, event: 'unverified_state_write', reason: 'awake_limit_19h SleepTransition write failed — Character state reverted, event is UNVERIFIED', transition_error: transitionError.message, revert_error: revertError });
                continue;
              }
              try {
                await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'sleep_deprivation_event', valence: 'negative', severity: 'significant', title: 'Passed out — 19-hour forced exhaustion', description: `${charName} was awake for ${Math.round(awakeHours)} hours and collapsed from exhaustion.`, emotional_impact: 'forced collapse, embarrassment, loss of control', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['awake_limit', 'passed_out', 'forced_exhaustion', passOutCount19h > 1 ? 'repeat_pass_out' : 'first_pass_out'] });
                await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} stayed awake for over ${Math.round(awakeHours)} hours and collapsed from exhaustion.`, memory_summary: `Passed out at ${Math.round(awakeHours)}h awake — forced exhaustion.`, importance_score: 8, permanence: 'long_term', related_character_id: char.id });
              } catch (consequenceError) {
                results.push({ character: charName, context, event: 'consequence_write_failed', reason: 'awake_limit_19h LifeEvent/CharacterMemory failed for a verified transition', error: consequenceError.message });
                continue;
              }
              results.push({ character: charName, context, event: '19h_pass_out_forced_exhaustion', awake_hours: Math.round(awakeHours * 100) / 100, home_redirected: !!(homeLocId && !isAlreadyAtHome), pass_out_count: passOutCount19h, needs: { hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy), social: Math.round(newNeeds.social), health: Math.round(newNeeds.health), mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene), comfort: Math.round(newNeeds.comfort) } });
              continue;
            }
          } else {
            let wakeTimeReconstructed = false;
            try {
              const recentTransitions = await base44.entities.SleepTransition.filter({ character_id: char.id, owner_email: ownerEmail }, '-timestamp', 10);
              const wakeRecord = recentTransitions.find(t => t.transition_type === 'sleep_end' || t.transition_type === 'nap_end' || t.transition_type === 'pass_out_end');
              if (wakeRecord && wakeRecord.timestamp) {
                const wakeEndMs = new Date(wakeRecord.timestamp).getTime();
                const laterStart = recentTransitions.find(t => (t.transition_type === 'sleep_start' || t.transition_type === 'nap_start' || t.transition_type === 'pass_out_start') && t.timestamp && new Date(t.timestamp).getTime() > wakeEndMs);
                if (!laterStart) { await base44.entities.Character.update(char.id, { last_wake_time: wakeRecord.timestamp, last_need_simulated_at: nowIso }); wakeTimeReconstructed = true; results.push({ character: charName, context, event: 'lifecycle_timestamp_reconstructed', reason: 'last_wake_time reconstructed from SleepTransition wake evidence', field: 'last_wake_time', evidence: wakeRecord.transition_type, evidence_timestamp: wakeRecord.timestamp }); }
              }
            } catch (e) { /* fall through */ }
            if (!wakeTimeReconstructed) { await base44.entities.Character.update(char.id, { last_need_simulated_at: nowIso }); results.push({ character: charName, context, event: 'unresolved_lifecycle_timestamp', reason: 'last_wake_time missing — 19h awake enforcement blocked, no fabricated history', field: 'last_wake_time', status: char.resolved_presence_status || 'unknown' }); }
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // BUILD UPDATE PAYLOAD
        // ═══════════════════════════════════════════════════════════════════
        const updatePayload = {
          hunger_value:  Math.round(newNeeds.hunger * 100) / 100,
          energy_value:  Math.round(newNeeds.energy * 100) / 100,
          social_value:  Math.round(newNeeds.social * 100) / 100,
          health_value:  Math.round(newNeeds.health * 100) / 100,
          mental_value:  Math.round(newNeeds.mental * 100) / 100,
          hygiene_value: Math.round(newNeeds.hygiene * 100) / 100,
          comfort_value: Math.round(newNeeds.comfort * 100) / 100,
          last_need_simulated_at: nowIso,
        };

        const transitionCandidates = [];

        // RC1: corrective activity writer (sleep/nap/pass_out from pressure pipeline)
        const corrective = computeCorrectiveState(newNeeds, char, locationMap);
        if (corrective) {
          const cs = corrective.resolved_presence_status;
          if (cs === 'sleeping') {
            transitionCandidates.push({
              priority: 3,
              payload: { ...corrective, last_sleep_start: nowIso, presence_stay_lock: true, presence_stay_lock_reason: 'sleep_state', presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso, presence_stay_lock_created_by: 'system_automation', resolved_current_location_id: char.resolved_current_location_id, resolved_current_location_name: char.resolved_current_location_name || (locationMap[char.resolved_current_location_id]?.name) || 'Home', resolved_location_type: 'home', resolved_source_reason: 'sleep_state', resolved_last_updated_at: nowIso },
              transition: { transition_type: 'sleep_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'sleeping', authority: 'wake_time_boundary', reason: 'Corrective state: energy pressure triggered voluntary sleep decision.' },
              consequence: { type: 'sleep_start', energyValue: Math.round(newNeeds.energy) },
            });
          } else if (cs === 'napping') {
            transitionCandidates.push({
              priority: 4,
              payload: { ...corrective, last_nap_time: nowIso, presence_stay_lock: true, presence_stay_lock_reason: 'nap_state', presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso, presence_stay_lock_created_by: 'system_automation', resolved_current_location_id: char.resolved_current_location_id, resolved_current_location_name: char.resolved_current_location_name || (locationMap[char.resolved_current_location_id]?.name) || 'Home', resolved_location_type: 'home', resolved_source_reason: 'nap_state', resolved_last_updated_at: nowIso },
              transition: { transition_type: 'nap_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'napping', authority: 'wake_time_boundary', reason: 'Corrective state: energy pressure triggered nap decision.' },
              consequence: { type: 'nap_start', energyValue: Math.round(newNeeds.energy) },
            });
          } else if (cs === 'passed_out') {
            // This branch is only reachable for COMPOUND CRISIS pass-out (exhaustion is blocked above).
            transitionCandidates.push({
              priority: 2,
              payload: { ...corrective, last_pass_out_at: nowIso, pass_out_count: (char.pass_out_count ?? 0) + 1, presence_stay_lock: true, presence_stay_lock_reason: 'pass_out_recovery', presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso, presence_stay_lock_created_by: 'system_automation', presence_stay_lock_release_condition: 'energy_above_35' },
              transition: { transition_type: 'pass_out_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'passed_out', authority: 'compound_crisis', reason: 'Corrective state: critical need pressure forced involuntary collapse.' },
              consequence: null,
            });
          }
        }

        // RC2 (continued): energy reached zero this tick
        // ── DISABLED: Exhaustion-threshold pass-out (energy ≤ 0) is blocked per
        // mandatory shutdown. Energy may reach zero without triggering pass-out.
        if (!PASSOUT_EXHAUSTION_DISABLED && newNeeds.energy <= 0 && !sleepLocked && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'passed_out') {
          transitionCandidates.push({
            priority: 2,
            payload: { resolved_presence_status: 'passed_out', current_activity: 'passed out from exhaustion — critical energy depletion', last_pass_out_at: nowIso, pass_out_count: (char.pass_out_count ?? 0) + 1, presence_stay_lock: true, presence_stay_lock_reason: 'pass_out_recovery', presence_stay_lock_authority: 'simulateActiveCharacterNeeds', presence_stay_lock_set_at: nowIso, presence_stay_lock_created_by: 'system_automation', presence_stay_lock_release_condition: 'energy_above_35' },
            transition: { transition_type: 'pass_out_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'passed_out', authority: 'energy_passout', reason: `Energy reached ${Math.round(newNeeds.energy)} (zero) this tick.` },
            consequence: null,
          });
        }

        // RC3: ER escalation — health ≤15 or compound crisis with health ≤20
        const compoundCrisisHealth = newNeeds.health <= T.HEALTH_CRITICAL &&
          [newNeeds.hunger, newNeeds.energy, newNeeds.health].filter(v => v < T.HEALTH_CRITICAL).length >= 2;
        // A character already marked hospitalized but whose committed location is
        // NOT the hospital (resolved_location_type !== 'medical') is in the
        // "Home — Hospitalized" violation — the original hospitalization committed
        // the presence without moving the location. Re-issue the hospitalization
        // request so the authority reconciles the location to the hospital. This
        // is the existing RC3 admission path repairing its own incomplete commit;
        // no new rule or threshold. For a reconciliation (already hospitalized),
        // no transition record and no er_escalation consequence are produced —
        // only the location is fixed, so an already-hospitalized character does
        // not receive a duplicate "Emergency hospitalization" Recent Activity
        // entry. The discharge LifeEvent remains the only new Recent Activity.
        const _staleHospitalLocation = char.resolved_presence_status === 'hospitalized' &&
          (char.resolved_location_type || '').toLowerCase() !== 'medical';
        if ((newNeeds.health <= T.HEALTH_ER || compoundCrisisHealth) &&
            (char.resolved_presence_status !== 'hospitalized' || _staleHospitalLocation)) {
          transitionCandidates.push({
            priority: 1,
            payload: { resolved_presence_status: 'hospitalized', current_activity: 'hospitalized — health collapsed' },
            transition: _staleHospitalLocation ? null : { transition_type: 'hospitalized_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'hospitalized', authority: 'energy_medical', reason: `Health reached ${Math.round(newNeeds.health)} (threshold ${T.HEALTH_ER}).`, verified_higher_priority_interrupt: true, interrupt_reason: 'health_critical_15' },
            consequence: _staleHospitalLocation ? null : { type: 'er_escalation', healthValue: Math.round(newNeeds.health) },
          });
        }

        // RC3b: Hospital discharge — AND gate across the canonical life-needs
        // defined in needsStateEngine.js (getNeedStates): hunger, energy, social,
        // health, mental, hygiene, comfort. Financial need is excluded — it is
        // not a hospitalization recovery dimension. These are the same 7 needs
        // used in the HOSPITAL_STABILIZATION admission config, but the discharge
        // set is grounded in the canonical life-needs definition, not inferred
        // from the stabilization fields.
        // Threshold: 85 is the minimum of the approved 85–90% recovery range.
        // Discharge requires ALL dimensions to meet this minimum — no dimension
        // may remain below 85. Recovery is provided by existing activity
        // execution (triggerAutonomousActions needsEffect: hygiene +20, social
        // +15, mental +20, comfort +15, health +12) and the eating block
        // (hunger +15–16.5), NOT by passive hospitalization rates.
        if (char.resolved_presence_status === 'hospitalized') {
          const DISCHARGE_THRESHOLD = 85;
          const _allRecovered = [
            newNeeds.hunger, newNeeds.energy, newNeeds.social,
            newNeeds.health, newNeeds.mental, newNeeds.hygiene, newNeeds.comfort,
          ].every(v => v >= DISCHARGE_THRESHOLD);
          if (_allRecovered) {
            transitionCandidates.push({
              priority: 1,
              payload: { resolved_presence_status: 'home', current_activity: '' },
              transition: { transition_type: 'hospitalized_end', from_status: 'hospitalized', to_status: 'home', authority: 'energy_medical', reason: 'All recovery dimensions reached threshold — discharged and sent home.' },
              consequence: { type: 'hospital_discharge' },
            });
          }
        }

        // RC4: compound crisis — 3+ needs below 20 (PRESERVED — separate cause from exhaustion)
        const criticalNeeds = [newNeeds.hunger, newNeeds.energy, newNeeds.health, newNeeds.social, newNeeds.mental].filter(v => v < T.HUNGER_CRITICAL).length;
        if (criticalNeeds >= T.COMPOUND_CRISIS
            && char.resolved_presence_status !== 'sleeping'
            && char.resolved_presence_status !== 'napping'
            && char.resolved_presence_status !== 'passed_out'
            && char.resolved_presence_status !== 'hospitalized'
            && !sleepLocked) {
          transitionCandidates.push({
            priority: 2,
            payload: { resolved_presence_status: 'passed_out', current_activity: 'passed out from compound crisis — forced recovery', last_pass_out_at: nowIso, pass_out_count: (char.pass_out_count ?? 0) + 1 },
            transition: { transition_type: 'pass_out_start', from_status: char.resolved_presence_status || 'unknown', to_status: 'passed_out', authority: 'compound_crisis', reason: `Compound crisis: ${criticalNeeds} needs below critical threshold.` },
            consequence: { type: 'compound_crisis', criticalNeeds },
          });
        }

        // Pass-out release: energy > 35 and (6h elapsed OR medical emergency) — PRESERVED (recovery from existing pass-out)
        if (char.presence_stay_lock && char.presence_stay_lock_reason === 'pass_out_recovery' && char.resolved_presence_status === 'passed_out' && newNeeds.energy > 35) {
          const passOutStart = char.last_pass_out_at;
          const isMedicalEmergency6h = (newNeeds.health ?? 80) <= 15;
          let elapsedPassOutHours = 0;
          if (passOutStart) elapsedPassOutHours = (Date.now() - new Date(passOutStart).getTime()) / 3_600_000;
          const safeToRelease = (!passOutStart || elapsedPassOutHours >= 6) || isMedicalEmergency6h;
          if (safeToRelease) {
            transitionCandidates.push({
              priority: 5,
              payload: { resolved_presence_status: 'home', current_activity: '', last_wake_time: nowIso, presence_stay_lock: false, presence_stay_lock_reason: null, presence_stay_lock_release_condition: null },
              transition: { transition_type: 'pass_out_end', from_status: 'passed_out', to_status: 'home', authority: isMedicalEmergency6h ? 'energy_medical' : 'pass_out_cap_12h', reason: `Pass-out release: elapsed=${Math.round(elapsedPassOutHours * 100) / 100}h, energy=${Math.round(newNeeds.energy)}.`, state_start_ref: passOutStart || null, elapsed_hours: Math.round(elapsedPassOutHours * 100) / 100 },
              consequence: { type: 'pass_out_end_recovery', elapsedHours: Math.round(elapsedPassOutHours * 100) / 100, energyValue: Math.round(newNeeds.energy) },
            });
          }
        }

        // ── ONE TRUTH: Route canonical transitions through enforceCharacterLocationPresence ──
        // simulateActiveCharacterNeeds retains classification of which transition it is
        // requesting (sleeping, napping, passed_out, hospitalized, wake, etc.) but does
        // NOT directly write canonical presence, location, locks, or canonical timestamps.
        // Need values (hunger, energy, social, health, mental, hygiene, comfort) remain
        // noncanonical fields owned by this caller and are written directly.
        let selectedTransition = null;
        let authorityCommittedResult = null;
        if (transitionCandidates.length > 0) {
          selectedTransition = transitionCandidates.reduce((best, c) => (c.priority < best.priority ? c : best));
          // Route the canonical transition through the sole canonical writer.
          // Do NOT apply canonical fields to updatePayload — only need values go in the direct write.
          const requestedStatus = selectedTransition.payload?.resolved_presence_status || null;
          const requestedLocId = selectedTransition.payload?.resolved_current_location_id || null;
          const requestedReason = selectedTransition.payload?.resolved_source_reason || selectedTransition.transition?.reason || null;
          try {
            const invokeRes = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
              character_id: char.id, owner_email: ownerEmail,
              requested_presence_status: requestedStatus,
              requested_location_id: requestedLocId,
              requested_source_reason: requestedReason,
              requested_authority: selectedTransition.transition?.authority || 'simulateActiveCharacterNeeds',
              requested_timestamp: nowIso,
            });
            const authData = invokeRes?.data || invokeRes;
            const intendedTo = selectedTransition.transition?.to_status || null;
            if (authData?.must_resubmit_sleep === true) {
              // Authority redirected the sleep/nap request (e.g., sleep-at-work → move home
              // awake first). The redirect committed a MOVEMENT, not sleep. Do NOT record a
              // sleep_start/nap_start from the redirect. Re-submit the sleep/nap request at
              // the committed location; only the resubmit's accepted committed result records
              // the transition. One redirect → one resubmit (no loop).
              const resubmitLocId = authData?.committed_result?.resolved_current_location_id || requestedLocId;
              const redirectPresence = authData?.committed_result?.resolved_presence_status || null;
              try {
                const resubmitRes = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
                  character_id: char.id, owner_email: ownerEmail,
                  requested_presence_status: requestedStatus,
                  requested_location_id: resubmitLocId,
                  requested_source_reason: requestedReason,
                  requested_authority: selectedTransition.transition?.authority || 'simulateActiveCharacterNeeds',
                  requested_timestamp: nowIso,
                });
                const resubmitData = resubmitRes?.data || resubmitRes;
                const resubmitPresence = resubmitData?.committed_result?.resolved_presence_status || null;
                // Record only when the resubmit is accepted, not still redirecting, and the
                // committed presence matches the intended transition (e.g., 'napping').
                if (resubmitData?.disposition === 'accepted' && !resubmitData?.must_resubmit_sleep && resubmitPresence === intendedTo) {
                  authorityCommittedResult = resubmitData.committed_result;
                  // Use the committed result: from_status = post-redirect presence (where the
                  // character actually was when sleep/nap began), to_status = committed presence.
                  sleepTransitionsToRecord.push({ ...selectedTransition.transition, from_status: redirectPresence || selectedTransition.transition.from_status, to_status: resubmitPresence });
                  if (selectedTransition.consequence) pendingConsequences.push(selectedTransition.consequence);
                } else {
                  results.push({ character: charName, context, event: 'authority_resubmit_disposition', disposition: resubmitData?.disposition, reason: resubmitData?.reason });
                }
              } catch (resubmitErr) {
                results.push({ character: charName, context, event: 'authority_resubmit_failed', error: resubmitErr.message });
              }
            } else if (authData?.disposition === 'accepted') {
              const committedPresence = authData?.committed_result?.resolved_presence_status || null;
              // Record the transition only when the committed presence matches the intended
              // transition (e.g., a nap_start records only when committed presence is 'napping').
              // A redirected movement (awake home) does NOT record a sleep/nap start.
              if (committedPresence === intendedTo) {
                authorityCommittedResult = authData.committed_result;
                sleepTransitionsToRecord.push({ ...selectedTransition.transition, to_status: committedPresence });
                if (selectedTransition.consequence) pendingConsequences.push(selectedTransition.consequence);
              } else {
                results.push({ character: charName, context, event: 'authority_disposition_mismatch', disposition: authData?.disposition, intended: intendedTo, committed: committedPresence, reason: authData?.reason });
              }
            } else {
              // redirected (without must_resubmit_sleep), deferred, rejected, no_longer_applicable —
              // do not create records claiming the transition occurred.
              results.push({ character: charName, context, event: 'authority_disposition', disposition: authData?.disposition, reason: authData?.reason });
            }
          } catch (invokeErr) {
            results.push({ character: charName, context, event: 'authority_invoke_failed', error: invokeErr.message });
          }
        }

        // CORRECTION 3: When the authority commits a fresh hospitalization, it
        // applies one-time HOSPITAL_STABILIZATION amounts to the character's needs.
        // The updatePayload below would overwrite those stabilized values with the
        // pre-stabilization newNeeds. Remove need values from updatePayload so the
        // stabilization committed by the authority persists. Only last_need_simulated_at
        // is written for this tick. The reconciliation path (_staleHospitalLocation)
        // does not apply stabilization — its transition is null — so need values are
        // preserved for that case.
        if (authorityCommittedResult?.resolved_presence_status === 'hospitalized' &&
            selectedTransition?.transition?.transition_type === 'hospitalized_start') {
          for (const k of ['hunger_value','energy_value','social_value','health_value','mental_value','hygiene_value','comfort_value']) {
            delete updatePayload[k];
          }
        }

        const staleCleanup = resolveStaleCorrectiveActivities(char, newNeeds);
        if (staleCleanup) {
          // ── ONE TRUTH: staleCleanup may contain resolved_presence_status (canonical).
          // Route the canonical wake through the authority. Only current_activity
          // (noncanonical) goes into the direct updatePayload.
          if (staleCleanup.current_activity !== undefined) {
            updatePayload.current_activity = staleCleanup.current_activity;
          }
          if (staleCleanup.resolved_presence_status) {
            const _wasResting = dbIsSleeping || dbIsNapping || dbIsPassedOut;
            const _nowAwake = staleCleanup.resolved_presence_status === 'home';
            try {
              const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
                character_id: char.id, owner_email: ownerEmail,
                requested_presence_status: staleCleanup.resolved_presence_status,
                requested_source_reason: 'stale_corrective_cleanup',
                requested_authority: 'simulateActiveCharacterNeeds',
                requested_timestamp: nowIso,
              });
              const _authData = _ir?.data || _ir;
              if (_authData?.disposition === 'accepted' || _authData?.disposition === 'redirected' || _authData?.disposition === 'modified') {
                if (_wasResting && _nowAwake && !sleepTransitionsToRecord.some(t => t.transition_type.endsWith('_end'))) {
                  const _wt = dbIsSleeping ? 'sleep_end' : dbIsNapping ? 'nap_end' : 'pass_out_end';
                  const _fs = dbIsSleeping ? 'sleeping' : dbIsNapping ? 'napping' : 'passed_out';
                  sleepTransitionsToRecord.push({ transition_type: _wt, from_status: _fs, to_status: 'home', authority: 'stale_corrective_cleanup', reason: 'Stale corrective state cleared — wake activity created to prevent silent wake.' });
                  pendingConsequences.push({ type: 'stale_wake', energyValue: Math.round(newNeeds.energy), wakeType: _wt });
                }
              }
            } catch (invokeErr) {
              results.push({ character: charName, context, event: 'authority_invoke_failed', error: invokeErr.message });
            }
          }
        }

        const staleIntent = resolveStaleDecisionIntents(char);
        if (staleIntent) Object.assign(updatePayload, staleIntent);

        const rc6RevertPayload = {
          resolved_presence_status: char.resolved_presence_status, current_activity: char.current_activity,
          last_sleep_start: char.last_sleep_start, last_nap_time: char.last_nap_time,
          last_pass_out_at: char.last_pass_out_at, last_wake_time: char.last_wake_time, pass_out_count: char.pass_out_count,
          presence_stay_lock: char.presence_stay_lock, presence_stay_lock_reason: char.presence_stay_lock_reason,
          presence_stay_lock_authority: char.presence_stay_lock_authority, presence_stay_lock_set_at: char.presence_stay_lock_set_at,
          presence_stay_lock_created_by: char.presence_stay_lock_created_by, presence_stay_lock_release_condition: char.presence_stay_lock_release_condition,
        };

        await base44.entities.Character.update(char.id, updatePayload);

        let rc6TransitionsVerified = true;
        let rc6TransitionFailure = null;
        for (const t of sleepTransitionsToRecord) {
          try {
            await base44.entities.SleepTransition.create({ character_id: char.id, character_name: charName, owner_email: ownerEmail, timestamp: nowIso, ...t });
          } catch (transitionError) {
            rc6TransitionsVerified = false;
            rc6TransitionFailure = { transition_type: t.transition_type, error: transitionError.message };
            break;
          }
        }

        if (!rc6TransitionsVerified) {
          let revertError = null;
          try { await base44.entities.Character.update(char.id, rc6RevertPayload); } catch (e) { revertError = e.message; }
          results.push({ character: charName, context, event: 'unverified_state_write', reason: `SleepTransition proof record failed (${rc6TransitionFailure.transition_type}) — Character state reverted, event is UNVERIFIED`, transition_error: rc6TransitionFailure.error, revert_error: revertError });
          continue;
        }

        for (const c of pendingConsequences) {
          try {
            if (c.type === 'er_escalation') {
              await base44.entities.ScheduledEvent.create({ character_id: char.id, character_name: charName, event_type: 'medical_emergency', title: 'Emergency hospitalization', description: `${charName} was hospitalized due to critical health collapse (health: ${c.healthValue}).`, scheduled_time: nowIso, status: 'active', owner_email: ownerEmail });
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'medical_event', valence: 'negative', severity: 'major', title: 'Emergency hospitalization', description: `${charName} was rushed to the hospital — health collapsed to ${c.healthValue}.`, emotional_impact: 'critical medical event', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['er_escalation', 'hospitalized'] });
            } else if (c.type === 'hospital_discharge') {
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'recovery_event', valence: 'positive', severity: 'moderate', title: 'Discharged from hospital', description: `${charName} recovered enough to leave the hospital and was sent home.`, emotional_impact: 'relieved', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['hospitalized_end', 'discharge', 'sent_home'] });
            } else if (c.type === 'compound_crisis') {
              await base44.entities.ScheduledEvent.create({ character_id: char.id, character_name: charName, event_type: 'compound_crisis_recovery', title: 'Compound crisis — forced rest', description: `${charName} was put to rest — ${c.criticalNeeds} needs below critical threshold.`, scheduled_time: nowIso, status: 'active', owner_email: ownerEmail });
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'medical_event', valence: 'negative', severity: 'major', title: 'Compound crisis — forced rest', description: `${charName}'s body gave out — ${c.criticalNeeds} needs were critical.`, emotional_impact: 'physical collapse', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['compound_crisis'] });
            } else if (c.type === 'sleep_start') {
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Went to sleep', description: `${charName} felt tired and went to sleep. Energy at ${c.energyValue}.`, emotional_impact: 'tired but choosing rest', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['sleep_start', 'voluntary_sleep'] });
              await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} felt tired and went to sleep. Energy at ${c.energyValue}.`, memory_summary: `Went to sleep at energy ${c.energyValue}.`, importance_score: 3, permanence: 'short_term', related_character_id: char.id });
            } else if (c.type === 'nap_start') {
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Took a nap', description: `${charName} took a nap to recover. Energy at ${c.energyValue}.`, emotional_impact: 'tired, resting', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['nap_start', 'voluntary_nap'] });
              await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} took a nap to recover energy. Energy at ${c.energyValue}.`, memory_summary: `Took a nap at energy ${c.energyValue}.`, importance_score: 2, permanence: 'short_term', related_character_id: char.id });
            } else if (c.type === 'pass_out_end_recovery') {
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'recovery_event', valence: 'positive', severity: 'moderate', title: 'Recovered from pass-out', description: `${charName} woke after ${c.elapsedHours}h of recovery. Energy at ${c.energyValue}.`, emotional_impact: 'groggy, relieved', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: ['pass_out_end', 'recovery'] });
              await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} woke after ${c.elapsedHours}h of recovery from passing out.`, memory_summary: `Recovered from pass-out after ${c.elapsedHours}h.`, importance_score: 6, permanence: 'long_term', related_character_id: char.id });
            } else if (c.type === 'stale_wake') {
              const _wTitle = c.wakeType === 'pass_out_end' ? 'Recovered from pass-out' : c.wakeType === 'nap_end' ? 'Woke up from a nap' : 'Woke up';
              await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'recovery_event', valence: 'positive', severity: 'minor', title: _wTitle, description: `${charName} woke up. Energy at ${c.energyValue}.`, emotional_impact: c.wakeType === 'pass_out_end' ? 'groggy' : 'rested', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: [c.wakeType, 'woke_up', 'stale_cleanup'] });
              await base44.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${charName} woke up. Energy at ${c.energyValue}.`, memory_summary: `Woke up at energy ${c.energyValue}.`, importance_score: 4, permanence: 'short_term', related_character_id: char.id });
            }
          } catch (consequenceError) {
            results.push({ character: charName, context, event: 'consequence_write_failed', reason: `Consequence creation failed for a verified transition (${c.type})`, error: consequenceError.message });
          }
        }

        const escalations = detectCriticalEscalations(needs, newNeeds, charName);
        for (const esc of escalations) {
          await base44.entities.LifeEvent.create({ character_id: char.id, character_name: charName, event_type: 'medical_event', valence: 'negative', severity: 'significant', title: esc.title, description: esc.description, emotional_impact: 'physical distress', triggered_by: 'life_simulation', timestamp: nowIso, context_tags: [esc.memory_tag] }).catch(() => {});
        }

        updatePayload.financial_need_value = deriveFinancialNeed(char);

        const nextActivity = resolveNextActivity(newNeeds, char);
        const isCorrectiveActive = corrective && (corrective.current_activity || '').includes(' — ');

        results.push({
          character: charName, context,
          needs: { hunger: Math.round(newNeeds.hunger), energy: Math.round(newNeeds.energy), social: Math.round(newNeeds.social), health: Math.round(newNeeds.health), mental: Math.round(newNeeds.mental), hygiene: Math.round(newNeeds.hygiene), comfort: Math.round(newNeeds.comfort) },
          corrective_applied: corrective ? Object.keys(corrective) : null,
          escalations: escalations.length,
          pressure_profile: nextActivity,
          stale_corrective_cleared: staleCleanup ? Object.keys(staleCleanup) : null,
          elapsed_hours: Math.round(elapsedHours * 100) / 100,
        });

        await new Promise(r => setTimeout(r, 200));
      } catch (charError) {
        console.error(`[simulateActiveCharacterNeeds] Error for ${char.name || char.id}: ${charError.message}`);
        results.push({ character: char.name || char.id, status: 'error', error: charError.message });
      }
    }

    return Response.json({
      success: true,
      simulated: results.filter(r => r.status !== 'error' && r.status !== 'skipped').length,
      ownerEmail, timestamp: nowIso, results,
    });

  } catch (error) {
    console.error(`[simulateActiveCharacterNeeds] Fatal: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});