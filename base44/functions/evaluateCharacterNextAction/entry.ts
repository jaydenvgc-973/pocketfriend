import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * evaluateCharacterNextAction — DECISION WEIGHTING ENGINE
 *
 * This is the decision layer for all active_created_character characters.
 * It evaluates multiple competing inputs, assigns contextual weights, and
 * produces the most believable next action.
 *
 * This is NOT a trigger-response machine. Needs influence but do not control.
 * Schedules influence but do not control. Weights shift based on context.
 *
 * CALLED BY:
 *   - simulateActiveCharacterNeeds (corrective action evaluation)
 *   - autonomousCharacterMovement (movement routing)
 *
 * OUTPUT: { action, actionType, reason, confidence, factorsConsidered, explanation }
 */

// ── THRESHOLDS (shared with simulateActiveCharacterNeeds) ────────────────────
const T = {
  HUNGER_ER:          5,
  HUNGER_CRITICAL:   20,
  HUNGER_LOW:        35,
  ENERGY_MEDICAL:     5,
  ENERGY_PASSOUT:    10,
  ENERGY_CRITICAL:   25,
  ENERGY_LOW:        35,   // nap/sleep transition point
  ENERGY_NAP_PRESSURE: 40, // strong nap pressure — should nap if at home
  ENERGY_NAP_AVAILABLE: 50, // nap becomes appropriate
  HEALTH_ER:         15,
  HEALTH_CRITICAL:   20,
  MENTAL_CRITICAL:   15,
  HYGIENE_CRITICAL:  20,
  SOCIAL_CRITICAL:   15,
};

// ── PERSONALITY TRAIT INFLUENCES ───────────────────────────────────────────
// Each trait biases the weighting of specific decision dimensions.
const TRAIT_WEIGHTS = {
  trait_conscientious:  { work: +0.15, education: +0.15, responsibility: +0.10, rest: -0.05 },
  trait_loyal:          { relationship: +0.12, family: +0.10 },
  trait_ambitious:      { work: +0.10, education: +0.12, career: +0.15 },
  trait_risk_taker:     { caution: -0.10, adventure: +0.12 },
  trait_stubborn:       { flexibility: -0.10 },
  trait_law_abiding:    { responsibility: +0.08, caution: +0.08 },
  trait_rule_breaker:   { responsibility: -0.08, caution: -0.08 },
  trait_empathetic:     { relationship: +0.08, family: +0.08 },
  trait_competitive:    { career: +0.08, work: +0.05 },
  trait_parental:       { family: +0.15, responsibility: +0.10 },
  trait_self_absorbed:  { relationship: -0.08, family: -0.08, responsibility: -0.05 },
  trait_loud:           { social: +0.08 },
  trait_adaptable:      { flexibility: +0.10 },
  trait_cynical:        { optimism: -0.10 },
  trait_generous:       { relationship: +0.08 },
  trait_morning_person: { rest: -0.05, work: +0.05 },
  trait_night_owl:      { rest: +0.05, work: -0.03 },
  trait_compassionate:  { family: +0.08, relationship: +0.05 },
  trait_flirty:         { social: +0.08 },
  trait_lawbreaker:     { responsibility: -0.12, caution: -0.10 },
  trait_leader:         { work: +0.08, career: +0.08 },
  trait_follower:       { autonomy: -0.05 },
  trait_toxic:          { relationship: -0.10, family: -0.08, caution: -0.05 },
  trait_creative:       { creativity: +0.10 },
  trait_impulsive:      { caution: -0.12, planning: -0.10 },
  trait_traditional:    { family: +0.08, responsibility: +0.08 },
  trait_liberal:        { flexibility: +0.08 },
  trait_quiet:          { social: -0.05 },
  trait_talkative:      { social: +0.08 },
  trait_optimistic:     { optimism: +0.10 },
  trait_pessimistic:    { optimism: -0.10 },
  trait_cautious:       { caution: +0.12 },
  trait_brave:          { caution: -0.08 },
  trait_independent:    { autonomy: +0.10 },
  trait_needy:          { autonomy: -0.08, relationship: +0.10 },
  trait_organized:      { planning: +0.12, work: +0.05 },
  trait_disorganized:   { planning: -0.10, work: -0.03 },
  trait_honest:         { responsibility: +0.05 },
  trait_deceptive:      { responsibility: -0.05 },
  trait_reliable:       { work: +0.10, responsibility: +0.08 },
  trait_unreliable:     { work: -0.10, responsibility: -0.08 },
  trait_proactive:      { planning: +0.12, work: +0.05, career: +0.08 },
  trait_reactive:       { planning: -0.08, career: -0.05 },
  trait_introvert:      { social: -0.08 },
  trait_extrovert:      { social: +0.08 },
  trait_disciplined:    { work: +0.08, education: +0.08, planning: +0.08 },
};

