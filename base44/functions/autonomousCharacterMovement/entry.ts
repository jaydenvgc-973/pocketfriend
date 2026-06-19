import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── CANONICAL TRAIT REGISTRY (inlined — no local imports in Deno functions) ──
// Mirrors lib/characterTraitRegistry.js. Keep in sync.
const TRAIT_COMMITMENT_MODIFIERS = {
  trait_loyal:           +3,
  trait_conscientious:   +2,
  trait_parental:        +1,
  trait_empathetic:      +1,
  trait_compassionate:   +1,
  trait_polite:          +1,
  trait_overcorrects:    +1,
  trait_adaptable:       +0.5,
  trait_stubborn:        +0.5,
  trait_leader:          +1,
  trait_goody_two_shoes: +1,
  trait_law_abiding:     +1,
  trait_two_faced:       -2,
  trait_wishy_washy:     -2,
  trait_toxic:           -1,
  trait_self_absorbed:   -1,
  trait_hot_and_cold:    -1,
  trait_easily_distracted: -1,
  trait_volatile:        -1,
  trait_philanderer:     -1,
  trait_rude:            -0.5,
  trait_cynical:         -0.5,
  trait_hard_to_read:    -0.5,
};
const QUIRK_COMMITMENT_MODIFIERS = {
  disciplined:     +2,
  people_pleaser:  +1,
  workaholic:      -0.5,
  unmotivated:     -1,
  overthinker:     -0.5,
  thrill_seeker:   -1,
  drinker:         -0.5,
};

/**
 * Compute commitment reliability score for a character from canonical traits/quirks.
 * Returns a numeric delta. 0 = average. Positive = more reliable. Negative = less reliable.
 */
function computeCommitmentReliabilityScore(char) {
  let score = 0;
  for (const [key, mod] of Object.entries(TRAIT_COMMITMENT_MODIFIERS)) {
    if (char[key] === true) score += mod;
  }
  const quirks = char.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    const mod = QUIRK_COMMITMENT_MODIFIERS[q.quirk_id] || 0;
    const mult = q.intensity === 'mild' ? 0.5 : q.intensity === 'strong' ? 1.5 : 1.0;
    score += mod * mult;
  }
  return score;
}

// ── INLINE PRESENCE STAY LOCK VALIDATOR ──────────────────────────────────────
// No network call. Observes authoritative state. Does NOT duplicate sleep/work/school logic.
function validateStayLock(char, nowET) {
  if (!char || char.presence_stay_lock !== true) {
    return { shouldRespectLock: false, shouldReleaseLock: false, reason: 'no_lock_active', authority: null, lockReason: null, proof: 'Lock not active' };
  }

  const lockReason = char.presence_stay_lock_reason || null;
  const lockAuthority = char.presence_stay_lock_authority || null;
  const lockExpiresAt = char.presence_stay_lock_expires_at || null;

  // Legacy lock detection
  const isLegacy = !lockReason && !lockAuthority && !lockExpiresAt && !char.presence_stay_lock_release_condition;

  if (isLegacy) {
    const lockSetAt = char.presence_stay_lock_set_at ? new Date(char.presence_stay_lock_set_at).getTime() : null;
    const lockLocId = char.presence_stay_lock_location_id || null;
    const curLocId = char.resolved_current_location_id || null;

    if (!lockSetAt) {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'orphaned_legacy_lock_no_timestamp', authority: lockAuthority, lockReason: lockReason, proof: 'Legacy lock missing set_at' };
    }
    if (lockLocId && curLocId && lockLocId !== curLocId) {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'legacy_lock_location_mismatch', authority: lockAuthority, lockReason: lockReason, proof: `Locked at ${lockLocId}, now at ${curLocId}` };
    }
    if (nowET.getTime() - lockSetAt > 12 * 60 * 60 * 1000) {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'stale_legacy_lock', authority: lockAuthority, lockReason: lockReason, proof: 'Legacy lock > 12 hours old' };
    }
  }

  // Expiration
  if (lockExpiresAt && nowET > new Date(lockExpiresAt)) {
    return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'expired', authority: lockAuthority, lockReason: lockReason, proof: `Expired at ${lockExpiresAt}` };
  }

  // Emergency override
  if ((char.energy_value ?? 75) < 10 || (char.health_value ?? 80) < 25) {
    return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'emergency_need_override', authority: 'needs_system', lockReason: lockReason, proof: `Energy: ${char.energy_value}, Health: ${char.health_value}` };
  }

  // Observe authoritative state — do NOT duplicate sleep/work/school logic
  const status = char.resolved_presence_status || '';
  const sourceReason = char.resolved_source_reason || '';

  if (lockReason === 'sleep_state') {
    if (status !== 'sleeping' && status !== 'napping') {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'sleep_obligation_completed', authority: lockAuthority, lockReason: lockReason, proof: `No longer sleeping (status=${status})` };
    }
  }
  if (lockReason === 'work_shift') {
    if (status !== 'at_work' && sourceReason !== 'work_schedule') {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'work_shift_completed', authority: lockAuthority, lockReason: lockReason, proof: `No longer at work (status=${status})` };
    }
  }
  if (lockReason === 'school_schedule') {
    if (status !== 'at_school' && sourceReason !== 'school_schedule') {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'school_schedule_completed', authority: lockAuthority, lockReason: lockReason, proof: `No longer at school (status=${status})` };
    }
  }

  // Scene end release
  if (char.presence_stay_lock_release_condition === 'scene_end' && lockReason === 'user_scene_stay') {
    if (char.resolved_current_location_id !== char.presence_stay_lock_location_id) {
      return { shouldRespectLock: false, shouldReleaseLock: true, releaseReason: 'scene_ended_user_left', authority: lockAuthority, lockReason: lockReason, proof: 'User left scene location' };
    }
  }

  return { shouldRespectLock: true, shouldReleaseLock: false, reason: isLegacy ? 'valid_legacy_lock' : 'valid_active_lock', authority: lockAuthority, lockReason: lockReason, proof: isLegacy ? 'Legacy lock respected' : `Lock '${lockReason}' still active` };
}

// ── SHARED TIME HELPER ────────────────────────────────────────────────────────
// Used by multiple helpers throughout this file (orphaned travel guard, work schedule check, etc.)
function toMin(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); }

// Check if location is currently open based on operating hours
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInWindow(currentMinutes, openStr, closeStr) {
  const open = toMinutes(openStr);
  const close = toMinutes(closeStr);
  if (open == null || close == null) return false;
  if (open <= close) {
    return currentMinutes >= open && currentMinutes <= close;
  }
  return currentMinutes >= open || currentMinutes <= close;
}

function isLocationOpen(location) {
  if (!location?.operating_hours || location.operating_hours.length === 0) {
    return true; // No hours = always open
  }
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nowET.getDay();
  const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
  const daySpecific = location.operating_hours.filter(h => h.day_of_week != null);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) {
    return todayEntries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  if (daySpecific.length > 0 && todayEntries.length === 0) {
    return false;
  }
  if (dayAgnostic.length > 0) {
    return dayAgnostic.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
  }
  return true;
}

/**
 * AUTONOMOUS CHARACTER MOVEMENT — NEEDS-DRIVEN
 *
 * Runs every 30 minutes. Evaluates each active_created_character's raw need
 * values and moves them to the best available location.
 *
 * THRESHOLD (internal urgency — NOT UI labels):
 *   > 70    no urgency — optional movement only (25% chance)
 *   50–70   awareness  — begin evaluating (50% chance)
 *   < 50    URGENT     — mandatory movement attempt
 *   < 25    HIGH       — strong prioritization, no delay
 *   < 10    EMERGENCY  — maximum urgency score
 *
 * Below 50 = system MUST attempt movement or prove a blocking reason.
 * Silent skipping at < 50 is a SYSTEM FAILURE.
 *
 * OWNER_EMAIL ISOLATION: character may only move to locations where
 *   destination.owner_email === character.owner_email
 */

// sleep_start_time and wake_up_time are METADATA only.
// They are NOT used to enforce sleep or wake for active_created_characters.
// Sleep onset is driven by energy levels. Wake is driven by energy recovery and real obligations.

// ── CURRENT-LOCATION SATISFACTION CHECK ───────────────────────────────────────
// Returns true if the character's urgent need can be satisfied at their current
// location without requiring travel.
//
// IMPORTANT: "can satisfy here" does NOT mean "must stay here."
// It is a factor in the stay-vs-travel decision, not a hard block.
//
// Rules:
//   hunger → can eat at home, at a food_drink/grocery location, or at work with food
//   energy → can rest at home
//   social → can text/call or interact with people at current location
//   hygiene → can shower/groom at home or gym with showers
//   comfort → can improve comfort at home (rest, change rooms, sit)
//   health/mental → may require specific venues
// ── REPAIRED: satisfactionQuality evaluates ALL urgent needs, not just top ──
// Returns { quality: 'fully'|'partially'|'weakly'|'not', detail, per_need }
// "fully" = need is well-handled here
// "partially" = somewhat handled but not ideal
// "weakly" = possible but not great (text/call for critical social)
// "not" = cannot satisfy here
// NOTE: This is a FACTOR in stay-vs-travel, NOT a hard block.
function satisfactionQuality(char, vals, currentLoc) {
  if (!currentLoc) return { quality: 'no_location', detail: 'No current location' };
  const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);
  if (urgentNeeds.length === 0) return { quality: 'no_need', detail: 'No urgent need' };

  const cat = (currentLoc.category || '').toLowerCase();
  const se = char.social_energy || 'ambivert';
  const qualities = [];

  for (const [key, val] of urgentNeeds) {
    const urg = urgencyLevel(val);

    if (key === 'hunger') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can cook/eat at home' });
      else if (cat === 'food_drink')
        qualities.push({ key, quality: 'fully', detail: 'At a food venue' });
      else if (cat === 'grocery')
        qualities.push({ key, quality: 'fully', detail: 'Can buy food' });
      else if (cat === 'workplace' && char.resolved_presence_status === 'at_work')
        qualities.push({ key, quality: 'partially', detail: 'May eat at work' });
      else
        qualities.push({ key, quality: 'not', detail: 'No food available here' });
    }
    else if (key === 'energy') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can rest at home' });
      else
        qualities.push({ key, quality: 'not', detail: 'Cannot properly rest here' });
    }
    else if (key === 'social') {
      if (cat === 'social' || cat === 'food_drink')
        qualities.push({ key, quality: 'fully', detail: 'Real in-person social interaction available' });
      else if (cat === 'outdoor' || cat === 'community')
        qualities.push({ key, quality: 'fully', detail: 'Public space with social possibilities' });
      else if (cat === 'workplace' && char.resolved_presence_status === 'at_work')
        qualities.push({ key, quality: 'partially', detail: 'Coworker interaction available' });
      else if (cat === 'school')
        qualities.push({ key, quality: 'partially', detail: 'Peer interaction available' });
      else if (cat === 'home') {
        if (urg <= 2 && val >= 40)
          qualities.push({ key, quality: 'fully', detail: 'Text/call sufficient for mild social need' });
        else if (urg >= 3 || val < 25)
          qualities.push({ key, quality: 'weakly', detail: 'Only text/call at home — in-person would be better' });
        else
          qualities.push({ key, quality: 'partially', detail: 'Text/call possible but in-person better' });
      }
      else {
        if (val < 30)
          qualities.push({ key, quality: 'weakly', detail: 'Only text/call available' });
        else
          qualities.push({ key, quality: 'partially', detail: 'Text/call is possible' });
      }
    }
    else if (key === 'hygiene') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Can shower/groom at home' });
      else if (cat === 'gym') {
        const features = (currentLoc.features || []).map(f => f.toLowerCase());
        if (features.some(f => f.includes('shower') || f.includes('locker')))
          qualities.push({ key, quality: 'partially', detail: 'Gym has shower/locker facilities' });
        else
          qualities.push({ key, quality: 'weakly', detail: 'Gym without showers' });
      }
      else
        qualities.push({ key, quality: 'not', detail: 'No hygiene facilities here' });
    }
    else if (key === 'comfort') {
      if (cat === 'home')
        qualities.push({ key, quality: 'fully', detail: 'Home is comfortable' });
      else if (cat === 'outdoor')
        qualities.push({ key, quality: 'partially', detail: 'Change of scenery helps' });
      else
        qualities.push({ key, quality: 'weakly', detail: 'Limited comfort options' });
    }
    else if (key === 'health') {
      if (cat === 'medical')
        qualities.push({ key, quality: 'fully', detail: 'Medical facility' });
      else if (cat === 'home' && urg <= 2)
        qualities.push({ key, quality: 'partially', detail: 'Can rest at home' });
      else
        qualities.push({ key, quality: 'not', detail: 'Cannot address health here' });
    }
    else if (key === 'mental') {
      if (cat === 'home' || cat === 'outdoor' || cat === 'religion')
        qualities.push({ key, quality: 'fully', detail: 'Calm environment' });
      else if (cat === 'gym')
        qualities.push({ key, quality: 'partially', detail: 'Exercise helps mental state' });
      else
        qualities.push({ key, quality: 'weakly', detail: 'Limited mental recovery' });
    }
    else {
      qualities.push({ key, quality: 'not', detail: `Cannot satisfy ${key}` });
    }
  }

  const rank = { fully: 3, partially: 2, weakly: 1, not: 0 };
  qualities.sort((a, b) => rank[a.quality] - rank[b.quality]);
  const worst = qualities[0];
  const allDetails = qualities.map(q => `${q.key}:${q.quality}`).join(', ');

  return {
    quality: worst.quality,
    detail: `${worst.detail} [${allDetails}]`,
    per_need: qualities,
  };
}

