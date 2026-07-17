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

// ── FINANCIAL CONSEQUENCE TRIGGER ───────────────────────────────────────────────
async function triggerSpendingForDestination(base44, char, destLocId, destLocName, destCategory, sourceReason, needType) {
  try {
    const payload = {
      character_id:              char.id,
      owner_email:               char.owner_email,
      destination_location_id:   destLocId,
      destination_location_name: destLocName,
      destination_category:      destCategory || '',
      home_location_id:          char.current_home_location_id || '',
      arrival_reason:            sourceReason || '',
      source_of_move:            'system',
      resolved_source_reason:    sourceReason || '',
      travel_reason:             sourceReason || '',
      need_type:                 needType || '',
      characterData:             char,
    };
    // Use invoke and wait for the result to log it
    const result = await base44.asServiceRole.functions.invoke('processCharacterFoodAndDrinkSpending', payload);
    console.log(`[triggerSpending] char=${char.name} dest=${destLocName} result: ${JSON.stringify(result.data)}`);

  } catch (err) {
    console.error(`[triggerSpending] FAILED for ${char.name} at ${destLocName}: ${err.message}`);
  }
}

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

// ── PROTECTED ARRIVAL COMMITMENT PREDICATE ──────────────────────────────────
// Reads ONLY the valid arrival contract written by confirmMovementCommitment:
//   commitment_type === 'arrival', interruptible === false, destination_location_id,
//   expected_arrival_time, expected_arrival_window_minutes
// 'active': protected once inside the arrival window (now >= eta - window_minutes).
// 'arrived': protected while resolved_current_location_id === destination_location_id
//   (condition-based release — when an authoritative system moves the character,
//   the match fails and protection lapses; no timer or invented expiration).
// Work/school authority is NOT re-evaluated here. Tier 3.5 dispatch runs before
// this predicate is computed and continues on its own authority, so a mandatory
// shift/session naturally overrides the commitment without a competing check.
// expected_arrival_time is validated (NaN rejected). Query failures are logged
// and treated as "no protection found" (non-fatal — does not crash the run).
async function getProtectedArrivalCommitment(base44, char) {
  if (!char?.id || !char?.owner_email) return null;
  let cs = null;
  try {
    cs = await base44.asServiceRole.entities.CharacterCommitment.filter(
      { character_id: char.id, owner_email: char.owner_email, commitment_type: 'arrival' },
      '-created_at', 50
    );
  } catch (qErr) {
    console.error(`[autonomousMovement] ${char.name}: arrival-commitment query FAILED — protection not evaluated: ${qErr.message}`);
    return null;
  }
  if (!cs?.length) return null;
  const nowMs = Date.now();
  for (const c of cs) {
    if (c?.interruptible !== false || !c?.destination_location_id) continue;
    if (c.status === 'active') {
      if (!c.expected_arrival_time) continue;
      const aMs = new Date(c.expected_arrival_time).getTime();
      if (!Number.isFinite(aMs)) continue;
      const wMin = c.expected_arrival_window_minutes ?? 15;
      if (nowMs >= aMs - wMin * 60000) return c;
    }
    if (c.status === 'arrived' && c.destination_location_id === char.resolved_current_location_id) return c;
  }
  return null;
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

  // ── COMBINED PRESSURES — only for needs NOT fully satisfied here ─────────
  const unmetUrgentKeys = urgentKeys.filter(k => perNeedQuality[k] !== 'fully');
  const unmetUrgentCount = unmetUrgentKeys.length;
  if (unmetUrgentCount >= 2) {
    stayProb -= 0.10 * (unmetUrgentCount - 1);
    if (unmetUrgentKeys.includes('social') && unmetUrgentKeys.includes('hunger') && cat === 'home')
      stayProb -= 0.15;
    if (unmetUrgentKeys.includes('social') && (char.trait_competitive || /gym|fitness|workout/.test((char.health_habits || '').toLowerCase())))
      stayProb -= 0.10;
    if (unmetUrgentKeys.includes('hunger') && (vals.financial || 60) < 40 && cat === 'home')
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
  const needs_locks = char.needs_locks || {};
  return {
    hunger:   needs_locks.hunger ? 100 : (char.hunger_value          ?? 70),
    energy:   needs_locks.energy ? 100 : (char.energy_value          ?? 75),
    social:   needs_locks.social ? 100 : (char.social_value          ?? 65),
    health:   needs_locks.health ? 100 : (char.health_value          ?? 80),
    mental:   needs_locks.mental ? 100 : (char.mental_value          ?? 70),
    hygiene:  needs_locks.hygiene ? 100 : (char.hygiene_value         ?? 75),
    comfort:  needs_locks.comfort ? 100 : (char.comfort_value         ?? 70),
    financial: needs_locks.financial ? 100 : (char.financial_need_value ?? 60),
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

  // ── HUNGER — drives eating, NOT grocery shopping ────────────────────────
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
    // Grocery is NO LONGER hunger-driven — inventory-driven below
    if (cat === 'home')       score += isIntro ? (3 + hungerU * 1.5) : (1 + Math.floor(hungerU * 0.5));
  }

  // ── INVENTORY-DRIVEN GROCERY — uses preloaded HouseholdResource data ────
  if (cat === 'grocery') {
    const inventoryData = char._householdInventory;
    if (inventoryData) {
      const level = inventoryData.inventoryLevel;
      const foodVal = inventoryData.homeFoodValue || 0;
      if (level === 'empty') {
        score += 4 + hungerU; // urgent — no food at home, must shop
      } else if (level === 'critical') {
        score += 3 + hungerU;
      } else if (level === 'low') {
        score += 2;
      } else {
        // healthy or full — grocery is not needed
        score -= 5;
      }
    } else {
      // No inventory data — default: neutral (don't assume either way)
      score += 0;
    }
  }

  // ── AFFORDABILITY-AWARE SCORING ─────────────────────────────────────────
  // Penalize spending destinations when character has low funds AND food at home
  {
    const balance = char._financialBalance;
    const inventoryData = char._householdInventory;
    const hasHomeFood = inventoryData && inventoryData.homeFoodValue > 0;
    const isSpendingCat = cat === 'food_drink' || cat === 'grocery' ||
      (cat === 'social' && (location.name || '').toLowerCase().includes('bar'));

    if (isSpendingCat && balance !== undefined && balance !== null) {
      // Expected cost estimate
      let expectedCost = 50; // default
      if (cat === 'food_drink') expectedCost = 35;
      if (cat === 'grocery') expectedCost = 80;
      const isNightlife = (location.name || '').toLowerCase().includes('club') ||
        (location.name || '').toLowerCase().includes('nightclub');

      // If balance can't cover expected cost → heavily penalize
      if (balance < expectedCost * 0.5) {
        score -= 8;
        // If home food exists, strongly redirect home
        if (hasHomeFood) {
          score -= 4;
        }
      } else if (balance < expectedCost) {
        score -= 4;
        if (hasHomeFood) {
          score -= 3;
        }
      }

      // Low funds + home food → home heavily preferred for hunger
      if (hasHomeFood && balance < 50 && hungerU >= 2) {
        if (cat !== 'home') score -= 3;
      }
    }
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

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECT LOCATION WRITE — active_created_character autonomous travel does NOT use
// TravelSession records, transit phases, ETAs, or cross-function arrival completion.
// Characters move immediately: write destination, begin need fulfillment/dwell.
// ═══════════════════════════════════════════════════════════════════════════════

async function writeCharacterToDestination(base44, char, destLocationId, destLocationName, {
  resolvedPresenceStatus = 'visiting',
  resolvedLocationType = 'visit',
  resolvedSourceReason = 'autonomous_needs',
  nowET,
}) {
  // Route through the sole canonical writer — do NOT write canonical fields directly.
  try {
    await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
      character_id: char.id,
      owner_email: char.owner_email,
      requested_presence_status: resolvedPresenceStatus,
      requested_location_id: destLocationId,
      requested_location_type: resolvedLocationType,
      requested_source_reason: resolvedSourceReason,
      requested_relocation: true,
      requested_timestamp: nowET.toISOString(),
    });
  } catch (invokeErr) {
    console.warn(`[autonomousMovement] Authority invoke failed for ${char.name} → ${destLocationName}: ${invokeErr.message}`);
    return;
  }
  // Clear noncanonical travel fields (this caller owns these — not canonical presence)
  try {
    await base44.asServiceRole.entities.Character.update(char.id, {
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
    });
  } catch { /* non-fatal */ }
}

// ── REMOVED: TravelSession transit model functions ──
// deterministicFloat, jitterMinutes, estimateTravelTime, and createAutonomousTravelSession
// were all part of the TravelSession transit model that does not belong in
// active_created_character autonomous travel. Characters move immediately — no transit phase.
// Use writeCharacterToDestination() for direct location writes.


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
          console.warn(`[autonomousMovement] ${char.name}: ORPHANED 'traveling' with no active session — clearing to '${canonicalStatus}' (canonical repair via authority)`);
          // ── ONE TRUTH: Route the canonical repair through the authority ──
          try {
            await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
              character_id: char.id, owner_email: char.owner_email,
              requested_presence_status: canonicalStatus,
              requested_location_id: canonicalLocId,
              requested_source_reason: 'orphaned_travel_state_cleared',
              requested_authority: 'autonomousCharacterMovement',
              requested_timestamp: nowET.toISOString(),
            });
          } catch { /* non-fatal — authority unavailable */ }
          // Clear noncanonical travel fields (this caller owns these)
          try {
            await base44.asServiceRole.entities.Character.update(char.id, {
              travel_status:                  'not_traveling',
              travel_destination_location_id: null,
              traveling_to_location_id:       null,
              traveling_to_location_name:     null,
            });
          } catch { /* non-fatal */ }
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
        // ── DISABLED: Exhaustion-threshold pass-out is blocked per mandatory
        // temporary shutdown. Energy may reach any value without triggering
        // pass-out. The threshold definition is retained for future restoration
        // but the execution path is blocked. Energy and awake-time values
        // continue to calculate and display normally.
        const PASSOUT_EXHAUSTION_DISABLED = true;
        if (!PASSOUT_EXHAUSTION_DISABLED && energyUrgency >= 4) {
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

        // ── TIER 2: ALREADY PASSED OUT — 6-HOUR MINIMUM GUARD ───────────────
        // Character is passed out. autonomousCharacterMovement must NOT route them to home
        // or change their presence until the 6-hour minimum has elapsed from last_pass_out_at.
        // Energy recovery reaching > 10 is the intended physiological response — it does NOT
        // mean the character is ready to get up. They are still unconscious/recovering.
        //
        // CANONICAL RULE: passed_out → home transition requires:
        //   a) 6h elapsed from last_pass_out_at, OR
        //   b) Medical emergency (health ≤ 15 — hospitalization overrides everything)
        //
        // The 12h hard cap in simulateActiveCharacterNeeds is the MAXIMUM.
        // The energy > 35 stay_lock_release is governed by the same 6h guard (fixed there too).
        // autonomousCharacterMovement must NOT circumvent both guards by routing to home directly.
        if (status === 'passed_out') {
          const passOutAt = char.last_pass_out_at;
          const isMedicalEmergencyPassOut = (char.health_value ?? 80) <= 15;
          let passOutElapsedHours = 0;
          if (passOutAt) {
            passOutElapsedHours = (nowET.getTime() - new Date(passOutAt).getTime()) / 3_600_000;
          }
          const passOutProtected = passOutAt && passOutElapsedHours < 6 && !isMedicalEmergencyPassOut;

          if (passOutProtected) {
            // Passed out but protected — do not move, do not change state.
            // simulateActiveCharacterNeeds will handle the release at 6h or 12h hard cap.
            console.log(`[autonomousMovement] ${char.name}: PASS_OUT_PROTECTED — ${passOutElapsedHours.toFixed(2)}h elapsed < 6h minimum — no action`);
            continue;
          }

          // Past 6h (or no timestamp, or medical emergency) — allow home routing.
          if (energyUrgency < 4 && char.current_home_location_id) {
            const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
            if (ownHome) {
              try { await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_presence_status: 'home', requested_location_id: ownHome.id, requested_location_type: 'home', requested_source_reason: 'pass_out_recovery', requested_timestamp: nowET.toISOString() }); } catch { /* non-fatal */ }
              moveLog.push(`${char.name} → ${ownHome.name} [PASS_OUT_RECOVERY after ${passOutElapsedHours.toFixed(1)}h]`);
              console.log(`[autonomousMovement] ✓ ${char.name}: pass-out recovery → ${ownHome.name} (${passOutElapsedHours.toFixed(1)}h elapsed)`);
            }
          }
          continue;
        }

        // ── TIER 3: SLEEP + NAP HANDLERS ─────────────────────────────────────
        // Two completely separate branches below: one for 'sleeping', one for 'napping'.
        // They use different timestamps, different duration rules, and different wake logic.
        // sleep uses last_sleep_start + 6–8h rules. nap uses last_nap_time + 3h cap.
        // The 3h nap cap is enforceStaleNapLimit's responsibility — not this handler.
        // ── NAPPING: separate handler, separate rules, separate timestamp ───────
        // Uses last_nap_time NOT last_sleep_start. 6–8h sleep rules NEVER apply here.
        // The 3h nap cap is enforceStaleNapLimit's job. This only handles early wake.
        if (status === 'napping') {
          const napStartedAt = char.last_nap_time ? new Date(char.last_nap_time) : null;
          const napDurationHours = napStartedAt ? (nowET.getTime() - napStartedAt.getTime()) / 3600000 : 0;
          const energyNow = char.energy_value ?? 0;
          // Nap ends when energy recovered (≥70) AND nap ≥ 30min. No 6h rule. No 8h rule.
          if (energyNow < 70 || napDurationHours < 0.5) {
            console.log(`[autoMove] ${char.name}: NAPPING — remain (energy=${Math.round(energyNow)}, nap=${napDurationHours.toFixed(1)}h) — 3h cap via enforceStaleNapLimit only`);
            continue;
          }
          let _napWakeAuth = null;
          try { const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_presence_status: 'home', requested_source_reason: 'nap_complete_energy_recovered', requested_timestamp: nowET.toISOString() }); _napWakeAuth = _ir?.data || _ir; } catch { /* non-fatal */ }
          // Only write proof records if the authority accepted/redirected/modified the wake.
          if (_napWakeAuth?.disposition === 'accepted' || _napWakeAuth?.disposition === 'redirected' || _napWakeAuth?.disposition === 'modified') {
            char.resolved_presence_status = _napWakeAuth.committed_result?.resolved_presence_status || 'home';
            // MANDATORY NAP WAKE PROOF — SleepTransition + LifeEvent (silent wake forbidden)
            try {
              await base44.asServiceRole.entities.SleepTransition.create({ character_id: char.id, character_name: char.name, owner_email: char.owner_email, transition_type: 'nap_end', from_status: 'napping', to_status: _napWakeAuth.committed_result?.resolved_presence_status || 'home', authority: 'nap_complete_energy_recovered', reason: `Nap complete — energy=${Math.round(energyNow)}, nap=${napDurationHours.toFixed(1)}h.`, timestamp: nowET.toISOString(), state_start_ref: char.last_nap_time || null, elapsed_hours: Math.round(napDurationHours * 100) / 100 });
              await base44.asServiceRole.entities.LifeEvent.create({ character_id: char.id, character_name: char.name, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up from a nap', description: `${char.name} woke up from a nap. Energy at ${Math.round(energyNow)}.`, emotional_impact: 'refreshed', triggered_by: 'life_simulation', timestamp: nowET.toISOString(), context_tags: ['nap_end', 'woke_up'] });
            } catch (proofError) { console.warn(`[autoMove] ${char.name}: nap wake proof failed (non-reverting): ${proofError.message}`); }
            console.log(`[autoMove] ✓ ${char.name}: NAPPING → woke naturally (energy=${Math.round(energyNow)}, nap=${napDurationHours.toFixed(1)}h) [proof created]`);
          } else {
            console.log(`[autoMove] ${char.name}: NAP WAKE — authority disposition=${_napWakeAuth?.disposition || 'unknown'} — no proof records written`);
          }
        }

        // ── SLEEPING: separate handler, separate rules, uses last_sleep_start ──
        // SLEEPING ONLY. The napping handler above is fully separate and already ran.
        // last_sleep_start is the authoritative sleep timer. 6–8h rules apply.
        // Employment/enrollment alone NEVER wakes. Obligation must be currently active.
        if (status === 'sleeping') {
          const nowMin3 = nowET.getHours() * 60 + nowET.getMinutes();
          const dowNow3 = nowET.getDay();
          const todayET3 = nowET.toISOString().slice(0, 10);
          // Use last_sleep_start — NEVER last_nap_time for sleeping status
          const sleepStartedAt = char.last_sleep_start ? new Date(char.last_sleep_start) : null;
          const sleepDurationHours = sleepStartedAt ? (nowET.getTime() - sleepStartedAt.getTime()) / 3600000 : 0;
          const isMedEmergency3 = (char.health_value ?? 80) <= 15;

          // WORK: shift must be currently active AND 6h minimum met (or medical emergency)
          const hasActiveWorkObligation = (() => {
            if (!Array.isArray(char.work_days) || !char.work_start_time || !char.work_end_time || !char.occupation_location_id) return false;
            if (!char.work_days.includes(dowNow3)) return false;
            if (char.work_exception_status === 'called_out' && char.work_exception_date === todayET3) return false;
            const s3 = toMin(char.work_start_time), e3 = toMin(char.work_end_time);
            if (s3 === null || e3 === null) return false;
            const shiftActive = e3 < s3 ? (nowMin3 >= s3 || nowMin3 < e3) : (nowMin3 >= s3 && nowMin3 < e3);
            if (!shiftActive) return false; // shift hasn't started or already ended — do NOT wake
            if (sleepDurationHours < 6 && !isMedEmergency3) { console.log(`[autonomousMovement] ${char.name}: work shift active but 6h minimum not met (${sleepDurationHours.toFixed(2)}h) — staying asleep`); return false; }
            return true;
          })();

          // SCHOOL: session must be currently active per actual school hours (not hardcoded 8–15)
          const hasActiveSchoolObligation = (() => {
            if (char.student_status !== 'enrolled' || !char.education_location_id) return false;
            const edLoc3 = userLocations.find(l => l.id === char.education_location_id);
            let sessionActive = false;
            if (edLoc3 && edLoc3.operating_hours && edLoc3.operating_hours.length > 0) {
              const dayH = edLoc3.operating_hours.filter(h => h.day_of_week === dowNow3);
              const agH  = edLoc3.operating_hours.filter(h => h.day_of_week == null);
              sessionActive = (dayH.length > 0 ? dayH : agH).some(h => {
                const s = toMinutes(h.open_time), e = toMinutes(h.close_time);
                if (s === null || e === null) return false;
                return e < s ? (nowMin3 >= s || nowMin3 < e) : (nowMin3 >= s && nowMin3 < e);
              });
            } else {
              const edD = char.education_details || {};
              const eS = toMinutes(edD.start_time || edD.school_start_time || '');
              const eE = toMinutes(edD.end_time   || edD.school_end_time   || '');
              if (eS !== null && eE !== null) sessionActive = eE < eS ? (nowMin3 >= eS || nowMin3 < eE) : (nowMin3 >= eS && nowMin3 < eE);
            }
            if (!sessionActive) return false; // school not in session — do NOT wake
            if (sleepDurationHours < 6 && !isMedEmergency3) { console.log(`[autonomousMovement] ${char.name}: school in session but 6h minimum not met (${sleepDurationHours.toFixed(2)}h) — staying asleep`); return false; }
            return true;
          })();

          // AUTO-SET ALARM for upcoming obligation so processScheduledCharacterAlarms handles the wake
          // Only set if no alarm already scheduled. Alarm fires PREP_MINUTES before shift start.
          // Alarm time is floored to at least 6h after sleep start (canonical minimum).
          const PREP_MINUTES = 60;
          if (!char.pending_alarm_time && sleepStartedAt) {
            let alarmTargetMs = null;
            // Check upcoming work shift today
            if (Array.isArray(char.work_days) && char.work_days.includes(dowNow3) &&
                char.work_start_time && char.occupation_location_id &&
                !(char.work_exception_status === 'called_out' && char.work_exception_date === todayET3)) {
              const wsMin = toMin(char.work_start_time);
              if (wsMin !== null && wsMin > nowMin3) {
                const alarmMin = wsMin - PREP_MINUTES;
                if (alarmMin > nowMin3) {
                  const alarmEt = new Date(nowET); alarmEt.setHours(Math.floor(alarmMin / 60), alarmMin % 60, 0, 0);
                  const minAlarmMs = sleepStartedAt.getTime() + 6 * 3600000;
                  alarmTargetMs = Math.max(alarmEt.getTime(), minAlarmMs);
                }
              }
            }
            // Check upcoming school today (if no work alarm)
            if (!alarmTargetMs && char.student_status === 'enrolled' && char.education_location_id) {
              const edLoc3b = userLocations.find(l => l.id === char.education_location_id);
              let schStartMin = null;
              if (edLoc3b && edLoc3b.operating_hours && edLoc3b.operating_hours.length > 0) {
                const dH = edLoc3b.operating_hours.filter(h => h.day_of_week === dowNow3);
                const aH = edLoc3b.operating_hours.filter(h => h.day_of_week == null);
                const h0 = (dH.length > 0 ? dH : aH)[0];
                if (h0) schStartMin = toMinutes(h0.open_time);
              }
              if (schStartMin === null) { const edD2 = char.education_details || {}; schStartMin = toMinutes(edD2.start_time || edD2.school_start_time || ''); }
              if (schStartMin !== null && schStartMin > nowMin3) {
                const alarmMin = schStartMin - PREP_MINUTES;
                if (alarmMin > nowMin3) {
                  const alarmEt = new Date(nowET); alarmEt.setHours(Math.floor(alarmMin / 60), alarmMin % 60, 0, 0);
                  const minAlarmMs = sleepStartedAt.getTime() + 6 * 3600000;
                  alarmTargetMs = Math.max(alarmEt.getTime(), minAlarmMs);
                }
              }
            }
            if (alarmTargetMs) {
              const alarmIso = new Date(alarmTargetMs).toISOString();
              base44.asServiceRole.entities.Character.update(char.id, { pending_alarm_time: alarmIso }).catch(() => {});
              console.log(`[autonomousMovement] ${char.name}: AUTO-SET obligation alarm → ET ${new Date(alarmTargetMs).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })}`);
            }
          }

          const energyNow = char.energy_value ?? 0;
          const isHealthRecovering = (char.health_value ?? 100) < 30 || (char.mental_value ?? 100) < 25;

          // Wake decision: obligation (shift/session active AND 6h met) OR natural rest complete
          const shouldWake = hasActiveWorkObligation || hasActiveSchoolObligation ||
            (energyNow >= 70 && sleepDurationHours >= 6 && !isHealthRecovering);

          if (!shouldWake) {
            console.log(`[autonomousMovement] ${char.name}: sleeping (energy=${Math.round(energyNow)}, slept=${sleepDurationHours.toFixed(1)}h, work=${hasActiveWorkObligation}, school=${hasActiveSchoolObligation})`);
            continue;
          }

          const wakeReason = hasActiveWorkObligation ? 'obligation_wake_work'
            : hasActiveSchoolObligation ? 'obligation_wake_school'
            : 'natural_wake_rested';
          // Obligation wakes preserve sleep consequences — no energy boost applied here.
          // Energy reflects actual hours recovered via simulateActiveCharacterNeeds rates.
          let _sleepWakeAuth = null;
          try { const _ir = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_presence_status: 'home', requested_source_reason: wakeReason, requested_timestamp: nowET.toISOString() }); _sleepWakeAuth = _ir?.data || _ir; } catch { /* non-fatal */ }
          // Only write proof records if the authority accepted/redirected/modified the wake.
          if (_sleepWakeAuth?.disposition === 'accepted' || _sleepWakeAuth?.disposition === 'redirected' || _sleepWakeAuth?.disposition === 'modified') {
            char.resolved_presence_status = _sleepWakeAuth.committed_result?.resolved_presence_status || 'home'; char.resolved_source_reason = wakeReason;
            // MANDATORY WAKE PROOF — SleepTransition + LifeEvent + CharacterMemory (silent wake forbidden)
            try {
              await base44.asServiceRole.entities.SleepTransition.create({ character_id: char.id, character_name: char.name, owner_email: char.owner_email, transition_type: 'sleep_end', from_status: 'sleeping', to_status: _sleepWakeAuth.committed_result?.resolved_presence_status || 'home', authority: wakeReason, reason: `Woke — ${wakeReason}, energy=${Math.round(energyNow)}, slept=${sleepDurationHours.toFixed(1)}h.`, timestamp: nowET.toISOString(), state_start_ref: char.last_sleep_start || null, elapsed_hours: Math.round(sleepDurationHours * 100) / 100 });
              await base44.asServiceRole.entities.LifeEvent.create({ character_id: char.id, character_name: char.name, event_type: 'routine_positive_event', valence: 'positive', severity: 'minor', title: 'Woke up', description: `${char.name} woke up. Slept ${sleepDurationHours.toFixed(1)}h. Energy at ${Math.round(energyNow)}.`, emotional_impact: wakeReason.includes('obligation') ? 'groggy' : 'rested', triggered_by: 'life_simulation', timestamp: nowET.toISOString(), context_tags: ['sleep_end', 'woke_up', wakeReason] });
              await base44.asServiceRole.entities.CharacterMemory.create({ character_id: char.id, memory_type: 'event', memory_text: `${char.name} woke up after sleeping ${sleepDurationHours.toFixed(1)}h. Energy at ${Math.round(energyNow)}.`, memory_summary: `Woke up — slept ${sleepDurationHours.toFixed(1)}h.`, importance_score: 3, permanence: 'short_term', related_character_id: char.id });
            } catch (proofError) { console.warn(`[autonomousMovement] ${char.name}: wake proof failed (non-reverting): ${proofError.message}`); }
            console.log(`[autonomousMovement] ✓ ${char.name}: woke — reason=${wakeReason}, energy=${Math.round(energyNow)}, slept=${sleepDurationHours.toFixed(1)}h [proof created]`);
          } else {
            console.log(`[autonomousMovement] ${char.name}: SLEEP WAKE — authority disposition=${_sleepWakeAuth?.disposition || 'unknown'} — no proof records written`);
          }
          // Do NOT continue — fall through to obligation dispatch (Tier 3.5+)
        }

        // (energy < 20 return-home moved below Tier 3.5 so mandatory work/school
        //  dispatch overrides it; see protectedArrival + ENERGY < 20 block after Tier 3.5)

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
                    // Already at work — ensure source reason is correct via authority
                    if (char.resolved_source_reason !== 'work_schedule') {
                      try { await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_presence_status: 'at_work', requested_location_id: workLoc.id, requested_source_reason: 'work_schedule', requested_authority: 'autonomousCharacterMovement', requested_timestamp: nowET.toISOString() }); } catch { /* non-fatal */ }
                    }
                    console.log(`[autonomousMovement] ${char.name}: WORK — already at ${workLoc.name}`);
                    workDispatchDone = true;
                  } else {
                    // Direct location write — NO TravelSession, NO transit phase
                    await writeCharacterToDestination(base44, char, workLoc.id, workLoc.name, {
                      resolvedPresenceStatus: 'at_work',
                      resolvedLocationType: 'work',
                      resolvedSourceReason: `work_schedule: shift ${char.work_start_time}–${char.work_end_time}`,
                      nowET,
                    });
                    totalMoved++;
                    moveLog.push(`${char.name} → ${workLoc.name} [WORK_SCHEDULE]`);
                    console.log(`[autonomousMovement] ✓ ${char.name}: WORK DISPATCH → ${workLoc.name}`);
                    workDispatchDone = true;
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
                  try { await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_presence_status: 'at_school', requested_location_id: schoolLoc.id, requested_source_reason: 'school_schedule', requested_authority: 'autonomousCharacterMovement', requested_timestamp: nowET.toISOString() }); } catch { /* non-fatal */ }
                }
                console.log(`[autonomousMovement] ${char.name}: SCHOOL — already at ${schoolLoc.name}`);
                continue;
              } else {
                // Direct location write — NO TravelSession, NO transit phase
                await writeCharacterToDestination(base44, char, schoolLoc.id, schoolLoc.name, {
                  resolvedPresenceStatus: 'at_school',
                  resolvedLocationType: 'school',
                  resolvedSourceReason: 'school_schedule',
                  nowET,
                });
                totalMoved++;
                moveLog.push(`${char.name} → ${schoolLoc.name} [SCHOOL_SCHEDULE]`);
                console.log(`[autonomousMovement] ✓ ${char.name}: SCHOOL DISPATCH → ${schoolLoc.name}`);
                continue;
              }
            }
          }
        }
        // ── PROTECTED PROMISED-ARRIVAL PREDICATE ────────────────
        // Computed AFTER Tier 3.5 work/school dispatch (which continues on its own
        // authority), so a mandatory shift/session naturally overrides the commitment.
        // The predicate reads only the valid arrival contract — it does NOT re-evaluate
        // work/school, so there is no competing obligation authority.
        const protectedArrival = await getProtectedArrivalCommitment(base44, char);
        if (protectedArrival) {
          console.log(`[autonomousMovement] ${char.name}: protected arrival — commitment ${protectedArrival.id} (status=${protectedArrival.status} → ${protectedArrival.destination_location_name || protectedArrival.destination_location_id})`);
        }

        // ── ENERGY < 20 RETURN-HOME (yields to protected arrival) ──────────
        // Critically tired: return home so simulateActiveCharacterNeeds can write
        // sleep. Yields to a non-interruptible promised arrival. autonomousCharacterMovement
        // never writes sleeping — that is owned by simulateActiveCharacterNeeds at energy ≤ 20.
        {
          const homeId = char.current_home_location_id;
          const atHome = homeId && char.resolved_current_location_id === homeId;
          const alreadySleeping = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
          const energyVal = char.energy_value ?? 75;
          if (!alreadySleeping && homeId && !atHome && energyVal < 20 && !protectedArrival) {
            const sleepHome = userLocations.find(loc => loc.id === homeId);
            if (sleepHome && char.resolved_current_location_id !== sleepHome.id) {
              await writeCharacterToDestination(base44, char, sleepHome.id, sleepHome.name, {
                resolvedPresenceStatus: 'home',
                resolvedLocationType: 'home',
                resolvedSourceReason: `energy_low_return_home_sleep energy(${Math.round(energyVal)})`,
                nowET,
              });
              totalMoved++;
              moveLog.push(`${char.name} → ${sleepHome.name} [TIRED_RETURN_HOME energy=${Math.round(energyVal)}]`);
              console.log(`[autonomousMovement] ✓ ${char.name}: tired, returning home to sleep (energy=${Math.round(energyVal)})`);
              continue;
            }
          }
        }

        // ── PRE-SHIFT RETURN-HOME: route home when work/school within 8 hours ──
        // A character with a shift starting within 8 hours should return home
        // so they can rest, prepare, and avoid being far from the work location.
        // This fires BEFORE Tier 4 critical energy to ensure schedule-aware routing.
        {
          const todayET4 = nowET.toISOString().slice(0, 10);
          const dowNow4 = nowET.getDay();
          const nowMin4 = nowET.getHours() * 60 + nowET.getMinutes();
          const homeId4 = char.current_home_location_id;
          const atHome4 = homeId4 && char.resolved_current_location_id === homeId4;
          const alreadyAtWork4 = char.resolved_presence_status === 'at_work';
          const alreadySleeping4 = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
          
          if (!atHome4 && !alreadyAtWork4 && !alreadySleeping4 && homeId4 && 
              !char.is_jailed && !char.house_arrest_active &&
              char.resolved_presence_status !== 'incarcerated' &&
              char.resolved_presence_status !== 'confined' &&
              char.resolved_presence_status !== 'house_arrest') {
            let preShiftMinutes = null; // minutes until shift start
            
            // Check primary work shift
            if (Array.isArray(char.work_days) && char.work_days.length > 0 &&
                char.work_start_time && char.occupation_location_id) {
              const hasCallout4 = char.work_exception_status === 'called_out' && char.work_exception_date === todayET4;
              if (!hasCallout4) {
                // Check today's shift
                if (char.work_days.includes(dowNow4)) {
                  const shiftStartMin = toMin(char.work_start_time);
                  if (shiftStartMin !== null && shiftStartMin > nowMin4) {
                    const minsToShift = shiftStartMin - nowMin4;
                    if (minsToShift <= 8 * 60) preShiftMinutes = minsToShift;
                  }
                }
                // Check tomorrow's shift (for late-night characters)
                if (preShiftMinutes === null) {
                  const tomorrowDow = (dowNow4 + 1) % 7;
                  if (char.work_days.includes(tomorrowDow)) {
                    const shiftStartMin = toMin(char.work_start_time);
                    if (shiftStartMin !== null) {
                      const minsToTomorrowShift = (24 * 60 - nowMin4) + shiftStartMin;
                      if (minsToTomorrowShift <= 8 * 60) preShiftMinutes = minsToTomorrowShift;
                    }
                  }
                }
              }
            }
            
            // Check school — use authoritative education_location operating_hours
            // Same source as Tier 3.5 school dispatch. No heuristic fallback.
            if (preShiftMinutes === null && char.student_status === 'enrolled' &&
                char.education_location_id) {
              const edLoc = userLocations.find(l => l.id === char.education_location_id);
              if (edLoc) {
                // Primary: operating_hours for today
                const dowNow4 = nowET.getDay();
                const todayHours = (edLoc.operating_hours || []).filter(h => h.day_of_week === dowNow4);
                if (todayHours.length > 0) {
                  for (const h of todayHours) {
                    const schStartMin = toMin(h.open_time);
                    if (schStartMin !== null && schStartMin > nowMin4) {
                      const minsToSchool = schStartMin - nowMin4;
                      if (minsToSchool <= 8 * 60) {
                        preShiftMinutes = minsToSchool;
                        break;
                      }
                    }
                  }
                }
                // Fallback: education_details on character
                if (preShiftMinutes === null) {
                  const edDetails = char.education_details || {};
                  const edStart = edDetails.start_time || edDetails.school_start_time || null;
                  if (edStart) {
                    const schStartMin = toMin(edStart);
                    if (schStartMin !== null && schStartMin > nowMin4) {
                      const minsToSchool = schStartMin - nowMin4;
                      if (minsToSchool <= 8 * 60) {
                        preShiftMinutes = minsToSchool;
                      }
                    }
                  }
                }
              }
            }
            
            if (preShiftMinutes !== null) {
              const returnHome = userLocations.find(loc => loc.id === homeId4);
              if (returnHome && char.resolved_current_location_id !== returnHome.id) {
                await writeCharacterToDestination(base44, char, returnHome.id, returnHome.name, {
                  resolvedPresenceStatus: 'home',
                  resolvedLocationType: 'home',
                  resolvedSourceReason: `pre_shift_return_home: shift in ${Math.round(preShiftMinutes / 60)}h`,
                  nowET,
                });
                totalMoved++;
                moveLog.push(`${char.name} → ${returnHome.name} [PRE_SHIFT_RETURN shift in ${Math.round(preShiftMinutes / 60)}h]`);
                console.log(`[autonomousMovement] ✓ ${char.name}: pre-shift return home — shift in ${Math.round(preShiftMinutes / 60)}h`);
                if (totalMoved >= MAX_MOVES_PER_RUN) {
                  return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, capped: true, timestamp: new Date().toISOString() });
                }
                continue;
              }
            }
          }
        }
        // END PRE-SHIFT RETURN-HOME

        // ── TIER 4: CRITICAL ENERGY (< 25) — force home regardless of toggle ─
        // Not at pass-out level but critically low. Must go home NOW.
        // Overrides stay-lock and toggle. Yields to a protected promised arrival.
        if (energyUrgency >= 3 && char.current_home_location_id && !protectedArrival) {
          const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
          if (ownHome && char.resolved_current_location_id !== ownHome.id) {
            // ── ONE TRUTH: Route critical-energy return home through the authority ──
            await writeCharacterToDestination(base44, char, ownHome.id, ownHome.name, {
              resolvedPresenceStatus: 'home',
              resolvedLocationType: 'home',
              resolvedSourceReason: 'energy_critical_return_home',
              nowET,
            });
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
            // ── ONE TRUTH: Route lock release through the authority ──
            try { await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', { character_id: char.id, owner_email: char.owner_email, requested_lock_release: true, requested_source_reason: `lock_release_${releaseReason || 'auto'}`, requested_authority: 'autonomousCharacterMovement', requested_timestamp: nowET.toISOString() }); } catch { /* non-fatal */ }
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
              { character_id: char.id, owner_email: char.owner_email, commitment_type: 'arrival' },
              '-created_at', 50
            );
            const liveCommitments = (activeCommitments || []).filter(c =>
              c.interruptible === false && c.status === 'active' && !!c.destination_location_id
            );

            // Priority 0: Skip if already in transit to this destination
            const alreadyTraveling = char.resolved_presence_status === 'traveling' &&
              char.travel_destination_location_id != null;
            if (alreadyTraveling) {
              console.log(`[autonomousMovement] ${char.name}: already in_transit to ${char.traveling_to_location_name || char.travel_destination_location_id} — skip`);
              commitmentHandled = true;
            }

            // Priority 1: Active arrival commitment due within its window.
            // Valid contract (confirmMovementCommitment): commitment_type='arrival',
            // interruptible=false, expected_arrival_time, expected_arrival_window_minutes.
            // When due (now >= eta - window), travel to the destination. This dispatch
            // sends the character TO the destination; the protectedArrival predicate
            // (computed after Tier 3.5) prevents energy-return FROM it. Stale values
            // (travel_directive, travel_promise, scheduled_execute_at, in_progress)
            // are fully removed — the schema enum has no such types/statuses.
            if (!commitmentHandled) {
              const nowMs = Date.now();
              const due = liveCommitments.find(c => {
                if (!c.expected_arrival_time) return false;
                const aMs = new Date(c.expected_arrival_time).getTime();
                if (!Number.isFinite(aMs)) return false;
                const wMin = c.expected_arrival_window_minutes ?? 15;
                return nowMs >= aMs - wMin * 60000;
              });
              if (due) {
                const destLoc = userLocations.find(l => l.id === due.destination_location_id);
                if (destLoc) {
                  const bailChance = reliabilityScore < -3 ? 0.15 : reliabilityScore < -1 ? 0.05 : 0;
                  const bailRolled = bailChance > 0 && Math.random() < bailChance;
                  if (bailRolled) {
                    await base44.asServiceRole.entities.CharacterCommitment.update(due.id, {
                      status: 'cancelled',
                      cancellation_reason: `personality_bail: reliability_score=${reliabilityScore.toFixed(1)}`,
                    }).catch(() => {});
                    console.log(`[autonomousMovement] ${char.name}: PERSONALITY BAIL on arrival commitment (score=${reliabilityScore.toFixed(1)})`);
                    commitmentHandled = true;
                    skippedLog.push(`${char.name}: personality bail on arrival commitment (reliability=${reliabilityScore.toFixed(1)})`);
                  } else if (char.resolved_current_location_id !== destLoc.id) {
                    await writeCharacterToDestination(base44, char, destLoc.id, destLoc.name, {
                      resolvedPresenceStatus: 'visiting',
                      resolvedLocationType: 'visit',
                      resolvedSourceReason: `commitment_arrival: due ${due.expected_arrival_time}`,
                      nowET,
                    });
                    totalMoved++;
                    moveLog.push(`${char.name} → ${destLoc.name} [COMMITMENT_ARRIVAL] due ${due.expected_arrival_time}`);
                    console.log(`[autonomousMovement] ✓ ${char.name}: COMMITMENT ARRIVAL → ${destLoc.name}`);
                    commitmentHandled = true;
                  } else {
                    await base44.asServiceRole.entities.CharacterCommitment.update(due.id, {
                      status: 'arrived',
                      completed_at: nowET.toISOString(),
                    }).catch(() => {});
                    console.log(`[autonomousMovement] ${char.name}: COMMITMENT ARRIVAL — already at ${destLoc.name}, marked arrived`);
                    commitmentHandled = true;
                  }
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

        // ── PRELOAD HOUSEHOLD INVENTORY + FINANCIAL DATA FOR SCORING ─────────
        // These are used by scoreLocation() for inventory-driven grocery and
        // affordability-aware destination scoring.
        {
          const homeId = char.current_home_location_id;
          if (homeId) {
            try {
              const hrArr = await base44.asServiceRole.entities.HouseholdResource.filter(
                { owner_email: char.owner_email, home_location_id: homeId, resource_type: 'food' }, null, 1
              ).catch(() => []);
              const hr = hrArr[0];
              const hasHR = !!hr;
              const homeFoodValue = hr ? (hr.home_food_value || 0) : null; // null = no HR record

              // Resolve resident count from home location
              const homeLoc = userLocations.find(l => l.id === homeId);
              const residentCount = homeLoc ? ((homeLoc.residents || []).length || 1) : 1;
              const inventoryLevel = (() => {
                if (homeFoodValue === null) return 'none'; // no household food system — not eligible for grocery
                if (homeFoodValue <= 0) return 'empty';
                const dailyConsumption = residentCount * 3;
                const days = homeFoodValue / dailyConsumption;
                if (days < 3) return 'critical';
                if (days < 7) return 'low';
                if (days < 14) return 'healthy';
                return 'full';
              })();

              char._householdInventory = {
                homeFoodValue,
                residentCount,
                inventoryLevel,
                dailyConsumption: residentCount * 3,
              };
            } catch { char._householdInventory = null; }
          }

          try {
            const finArr = await base44.asServiceRole.entities.CharacterFinancial.filter(
              { character_id: char.id }, null, 1
            ).catch(() => []);
            char._financialBalance = finArr[0] ? (finArr[0].current_balance || 0) : null;
          } catch { char._financialBalance = null; }
        }

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

        // ── GROCERY ELIGIBILITY GATE ────────────────────────────────────────
        // Grocery stores, bodegas, supermarkets, convenience stores, and food
        // markets are purchase destinations, NOT social/hangout/leisure venues.
        // They are only eligible when the character has an actual grocery need
        // (inventory low or empty). Otherwise they are excluded from the
        // candidate pool entirely — not just penalized.
        //
        // This is an eligibility gate, not a scoring preference.
        // A grocery location that is not eligible CANNOT be selected, regardless
        // of other scoring inputs.
        const inventoryData = char._householdInventory;
        const needsGroceryRun = inventoryData && 
          inventoryData.inventoryLevel !== 'none' && (
          inventoryData.inventoryLevel === 'empty' ||
          inventoryData.inventoryLevel === 'critical' ||
          inventoryData.inventoryLevel === 'low'
        );
        const eligibleLocations = openLocations.filter(loc => {
          if (loc.category !== 'grocery') return true;
          return !!needsGroceryRun;
        });

        // ── LOW ENERGY (urgent, < 50) → route home via travel session ────────
        // No teleport — initiate transit to home. processTravelArrivals delivers them.
        // Yields to a protected promised arrival.
        if (energyUrgency >= 2 && char.current_home_location_id && !protectedArrival) {
        const ownHome = userLocations.find(loc => loc.id === char.current_home_location_id);
        if (ownHome && char.resolved_current_location_id !== ownHome.id) {
          await writeCharacterToDestination(base44, char, ownHome.id, ownHome.name, {
            resolvedPresenceStatus: 'home',
            resolvedLocationType: 'home',
            resolvedSourceReason: `energy_urgent_return_home energy(${Math.round(vals.energy)})`,
            nowET,
          });
          totalMoved++;
          moveLog.push(`${char.name} → ${ownHome.name} [ENERGY_URGENT_HOME] energy(${Math.round(vals.energy)})`);
          console.log(`[autonomousMovement] ✓ ${char.name}: energy urgent → home ${ownHome.name}`);
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
        const bestLocation = selectBestLocation(eligibleLocations, char, vals, nowET);

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
            const nonLockedOpen = eligibleLocations.filter(loc => loc.id !== char.location_correction_previous_id);
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
          const nonHomeLocations = eligibleLocations.filter(loc => loc.category !== 'home' && loc.category !== 'generic');
          const homeFallback = selectBestLocation(nonHomeLocations, char, vals, nowET);
          if (!homeFallback) {
            console.log(`[autonomousMovement] ${char.name}: no non-home fallback, skipping`);
            skippedLog.push(`${char.name}: blocked wrong home write, no non-home fallback`);
            continue;
          }
          finalLocation = homeFallback;
        }

        // ── DIRECT LOCATION WRITE — no transit phase ────────────────────────
        // active_created_characters move immediately to the selected destination.
        // Need fulfillment and dwell duration are handled by simulateActiveCharacterNeeds
        // and the existing activity/dwell systems. Yields to a protected promised arrival.
        if (protectedArrival) {
          skippedLog.push(`${char.name}: protected arrival (→ ${protectedArrival.destination_location_name || protectedArrival.destination_location_id}) — autonomous relocation blocked`);
          continue;
        }
        await writeCharacterToDestination(base44, char, finalLocation.id, finalLocation.name, {
          resolvedPresenceStatus: 'visiting',
          resolvedLocationType: 'visit',
          resolvedSourceReason: `autonomous_needs: ${top.key}(${Math.round(top.value)})`,
          nowET,
        });
        // ── FINANCIAL CONSEQUENCE: fire-and-forget spending trigger ──
        triggerSpendingForDestination(base44, char, finalLocation.id, finalLocation.name, finalLocation.category, `autonomous_needs: ${top.key}(${Math.round(top.value)})`, top.key);
        totalMoved++;
        const urgentList = Object.entries(vals)
          .filter(([, v]) => urgencyLevel(v) >= 2)
          .map(([k, v]) => `${k}(${Math.round(v)})`)
          .join(', ') || `${top.key}(${Math.round(top.value)})`;
        const mandatory = isMandatory ? '[MANDATORY]' : '[optional]';
        const msg = `${char.name} → ${finalLocation.name} ${mandatory} needs: ${urgentList}`;
        moveLog.push(msg);
        console.log(`[autonomousMovement] ✓ ${msg}`);
        if (totalMoved >= MAX_MOVES_PER_RUN) {
          console.log(`[autonomousMovement] MAX_MOVES_PER_RUN (${MAX_MOVES_PER_RUN}) reached — stopping run`);
          return Response.json({ success: true, users_processed: Object.keys(byUser).length, characters_moved: totalMoved, moves: moveLog, blocked_with_reason: blockedLog, skipped: skippedLog.length, capped: true, timestamp: new Date().toISOString() });
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