// Social energy archetype influences
const SOCIAL_ENERGY_WEIGHTS = {
  introvert:          { social: -0.08, rest: +0.05 },
  mostly_introvert:   { social: -0.04, rest: +0.03 },
  ambivert:           {},
  mostly_extrovert:   { social: +0.04, rest: -0.03 },
  extrovert:          { social: +0.08, rest: -0.05 },
};

// ── TIME-OF-DAY CONTEXT ─────────────────────────────────────────────────────
function getTimeContext() {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hour = nowET.getHours();
  const day = nowET.getDay();
  
  const timeOfDay = 
    hour >= 5  && hour < 7  ? 'early_morning' :
    hour >= 7  && hour < 10 ? 'morning' :
    hour >= 10 && hour < 12 ? 'late_morning' :
    hour >= 12 && hour < 14 ? 'midday' :
    hour >= 14 && hour < 17 ? 'afternoon' :
    hour >= 17 && hour < 20 ? 'evening' :
    hour >= 20 && hour < 23 ? 'night' : 'late_night';
  
  const isWeekend = day === 0 || day === 6;
  const isLate   = hour >= 22 || hour < 5;
  
  return { timeOfDay, hour, day, isWeekend, isLate };
}

// ── SCHEDULE EVALUATION ──────────────────────────────────────────────────────
function evaluateSchedule(char, locationMap) {
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cur = nowET.getHours() * 60 + nowET.getMinutes();
  const dow = nowET.getDay();
  
  const schedule = {
    onShift: false,
    shiftStartsIn: null,
    shiftEndsIn: null,
    workLocationName: null,
    workLocationId: null,
    isSchoolDay: false,
    schoolStartsIn: null,
    hasWorkToday: false,
    hasSchoolToday: false,
  };
  
  // Check work schedule
  if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days) && char.work_days.includes(dow)) {
    schedule.hasWorkToday = true;
    const [sh, sm = 0] = char.work_start_time.split(':').map(Number);
    const [eh, em = 0] = char.work_end_time.split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    
    if (cur >= startMins && cur < endMins) {
      schedule.onShift = true;
      schedule.shiftEndsIn = endMins - cur;
      schedule.workLocationId = char.occupation_location_id || char.current_work_location_id;
      if (schedule.workLocationId && locationMap[schedule.workLocationId]) {
        schedule.workLocationName = locationMap[schedule.workLocationId].name;
      }
    } else if (cur < startMins) {
      schedule.shiftStartsIn = startMins - cur;
    }
  }
  
  // Also check additional_occupation_locations for location-side shifts
  if (!schedule.onShift && !schedule.shiftStartsIn && Array.isArray(char.additional_occupation_locations)) {
    for (const entry of char.additional_occupation_locations) {
      if (!entry.location_id || !locationMap[entry.location_id]) continue;
      const loc = locationMap[entry.location_id];
      const shift = loc.worker_shifts?.[char.id];
      if (shift?.start && shift?.end) {
        const shiftDays = Array.isArray(shift.days) && shift.days.length > 0 ? shift.days : null;
        if (shiftDays && !shiftDays.includes(dow)) continue;
        const [sh, sm = 0] = shift.start.split(':').map(Number);
        const [eh, em = 0] = shift.end.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const endMins = eh * 60 + em;
        if (cur >= startMins && cur < endMins) {
          schedule.onShift = true;
          schedule.shiftEndsIn = endMins - cur;
          schedule.workLocationId = entry.location_id;
          schedule.workLocationName = loc.name;
          schedule.hasWorkToday = true;
          break;
        } else if (cur < startMins) {
          schedule.shiftStartsIn = Math.min(schedule.shiftStartsIn ?? Infinity, startMins - cur);
          schedule.hasWorkToday = true;
        }
      }
    }
  }
  
  // School check
  if (char.student_status === 'enrolled') {
    schedule.hasSchoolToday = true;
    // School is typically weekdays
    if (![0, 6].includes(dow)) {
      schedule.isSchoolDay = true;
    }
  }
  
  return schedule;
}