// ── STAY-VS-TRAVEL WEIGHTED DECISION ──────────────────────────────────────────
// When the character CAN satisfy their top need at their current location,
// this computes a probability of staying. It considers:
//   1. How many needs are urgent (more urgent needs = more likely to travel)
//   2. Personality (homebodies stay more, social characters travel more)
//   3. Combined pressures (hunger + social = dining out more attractive than eating at home)
//   4. Time of day (evening social hours make travel more likely)
//
// Returns a stay probability (0.0 to 1.0). The caller flips a weighted coin.
// ── REPAIRED: computeStayProbability uses satisfaction QUALITY and EXACT VALUES ──
// satQuality comes from satisfactionQuality() — per-need quality levels.
// Severity pressure only applies for needs NOT fully satisfied at current location.
function computeStayProbability(char, vals, currentLoc, nowET, satQuality) {
  const cat = (currentLoc?.category || '').toLowerCase();
  const hour = nowET.getHours();
  const isEvening = hour >= 17 && hour < 23;
  const isLate = hour >= 22 || hour < 5;
  const urgentNeeds = Object.entries(vals).filter(([, v]) => urgencyLevel(v) >= 2);
  const urgentKeys = urgentNeeds.map(([k]) => k);
  const urgentCount = urgentNeeds.length;

  let stayProb = 0.55;

  // ── SATISFACTION QUALITY WEIGHT ────────────────────────────────────────
  if (satQuality) {
    if (satQuality.quality === 'fully')  stayProb += 0.25;
    if (satQuality.quality === 'partially') stayProb += 0.05;
    if (satQuality.quality === 'weakly') stayProb -= 0.25;
    if (satQuality.quality === 'not')    stayProb -= 0.40;
  }

  // ── LOCATION BASE ──────────────────────────────────────────────────────
  if (cat === 'home') {
    stayProb += 0.08; // reduced from 0.20 — home shouldn't dominate weakly satisfied needs
    if (char.trait_night_owl === false && char.trait_risk_taker === false) stayProb += 0.05;
  }

  // ── NEED SEVERITY — only penalize for needs NOT fully satisfied here ─────
  const perNeedQuality = {};
  if (satQuality && satQuality.per_need) {
    for (const pn of satQuality.per_need) perNeedQuality[pn.key] = pn.quality;
  }
  for (const [key, val] of urgentNeeds) {
    const curSatisfied = perNeedQuality[key] || 'not';
    if (curSatisfied === 'fully') continue; // no pressure — need is handled here
    const severity = (100 - val) / 100;
    if (key === 'social' && cat === 'home' && curSatisfied !== 'fully') {
      stayProb -= severity * 0.35;
    } else {
      stayProb -= severity * 0.15;
    }
  }

  // ── COMBINED PRESSURES ─────────────────────────────────────────────────
  if (urgentCount >= 2) {
    stayProb -= 0.10 * (urgentCount - 1);
    if (urgentKeys.includes('social') && urgentKeys.includes('hunger') && cat === 'home')
      stayProb -= 0.15;
    if (urgentKeys.includes('social') && (char.trait_competitive || /gym|fitness|workout/.test((char.health_habits || '').toLowerCase())))
      stayProb -= 0.10;
    if (urgentKeys.includes('hunger') && (vals.financial || 60) < 40 && cat === 'home')
      stayProb += 0.10;
  }

  // ── PERSONALITY ────────────────────────────────────────────────────────
  const se = char.social_energy || 'ambivert';
  if (se === 'extrovert' || se === 'mostly_extrovert') stayProb -= 0.12;
  if (se === 'introvert' || se === 'mostly_introvert') stayProb += 0.10;
  if (char.trait_flirty || char.trait_uninhibited) stayProb -= 0.08;
  if (char.trait_stubborn) stayProb -= 0.05;
  if (char.trait_conscientious) stayProb += 0.06;

  // ── EMOTIONAL STATE ────────────────────────────────────────────────────
  const emo = (char.emotional_state || 'calm').toLowerCase();
  if (['joyful', 'excited', 'bored', 'restless'].includes(emo)) stayProb -= 0.10;
  if (['sad', 'overwhelmed', 'burnt out', 'grief'].includes(emo)) stayProb += 0.12;

  // ── TIME OF DAY ────────────────────────────────────────────────────────
  if (isEvening && urgentKeys.includes('social')) stayProb -= 0.10;
  if (isLate) stayProb += 0.15;

  // ── QUIRKS ────────────────────────────────────────────────────────────
  const quirks = char.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    if (q.quirk_id === 'homebody') stayProb += q.intensity === 'strong' ? 0.15 : 0.08;
    if (q.quirk_id === 'thrill_seeker') stayProb -= 0.10;
  }

  return Math.max(0.05, Math.min(0.92, stayProb));
}

// ── RAW NEED VALUES ────────────────────────────────────────────────────────────
function needValues(char) {
  return {
    hunger:   char.hunger_value          ?? 70,
    energy:   char.energy_value          ?? 75,
    social:   char.social_value          ?? 65,
    health:   char.health_value          ?? 80,
    mental:   char.mental_value          ?? 70,
    hygiene:  char.hygiene_value         ?? 75,
    comfort:  char.comfort_value         ?? 70,
    financial: char.financial_need_value ?? 60,
  };
}

// ── URGENCY LEVEL ──────────────────────────────────────────────────────────────
// 0 = none | 1 = awareness | 2 = urgent | 3 = high | 4 = emergency
function urgencyLevel(value) {
  if (value < 10) return 4;
  if (value < 25) return 3;
  if (value < 50) return 2;
  if (value < 70) return 1;
  return 0;
}

// ── LOWEST URGENCY NEED ────────────────────────────────────────────────────────
function highestUrgencyEntry(vals) {
  return Object.entries(vals)
    .map(([k, v]) => ({ key: k, value: v, urgency: urgencyLevel(v) }))
    .sort((a, b) => b.urgency - a.urgency || a.value - b.value)[0];
}

// ── NIGHTLIFE / CLUB DETECTION ────────────────────────────────────────────────
// A location is "nightlife" if its category is 'social' and its name/subtype
// suggests a club, bar, lounge, or nightlife venue. food_drink (cafés, restaurants)
// are NOT considered nightlife — only dedicated nightlife venues.
function isNightlifeVenue(location) {
  if (location.category !== 'social') return false;
  const name = (location.name || '').toLowerCase();
  const subtypes = (location.subtype || []).map(s => s.toLowerCase());
  const nightlifeKeywords = ['club', 'bar', 'lounge', 'nightclub', 'night club', 'pub', 'tavern', 'disco', 'bottle service', 'vip section'];
  return nightlifeKeywords.some(k => name.includes(k) || subtypes.includes(k));
}

// ── NIGHTLIFE ELIGIBILITY CHECK ───────────────────────────────────────────────
// Returns { allowed: bool, penalty: number, reason: string }
// Penalty is subtracted from score. Allowed=false means score forced negative.
function computeNightlifePenalty(char, nowET) {
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dowNow = nowET.getDay(); // 0=Sun

  // DAYTIME BLOCK: clubs/bars don't make sense before 5pm (17:00)
  if (nowMin < 17 * 60) {
    return { allowed: false, penalty: 999, reason: 'daytime_block' };
  }

  // WORK/SCHOOL TOMORROW BLOCK: if character has work or school before 10am tomorrow, penalize heavily
  const tomorrowDow = (dowNow + 1) % 7;
  const hasWorkTomorrow = Array.isArray(char.work_days) &&
    char.work_days.includes(tomorrowDow) &&
    char.work_start_time &&
    toMin(char.work_start_time) < 10 * 60;
  const hasSchoolTomorrow = char.student_status === 'enrolled' && char.education_location_id;
  // Also block if work is TODAY and shift hasn't started yet but is early
  const hasEarlyWorkToday = Array.isArray(char.work_days) &&
    char.work_days.includes(dowNow) &&
    char.work_start_time &&
    toMin(char.work_start_time) < 9 * 60;

  // Disciplined characters always skip nightlife before work/school
  if (char.trait_conscientious || char.trait_law_abiding || char.trait_goody_two_shoes) {
    if (hasWorkTomorrow || hasSchoolTomorrow || hasEarlyWorkToday) {
      return { allowed: false, penalty: 999, reason: 'disciplined_before_obligations' };
    }
  }

  // Non-disciplined characters: heavy penalty before early work/school
  let penalty = 0;
  if (hasWorkTomorrow || hasSchoolTomorrow || hasEarlyWorkToday) {
    penalty += 4; // significant penalty but not absolute block
  }

  // FINANCIAL PENALTY: low financial value = character is broke/anxious about money
  const financial = char.financial_need_value ?? 60;
  if (financial < 30) {
    // Bougie characters still go even when broke (denial)
    if (!char.trait_bougie && !char.trait_risk_taker) {
      return { allowed: false, penalty: 999, reason: 'financially_blocked' };
    }
    penalty += 3;
  } else if (financial < 50) {
    penalty += 2; // moderate financial concern
  }

  // ENERGY PENALTY: tired characters should rest, not party
  const energy = char.energy_value ?? 75;
  if (energy < 40) {
    penalty += 3;
  } else if (energy < 60) {
    penalty += 1;
  }

  // PERSONALITY BONUSES: some traits make nightlife more appropriate
  if (char.trait_night_owl)     penalty -= 2; // Night owls naturally stay up
  if (char.trait_risk_taker)    penalty -= 1; // Risk takers embrace nightlife
  if (char.trait_bougie)        penalty -= 1; // Bougie characters like upscale venues
  if (char.trait_uninhibited)   penalty -= 1; // Uninhibited characters enjoy parties
  if (char.trait_insatiable)    penalty -= 1; // Insatiable always wants more
  if (char.trait_philanderer)   penalty -= 1; // Philanderers frequent bars/clubs

  // PERSONALITY PENALTIES: some traits actively resist nightlife
  if (char.trait_conscientious) penalty += 2; // Rule-followers avoid late nights
  if (char.trait_morning_person) penalty += 2; // Morning people go to bed early
  if (char.trait_parental)      penalty += 2; // Parents don't party randomly
  if (char.trait_stubborn && char.resolved_source_reason === 'work_schedule') penalty += 1;

  // QUIRK MODIFIERS
  const quirks = char.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    if (q.quirk_id === 'drinker') penalty -= (q.intensity === 'strong' ? 2 : 1); // drinkers like bars
    if (q.quirk_id === 'homebody') penalty += (q.intensity === 'strong' ? 3 : 2);
    if (q.quirk_id === 'disciplined') penalty += (q.intensity === 'strong' ? 3 : 1);
    if (q.quirk_id === 'thrill_seeker') penalty -= 1;
    if (q.quirk_id === 'workaholic') penalty += 1;
  }

  // FREQUENCY CAP: check recent_location_history for nightlife visits
  // If character went to a nightlife venue in last 2 days, add penalty
  // If 3+ times in last 7 days, add heavy penalty (cap at realistic frequency)
  const history = char.recent_location_history || [];
  const now = nowET.getTime();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // Count recent nightlife visits from history (uses destination_location_name heuristic)
  const nightlifeKeywords = ['club', 'bar', 'lounge', 'nightclub', 'pub', 'tavern', 'disco'];
  const recentNightlifeVisits = history.filter(h => {
    if (!h.timestamp && !h.arrived_at) return false;
    const visitTime = new Date(h.timestamp || h.arrived_at).getTime();
    if (now - visitTime > sevenDaysMs) return false;
    const locName = (h.location_name || '').toLowerCase();
    return nightlifeKeywords.some(k => locName.includes(k));
  });

  const withinTwoDays = recentNightlifeVisits.filter(h => {
    const visitTime = new Date(h.timestamp || h.arrived_at).getTime();
    return now - visitTime <= twoDaysMs;
  });

  if (withinTwoDays.length >= 1) {
    penalty += 2; // went recently — not again so soon
  }
  if (recentNightlifeVisits.length >= 3) {
    penalty += 3; // heavy nightlife pattern — pump the brakes
  }
  if (recentNightlifeVisits.length >= 5) {
    // Only night owls, risk-takers, drinkers (strong quirk), or uninhibited can override
    const hasNightlifePersonality = char.trait_night_owl || char.trait_risk_taker || char.trait_uninhibited ||
      quirks.some(q => q.active && q.quirk_id === 'drinker' && q.intensity === 'strong');
    if (!hasNightlifePersonality) {
      return { allowed: false, penalty: 999, reason: 'nightlife_frequency_cap_exceeded' };
    }
    penalty += 2;
  }

  return { allowed: true, penalty: Math.max(0, penalty), reason: null };
}