// ── RESTRICTION CHECK ────────────────────────────────────────────────────────
function checkRestrictions(char) {
  const restrictions = {
    confined: false,
    reason: null,
    allowedContexts: [],
  };
  
  if (char.is_jailed) {
    restrictions.confined = true;
    restrictions.reason = 'incarcerated';
    restrictions.allowedContexts = ['rest', 'eat_in_confinement', 'recreation_confinement', 'sleep'];
  }
  if (char.house_arrest_active) {
    restrictions.confined = true;
    restrictions.reason = 'house_arrest';
    restrictions.allowedContexts = ['rest', 'eat_at_home', 'sleep', 'home_routine'];
  }
  if ((char.resolved_presence_status || '') === 'hospitalized') {
    restrictions.confined = true;
    restrictions.reason = 'hospitalized';
    restrictions.allowedContexts = ['rest', 'eat_in_confinement', 'sleep', 'medical_care'];
  }
  
  return restrictions;
}

// ── NEEDS EVALUATION ─────────────────────────────────────────────────────────
function evaluateNeeds(char) {
  const needs = {
    hunger:  char.hunger_value  ?? 70,
    energy:  char.energy_value  ?? 75,
    social:  char.social_value  ?? 65,
    health:  char.health_value  ?? 80,
    mental:  char.mental_value  ?? 70,
    hygiene: char.hygiene_value ?? 75,
    comfort: char.comfort_value ?? 70,
    financial: char.financial_need_value ?? 60,
  };
  
  const urgency = {};
  
  // Critical (life-threatening / collapse)
  if (needs.hunger <= T.HUNGER_ER)       urgency.hunger = 'emergency';
  else if (needs.hunger <= T.HUNGER_CRITICAL) urgency.hunger = 'critical';
  else if (needs.hunger <= T.HUNGER_LOW)      urgency.hunger = 'low';
  
  if (needs.energy <= T.ENERGY_MEDICAL)  urgency.energy = 'emergency';
  else if (needs.energy <= T.ENERGY_PASSOUT)  urgency.energy = 'critical_collapse';
  else if (needs.energy <= T.ENERGY_CRITICAL)  urgency.energy = 'critical';
  else if (needs.energy <= T.ENERGY_LOW)       urgency.energy = 'nap_or_sleep';
  else if (needs.energy <= T.ENERGY_NAP_PRESSURE) urgency.energy = 'nap_pressure';
  else if (needs.energy <= T.ENERGY_NAP_AVAILABLE) urgency.energy = 'nap_available';
  
  if (needs.health <= T.HEALTH_ER)       urgency.health = 'emergency';
  else if (needs.health <= T.HEALTH_CRITICAL)   urgency.health = 'critical';
  
  if (needs.mental <= T.MENTAL_CRITICAL) urgency.mental = 'critical';
  if (needs.hygiene <= T.HYGIENE_CRITICAL) urgency.hygiene = 'critical';
  if (needs.social <= T.SOCIAL_CRITICAL) urgency.social = 'critical';
  
  return { values: needs, urgency };
}

// ── COMPUTE BASE WEIGHTS ─────────────────────────────────────────────────────
function computeBaseWeights(char, schedule, needs, restrictions, timeCtx, locationMap) {
  const weights = {
    work:        0.15,
    education:   0.10,
    rest:        0.10,
    eat:         0.08,
    hygiene:     0.05,
    social:      0.08,
    family:      0.08,
    relationship:0.08,
    home:        0.05,
    recreation:  0.05,
    career:      0.05,
    responsibility: 0.05,
    caution:     0.03,
    flexibility: 0.02,
    optimism:    0.01,
    planning:    0.01,
    creativity:  0.00,
    adventure:   0.00,
    autonomy:    0.01,
    financial:   0.05,
  };
  
  // ── CRITICAL TRUMPS: emergency states override everything ────────────────
  const hasEmergency = needs.urgency.health === 'emergency' ||
    needs.urgency.energy === 'emergency' ||
    needs.urgency.hunger === 'emergency';
  
  if (hasEmergency) {
    return {
      ...weights,
      rest:   0.60, // medical/survival dominates
      health: 0.40, // health-seeking
      work:   0.00,
      education: 0.00,
      eat:    0.00,
      social: 0.00,
      recreation: 0.00,
    };
  }
  
  // Energy collapse = forced rest
  if (needs.urgency.energy === 'critical_collapse') {
    return {
      ...weights,
      rest:   0.70,
      work:   0.00,
      education: 0.00,
      social: 0.00,
      recreation: 0.00,
    };
  }
  
  // ── SCHEDULE GRAVITY: work/school carry strong weight ───────────────────
  if (schedule.onShift) {
    weights.work = 0.40;
    weights.education = 0.00;
    weights.recreation = 0.01;
  } else if (schedule.shiftStartsIn !== null && schedule.shiftStartsIn <= 30) {
    // Work starts within 30 minutes — strongly favor prepping/going
    weights.work = 0.35;
  } else if (schedule.hasWorkToday && schedule.shiftStartsIn !== null) {
    weights.work = 0.20;
  }
  
  if (schedule.isSchoolDay) {
    weights.education = 0.30;
    weights.recreation = 0.03;
  }
  
  // ── NEEDS PUSH: hungry → eat weight rises, tired → rest rises ───────────
  if (needs.urgency.hunger === 'critical') {
    // When critical but not on shift or on shift at a food-serving workplace
    if (schedule.onShift) {
      const isAtFoodWork = (char) => {
        const wLocId = char.current_work_location_id || char.occupation_location_id;
        if (!wLocId || !locationMap[wLocId]) return false;
        const wl = locationMap[wLocId];
        const wCat = (wl.category || '').toLowerCase();
        const wName = (wl.name || '').toLowerCase();
        return wCat === 'food_drink' || wCat === 'social' ||
          wName.includes('bar') || wName.includes('restaurant') || wName.includes('cafe') ||
          wName.includes('diner') || wName.includes('grill') || wName.includes('club');
      };
      if (isAtFoodWork(char)) {
        weights.eat = 0.20; // can eat during shift at a restaurant/bar job
      } else {
        weights.eat = 0.08; // suppressed by work obligation
      }
    } else {
      weights.eat = 0.35;
      weights.work = weights.work * 0.6; // hunger tempers work focus
    }
  } else if (needs.urgency.hunger === 'low') {
    weights.eat = 0.15;
  }
  
  if (needs.urgency.energy === 'critical') {
    weights.rest = 0.50;
    weights.work = Math.min(weights.work, 0.15);
    weights.education = Math.min(weights.education, 0.10);
    weights.social = 0.01;
  } else if (needs.urgency.energy === 'nap_or_sleep') {
    // Energy ≤ 35%: nap or sleep transition — strong rest push
    weights.rest = 0.35;
    weights.recreation = 0.01;
  } else if (needs.urgency.energy === 'nap_pressure') {
    // Energy ≤ 40%: strong nap pressure
    weights.rest = 0.25;
  } else if (needs.urgency.energy === 'nap_available') {
    // Energy ≤ 50%: nap is becoming appropriate
    weights.rest = 0.18;
  }

  // ── SOCIAL CRITICAL: mandatory social-seeking boost, suppress home ──────
  if (needs.urgency.social === 'critical') {
    // Social is critically low — character MUST seek social contact.
    // Boost social weight significantly, suppress home (home IS the deprivation).
    weights.social = Math.max(weights.social, 0.45);
    weights.home  = Math.min(weights.home, 0.01);
    // Suppress rest/recreation to prevent "just stay home and relax" winning
    weights.rest = Math.min(weights.rest, 0.05);
    weights.recreation = Math.min(weights.recreation, 0.02);
  }
  
  // ── TIME-OF-DAY MODULATION ──────────────────────────────────────────────
  if (timeCtx.isLate) {
    weights.rest += 0.15;
    weights.work = Math.min(weights.work, 0.05);
    weights.social -= 0.03;
  }
  if (timeCtx.timeOfDay === 'morning' || timeCtx.timeOfDay === 'early_morning') {
    weights.rest += 0.05;
  }
  
  // ── PERSONALITY INFLUENCE ───────────────────────────────────────────────
  for (const [traitKey, traitWeights] of Object.entries(TRAIT_WEIGHTS)) {
    if (char[traitKey] === true) {
      for (const [dim, adj] of Object.entries(traitWeights)) {
        weights[dim] = (weights[dim] || 0) + adj;
      }
    }
  }
  
  // Social energy archetype
  const seWeights = SOCIAL_ENERGY_WEIGHTS[char.social_energy] || {};
  for (const [dim, adj] of Object.entries(seWeights)) {
    weights[dim] = (weights[dim] || 0) + adj;
  }
  
  // ── CLA MP ALL WEIGHTS TO [0, 0.75] ────────────────────────────────────
  for (const key of Object.keys(weights)) {
    weights[key] = Math.max(0, Math.min(0.75, weights[key]));
  }
  
  return weights;
}