// ── LOCATION SCORER ────────────────────────────────────────────────────────────
// Score scales with urgency so correct category wins harder when need is worse.
function scoreLocation(location, char, vals, nowET) {
  let score = 0;
  const cat = location.category || 'generic';
  const se = char.social_energy || 'ambivert';

  const hungerU  = urgencyLevel(vals.hunger);
  const energyU  = urgencyLevel(vals.energy);
  const socialU  = urgencyLevel(vals.social);
  const healthU  = urgencyLevel(vals.health);
  const mentalU  = urgencyLevel(vals.mental);
  const hygieneU = urgencyLevel(vals.hygiene);
  const comfortU = urgencyLevel(vals.comfort);

  // ── REPAIRED: HUNGER — introverts prefer home cooking ──────────────────
  const isIntro = ['introvert', 'mostly_introvert'].includes(se);
  if (hungerU >= 2) {
    if (cat === 'food_drink') {
      const hasSocialUrgent = socialU >= 2;
      if (isIntro && !hasSocialUrgent) {
        score += 2 + hungerU; // reduced — cooking at home is preferred
      } else {
        score += 3 + hungerU * 2;
      }
    }
    if (cat === 'grocery')    score += 2 + hungerU;
    if (cat === 'home')       score += isIntro ? (3 + hungerU * 1.5) : (1 + Math.floor(hungerU * 0.5));
  }

  // ENERGY → rest at home
  if (energyU >= 2) {
    if (cat === 'home') score += 3 + energyU * 2;
    if (cat === 'gym')  score -= energyU;
  }

  // SOCIAL → varies by personality
  if (socialU >= 2) {
    const intro = ['introvert', 'mostly_introvert'].includes(se);
    if (intro) {
      if (cat === 'outdoor') score += 2 + socialU;
      if (cat === 'home')    score -= socialU;
    } else {
      if (cat === 'social' || cat === 'food_drink') score += 3 + socialU * 2;
      if (cat === 'outdoor' || cat === 'gym')       score += 2 + socialU;
      if (cat === 'home')                           score -= 2 + socialU;
    }
  }

  // HEALTH → medical care — scales most aggressively
  if (healthU >= 2) {
    if (cat === 'medical')  score += 4 + healthU * 3;
    if (cat === 'home')     score += 1 + healthU;
    if (cat === 'gym')      score -= healthU * 2;
    if (cat === 'social')   score -= healthU;
  }

  // MENTAL / STRESS → calm environments
  if (mentalU >= 2) {
    if (['outdoor', 'home', 'religion'].includes(cat)) score += 2 + mentalU;
    if (cat === 'gym') score += 1 + mentalU;
  }

  // ── REPAIRED: HYGIENE — home/self-care only, PENALIZE food/social/outdoor ──
  if (hygieneU >= 2) {
    if (cat === 'home') score += 3 + hygieneU * 2;
    if (cat === 'gym') {
      const features = (location.features || []).map(f => f.toLowerCase());
      if (features.some(f => f.includes('shower') || f.includes('locker')))
        score += 2 + hygieneU;
      else
        score -= 1;
    }
    // PENALIZE food/social/outdoor — these are NOT for hygiene
    if (cat === 'food_drink') score -= 4;
    if (cat === 'social') score -= 4;
    if (cat === 'outdoor') score -= 3;
    if (cat === 'grocery') score -= 3;
  }

  // COMFORT → change of scenery
  if (comfortU >= 2) {
    if (cat === 'outdoor' || cat === 'food_drink') score += 1 + comfortU;
    if (cat === 'home') score -= 1;
  }

  // BASE social energy preference (minor, overridden by urgent needs)
  if (se === 'extrovert' && ['social', 'food_drink', 'outdoor'].includes(cat))      score += 1;
  if (['introvert', 'mostly_introvert'].includes(se) && ['home', 'outdoor'].includes(cat)) score += 1;

  // ── REPAIRED: COMBINED PRESSURE BONUSES — boosted multipliers ───────────
  {
    const urgentCount = [hungerU, energyU, socialU, healthU, mentalU, hygieneU, comfortU]
      .filter(u => u >= 2).length;

    if (urgentCount >= 2) {
      // hunger + social → dining out
      if (hungerU >= 2 && socialU >= 2 && cat === 'food_drink') score += 5;
      // hunger + social → picnic/outdoor
      if (hungerU >= 2 && socialU >= 2 && cat === 'outdoor')   score += 2;
      // social + fitness → gym
      if (socialU >= 2 && /gym|fitness|workout/.test((char.health_habits || '').toLowerCase()) && cat === 'gym') score += 4;
      // social + mental → calm social
      if (socialU >= 2 && mentalU >= 2 && (cat === 'outdoor' || cat === 'religion' || cat === 'community')) score += 3;
      // hunger + broke → grocery
      if (hungerU >= 2 && (vals.financial || 60) < 40 && cat === 'grocery') score += 3;
      // energy + comfort → home double benefit
      if (energyU >= 2 && comfortU >= 2 && cat === 'home') score += 3;
    }
  }

  // ── SOCIAL WORKPLACE RECOGNITION ──────────────────────────────────────────
  // If the character has recently completed a shift at a people-facing workplace
  // (bar, restaurant, salon, school, retail, customer service, medical, etc.),
  // their social need has already been partially met during work.
  // A server who just got off a 6-hour shift at a restaurant does NOT need to
  // go to a bar or café for social recovery — they already had 6 hours of social contact.
  //
  // Detection: check resolved_source_reason for 'work_schedule' and the work location's
  // category/subtype. If the character is marked as currently at work (or just finished
  // work and went somewhere nearby), recognize the social exposure.
  //
  // This modifies social urgency for NEED SCORING ONLY. It does NOT affect
  // the character's actual social_value — that number is independent.
  // It only prevents the scorer from sending them to a social venue when their
  // social need has already been addressed by work context.
  {
    const presenceSource = char.resolved_source_reason || '';
    const currentlyAtWork = char.resolved_presence_status === 'at_work';
    const justFinishedWork = presenceSource === 'work_schedule' ||
      presenceSource === 'autonomous_need' ||
      (char.resolved_location_type === 'work' && !currentlyAtWork);

    if (currentlyAtWork || justFinishedWork) {
      // Resolve the work location to determine if it is people-facing
      const workLocId = char.occupation_location_id || char.current_work_location_id;
      const workLoc = userLocations.find(l => l.id === workLocId);

      if (workLoc) {
        const wCat = (workLoc.category || '').toLowerCase();
        const wName = (workLoc.name || '').toLowerCase();
        const wSubtypes = (workLoc.subtype || []).map(s => s.toLowerCase());

        // People-facing workplace detection
        const isPeopleFacingWorkplace = (
          wCat === 'food_drink' ||
          wCat === 'social' ||
          (wCat === 'education' && workLoc.school_type) ||
          wCat === 'medical' ||
          wCat === 'community' ||
          wSubtypes.includes('salon') ||
          wSubtypes.includes('retail') ||
          wSubtypes.includes('customer_service') ||
          wName.includes('bar') || wName.includes('restaurant') || wName.includes('cafe') ||
          wName.includes('salon') || wName.includes('shop') || wName.includes('store') ||
          wName.includes('clinic') || wName.includes('hospital') || wName.includes('school') ||
          wName.includes('centre') || wName.includes('center') || wName.includes('service')
        );

        if (isPeopleFacingWorkplace) {
          // Reduce social urgency for location scoring — the character already
          // had social contact during their work shift. They should NOT be routed
          // to another social venue immediately after work.
          // This is a scoring modifier only — actual social_value is unchanged.
          if (socialU >= 1) {
            // Downgrade social urgency by one level for scoring purposes
            // Urgent social (>=2) → awareness (1), awareness (1) → none (0)
            const adjustedSocialU = Math.max(0, socialU - 1);
            // Recompute social contribution with adjusted urgency
            const isIntro = ['introvert', 'mostly_introvert'].includes(se);
            if (adjustedSocialU >= 2) {
              if (isIntro) {
                if (cat === 'outdoor' || cat === 'home') score += 2 + adjustedSocialU;
              } else {
                if (cat === 'social' || cat === 'food_drink') score += 1 + adjustedSocialU; // reduced weight
                if (cat === 'outdoor' || cat === 'gym') score += 2 + adjustedSocialU;
              }
            }
            // Log the modifier for observability — no hidden state written to Character
            console.log(`[autonomousMovement] ${char.name}: social workplace modifier active — social urgency downgraded for location scoring only`);
          }

          // ── POST-SOCIAL-SHIFT SATURATION PENALTY ──────────────────────────
          // If the character just finished a people-facing work shift, they are
          // socially saturated. They do NOT need another crowded venue.
          // Home gets a decompression bonus. Social/nightlife venues are heavily
          // penalized. food_drink is reduced but eating-for-hunger remains valid.
          if (justFinishedWork) {
            if (cat === 'social' || isNightlifeVenue(location)) {
              score -= 5; // "I just spent hours in a crowded venue — I need to decompress, not find another one"
            }
            if (cat === 'home') {
              score += 3; // decompression after a social shift — "I need my own space"
            }
            // food_drink: reduce social draw (the "let's go out" impulse)
            // Hunger scoring from the hungerU section above is untouched.
            if (cat === 'food_drink') {
              score -= 2;
            }
          }
        }
      }
    }
  }

  // ── NIGHTLIFE PENALTY: applied AFTER base scoring ───────────────────────
  // Only applies to confirmed nightlife venues (clubs, bars, lounges).
  // cafés, restaurants (food_drink), parks, gyms are unaffected.
  if (nowET && isNightlifeVenue(location)) {
    const { allowed, penalty } = computeNightlifePenalty(char, nowET);
    if (!allowed) {
      return -999; // Force this location out of selection pool
    }
    score -= penalty;
  }

  // ── DECISION WEIGHT MODULATION ────────────────────────────────────────────
  // Decision weights from the character's live context modulate raw urgency scores.
  // This is the bridge between the decision engine and movement routing.
  // Characters on shift tolerate more hunger before food-seeking. Tired characters
  // avoid gyms. Conscientious characters favor obligations over recreation.
  {
    const dw = (char._decisionWeights) || null;
    if (dw) {
      // Schedule gravity: work/school on shift suppresses non-essential movement
      if (dw.work > 0.30 || dw.education > 0.25) {
        if (cat === 'social' || cat === 'outdoor') score *= 0.4;
        if (isNightlifeVenue(location)) score *= 0.3;
        if (cat === 'gym') score *= 0.5;
      }
      // Rest weight: tired characters go home, avoid energy-draining locations
      if (dw.rest > 0.30) {
        if (cat === 'home' || cat === 'generic') score *= 1.3;
        if (cat === 'gym') score *= 0.5;
        if (isNightlifeVenue(location)) score *= 0.4;
        if (cat === 'social') score *= 0.6;
      }
      // Eat weight: hungry characters prioritize food
      if (dw.eat > 0.20) {
        if (cat === 'food_drink' || cat === 'grocery') score *= 1.3;
        if (cat === 'home') score *= 1.1; // can cook at home
      }
      // Social weight: social need drives venue selection
      if (dw.social > 0.15) {
        if (cat === 'social' || cat === 'food_drink' || cat === 'outdoor') score *= 1.2;
        if (cat === 'home') score *= 0.9; // staying home doesn't help social need
      }
      // Recreation weight: free-time characters explore
      if (dw.recreation > 0.05) {
        if (cat === 'social' || cat === 'outdoor' || cat === 'gym') score *= 1.15;
        if (cat === 'home') score *= 0.9;
      }
      // Confinement: restricted characters can only go home/rest
      if (dw.emergency) {
        if (cat !== 'home' && cat !== 'generic' && cat !== 'medical') score = Math.min(score, -1);
      }
    }
  }

  // ── PRE-SLEEP UNWIND CONTEXT ─────────────────────────────────────────────
  // If the character is within ~60 minutes of their natural sleep window,
  // gently nudge them toward quieter choices. This is CONTEXT, not authority.
  // It does NOT force sleep. It does NOT block movement. It does NOT evict visits.
  // It simply makes home score a bit higher and demanding new activities score lower.
  // Characters who are night owls, have obligations, or have overridden their schedule
  // are unaffected — the energy system handles their actual sleep onset.
  if (nowET && char.sleep_start_time) {
    const toMinLocal = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
    const sleepStartMin = toMinLocal(char.sleep_start_time);
    if (sleepStartMin !== null) {
      const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
      const preWindMin = (sleepStartMin - 60 + 1440) % 1440;
      const inUnwindWindow = preWindMin > sleepStartMin
        ? (nowMin >= preWindMin || nowMin < sleepStartMin)
        : (nowMin >= preWindMin && nowMin < sleepStartMin);
      // Only apply if not night owl, not already overriding schedule, not critically needing something else
      const isNightOwl = char.trait_night_owl === true;
      const hasAwakeOverride = char.decided_to_stay_up_until &&
        new Date(char.decided_to_stay_up_until) > nowET;
      if (inUnwindWindow && !isNightOwl && !hasAwakeOverride) {
        // Nudge home up, nudge demanding activities down — gentle, proportional
        if (cat === 'home' || cat === 'generic') score += 2;
        if (cat === 'gym') score -= 1;
        if (isNightlifeVenue(location)) score -= 2;
      }
    }
  }

  return score;
}

// ── BEST LOCATION SELECTOR ─────────────────────────────────────────────────────
function selectBestLocation(locations, char, vals, nowET) {
  if (!locations || locations.length === 0) return null;

  const scored = locations
    .map(loc => ({ location: loc, score: scoreLocation(loc, char, vals, nowET) }))
    .sort((a, b) => b.score - a.score);

  // Must score positive — no movement just to move
  const positives = scored.filter(s => s.score > 0);
  if (positives.length === 0) return null;

  // Weighted random from top 3 to avoid robotic repetition
  const top = positives.slice(0, Math.min(3, positives.length));
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  const roll = Math.random();
  let cum = 0;
  for (let i = 0; i < top.length; i++) {
    cum += weights[i] || 0;
    if (roll <= cum) return top[i].location;
  }
  return top[0].location;
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
    const base44 = createClientFromRequest(req);
  try {
    

    // Check if user has an active foreground session
    // Frontend writes to AppWorldState.user_active_session when in Chat/Travel/Profile/etc.
    // This allows background work to yield gracefully if user is actively using the app
    let isForegroundActive = false;
    try {
      const sessions = await base44.asServiceRole.entities.AppWorldState.filter({ key: 'user_active_session' });
      if (sessions.length > 0) {
        const lastUpdate = sessions[0].value ? new Date(sessions[0].value).getTime() : 0;
        const now = Date.now();
        const thirtySeconds = 30 * 1000;
        // If the flag was updated within the last 30 seconds, user is active
        isForegroundActive = (now - lastUpdate) < thirtySeconds;
      }
    } catch (_) {
      // If we can't read the flag, assume no foreground activity — proceed with background work
    }

    // ── LOAD active_created_character — FILTERED, not full list ──────────────
    // Cap at 100 (was 500 via unfiltered .list()). Sorted by most-recently-updated
    // so the most active characters are processed first within the MAX_MOVES_PER_RUN cap.
    // Using a filter instead of .list() avoids loading ALL character types unnecessarily.
    let characters = [];
    try {
      characters = await base44.entities.Character.filter(
        { character_type: 'active_created_character', status: 'active' },
        '-updated_date',
        100
      );
    } catch {
      try {
        characters = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'active_created_character', status: 'active' },
          '-updated_date',
          100
        );
      } catch (e2) {
        return Response.json({ error: `Character load failed: ${e2.message}` }, { status: 500 });
      }
    }

    const eligible = characters.filter(c =>
      c.owner_email &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'moved_away' &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.exclude_from_homepage &&
      // Accept home via either explicit field OR resolved location marked as home type
      (c.current_home_location_id || (c.resolved_current_location_id && c.resolved_location_type === 'home'))
    );

    console.log(`[autonomousMovement] Eligible: ${eligible.length}`);

    // ── GROUP BY owner_email (strict isolation) ──────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }

    // RATE LIMIT GOVERNOR: cap total writes per run to 8 across all users.
    // This prevents burst storms when many characters all need movement simultaneously.
    // The 30-minute interval ensures all characters cycle through within 2-3 runs.
    const MAX_MOVES_PER_RUN = 8;
    let totalMoved = 0;
    const moveLog = [];
    const blockedLog = [];
    const skippedLog = [];

    for (const [userEmail, userChars] of Object.entries(byUser)) {
      // Load ONLY this user's locations (owner_email scope)
      let userLocations = [];
      try {
        userLocations = await base44.entities.LocationReference.filter({ owner_email: userEmail });
      } catch (locErr) {
        const is429 = locErr?.message?.includes('429') || locErr?.message?.includes('Rate limit');
        if (is429) {
          console.warn(`[autonomousMovement] 429 on location load for ${userEmail} — stopping run to avoid storm`);
          break; // Stop entire automation run — do not process further users
        }
        try {
          userLocations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: userEmail });
        } catch (e2) {
          console.warn(`[autonomousMovement] Location load failed for ${userEmail}:`, e2.message);
          continue;
        }
      }

      // Check if autonomous travel is enabled for this user (default: ON)
      // owner_email is the sole ownership source of truth — created_by is permanently forbidden
      let autonomousTravelEnabled = true;
      try {
        const userSettingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: userEmail }, null, 1);
        const userSettings = userSettingsList?.[0];
        if (userSettings && userSettings.autonomous_travel_enabled === false) {
          autonomousTravelEnabled = false;
        }
      } catch { /* non-fatal — default to enabled */ }

      for (const char of userChars) {
        const status = char.resolved_presence_status || '';
        const reason = char.resolved_source_reason || '';
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const vals = needValues(char);
        const energyUrgency = urgencyLevel(vals.energy);

        // ── DECISION WEIGHTING FOR MOVEMENT ROUTING ─────────────────────────
        // Compute inline decision weights so the location scorer can modulate
        // scores based on the character's full context (schedule, needs, traits, time).
        // Attached to char._decisionWeights for use in scoreLocation.
        {
          const nowET2 = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const cur = nowET2.getHours() * 60 + nowET2.getMinutes();
          const dow = nowET2.getDay();
          const hour = nowET2.getHours();

          // Check if currently on shift
          let onShiftNow = false;
          if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days) && char.work_days.includes(dow)) {
            const [sh, sm = 0] = char.work_start_time.split(':').map(Number);
            const [eh, em = 0] = char.work_end_time.split(':').map(Number);
            if (cur >= sh * 60 + sm && cur < eh * 60 + em) onShiftNow = true;
          }
          if (!onShiftNow && Array.isArray(char.additional_occupation_locations)) {
            for (const entry of char.additional_occupation_locations) {
              if (!entry.location_id) continue;
              const loc = userLocations.find(l => l.id === entry.location_id);
              if (!loc) continue;
              const shift = loc.worker_shifts?.[char.id];
              if (shift?.start && shift?.end) {
                const shiftDays = Array.isArray(shift.days) && shift.days.length > 0 ? shift.days : null;
                if (shiftDays && !shiftDays.includes(dow)) continue;
                const [sh, sm = 0] = shift.start.split(':').map(Number);
                const [eh, em = 0] = shift.end.split(':').map(Number);
                if (cur >= sh * 60 + sm && cur < eh * 60 + em) { onShiftNow = true; break; }
              }
            }
          }

          const isStudent = char.student_status === 'enrolled';
          const isSchoolDay = isStudent && ![0, 6].includes(dow);
          const isLate = hour >= 22 || hour < 5;

          // ── PRESSURE CURVES: same as simulateActiveCharacterNeeds ──────
          const pCurve = (value, curve) => {
            for (let i = 0; i < curve.length - 1; i++) {
              const [vHi, pHi] = curve[i], [vLo, pLo] = curve[i+1];
              if (value >= vLo && value <= vHi) {
                const range = vHi - vLo;
                if (range === 0) return pHi;
                return pHi + ((vHi - value) / range) * (pLo - pHi);
              }
            }
            return value >= curve[0][0] ? curve[0][1] : curve[curve.length-1][1];
          };
          const HC = [[100,0],[70,0],[55,0.10],[45,0.18],[40,0.22],[35,0.30],[25,0.50],[20,0.65],[15,0.80],[10,0.90],[5,0.95],[0,1.0]];
          const EC = [[100,0],[80,0.03],[60,0.10],[50,0.18],[40,0.28],[35,0.35],[30,0.45],[25,0.58],[20,0.72],[15,0.82],[10,0.90],[5,0.97],[0,1.0]];
          const YC = [[100,0],[75,0],[55,0.08],[45,0.15],[40,0.20],[35,0.30],[30,0.45],[25,0.60],[20,0.75],[15,0.85],[10,0.93],[0,1.0]];
          const p = {
            hunger:  pCurve(vals.hunger ?? 70, HC),
            energy:  pCurve(vals.energy ?? 75, EC),
            hygiene: pCurve(vals.hygiene ?? 75, YC),
          };

          const dw = {
            work: 0.15, education: 0.10, rest: 0.10, eat: 0.08,
            hygiene: 0.05, social: 0.08, home: 0.05, recreation: 0.05,
          };

          const needsEnergy = vals.energy;
          const needsHealth = vals.health;
          const needsHunger = vals.hunger;
          if (needsEnergy <= 10 || needsHealth <= 15 || needsHunger <= 5) {
            dw.rest = 0.70; dw.work = 0; dw.education = 0; dw.eat = 0; dw.social = 0; dw.recreation = 0; dw.emergency = true;
          } else {
            if (onShiftNow) { dw.work = 0.40; dw.recreation = 0.01; }
            if (isSchoolDay) { dw.education = 0.30; dw.recreation = 0.03; }
            // Continuous pressure scaling (not binary thresholds)
            dw.eat     *= (1 + p.hunger  * 3.5);
            dw.rest    *= (1 + p.energy  * 3.5);
            dw.hygiene *= (1 + p.hygiene * 4.0);
            dw.home    *= (1 + p.energy  * 1.5);
            if (isLate) { dw.rest += 0.12; dw.work = Math.min(dw.work, 0.05); dw.social *= 0.5; }
            if (char.trait_conscientious) { dw.work += 0.10; dw.rest -= 0.03; }
            if (char.trait_night_owl) { dw.rest += 0.05; }
            if (char.trait_morning_person) { dw.rest -= 0.03; }
            if (char.trait_loyal) { dw.social += 0.05; }
            if (char.trait_stubborn) { dw.eat -= 0.02; }
            if (char.is_jailed || char.house_arrest_active) { dw.work = 0; dw.education = 0; dw.recreation = 0.01; dw.social *= 0.3; }
            for (const k of Object.keys(dw)) { if (k !== 'emergency') dw[k] = Math.max(0, Math.min(0.75, dw[k])); }
          }

          char._decisionWeights = dw;
        }

        // ── TIER -1: ACTIVE TRANSIT GUARD ────────────────────────────────────
        // If this character already has an active in_transit TravelSession,
        // do NOT override their location via any autonomous path.
        // Let processTravelArrivals handle the commit.
        // Exception: sleep enforcement and pass-out may cancel a session (handled below in Tier 1/2/3).
        let activeSession = null;
        try {
          const activeSessions = await base44.asServiceRole.entities.TravelSession.filter({
            owner_email: char.owner_email,
            character_id: char.id,
            route_status: 'in_transit',
          }, null, 1).catch(() => []);
          activeSession = activeSessions?.[0] || null;
        } catch { /* non-fatal */ }

        // ── ORPHANED TRAVELING PRESENCE GUARD (before session commitment check) ────
        // If the character's resolved_presence_status is 'traveling' but no active TravelSession
        // backs it, that is an orphaned state written by a previously-cancelled createTravelSession.
        // Clear it now to the canonical home/work/sleep presence so subsequent tiers work correctly.
        // This is the upstream fix for the root cause: createTravelSession writes 'traveling' to
        // resolved_presence_status, and cancellation paths never reset it.
        if (char.resolved_presence_status === 'traveling' && !activeSession) {
          const homeId = char.current_home_location_id || char.home_location_id || null;
          const isShift = (
            Array.isArray(char.work_days) && char.work_days.length > 0 &&
            char.work_start_time && char.work_end_time && char.occupation_location_id
          ) ? (() => {
            const nowMin2 = nowET.getHours() * 60 + nowET.getMinutes();
            const s = toMin(char.work_start_time), e = toMin(char.work_end_time);
            if (s === null || e === null || !char.work_days.includes(nowET.getDay())) return false;
            return e < s ? (nowMin2 >= s || nowMin2 < e) : (nowMin2 >= s && nowMin2 < e);
          })() : false;
          const todayET2 = nowET.toISOString().slice(0, 10);
          const hasCallout2 = char.work_exception_status === 'called_out' && char.work_exception_date === todayET2;
          // Canonical status: at_work if shift is active, otherwise home.
          // Do NOT use sleep_start_time/wake_up_time to derive sleeping — sleep status comes from energy only.
          const canonicalStatus = (isShift && !hasCallout2 && char.occupation_location_id)
            ? 'at_work'
            : 'home';
          const canonicalLocId = (isShift && !hasCallout2 && char.occupation_location_id)
            ? char.occupation_location_id
            : homeId;
          const canonicalLocType = canonicalStatus === 'at_work' ? 'work' : 'home';
          console.warn(`[autonomousMovement] ${char.name}: ORPHANED 'traveling' with no active session — clearing to '${canonicalStatus}' (canonical repair)`);
          try {
            await base44.entities.Character.update(char.id, {
              resolved_presence_status:       canonicalStatus,
              resolved_location_type:         canonicalLocType,
              resolved_source_reason:         'orphaned_travel_state_cleared',
              resolved_current_location_id:   canonicalLocId,
              resolved_last_updated_at:       nowET.toISOString(),
              travel_status:                  'not_traveling',
              travel_destination_location_id: null,
              traveling_to_location_id:       null,
              traveling_to_location_name:     null,
            });
          } catch {
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_presence_status:       canonicalStatus,
              resolved_location_type:         canonicalLocType,
              resolved_source_reason:         'orphaned_travel_state_cleared',
              resolved_current_location_id:   canonicalLocId,
              resolved_last_updated_at:       nowET.toISOString(),
              travel_status:                  'not_traveling',
              travel_destination_location_id: null,
              traveling_to_location_id:       null,
              traveling_to_location_name:     null,
            }).catch(() => {});
          }
          // Update in-memory char so subsequent tiers in this iteration see the cleared state
          char.resolved_presence_status = canonicalStatus;
          char.resolved_source_reason   = 'orphaned_travel_state_cleared';
          char.travel_status            = 'not_traveling';
          moveLog.push(`${char.name}: orphaned 'traveling' cleared → '${canonicalStatus}'`);
        }

        if (activeSession) {
          // COMMITMENT PROTECTION: sessions with interruption_allowed=false are commitment-driven
          // (character said "I'm on my way", accepted a plan, made a verbal promise).
          // These represent autonomous decisions by the character — they outrank passive needs/wants.
          // Only CONFINEMENT (jail/house_arrest) can cancel a commitment session.
          // Sleep, energy, hunger, boredom, and all other needs CANNOT cancel a commitment.
          const isCommitmentSession = activeSession.interruption_allowed === false ||
            activeSession.travel_source === 'promise';

          if (isCommitmentSession) {
            // ONLY hard confinement can interrupt a commitment session
            const confinementBlock = (
              char.is_jailed === true ||
              char.house_arrest_active === true ||
              char.resolved_presence_status === 'incarcerated' ||
              char.resolved_presence_status === 'confined' ||
              char.resolved_presence_status === 'house_arrest'
            );
            if (!confinementBlock) {
              console.log(`[autonomousMovement] ${char.name}: COMMITMENT SESSION PROTECTED (session ${activeSession.id} → ${activeSession.destination_location_name}) — autonomous needs cannot override`);
              continue;
            }
            // Confinement cancels even commitment sessions
            console.log(`[autonomousMovement] ${char.name}: CONFINEMENT overrides commitment session ${activeSession.id}`);
            await base44.asServiceRole.entities.TravelSession.update(activeSession.id, {
              route_status: 'cancelled',
              blocker_reason: 'overridden_by_confinement',
            }).catch(() => {});
            // Clear Character travel fields — session cancelled, travel metadata must not remain.
            // For active_created_character: resolved_presence_status was never set to 'traveling',
            // so only the travel action fields need clearing.
            base44.asServiceRole.entities.Character.update(char.id, {
              travel_status:                  'not_traveling',
              travel_destination_location_id: null,
              traveling_to_location_id:       null,
              traveling_to_location_name:     null,
            }).catch(() => {});
            activeSession = null;
          } else {
            // Non-commitment session: only proceed if an overriding hard condition is present.
            const overridingHardCondition = (
              char.is_jailed === true ||
              char.house_arrest_active === true ||
              char.resolved_presence_status === 'incarcerated' ||
              char.resolved_presence_status === 'confined' ||
              char.resolved_presence_status === 'house_arrest' ||
              urgencyLevel(needValues(char).energy) >= 4       // pass-out only — no clock-based sleep window
            );
            if (!overridingHardCondition) {
              console.log(`[autonomousMovement] ${char.name}: IN_TRANSIT (session ${activeSession.id} → ${activeSession.destination_location_name}) — skip autonomous move`);
              continue;
            }
            // Hard condition overrides non-commitment transit — cancel the session before re-routing
            console.log(`[autonomousMovement] ${char.name}: HARD CONDITION overrides active transit — cancelling session ${activeSession.id}`);
            await base44.asServiceRole.entities.TravelSession.update(activeSession.id, {
              route_status: 'cancelled',
              blocker_reason: 'overridden_by_hard_condition',
            }).catch(() => {});
            // Clear Character travel fields — session cancelled, travel metadata must not remain.
            base44.asServiceRole.entities.Character.update(char.id, {
              travel_status:                  'not_traveling',
              travel_destination_location_id: null,
              traveling_to_location_id:       null,
              traveling_to_location_name:     null,
            }).catch(() => {});
            activeSession = null;
          }
        }

        // ── TIER 0: INCARCERATION / HOUSE ARREST / HOSPITALIZED — absolute hard stop ──
        // Incarcerated characters are CONFINED. They cannot autonomously travel, roam, visit,
        // go shopping, work (unless work-release is active), or relocate.
        // This is a valid life state — do NOT attempt to correct it, reroute, or "fix" it.
        if (char.is_jailed === true) {
          console.log(`[autonomousMovement] ${char.name}: CONFINEMENT BLOCK — incarcerated (${char.incarceration_facility_name || 'facility'})`);
          continue;
        }
        if (char.house_arrest_active === true) {
          console.log(`[autonomousMovement] ${char.name}: CONFINEMENT BLOCK — house arrest`);
          continue;
        }
        if (status === 'incarcerated' || status === 'confined' || status === 'house_arrest') {
          console.log(`[autonomousMovement] ${char.name}: CONFINEMENT BLOCK — status=${status}`);
          continue;
        }
        if (status === 'hospitalized') {
          console.log(`[autonomousMovement] ${char.name}: EMERGENCY BLOCK — hospitalized`);
          continue;
        }

        // ── TIER 1: ZERO ENERGY — PASS OUT ──────────────────────────────────
        // energy < 10 → character passes out at current location regardless of
        // toggle, stay-lock, schedule, or personality. Overrides everything
        // except hospitalization/jail.
        if (energyUrgency >= 4) {
          if (status !== 'passed_out') {
            const passOutPayload = {
              resolved_presence_status:   'passed_out',
              resolved_source_reason:     'energy_depleted_pass_out',
              energy_value:               0,
              last_arrived_time:          new Date().toISOString(),
            };
            try {
              await base44.entities.Character.update(char.id, passOutPayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, passOutPayload);
            }
            moveLog.push(`${char.name}: PASSED OUT at ${char.resolved_current_location_name || 'current location'} [energy depleted]`);
            console.log(`[autonomousMovement] ⚠️ ${char.name}: PASSED OUT`);
          } else {
            console.log(`[autonomousMovement] ${char.name}: already passed_out — no change`);
          }
          continue;
        }

        // ── TIER 2: ALREADY PASSED OUT — RECOVERY ────────────────────────────
        // Character is passed out but energy > 10 (has recovered enough to move).
        // Route to home. Write presence as 'home' — NOT 'sleeping'.
        // passed_out and sleeping are separate states. Once home, the energy-based
        // sleep onset block below will write 'sleeping' if energy still warrants it.
        //
        // IMPORTANT: Write last_sleep_start now so the subsequent sleep onset (Case A)
        // starts the sleep duration timer correctly. Without it, sleepDurationHours is always 0
        // and the natural wake condition (sleepDurationHours >= 4) can never be satisfied,
        // causing the character to sleep indefinitely after pass-out recovery.
        if (status === 'passed_out') {
          if (energyUrgency < 4 && char.current_home_location_id) {
            const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
            if (ownHome) {
              const recoveryPayload = {
                resolved_current_location_id:   ownHome.id,
                resolved_current_location_name: ownHome.name,
                resolved_presence_status:       'home',
                resolved_location_type:         'home',
                resolved_source_reason:         'pass_out_recovery',
                last_arrived_time:              new Date().toISOString(),
                // Stamp last_sleep_start so the sleep onset timer starts on next run.
                // This is the pass-out recovery sleep — not a new independent sleep cycle.
                last_sleep_start:               new Date().toISOString(),
              };
              try {
                await base44.entities.Character.update(char.id, recoveryPayload);
              } catch {
                await base44.asServiceRole.entities.Character.update(char.id, recoveryPayload);
              }
              moveLog.push(`${char.name} → ${ownHome.name} [PASS_OUT_RECOVERY]`);
              console.log(`[autonomousMovement] ✓ ${char.name}: recovering → ${ownHome.name}`);
            }
          }
          continue;
        }

        // ── TIER 3: SLEEPING/NAPPING STATUS HANDLER ─────────────────────────
        // No clock windows. No sleep_start_time authority. No wake_up_time authority.
        // If the character IS sleeping (as a current status fact), handle their state.
        // Sleep onset is driven entirely by energy levels (below, in energy-based onset block).
        // Wake is driven by energy recovery and real active obligations.
        if (status === 'sleeping' || status === 'napping') {
          // Check if a real obligation is currently active (work shift or school in session).
          const nowMin3 = nowET.getHours() * 60 + nowET.getMinutes();
          const dowNow3 = nowET.getDay();
          const todayET3 = nowET.toISOString().slice(0, 10);

          const hasActiveWorkObligation = (() => {
            if (!Array.isArray(char.work_days) || char.work_days.length === 0) return false;
            if (!char.work_start_time || !char.work_end_time || !char.occupation_location_id) return false;
            if (!char.work_days.includes(dowNow3)) return false;
            const hasCallout3 = char.work_exception_status === 'called_out' && char.work_exception_date === todayET3;
            if (hasCallout3) return false;
            const s3 = toMin(char.work_start_time);
            const e3 = toMin(char.work_end_time);
            if (s3 === null || e3 === null) return false;
            const isOvernight3 = e3 < s3;
            return isOvernight3 ? (nowMin3 >= s3 || nowMin3 < e3) : (nowMin3 >= s3 && nowMin3 < e3);
          })();

          const hasActiveSchoolObligation = (() => {
            if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
            return nowMin3 >= 8 * 60 && nowMin3 < 15 * 60;
          })();

          const energyNow = char.energy_value ?? 0;
          const sleepStartedAt = char.last_sleep_start ? new Date(char.last_sleep_start) : null;
          const sleepDurationHours = sleepStartedAt
            ? (Date.now() - sleepStartedAt.getTime()) / 3600000
            : 0;
          const isHealthRecovering = (char.health_value ?? 100) < 30 || (char.mental_value ?? 100) < 25;

          // Wake conditions (in priority order):
          // 1. Active work obligation right now → wake for work
          // 2. Active school obligation right now → wake for school
          // 3. Energy recovered (>= 70) AND slept >= 4 hours AND not health-recovering → natural wake
          //    (at +12/hr from energy=20, reaching 70 takes ~4.2 hours — minimum realistic sleep)
          //    Characters who slept more will have higher energy and wake more easily.
          //    Characters who are sick/recovering stay asleep until health improves.
          // Otherwise → keep sleeping, no action
          const shouldWake = hasActiveWorkObligation || hasActiveSchoolObligation ||
            (energyNow >= 70 && sleepDurationHours >= 4 && !isHealthRecovering);

          if (!shouldWake) {
            console.log(`[autonomousMovement] ${char.name}: sleeping (energy=${Math.round(energyNow)}, slept=${Math.round(sleepDurationHours * 10) / 10}h, obligation=${hasActiveWorkObligation || hasActiveSchoolObligation})`);
            continue;
          }

          // Wake the character — write presence back to home, then fall through to obligation dispatch
          const wakeReason = hasActiveWorkObligation ? 'obligation_wake_work'
            : hasActiveSchoolObligation ? 'obligation_wake_school'
            : 'natural_wake_rested';
          try {
            await base44.entities.Character.update(char.id, {
              resolved_presence_status:   'home',
              resolved_source_reason:     wakeReason,
              resolved_last_updated_at:   nowET.toISOString(),
            });
          } catch {
            await base44.asServiceRole.entities.Character.update(char.id, {
              resolved_presence_status:   'home',
              resolved_source_reason:     wakeReason,
              resolved_last_updated_at:   nowET.toISOString(),
            });
          }
          char.resolved_presence_status = 'home';
          char.resolved_source_reason = wakeReason;
          console.log(`[autonomousMovement] ✓ ${char.name}: woke — reason=${wakeReason}, energy=${Math.round(energyNow)}, slept=${Math.round(sleepDurationHours * 10) / 10}h`);
          // Do NOT continue — fall through to work/school dispatch (Tier 3.5+)
        }

        // ── ENERGY-BASED HOME ROUTING (travel only — no direct sleep writes) ───
        // SINGLE SLEEP AUTHORITY RULE (permanent):
        //   Only simulateActiveCharacterNeeds may write resolved_presence_status = 'sleeping'.
        //   It does so at energy ≤ 20 only, at a valid sleep location, with alarm/shift guards.
        //   autonomousCharacterMovement may only route characters home via TravelSession.
        //
        // THRESHOLDS:
        //   energy < 20 AND not at home → return home via TravelSession (critically tired)
        //   energy < 30 AND at home     → no action needed (scorer keeps them home; simulateNeeds writes sleep)
        //
        // Case A (energy < 30 at home → write sleeping) was removed — it was a duplicate sleep
        // authority that fired at energy=28, ignored alarms/work/school, and bypassed foreground yield.
        {
          const homeId = char.current_home_location_id;
          const atHome = homeId && char.resolved_current_location_id === homeId;
          const alreadySleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
          const energyVal = char.energy_value ?? 75;

          if (!alreadySleeping && homeId) {
            // ARCHITECTURE RULE (permanent):
            // autonomousCharacterMovement MUST NOT write resolved_presence_status = 'sleeping'.
            // Sleep onset is exclusively owned by simulateActiveCharacterNeeds at energy ≤ 20.
            // Case A (energy < 30 at home → write sleeping directly) was removed because:
            //   1. It conflicted with simulateActiveCharacterNeeds threshold (20 vs 30 = duplicate authority)
            //   2. It ran BEFORE Tier 3.5 work/school dispatch — sleeping a character before their shift check
            //   3. It bypassed the foreground yield gate entirely
            //   4. It ignored pending_alarm_time, active commitments, and user intent
            // The location scorer already nudges home high when energy < 30, so the character
            // stays home naturally. simulateActiveCharacterNeeds writes sleep at energy ≤ 20.

            // Case B: not at home, critically tired — return home via TravelSession.
            // simulateActiveCharacterNeeds will write sleep once they arrive and energy ≤ 20.
            if (!atHome && energyVal < 20) {
              const sleepHome = userLocations.find(loc => loc.id === homeId);
              if (sleepHome && char.resolved_current_location_id !== sleepHome.id) {
                const travelHomeRes = await base44.asServiceRole.entities.TravelSession.create({
                  character_id: char.id,
                  destination_location_id: sleepHome.id,
                  travel_reason: `energy_low_return_home_sleep energy(${Math.round(energyVal)})`,
                  travel_source: 'autonomous_need',
                  owner_email: char.owner_email,
                }).catch(e => ({ success: false, error: e.message }));
                const rtd = travelHomeRes?.data || {};
                if (rtd.success) {
                  totalMoved++;
                  moveLog.push(`${char.name} → ${sleepHome.name} [TIRED_RETURN_HOME energy=${Math.round(energyVal)}]`);
                  console.log(`[autonomousMovement] ✓ ${char.name}: tired, returning home to sleep (energy=${Math.round(energyVal)})`);
                } else {
                  blockedLog.push(`${char.name}: tired home return blocked — ${rtd.blocker_reason || rtd.error}`);
                }
                continue;
              }
            }
          }
        }

        // ── TIER 3.5: ACTIVE WORK / SCHOOL DISPATCH ─────────────────────────
        // Runs immediately after sleep/wake evaluation, BEFORE energy or needs scoring.
        // If the character's actual schedule is active right now, send them to work/school.
        // This is the correct post-wake priority: schedule > needs.
        //
        // RULES:
        //   - Reads the character's actual fields: work_days, work_start_time, work_end_time,
        //     occupation_location_id, additional_occupation_locations, education_location_id
        //   - Does NOT hardcode 09:00–17:00
        //   - Respects work_exception_status === 'called_out' for today
        //   - If shift active AND character not already at work location → dispatch
        //   - If shift active AND character already there → preserve work_schedule reason + continue
        //   - If no shift active → fall through to existing tiers unchanged
        //
        // ENERGY RULE: Energy does NOT block work dispatch after a completed sleep window.
        // A character who just woke (adaptive_sleep_ended_wake) is considered awake-ready.
        // Energy is already at 100 for most characters after sleep; even if low it must not
        // prevent the character from going to work — energy-critical path (Tier 4) is below.
        {
          const todayET = nowET.toISOString().slice(0, 10); // YYYY-MM-DD in ET
          const nowMin  = nowET.getHours() * 60 + nowET.getMinutes();
          const dowNow  = nowET.getDay(); // 0=Sun, 6=Sat

          // ── WORK SCHEDULE CHECK ────────────────────────────────────────────
          // Use the character's actual stored fields — do not assume any defaults.
          let workDispatchDone = false;

          if (
            Array.isArray(char.work_days) && char.work_days.length > 0 &&
            char.work_start_time && char.work_end_time &&
            char.occupation_location_id
          ) {
            const isWorkDay = char.work_days.includes(dowNow);

            if (isWorkDay) {
              const shiftStart = toMin(char.work_start_time);
              const shiftEnd   = toMin(char.work_end_time);
              // Overnight shift support (e.g. 22:00–06:00)
              const isOvernightShift = shiftEnd < shiftStart;
              const shiftActiveNow   = isOvernightShift
                ? (nowMin >= shiftStart || nowMin < shiftEnd)
                : (nowMin >= shiftStart && nowMin < shiftEnd);

              if (shiftActiveNow) {
                // CALLOUT GUARD: skip if character has a valid callout for today
                const hasCallout = char.work_exception_status === 'called_out' &&
                                   char.work_exception_date === todayET;
                if (hasCallout) {
                  console.log(`[autonomousMovement] ${char.name}: WORK DISPATCH skipped — valid callout for ${todayET}`);
                } else {
                  // Resolve work location — check worker_shifts[char.id] on location record
                  // for per-character shift overrides. If none, use character-level schedule.
                  // Primary location: occupation_location_id. Additional locations checked
                  // only if they have an active per-character shift right now.
                  let activeWorkLocId = char.occupation_location_id;

                  // Check additional_occupation_locations for an alternate active shift
                  if (Array.isArray(char.additional_occupation_locations)) {
                    for (const entry of char.additional_occupation_locations) {
                      if (!entry.location_id) continue;
                      const altLoc = userLocations.find(l => l.id === entry.location_id);
                      if (!altLoc) continue;
                      // If this alternate location has a worker_shifts entry for this character,
                      // check if it is active right now — if so, it takes priority.
                      const altShift = altLoc.worker_shifts?.[char.id];
                      if (altShift && altShift.start && altShift.end) {
                        const altStart = toMin(altShift.start);
                        const altEnd   = toMin(altShift.end);
                        const altOvernight = altEnd < altStart;
                        const altActive = altOvernight
                          ? (nowMin >= altStart || nowMin < altEnd)
                          : (nowMin >= altStart && nowMin < altEnd);
                        if (altActive) {
                          // Also check day constraint on shift if present
                          const altDayOk = !Array.isArray(altShift.days) || altShift.days.length === 0 || altShift.days.includes(dowNow);
                          if (altDayOk) {
                            activeWorkLocId = entry.location_id;
                            break;
                          }
                        }
                      }
                    }
                  }

                  const workLoc = userLocations.find(l => l.id === activeWorkLocId);
                  if (!workLoc) {
                    console.warn(`[autonomousMovement] ${char.name}: WORK DISPATCH — shift active but work location id=${activeWorkLocId} not in user scope`);
                  } else if (char.resolved_current_location_id === workLoc.id) {
                    // Already at work — ensure source reason is correct and skip
                    if (char.resolved_source_reason !== 'work_schedule') {
                      try {
                        await base44.entities.Character.update(char.id, {
                          resolved_presence_status: 'at_work',
                          resolved_location_type:   'work',
                          resolved_source_reason:   'work_schedule',
                          resolved_last_updated_at: nowET.toISOString(),
                        });
                      } catch {
                        await base44.asServiceRole.entities.Character.update(char.id, {
                          resolved_presence_status: 'at_work',
                          resolved_location_type:   'work',
                          resolved_source_reason:   'work_schedule',
                          resolved_last_updated_at: nowET.toISOString(),
                        });
                      }
                    }
                    console.log(`[autonomousMovement] ${char.name}: WORK — already at ${workLoc.name}`);
                    workDispatchDone = true;
                  } else {
                    // Dispatch to work via TravelSession — NO direct location write, NO teleport
                    const workTravelRes = await base44.asServiceRole.entities.TravelSession.create( {
                      character_id:           char.id,
                      destination_location_id: workLoc.id,
                      travel_reason:          `work_schedule: shift ${char.work_start_time}–${char.work_end_time}`,
                      travel_source:          'work_schedule',
                      owner_email:            char.owner_email,
                    }).catch(e => ({ success: false, error: e.message }));
                    const wtd = workTravelRes?.data || {};
                    if (wtd.success) {
                      totalMoved++;
                      moveLog.push(`${char.name} → ${workLoc.name} [WORK_SCHEDULE → IN_TRANSIT ~${wtd.duration_minutes}min]`);
                      console.log(`[autonomousMovement] ✓ ${char.name}: WORK DISPATCH → in_transit → ${workLoc.name}`);
                      workDispatchDone = true;
                    } else if (wtd.blocked) {
                      blockedLog.push(`${char.name}: work dispatch blocked — ${wtd.blocker_reason || wtd.blocker}`);
                      console.log(`[autonomousMovement] ${char.name}: WORK DISPATCH BLOCKED — ${wtd.blocker_reason}`);
                      workDispatchDone = true;
                    } else {
                      blockedLog.push(`${char.name}: work createTravelSession FAILED — ${wtd.error} — NO teleport`);
                      console.error(`[autonomousMovement] ⛔ NO-TELEPORT: ${char.name} work dispatch failed — ${wtd.error}`);
                      workDispatchDone = true;
                    }
                  }
                }
              }
            }
          }

          if (workDispatchDone) continue;

          // ── SCHOOL SCHEDULE CHECK ──────────────────────────────────────────
          // Only for enrolled students with an assigned education_location_id.
          // Uses the education location's operating_hours via isLocationOpen(),
          // plus a fallback to character's education_details for start/end times.
          // Does NOT hardcode a universal 8AM–3PM school window.
          if (
            char.student_status === 'enrolled' &&
            char.education_location_id
          ) {
            const schoolLoc = userLocations.find(l => l.id === char.education_location_id);
            // Use location operating_hours as the primary source for school time window
            let schoolActiveNow = false;
            if (schoolLoc) {
              schoolActiveNow = isLocationOpen(schoolLoc);
            }
            // Fallback: if no location or no operating_hours, check character's education_details
            if (!schoolLoc || (!schoolLoc.operating_hours || schoolLoc.operating_hours.length === 0)) {
              const edDetails = char.education_details || {};
              const edStart = edDetails.start_time || edDetails.school_start_time || null;
              const edEnd   = edDetails.end_time   || edDetails.school_end_time   || null;
              if (edStart && edEnd) {
                const s = toMinutes(edStart);
                const e = toMinutes(edEnd);
                if (s !== null && e !== null) {
                  schoolActiveNow = e < s
                    ? (nowMin >= s || nowMin < e)
                    : (nowMin >= s && nowMin < e);
                }
              }
            }

            if (schoolActiveNow) {
              const schoolLoc = userLocations.find(l => l.id === char.education_location_id);
              if (!schoolLoc) {
                console.warn(`[autonomousMovement] ${char.name}: SCHOOL DISPATCH — enrolled but location id=${char.education_location_id} not in user scope`);
              } else if (char.resolved_current_location_id === schoolLoc.id) {
                if (char.resolved_source_reason !== 'school_schedule') {
                  try {
                    await base44.entities.Character.update(char.id, {
                      resolved_presence_status: 'at_school',
                      resolved_location_type:   'school',
                      resolved_source_reason:   'school_schedule',
                      resolved_last_updated_at: nowET.toISOString(),
                    });
                  } catch {
                    await base44.asServiceRole.entities.Character.update(char.id, {
                      resolved_presence_status: 'at_school',
                      resolved_location_type:   'school',
                      resolved_source_reason:   'school_schedule',
                      resolved_last_updated_at: nowET.toISOString(),
                    });
                  }
                }
                console.log(`[autonomousMovement] ${char.name}: SCHOOL — already at ${schoolLoc.name}`);
                continue;
              } else {
                // Dispatch to school via TravelSession — NO direct location write, NO teleport
                const schoolTravelRes = await base44.asServiceRole.entities.TravelSession.create({
                  character_id:           char.id,
                  destination_location_id: schoolLoc.id,
                  travel_reason:          'school_schedule',
                  travel_source:          'school_schedule',
                  owner_email:            char.owner_email,
                }).catch(e => ({ success: false, error: e.message }));
                const std = schoolTravelRes?.data || {};
                if (std.success) {
                  totalMoved++;
                  moveLog.push(`${char.name} → ${schoolLoc.name} [SCHOOL_SCHEDULE → IN_TRANSIT ~${std.duration_minutes}min]`);
                  console.log(`[autonomousMovement] ✓ ${char.name}: SCHOOL DISPATCH → in_transit → ${schoolLoc.name}`);
                } else if (std.blocked) {
                  blockedLog.push(`${char.name}: school dispatch blocked — ${std.blocker_reason || std.blocker}`);
                  console.log(`[autonomousMovement] ${char.name}: SCHOOL DISPATCH BLOCKED — ${std.blocker_reason}`);
                } else {
                  blockedLog.push(`${char.name}: school createTravelSession FAILED — ${std.error} — NO teleport`);
                  console.error(`[autonomousMovement] ⛔ NO-TELEPORT: ${char.name} school dispatch failed — ${std.error}`);
                }
                continue;
              }
            }
          }
        }
        // END TIER 3.5

        // ── TIER 4: CRITICAL ENERGY (< 25) — force home regardless of toggle ─
        // Not at pass-out level but critically low. Must go home NOW.
        // Overrides stay-lock and toggle.
        if (energyUrgency >= 3 && char.current_home_location_id) {
          const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
          if (ownHome && char.resolved_current_location_id !== ownHome.id) {
            const critPayload = {
              resolved_current_location_id:   ownHome.id,
              resolved_current_location_name: ownHome.name,
              resolved_presence_status:       'home',
              resolved_location_type:         'home',
              resolved_source_reason:         'energy_critical_return_home',
              last_arrived_time:              new Date().toISOString(),
              presence_stay_lock:             false,
              presence_stay_lock_location_id: null,
            };
            try {
              await base44.entities.Character.update(char.id, critPayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, critPayload);
            }
            totalMoved++;
            moveLog.push(`${char.name} → ${ownHome.name} [ENERGY_CRITICAL] energy(${Math.round(vals.energy)})`);
            console.log(`[autonomousMovement] ✓ ${char.name}: critical energy → ${ownHome.name}`);
          } else if (ownHome) {
            console.log(`[autonomousMovement] ${char.name}: critical energy, already home`);
          }
          continue;
        }

        // ── TIER 5: PRESENCE STAY LOCK VALIDATION ────────────────────────────
        // Inline validator — no network call per character.
        // Observes authoritative state; does NOT duplicate sleep/work/school logic.
        if (char.presence_stay_lock === true) {
          const lockResult = validateStayLock(char, nowET);
          const { shouldRespectLock, shouldReleaseLock, releaseReason, proof } = lockResult;

          if (shouldReleaseLock) {
            console.log(`[autonomousMovement] ${char.name}: Releasing presence_stay_lock. Reason: ${releaseReason}. Proof: ${proof}`);
            const releasePayload = {
              presence_stay_lock: false,
              presence_stay_lock_location_id: null,
              presence_stay_lock_set_at: null,
              presence_stay_lock_reason: null,
              presence_stay_lock_authority: null,
              presence_stay_lock_expires_at: null,
              presence_stay_lock_release_condition: null,
              presence_stay_lock_created_by: null,
            };
            try {
              await base44.entities.Character.update(char.id, releasePayload);
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, releasePayload).catch(() => {});
            }
            char.presence_stay_lock = false;
          } else if (shouldRespectLock) {
            console.log(`[autonomousMovement] ${char.name}: STAY_LOCK active — skipping autonomous movement. Proof: ${proof}`);
            skippedLog.push(`${char.name}: STAY_LOCK active (${lockResult.lockReason || 'legacy'})`);
            continue;
          }
        }

        // ── TIER 6: AUTONOMOUS TRAVEL TOGGLE + FOREGROUND YIELD ──────────────
        // When foreground is active, suppress optional needs-based wandering entirely.
        // Mandatory needs (urgency >= 2) still run — character won't starve because user is chatting.
        // When autonomous travel is OFF, same rule applies.
        const topNeedCheck = highestUrgencyEntry(vals);
        if (isForegroundActive && topNeedCheck.urgency < 2) {
          skippedLog.push(`${char.name}: foreground active, optional needs suppressed`);
          continue;
        }
        if (!autonomousTravelEnabled && topNeedCheck.urgency < 2) {
          skippedLog.push(`${char.name}: autonomous travel OFF, needs not urgent enough`);
          continue;
        }

        // ── HARD BLOCKS (schedule-based) ─────────────────────────────────────
        if (
          reason === 'work_schedule'   ||
          reason === 'school_schedule' ||
          reason === 'praying_at_home'
        ) {
          console.log(`[autonomousMovement] ${char.name}: HARD BLOCK (${reason || status})`);
          continue;
        }

        // ── COMMITMENT DESTINATION LOCK ───────────────────────────────────────
        // If character has an active commitment-driven TravelSession (interruption_allowed=false),
        // do NOT start any needs-based travel. The character has already made an autonomous decision.
        // This check covers the case where the session was created but Tier -1 did not catch it
        // (e.g., session just became active after this loop iteration loaded char).
        {
          const lockedSessions = await base44.asServiceRole.entities.TravelSession.filter({
            owner_email: char.owner_email,
            character_id: char.id,
            route_status: 'in_transit',
          }, null, 5).catch(() => []);
          const hasLockedCommitment = (lockedSessions || []).some(s =>
            s.interruption_allowed === false || s.travel_source === 'promise'
          );
          if (hasLockedCommitment) {
            const locked = lockedSessions.find(s => s.interruption_allowed === false || s.travel_source === 'promise');
            console.log(`[autonomousMovement] ${char.name}: COMMITMENT DESTINATION LOCKED → ${locked?.destination_location_name} — needs-based travel blocked`);
            skippedLog.push(`${char.name}: commitment-locked (→ ${locked?.destination_location_name})`);
            continue;
          }
        }

        // ── TIER 6.5: ACTIVE COMMITMENT CHECK ────────────────────────────────
        // Priority order: hard obligations (work/school/jail already handled above) →
        //   active promises/directives → social context → personality → needs-based wandering.
        //
        // Commitment reliability is weighted by character personality (canonical trait registry).
        // Loyal + conscientious characters almost always follow through.
        // Wishy-washy + two-faced characters have reduced follow-through probability.
        // But note: the system should only REDUCE travel probability for flaky characters,
        // NEVER silently null the destination. If a flaky character fails to show, the
        // commitment must be marked as "bailed" with an in-character reason, not silently lost.
        {
          let commitmentHandled = false;
          const reliabilityScore = computeCommitmentReliabilityScore(char);
          try {
            const activeCommitments = await base44.asServiceRole.entities.CharacterCommitment.filter(
              { character_id: char.id },
              '-created_at',
              10
            );
            const liveCommitments = (activeCommitments || []).filter(c =>
              c.status === 'active' || c.status === 'in_progress'
            );

            // Priority 0: Skip if already in transit to this destination
            const alreadyTraveling = char.resolved_presence_status === 'traveling' &&
              char.travel_destination_location_id != null;
            if (alreadyTraveling) {
              console.log(`[autonomousMovement] ${char.name}: already in_transit to ${char.traveling_to_location_name || char.travel_destination_location_id} — skip`);
              commitmentHandled = true;
            }

            // Priority 1: Travel directives — "I'm on my way" / "heading there now"
            if (!commitmentHandled) {
              const directive = liveCommitments.find(c => c.commitment_type === 'travel_directive');
              if (directive && directive.destination_location_id) {
                const destLoc = userLocations.find(l => l.id === directive.destination_location_id);
                if (destLoc) {
                  // PERSONALITY CHECK: very unreliable characters (score < -3) have a small chance
                  // of bailing. But this must be VISIBLE — the commitment is marked "bailed" not silently dropped.
                  // Loyal/conscientious characters (score >= 1) NEVER bail on directives.
                  const bailChance = reliabilityScore < -3 ? 0.15 : reliabilityScore < -1 ? 0.05 : 0;
                  const bailRolled = bailChance > 0 && Math.random() < bailChance;
                  if (bailRolled) {
                    // Mark commitment as bailed with personality reason — NEVER silent
                    await base44.asServiceRole.entities.CharacterCommitment.update(directive.id, {
                      status: 'cancelled',
                      cancellation_reason: `personality_bail: reliability_score=${reliabilityScore.toFixed(1)} (${char.trait_wishy_washy ? 'wishy-washy' : char.trait_two_faced ? 'two-faced' : 'unreliable'})`,
                    }).catch(() => {});
                    console.log(`[autonomousMovement] ${char.name}: PERSONALITY BAIL on directive (score=${reliabilityScore.toFixed(1)}) — commitment marked cancelled, NOT silently dropped`);
                    commitmentHandled = true;
                    skippedLog.push(`${char.name}: personality bail on commitment (reliability=${reliabilityScore.toFixed(1)})`);
                  } else if (char.resolved_current_location_id !== destLoc.id) {
                    // Create a REAL travel session — character is in transit, NOT teleported
                    const travelRes = await base44.asServiceRole.entities.TravelSession.create( {
                      character_id:           char.id,
                      destination_location_id: destLoc.id,
                      travel_reason:          directive.promised_action || 'commitment travel directive',
                      travel_source:          'promise',
                      source_commitment_id:    directive.id,
                      owner_email:            char.owner_email,
                    }).catch(e => ({ success: false, error: e.message }));
                    const td = travelRes?.data || {};
                    if (td.success) {
                      // Update commitment to in_progress
                      await base44.asServiceRole.entities.CharacterCommitment.update(directive.id, {
                        status: 'in_progress',
                        travel_started_at: nowET.toISOString(),
                      }).catch(() => {});
                      totalMoved++;
                      moveLog.push(`${char.name} → ${destLoc.name} [COMMITMENT_TRAVEL_DIRECTIVE → IN_TRANSIT ~${td.duration_minutes}min] "${directive.promised_action || 'on the way'}"`);
                      console.log(`[autonomousMovement] ✓ ${char.name}: COMMITMENT DIRECTIVE → in_transit → ${destLoc.name} (ETA: ${td.estimated_arrival})`);
                    } else if (td.blocked) {
                      blockedLog.push(`${char.name}: commitment directive blocked — ${td.blocker_reason || td.blocker}`);
                      console.log(`[autonomousMovement] ${char.name}: COMMITMENT DIRECTIVE BLOCKED — ${td.blocker_reason}`);
                    } else {
                      // createTravelSession failed — LOG and block. NO teleport fallback.
                      // A failed travel session must never silently move the character.
                      const failReason = td.error || 'createTravelSession returned failure without error detail';
                      blockedLog.push(`${char.name}: createTravelSession FAILED — ${failReason} — NO fallback teleport applied`);
                      console.error(`[autonomousMovement] ⛔ NO-TELEPORT ENFORCED: ${char.name}: createTravelSession failed — ${failReason}. Character stays at origin. Commitment NOT completed.`);
                    }
                  } else {
                    // Already there — mark completed
                    await base44.asServiceRole.entities.CharacterCommitment.update(directive.id, {
                      status: 'completed',
                      travel_arrived_at: nowET.toISOString(),
                      completion_result: `Already at ${destLoc.name}`,
                    }).catch(() => {});
                    console.log(`[autonomousMovement] ${char.name}: COMMITMENT DIRECTIVE — already at destination ${destLoc.name}`);
                  }
                  commitmentHandled = true;
                }
              }
            }

            // Priority 2: Travel promises that are due within 60 minutes
            if (!commitmentHandled) {
              const nowMs = nowET.getTime();
              const promise = liveCommitments.find(c => {
                if (c.commitment_type !== 'travel_promise') return false;
                if (!c.destination_location_id) return false;
                if (!c.scheduled_execute_at) return false;
                const dueMs = new Date(c.scheduled_execute_at).getTime();
                return dueMs - nowMs <= 60 * 60 * 1000 && dueMs > nowMs - 10 * 60 * 1000;
              });
              if (promise && promise.destination_location_id) {
                const destLoc = userLocations.find(l => l.id === promise.destination_location_id);
                if (destLoc && char.resolved_current_location_id !== destLoc.id) {
                  // Create travel session — promise fulfillment is real transit
                  const travelRes2 = await base44.functions.invoke('createTravelSession', {
                    characterId:           char.id,
                    destinationLocationId: destLoc.id,
                    travelReason:          promise.promised_action || 'travel promise fulfillment',
                    travelSource:          'promise',
                    sourceCommitmentId:    promise.id,
                    ownerEmail:            char.owner_email,
                  }).catch(e => ({ data: { success: false, error: e.message } }));
                  const td2 = travelRes2?.data || {};
                  if (td2.success) {
                    await base44.asServiceRole.entities.CharacterCommitment.update(promise.id, {
                      status: 'in_progress',
                      travel_started_at: nowET.toISOString(),
                    }).catch(() => {});
                    totalMoved++;
                    moveLog.push(`${char.name} → ${destLoc.name} [COMMITMENT_PROMISE → IN_TRANSIT ~${td2.duration_minutes}min] due ${promise.promised_time_window || 'soon'}`);
                    console.log(`[autonomousMovement] ✓ ${char.name}: COMMITMENT PROMISE → in_transit → ${destLoc.name}`);
                  } else if (td2.blocked) {
                    blockedLog.push(`${char.name}: promise travel blocked — ${td2.blocker_reason || td2.blocker}`);
                  } else {
                    // createTravelSession failed — LOG and block. NO teleport fallback.
                    const failReason2 = td2.error || 'createTravelSession returned failure without error detail';
                    blockedLog.push(`${char.name}: promise createTravelSession FAILED — ${failReason2} — NO fallback teleport applied`);
                    console.error(`[autonomousMovement] ⛔ NO-TELEPORT ENFORCED: ${char.name}: promise createTravelSession failed — ${failReason2}. Character stays at origin.`);
                  }
                  commitmentHandled = true;
                }
              }
            }
          } catch (commitErr) {
            // Non-fatal — if commitment lookup fails, fall through to normal needs-based movement
            console.warn(`[autonomousMovement] ${char.name}: commitment check failed (non-fatal) — ${commitErr.message}`);
          }

          if (commitmentHandled) {
            if (totalMoved >= MAX_MOVES_PER_RUN) {
              return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, capped: true, timestamp: new Date().toISOString() });
            }
            continue;
          }
        }
        // END TIER 6.5

        // ── READ FULL NEEDS + DECIDE IF MOVEMENT IS REQUIRED ─────────────────
        const top = highestUrgencyEntry(vals);

        let shouldAttempt = false;
        let isMandatory = false;

        if (top.urgency >= 2) {
          shouldAttempt = true;
          isMandatory = true;
        } else if (top.urgency === 1) {
          shouldAttempt = Math.random() < 0.50;
        } else {
          shouldAttempt = Math.random() < 0.25;
        }

        if (!shouldAttempt) {
          console.log(`[autonomousMovement] ${char.name}: needs OK, skipping`);
          skippedLog.push(`${char.name}: all needs OK`);
          continue;
        }

        // ── TRAVEL DISPLAY INTEGRITY: clear orphaned travel_status ──────────────
        // If character shows travel_status but has NO valid active TravelSession,
        // the Home/Travel/Chat UI will show "Traveling to…" with no proof (no status bar,
        // no ETA, no progress, no map movement). This is a one-truth/one-presence violation.
        // Clear it now so the character's presence displays correctly.
        const travelingStates = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination', 'traveling'];
        if (travelingStates.includes(char.travel_status)) {
          const orphanCheck = await base44.asServiceRole.entities.TravelSession.filter({
            owner_email: char.owner_email,
            character_id: char.id,
            route_status: 'in_transit',
          }, null, 1).catch(() => []);
          if (!orphanCheck || orphanCheck.length === 0) {
            // No valid session — this travel_status is orphaned. Clear it.
            console.warn(`[autonomousMovement] ${char.name}: ORPHANED travel_status="${char.travel_status}" with no active TravelSession — clearing display flags`);
            try {
              await base44.entities.Character.update(char.id, {
                travel_status: 'not_traveling',
                traveling_to_location_id: null,
                traveling_to_location_name: null,
                travel_destination_location_id: null,
              });
            } catch {
              await base44.asServiceRole.entities.Character.update(char.id, {
                travel_status: 'not_traveling',
                traveling_to_location_id: null,
                traveling_to_location_name: null,
                travel_destination_location_id: null,
              }).catch(() => {});
            }
            blockedLog.push(`${char.name}: cleared orphaned travel_status="${char.travel_status}" (no matching TravelSession)`);
          }
        }

        // ── FILTER OUT CLOSED LOCATIONS ───────────────────────────────────────
        const openLocations = userLocations.filter(loc => isLocationOpen(loc));

        // ── LOW ENERGY (urgent, < 50) → route home via travel session ────────
        // No teleport — initiate transit to home. processTravelArrivals delivers them.
        if (energyUrgency >= 2 && char.current_home_location_id) {
          const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
          if (ownHome && char.resolved_current_location_id !== ownHome.id) {
            const eLowRes = await base44.functions.invoke('createTravelSession', {
              characterId:           char.id,
              destinationLocationId: ownHome.id,
              travelReason:          `energy_low_return_home energy(${Math.round(vals.energy)})`,
              travelSource:          'autonomous_need',
              ownerEmail:            char.owner_email,
            }).catch(e => ({ data: { success: false, error: e.message } }));
            const eLowData = eLowRes?.data || {};
            if (eLowData.success) {
              totalMoved++;
              moveLog.push(`${char.name} → ${ownHome.name} [ENERGY_LOW_HOME → IN_TRANSIT ~${eLowData.duration_minutes}min] energy(${Math.round(vals.energy)})`);
              console.log(`[autonomousMovement] ✓ ${char.name}: energy low → in_transit home ${ownHome.name}`);
            } else if (eLowData.blocked) {
              blockedLog.push(`${char.name}: energy-low home travel blocked — ${eLowData.blocker_reason}`);
            } else {
              blockedLog.push(`${char.name}: energy-low home createTravelSession failed — ${eLowData.error} — NO fallback teleport`);
              console.error(`[autonomousMovement] ⛔ NO-TELEPORT: ${char.name} energy-low home travel failed — ${eLowData.error}`);
            }
            continue;
          }
          if (ownHome && char.resolved_current_location_id === ownHome.id) {
            console.log(`[autonomousMovement] ${char.name}: low energy, already home`);
            continue;
          }
        }

        // ── CURRENT-LOCATION SATISFACTION CHECK (REPAIRED) ─────────────────
        // Uses satisfactionQuality() — evaluates ALL urgent needs at current loc.
        // Returns quality level: fully/partially/weakly/not.
        // This is a FACTOR in stay-vs-travel, NOT a hard block.
        const currentLoc = userLocations.find(l => l.id === char.resolved_current_location_id);
        const sat = currentLoc ? satisfactionQuality(char, vals, currentLoc) : { quality: 'no_location', detail: 'No current location' };

        if (sat.quality !== 'not' && sat.quality !== 'no_need' && sat.quality !== 'no_location') {
          const stayProb = computeStayProbability(char, vals, currentLoc, nowET, sat);
          const roll = Math.random();
          if (roll < stayProb) {
            console.log(`[autonomousMovement] ${char.name}: staying — sat=${sat.quality} (${sat.detail}) stayProb=${(stayProb*100).toFixed(0)}%, roll=${(roll*100).toFixed(0)}%)`);
            skippedLog.push(`${char.name}: staying — sat=${sat.quality} at ${currentLoc.name} (stayProb=${(stayProb*100).toFixed(0)}%)`);
            continue;
          }
          console.log(`[autonomousMovement] ${char.name}: traveling — sat=${sat.quality} but stayProb=${(stayProb*100).toFixed(0)}%, roll=${(roll*100).toFixed(0)}% — personality/combined pressures override`);
        }

        // ── SELECT BEST LOCATION ──────────────────────────────────────────────
        const bestLocation = selectBestLocation(openLocations, char, vals, nowET);

        if (!bestLocation) {
          const urgentNeeds = Object.entries(vals)
            .filter(([, v]) => urgencyLevel(v) >= 2)
            .map(([k, v]) => `${k}(${Math.round(v)})`)
            .join(', ');
          const msg = `${char.name}: URGENT [${urgentNeeds}] — NO valid location in scope`;
          blockedLog.push(msg);
          console.warn(`[autonomousMovement] BLOCK: ${msg}`);
          continue;
        }

        // ── ALREADY THERE — no-op ───────────────────────────────────────────
        if (char.resolved_current_location_id === bestLocation.id) {
          console.log(`[autonomousMovement] ${char.name}: already at ${bestLocation.name}`);
          continue;
        }

        // ── DECLARE finalLocation EARLY so correction lock and home protection can both assign it ──
        let finalLocation = bestLocation;

        // ── CORRECTION LOCK: Do not move character back to a recently-corrected-FROM location ──
        // If the character has a correction lock active and the destination matches the
        // location they were just corrected away from, block the move.
        if (char.location_correction_locked_until && char.location_correction_previous_id) {
          const lockUntil = new Date(char.location_correction_locked_until);
          if (nowET < lockUntil && finalLocation.id === char.location_correction_previous_id) {
            const msg = `${char.name}: CORRECTION_LOCK blocked return to "${finalLocation.name}" — lock expires ${lockUntil.toISOString()}`;
            blockedLog.push(msg);
            console.warn(`[autonomousMovement] CORRECTION_LOCK: ${msg}`);
            // Re-select excluding the locked location
            const nonLockedOpen = openLocations.filter(loc => loc.id !== char.location_correction_previous_id);
            const lockFallback = selectBestLocation(nonLockedOpen, char, vals, nowET);
            if (!lockFallback) {
              skippedLog.push(`${char.name}: correction lock active, no valid fallback`);
              continue;
            }
            finalLocation = lockFallback;
          }
        }

        // ── HOME WRITE PROTECTION ────────────────────────────────────────────
        // If the selected location is home-category but NOT this character's authoritative home,
        // that write is invalid. Re-select from non-home locations only.
        if (finalLocation.category === 'home' && finalLocation.id !== char.current_home_location_id) {
          console.warn(`[autonomousMovement] BLOCKED_INVALID_HOME_WRITE: ${char.name} → ${finalLocation.name} (not their home). Re-selecting.`);
          blockedLog.push(`${char.name}: BLOCKED_INVALID_HOME_WRITE — ${finalLocation.name} is not their authoritative home`);
          const nonHomeLocations = openLocations.filter(loc => loc.category !== 'home' && loc.category !== 'generic');
          const homeFallback = selectBestLocation(nonHomeLocations, char, vals, nowET);
          if (!homeFallback) {
            console.log(`[autonomousMovement] ${char.name}: no non-home fallback, skipping`);
            skippedLog.push(`${char.name}: blocked wrong home write, no non-home fallback`);
            continue;
          }
          finalLocation = homeFallback;
        }

        // ── INITIATE TRAVEL SESSION (no teleport) ───────────────────────────
        // Needs-driven movement MUST go through createTravelSession.
        // The character stays at origin. processTravelArrivals commits the destination on arrival.
        // Direct location mutation is FORBIDDEN here — that is the no-teleport invariant.
        try {
          const travelRes = await base44.asServiceRole.entities.TravelSession.create( {
            character_id:           char.id,
            destination_location_id: finalLocation.id,
            travel_reason:          `autonomous_needs: ${top.key}(${Math.round(top.value)})`,
            travel_source:          'autonomous_need',
            owner_email:            char.owner_email,
          }).catch(e => ({ success: false, error: e.message }));
          const td = travelRes?.data || {};

          if (td.success) {
            totalMoved++;
            const urgentList = Object.entries(vals)
              .filter(([, v]) => urgencyLevel(v) >= 2)
              .map(([k, v]) => `${k}(${Math.round(v)})`)
              .join(', ') || `${top.key}(${Math.round(top.value)})`;
            const mandatory = isMandatory ? '[MANDATORY]' : '[optional]';
            const msg = `${char.name} → ${finalLocation.name} ${mandatory} needs: ${urgentList} [IN_TRANSIT ~${td.duration_minutes}min ETA: ${td.estimated_arrival}]`;
            moveLog.push(msg);
            console.log(`[autonomousMovement] ✓ ${msg}`);
            if (totalMoved >= MAX_MOVES_PER_RUN) {
              console.log(`[autonomousMovement] MAX_MOVES_PER_RUN (${MAX_MOVES_PER_RUN}) reached — stopping run`);
              return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, capped: true, timestamp: new Date().toISOString() });
            }
          } else if (td.blocked) {
            blockedLog.push(`${char.name}: travel blocked — ${td.blocker_reason || td.blocker}`);
            console.log(`[autonomousMovement] ${char.name}: travel BLOCKED — ${td.blocker_reason}`);
          } else {
            // createTravelSession failed — NO teleport fallback. Character stays at origin.
            const failReason = td.error || 'createTravelSession returned failure without error detail';
            blockedLog.push(`${char.name}: createTravelSession FAILED — ${failReason} — NO fallback teleport`);
            console.error(`[autonomousMovement] ⛔ NO-TELEPORT ENFORCED: ${char.name} → ${finalLocation.name}: ${failReason}. Character stays at origin.`);
            const is429 = failReason.includes('429') || failReason.includes('Rate limit');
            if (is429) {
              console.warn(`[autonomousMovement] 429 from createTravelSession — stopping run`);
              return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, rate_limited: true, timestamp: new Date().toISOString() });
            }
          }
        } catch (e) {
          const is429 = e?.message?.includes('429') || e?.message?.includes('Rate limit');
          if (is429) {
            console.warn(`[autonomousMovement] 429 on travel initiation — stopping run`);
            return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, rate_limited: true, timestamp: new Date().toISOString() });
          }
          console.error(`[autonomousMovement] createTravelSession invoke FAILED for ${char.name}:`, e.message);
          blockedLog.push(`${char.name}: createTravelSession invoke failed — ${e.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      users_processed: Object.keys(byUser).length,
      characters_moved: totalMoved,
      moves: moveLog,
      blocked_with_reason: blockedLog,
      skipped: skippedLog.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[autonomousMovement]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});