// ── DECISION EVALUATION ──────────────────────────────────────────────────────
function evaluateDecision(char, schedule, needs, weights, restrictions, timeCtx, locationMap) {
  const presence = char.resolved_presence_status || '';
  const locationType = (char.resolved_location_type || '').toLowerCase();
  const locId = char.resolved_current_location_id;
  const loc = locId ? locationMap[locId] : null;
  const locCat = (loc?.category || '').toLowerCase();
  
  // ── RESTRICTIONS: confined characters have limited options ─────────────
  if (restrictions.confined) {
    if (needs.urgency.energy === 'critical' || needs.urgency.energy === 'critical_collapse') {
      return { action: 'rest and recover', actionType: 'sleep', reason: `Energy critically low while ${restrictions.reason} — rest is the only viable option`, confidence: 0.95, explanation: `${char.name} is too exhausted to do anything but rest, even while ${restrictions.reason}.` };
    }
    if (needs.urgency.hunger === 'critical') {
      return { action: 'eat available food', actionType: 'eat', reason: `Hunger critical while ${restrictions.reason} — eating what is available`, confidence: 0.90, explanation: `${char.name} is hungry and needs to eat within the limits of their current confinement.` };
    }
    return { action: 'follow confinement routine', actionType: 'confinement_routine', reason: `Confined: ${restrictions.reason} — limited to available activities`, confidence: 0.85, explanation: `${char.name} is ${restrictions.reason} and is following the available routine.` };
  }
  
  // ── EMERGENCY: health/energy emergency trumps everything ──────────────
  if (needs.urgency.health === 'emergency') {
    return { action: 'seek medical attention', actionType: 'hospitalize', reason: `Health at ${Math.round(needs.values.health)} — medical emergency`, confidence: 0.99, explanation: `${char.name} needs emergency medical care. Nothing else matters until health is stabilized.` };
  }
  if (needs.urgency.energy === 'emergency') {
    return { action: 'seek medical attention', actionType: 'hospitalize', reason: `Energy at ${Math.round(needs.values.energy)} — sustained collapse requiring medical intervention`, confidence: 0.98, explanation: `${char.name} has completely collapsed from exhaustion and needs medical stabilization.` };
  }
  if (needs.urgency.energy === 'critical_collapse') {
    return { action: 'pass out and recover', actionType: 'pass_out', reason: `Energy at ${Math.round(needs.values.energy)} — character has collapsed from exhaustion`, confidence: 0.97, explanation: `${char.name} has pushed past their physical limit and collapsed. They need rest immediately.` };
  }
  
  // ── ON SHIFT: work is the frame, but needs can layer inside it ─────────
  if (schedule.onShift) {
    const shiftEndMins = schedule.shiftEndsIn || 480; // default 8h
    const shiftEndHours = shiftEndMins / 60;
    
    // Energy critical while on shift — character should go home
    if (needs.urgency.energy === 'critical') {
      return { action: 'leave work early — exhausted', actionType: 'go_home_rest', reason: `Energy critically low (${Math.round(needs.values.energy)}) while on shift — cannot continue working`, confidence: 0.88, explanation: `${char.name} is too exhausted to finish their shift at ${schedule.workLocationName}. They need to go home and rest.` };
    }
    
    // Hunger critical while on shift at a food-serving workplace
    if (needs.urgency.hunger === 'critical' || needs.urgency.hunger === 'emergency') {
      const isAtFoodWork = (() => {
        const wLocId = char.current_work_location_id || char.occupation_location_id;
        if (!wLocId || !locationMap[wLocId]) return false;
        const wl = locationMap[wLocId];
        const wCat = (wl.category || '').toLowerCase();
        const wName = (wl.name || '').toLowerCase();
        return wCat === 'food_drink' || wCat === 'social' ||
          wName.includes('bar') || wName.includes('restaurant') || wName.includes('cafe') ||
          wName.includes('diner') || wName.includes('grill') || wName.includes('club') ||
          wName.includes('kitchen');
      })();
      if (isAtFoodWork) {
        return { action: 'eat during shift', actionType: 'eat_at_work', reason: `Hunger critical (${Math.round(needs.values.hunger)}) — eating during shift at ${schedule.workLocationName}`, confidence: 0.85, explanation: `${char.name} is hungry but is at work (${schedule.workLocationName}), where they can eat during their shift. Work continues.` };
      }
    }
    
    // Default: working — any mild needs are deferred
    return { action: 'continue working shift', actionType: 'work', reason: `On shift at ${schedule.workLocationName || 'work'} — ${shiftEndHours < 1 ? 'shift ending soon' : 'shift in progress'}`, confidence: 0.90, explanation: `${char.name} is working their shift${schedule.workLocationName ? ' at ' + schedule.workLocationName : ''}.${shiftEndHours < 1 ? ' Their shift is almost over.' : ''}` };
  }
  
  // ── WORK STARTS SOON (≤ 30 min): prioritize preparation ────────────────
  if (schedule.shiftStartsIn !== null && schedule.shiftStartsIn <= 30) {
    // Only defer if need is not critical
    if (needs.urgency.hunger !== 'emergency' && needs.urgency.hunger !== 'critical') {
      return { action: 'prepare for work', actionType: 'prep_work', reason: `Work starts in ${schedule.shiftStartsIn} minutes`, confidence: 0.85, explanation: `${char.name} needs to get ready for work which starts soon.` };
    }
  }
  
  // ── POST-WORK / FREE TIME ──────────────────────────────────────────────
  // Evaluate highest-weighted dimension
  
  // Build scored options
  const options = [];
  
  if (needs.urgency.energy === 'critical') {
    options.push({ action: 'go to sleep', actionType: 'sleep', dimension: 'rest', score: 0.90, explanation: `${char.name} is critically exhausted and needs to sleep.` });
  } else if (needs.urgency.energy === 'nap_or_sleep') {
    // Energy ≤ 35%: transition should occur. Prefer sleep if in sleep window, nap otherwise
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      options.push({ action: 'nap or sleep at home', actionType: 'nap', dimension: 'rest', score: weights.rest + 0.20, explanation: `${char.name} has low energy (${Math.round(needs.values.energy)}%) and should nap or sleep at home.` });
    } else {
      options.push({ action: 'go home to rest', actionType: 'go_home_rest', dimension: 'rest', score: weights.rest + 0.15, explanation: `${char.name} has low energy and should go home to nap or sleep.` });
    }
  } else if (needs.urgency.energy === 'nap_pressure') {
    // Energy ≤ 40%: strong nap pressure
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      options.push({ action: 'take a nap', actionType: 'nap', dimension: 'rest', score: weights.rest + 0.10, explanation: `${char.name} has low energy (${Math.round(needs.values.energy)}%) and should take a nap.` });
    } else {
      options.push({ action: 'head home for a nap', actionType: 'go_home_rest', dimension: 'rest', score: weights.rest + 0.08, explanation: `${char.name} should head home to rest — energy is low.` });
    }
  } else if (needs.urgency.energy === 'nap_available') {
    // Energy ≤ 50%: nap is appropriate
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      options.push({ action: 'rest and recharge', actionType: 'nap', dimension: 'rest', score: weights.rest + 0.05, explanation: `${char.name} could use a nap — energy at ${Math.round(needs.values.energy)}%.` });
    }
  }
  
  if (needs.urgency.hunger === 'critical' || needs.urgency.hunger === 'emergency') {
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      options.push({ action: 'eat at home', actionType: 'eat', dimension: 'eat', score: weights.eat + 0.25, explanation: `${char.name} is hungry and can eat at home.` });
    } else {
      options.push({ action: 'get food', actionType: 'eat', dimension: 'eat', score: weights.eat + 0.20, explanation: `${char.name} is hungry and needs to find food.` });
    }
  } else if (needs.urgency.hunger === 'low') {
    options.push({ action: 'get something to eat', actionType: 'eat', dimension: 'eat', score: weights.eat + 0.08, explanation: `${char.name} is starting to get hungry.` });
  }
  
  if (needs.urgency.hygiene === 'critical') {
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      options.push({ action: 'shower and freshen up', actionType: 'hygiene', dimension: 'hygiene', score: weights.hygiene + 0.30, explanation: `${char.name} really needs to clean up and is already home.` });
    } else {
      options.push({ action: 'head home to wash up', actionType: 'hygiene', dimension: 'hygiene', score: weights.hygiene + 0.15, explanation: `${char.name} needs to clean up — heading home.` });
    }
  }
  
  if (needs.urgency.social === 'critical') {
    // CRITICAL SOCIAL — MANDATORY OUTBOUND ACTION
    // Social need at critical level means the character MUST pursue social fulfillment.
    // "relax at home" is explicitly blocked below — home IS the cause of the deficit.
    // This is NOT a weight-based choice. It is a mandatory behavioral requirement.
    const atHome = locationType === 'home' || locCat === 'home' || presence === 'home';
    if (atHome) {
      // Character is isolated at home — MUST leave to find social contact
      // Home is NOT a valid option when social is critically low and it's causing the deprivation
      options.push({
        action: 'go out to socialize and be around people',
        actionType: 'go_out_socialize',
        dimension: 'social',
        score: 0.95, // Near-maximum — this is mandatory, not optional
        explanation: `${char.name} has been isolated too long with critically low social need. Must leave home to find social interaction — visiting venues, seeing people, being in public.`
      });
    } else {
      // Already out somewhere — seek social contact wherever they are
      options.push({
        action: 'seek social interaction where you are',
        actionType: 'social',
        dimension: 'social',
        score: 0.90,
        explanation: `${char.name} has critically low social need. Must connect with people — talk to someone nearby, join an activity, find social contact.`
      });
    }
  }
  
  if (needs.urgency.mental === 'critical') {
    options.push({ action: 'take time to decompress', actionType: 'rest', dimension: 'rest', score: weights.rest + 0.12, explanation: `${char.name} is mentally strained and needs to step back.` });
  }
  
  // Non-need-driven options
  if (weights.family > 0.08 && !needs.urgency.energy?.includes('critical')) {
    options.push({ action: 'spend time with family', actionType: 'family', dimension: 'family', score: weights.family, explanation: `${char.name} values family time.` });
  }
  
  if (weights.social > 0.10 && !needs.urgency.energy?.includes('critical') && !timeCtx.isLate) {
    options.push({ action: 'socialize', actionType: 'social', dimension: 'social', score: weights.social, explanation: `${char.name} enjoys socializing.` });
  }
  
  if (weights.recreation > 0.05 && !needs.urgency.energy?.includes('critical') && !timeCtx.isLate) {
    options.push({ action: 'enjoy some free time', actionType: 'recreation', dimension: 'recreation', score: weights.recreation, explanation: `${char.name} has free time to enjoy.` });
  }
  
  // Default fallback: home routine
  options.push({ action: 'relax at home', actionType: 'home_routine', dimension: 'home', score: weights.home + 0.05, explanation: `${char.name} is spending time at home.` });
  
  // Sort by score descending
  options.sort((a, b) => b.score - a.score);
  
  const best = options[0];
  return {
    action: best.action,
    actionType: best.actionType,
    reason: best.explanation,
    confidence: Math.min(0.95, best.score * 1.2),
    explanation: best.explanation,
    alternatives: options.slice(1, 4).map(o => ({ action: o.action, actionType: o.actionType, score: o.score })),
  };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { characterId } = payload;
    
    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }
    
    const writeSDK = base44.asServiceRole;
    
    // Fetch character — try service-role by ID first, fall back to broader filter
    let chars = await writeSDK.entities.Character.filter({ id: characterId }, null, 3)
      .catch(() => []);
    
    // If service role returned 0, try user-scoped filter with owner_email context
    if (chars.length === 0) {
      try {
        const user = await base44.auth.me();
        if (user?.email) {
          chars = await base44.entities.Character.filter(
            { id: characterId, owner_email: user.email }, null, 3
          ).catch(() => []);
        }
      } catch (_) {}
    }
    
    if (chars.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const char = chars[0];
    
    // Validate character type
    if (char.character_type !== 'active_created_character') {
      return Response.json({
        error: `evaluateCharacterNextAction only applies to active_created_character, not ${char.character_type}`,
      }, { status: 400 });
    }
    
    // Fetch locations
    const allLocations = await writeSDK.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    
    // ── EVALUATE ALL INPUTS ──────────────────────────────────────────────
    const timeCtx     = getTimeContext();
    const schedule    = evaluateSchedule(char, locationMap);
    const needs       = evaluateNeeds(char);
    const restrictions = checkRestrictions(char);
    const weights     = computeBaseWeights(char, schedule, needs, restrictions, timeCtx, locationMap);
    const decision    = evaluateDecision(char, schedule, needs, weights, restrictions, timeCtx, locationMap);
    
    // ── BUILD EXPLAINABLE DECISION REPORT ─────────────────────────────────
    const activeTraits = Object.keys(TRAIT_WEIGHTS).filter(k => char[k] === true);
    
    return Response.json({
      success: true,
      characterId,
      characterName: char.name,
      timestamp: new Date().toISOString(),
      timestampET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      decision,
      context: {
        time: timeCtx,
        schedule,
        needs: {
          values: needs.values,
          urgency: needs.urgency,
        },
        restrictions,
        location: {
          id: char.resolved_current_location_id,
          name: char.resolved_current_location_name,
          type: char.resolved_location_type,
          presence: char.resolved_presence_status,
        },
        personality: {
          socialEnergy: char.social_energy || 'ambivert',
          activeTraits,
        },
      },
      weights,
    });
  } catch (error) {
    console.error('[evaluateCharacterNextAction]', error.message, error.stack);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});