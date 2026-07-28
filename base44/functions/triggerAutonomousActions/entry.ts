/**
 * triggerAutonomousActions
 *
 * Schedule-aware autonomous activity updater.
 * Characters have fuller lives: they leave home for needs, stress relief,
 * social connection, errands, fun, self-care, and routine life.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function isInWindow(currentMinutes, startStr, endStr) {
  const start = toMinutes(startStr);
  const end = toMinutes(endStr);
  if (start == null || end == null) return false;
  if (start <= end) return currentMinutes >= start && currentMinutes < end;
  return currentMinutes >= start || currentMinutes < end;
}

function getCurrentDayIndexET() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etNow.getDay();
}

function getCurrentMinutesET() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etNow.getHours() * 60 + etNow.getMinutes();
}

function getCurrentHourET() {
  const now = new Date();
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etNow.getHours();
}

function isLocationActiveNow(location, currentMinutes, currentDay) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return null;
  for (const window of hours) {
    const dayMatch = window.day_of_week == null || window.day_of_week === currentDay;
    if (dayMatch && isInWindow(currentMinutes, window.open_time, window.close_time)) return true;
  }
  return false;
}

function getCharacterShift(characterId, location) {
  if (!location?.worker_shifts || !characterId) return null;
  const shift = location.worker_shifts[characterId];
  if (!shift?.start || !shift?.end) return null;
  return shift;
}

function isShiftDay(shift, currentDay) {
  const days = shift.days;
  if (!days || days.length === 0) return [1, 2, 3, 4, 5].includes(currentDay);
  return days.includes(currentDay);
}

// ── SHARED LOGIC: Copied from enforceCoreLoop.js ──
// Duplication is required (backend functions cannot import local files).
// If this logic changes, update BOTH copies: enforceCoreLoop + triggerAutonomousActions.
function scoreLocationForCharacter(loc, character) {
  let score = 0;
  const se = character.social_energy || 'ambivert';
  const SOCIAL_ENERGY_AFFINITIES = {
    introvert:        { preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion'], conditional: ['social','gym'] },
    mostly_introvert: { preferred: ['home','outdoor','public'], acceptable: ['food_drink','education','medical','grocery','religion','gym'], conditional: ['social'] },
    ambivert:         { preferred: ['food_drink','outdoor','home','social'], acceptable: ['gym','public','education','religion','grocery','medical'], conditional: [] },
    mostly_extrovert: { preferred: ['social','food_drink','gym'], acceptable: ['outdoor','public','home','education','religion','grocery','medical'], conditional: [] },
    extrovert:        { preferred: ['social','food_drink'], acceptable: ['gym','outdoor','public','education','religion','grocery','medical'], conditional: ['home'] },
  };
  const ep = SOCIAL_ENERGY_AFFINITIES[se] || SOCIAL_ENERGY_AFFINITIES.ambivert;
  if (ep.preferred.includes(loc.category)) score += 3;
  else if (ep.acceptable.includes(loc.category)) score += 1;
  else if (ep.conditional && ep.conditional.includes(loc.category)) score -= 1;

  const arch = (character.archetype||'').toLowerCase();
  const archBoosts = {'guardian':['home','religion'],'achiever':['gym','education'],'rebel':['social','outdoor'],'introvert':['home','outdoor'],'charmer':['social'],'wounded':['home','outdoor'],'chaotic':['social']};
  const archPens  = {'guardian':['social'],'introvert':['social'],'wounded':['social'],'chaotic':['home']};
  if (archBoosts[arch]?.includes(loc.category)) score += 2;
  if (archPens[arch]?.includes(loc.category))   score -= 2;

  const hh = (character.health_habits||'').toLowerCase();
  if (loc.category === 'gym' && /gym|workout|fitness|exercise/.test(hh)) score += 2;
  if (loc.category === 'outdoor' && /run|jog|walk|hike|outdoor/.test(hh)) score += 2;

  const religion = (character.religion||'').toLowerCase();
  const isDevout = character.belief_level === 'devout';
  if (loc.category === 'religion' && religion && religion !== 'none') score += isDevout ? 4 : 2;
  if (isDevout && religion && religion !== 'none') {
    const vi = (loc.venue_identity||'').toLowerCase();
    if (/gay|lgbt|queer|strip|adult/.test(vi)) score -= 8;
    if (loc.category === 'social') score -= 1;
  }

  const EMOTIONAL_MODIFIERS = {
    sad:{'boost':['home','outdoor'],'penalize':['social']}, anxious:{'boost':['home','outdoor'],'penalize':['social']},
    overwhelmed:{'boost':['home','outdoor'],'penalize':['social']}, reflective:{'boost':['home','outdoor','religion'],'penalize':['social']},
    'closed-off':{'boost':['home'],'penalize':['social','food_drink']}, 'burnt out':{'boost':['home','outdoor'],'penalize':['social','gym']},
    grief:{'boost':['home','religion','outdoor'],'penalize':['social']}, joyful:{'boost':['social','food_drink','outdoor'],'penalize':[]},
    excited:{'boost':['social','food_drink','outdoor','gym'],'penalize':[]}, content:{'boost':['home','outdoor','food_drink'],'penalize':[]},
    bored:{'boost':['social','food_drink','outdoor'],'penalize':['home']}, irritated:{'boost':['outdoor','gym'],'penalize':['social']},
    frustrated:{'boost':['gym','outdoor','home'],'penalize':['social']},
  };
  const em = EMOTIONAL_MODIFIERS[character.emotional_state||'calm'];
  if (em) {
    if (em.boost.includes(loc.category)) score += 2;
    if (em.penalize.includes(loc.category)) score -= 2;
  }

  if (loc.category === 'home' && ['burnt out','overwhelmed','sad','anxious','grief'].includes(character.emotional_state)) score += 2;

  return score;
}

function pickBestFreeTimeLocation(availableLocations, character) {
  if (!availableLocations?.length) return null;
  const scored = availableLocations
    .map(loc => ({ loc, score: scoreLocationForCharacter(loc, character) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score > 0).slice(0, 3);
  if (!top.length) return scored[0]?.loc || null;
  const weights = top.length === 1 ? [1] : top.length === 2 ? [0.65, 0.35] : [0.50, 0.30, 0.20];
  const roll = Math.random();
  let cum = 0;
  for (let i = 0; i < top.length; i++) {
    cum += weights[i];
    if (roll <= cum) return top[i].loc;
  }
  return top[0].loc;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── LOCATION FACILITIES & HEALTH-ACTIVITY ELIGIBILITY ────────────────────
// Supplemental health-activity system. Being at a supporting location makes
// health-improving activities ELIGIBLE candidates, not automatic assignments.
// Selection still passes through the weighted-random gate in resolveCurrentActivity.
// Existing pressure-driven health/gym/outdoor candidates remain fully functional.
// Activities are facility-gated and role-appropriate; ordinary movement (walking
// between rooms, passing through) is never treated as exercise.
function locationFacilities(loc) {
  if (!loc) return [];
  const f = (loc.features || []).map(s => (s || '').toLowerCase());
  const st = (loc.subtype || []).map(s => (s || '').toLowerCase());
  return [...f, ...st].filter(Boolean);
}

function hasFacility(facilities, keywords) {
  return facilities.some(fac => keywords.some(kw => fac.includes(kw)));
}

function resolveCurrentLocationObj(character, allLocations) {
  const id = character.resolved_current_location_id;
  if (!id || !allLocations) return null;
  return allLocations.find(l => l.id === id) || null;
}

function buildLocationHealthCandidates(character, currentLoc, ctx) {
  if (!currentLoc) return [];
  const cat = (currentLoc.category || '').toLowerCase();
  const facilities = locationFacilities(currentLoc);
  const out = [];
  const energy = ctx.energy;
  const healthNeed = ctx.healthNeed;
  const isEnrolled = character.student_status === 'enrolled';
  const isDaytime = ctx.isDaytime;

  const addFac = (keywords, activities) => {
    if (hasFacility(facilities, keywords)) out.push(...activities);
  };

  if (cat === 'gym') {
    if (energy >= 45) {
      out.push({ weight: 28, label: 'working out at the gym', type: 'fitness_activity', needsEffect: { health: 14, mental: 8 } });
      addFac(['weight room', 'weight'], [{ weight: 30, label: 'strength training in the weight room', type: 'fitness_activity', needsEffect: { health: 14, mental: 5 } }]);
      addFac(['cardio'], [{ weight: 30, label: 'cardio workout on the machines', type: 'fitness_activity', needsEffect: { health: 13, mental: 7 } }]);
      addFac(['track'], [{ weight: 26, label: 'walking laps on the indoor track', type: 'fitness_activity', needsEffect: { health: 10, mental: 6 } }]);
      addFac(['treadmill'], [{ weight: 26, label: 'running on the treadmill', type: 'fitness_activity', needsEffect: { health: 13 } }]);
      addFac(['pool', 'swimming'], [{ weight: 28, label: 'swimming laps in the pool', type: 'fitness_activity', needsEffect: { health: 14, mental: 8 } }]);
      addFac(['basketball'], [{ weight: 24, label: 'shooting hoops on the court', type: 'fitness_activity', needsEffect: { health: 11, social: 6 } }]);
      addFac(['stretch'], [{ weight: 22, label: 'stretching in the stretching area', type: 'fitness_activity', needsEffect: { health: 6, mental: 5 } }]);
      out.push({ weight: 18, label: 'cooling down after a workout', type: 'fitness_activity', needsEffect: { health: 5, mental: 5 } });
    }
  } else if (cat === 'outdoor') {
    if (energy >= 45) {
      out.push({ weight: 24, label: 'walking for exercise', type: 'fitness_activity', needsEffect: { health: 10, mental: 8 } });
      addFac(['trail'], [{ weight: 28, label: 'walking the trail', type: 'fitness_activity', needsEffect: { health: 11, mental: 8 } }]);
      addFac(['fitness'], [{ weight: 26, label: 'using the outdoor fitness equipment', type: 'fitness_activity', needsEffect: { health: 12 } }]);
      addFac(['basketball'], [{ weight: 22, label: 'playing basketball on the outdoor court', type: 'fitness_activity', needsEffect: { health: 11, social: 8 } }]);
      addFac(['soccer', 'field'], [{ weight: 22, label: 'playing soccer on the field', type: 'fitness_activity', needsEffect: { health: 12, social: 8 } }]);
      out.push({ weight: 20, label: 'jogging', type: 'fitness_activity', needsEffect: { health: 12, mental: 7 } });
      out.push({ weight: 18, label: 'stretching outdoors', type: 'fitness_activity', needsEffect: { health: 5, mental: 6 } });
    }
  } else if (cat === 'home') {
    if (energy >= 45) {
      addFac(['treadmill', 'walking pad'], [{ weight: 26, label: 'walking on the treadmill at home', type: 'fitness_activity', needsEffect: { health: 11, mental: 7 } }]);
      addFac(['exercise bike', 'stationary'], [{ weight: 26, label: 'riding the exercise bike at home', type: 'fitness_activity', needsEffect: { health: 11, mental: 6 } }]);
      addFac(['home gym', 'home fitness'], [{ weight: 28, label: 'working out in the home gym', type: 'fitness_activity', needsEffect: { health: 13, mental: 7 } }]);
      addFac(['yoga'], [{ weight: 22, label: 'doing yoga on the mat at home', type: 'fitness_activity', needsEffect: { health: 8, mental: 9 } }]);
      addFac(['weights', 'dumbbell', 'kettlebell', 'resistance'], [{ weight: 24, label: 'strength training at home', type: 'fitness_activity', needsEffect: { health: 12 } }]);
      const hasAnyFitness = hasFacility(facilities, ['treadmill', 'walking pad', 'exercise bike', 'stationary', 'home gym', 'home fitness', 'yoga', 'weights', 'dumbbell', 'kettlebell', 'resistance', 'pull-up', 'pull up']);
      if (hasAnyFitness) {
        out.push({ weight: 22, label: 'home workout', type: 'fitness_activity', needsEffect: { health: 12, mental: 7 } });
      }
      out.push({ weight: 16, label: 'stretching at home', type: 'fitness_activity', needsEffect: { health: 5, mental: 6 } });
    }
  } else if (cat === 'medical') {
    // Medical activities only eligible when there is a health need. A character
    // at a medical location with full health does not auto-receive treatment.
    if (healthNeed < 70) {
      out.push({ weight: healthNeed < 40 ? 55 : 35, label: 'attending a medical appointment', type: 'health_activity', needsEffect: { health: 18 } });
      out.push({ weight: healthNeed < 40 ? 40 : 25, label: 'receiving treatment', type: 'health_activity', needsEffect: { health: 15 } });
      addFac(['physical therapy', 'rehab', 'rehabilitation'], [{ weight: 38, label: 'in physical therapy', type: 'health_activity', needsEffect: { health: 16 } }]);
      out.push({ weight: 30, label: 'picking up a prescription', type: 'health_activity', needsEffect: { health: 8 } });
      out.push({ weight: 26, label: 'completing lab work', type: 'health_activity', needsEffect: { health: 6 } });
      out.push({ weight: 24, label: 'preventive care visit', type: 'health_activity', needsEffect: { health: 12 } });
    }
  } else if (cat === 'education' || cat === 'school') {
    // School health activities only for enrolled students, during daytime.
    if (isEnrolled && energy >= 45 && isDaytime) {
      out.push({ weight: 22, label: 'participating in Physical Education', type: 'fitness_activity', needsEffect: { health: 11, social: 5 } });
      out.push({ weight: 20, label: 'athletic practice', type: 'fitness_activity', needsEffect: { health: 12, social: 6 } });
      addFac(['nurse'], [{ weight: 30, label: 'visiting the school nurse', type: 'health_activity', needsEffect: { health: 10 } }]);
      addFac(['gym', 'fitness'], [{ weight: 24, label: 'working out in the school gym', type: 'fitness_activity', needsEffect: { health: 12 } }]);
    }
  } else if (cat === 'workplace' || cat === 'business' || cat === 'government') {
    // Workplace wellness only when the workplace legitimately provides the
    // facility. Medical/therapy at work requires the workplace to actually
    // offer those services — a bartender does not receive a preventive exam
    // simply by being at work.
    addFac(['fitness', 'gym'], [{ weight: 22, label: 'using the employee fitness facility', type: 'fitness_activity', needsEffect: { health: 11, mental: 7 } }]);
    addFac(['wellness'], [{ weight: 20, label: 'participating in a workplace wellness activity', type: 'fitness_activity', needsEffect: { health: 8, mental: 6 } }]);
    if (hasFacility(facilities, ['break room', 'breakroom'])) {
      out.push({ weight: 18, label: 'stretching during a break', type: 'fitness_activity', needsEffect: { health: 6, mental: 5 } });
      out.push({ weight: 16, label: 'taking a walking break', type: 'fitness_activity', needsEffect: { health: 7, mental: 6 } });
    }
  }

  return out;
}

/**
 * Determine what a character is actually doing right now.
 * Full life engine: work, school, needs, stress, social, errands, self-care, fun.
 */
function resolveCurrentActivity(character, pendingScheduledEvents, allLocations) {
  const currentMinutes = getCurrentMinutesET();
  const currentDay = getCurrentDayIndexET();
  const currentHour = getCurrentHourET();
  const now = Date.now();
  const isWeekend = currentDay === 0 || currentDay === 6;

  // ── 1. SLEEPING ──────────────────────────────────────────────────────────
  const sleepStart = character.sleep_start_time || '23:00';
  const wakeUp = character.wake_up_time || '07:00';
  if (isInWindow(currentMinutes, sleepStart, wakeUp)) {
    return { activity: 'sleeping', type: 'sleep', isBusy: true };
  }

  // ── 2. MEDICAL / HOSPITAL ─────────────────────────────────────────────────
  const medicalEvent = pendingScheduledEvents.find(e => {
    if (e.character_ids?.includes(character.id) && e.status === 'pending') {
      const triggerMs = new Date(e.trigger_time).getTime();
      const desc = (e.description || '').toLowerCase();
      const isMedical = desc.includes('hospital') || desc.includes('surgery') || desc.includes('doctor') || desc.includes('appointment') || desc.includes('clinic') || desc.includes('procedure');
      return isMedical && triggerMs >= now - 4 * 3600000 && triggerMs <= now + 2 * 3600000;
    }
    return false;
  });
  if (medicalEvent) {
    const desc = (medicalEvent.description || '').toLowerCase();
    if (desc.includes('surgery') || desc.includes('hospital')) {
      return { activity: 'at hospital', type: 'hospital', isBusy: true };
    }
    return { activity: 'at doctor appointment', type: 'hospital', isBusy: true };
  }

  // ── 3. WORK ───────────────────────────────────────────────────────────────
  const unemployedKeywords = ['unemployed', 'between jobs', 'crime'];
  const workType = (character.work_details?.workplace_type || '').toLowerCase();
  const isUnemployed = unemployedKeywords.some(k => workType.includes(k));

  if (!isUnemployed) {
    if (character.occupation_location_id) {
      const workLoc = allLocations.find(l => l.id === character.occupation_location_id);
      if (workLoc) {
        const shift = getCharacterShift(character.id, workLoc);
        if (shift && isShiftDay(shift, currentDay) && isInWindow(currentMinutes, shift.start, shift.end)) {
          const jobTitle = workLoc.worker_job_titles?.[character.id] || character.work_details?.job_title || 'work';
          return { activity: `at work — ${jobTitle} at ${workLoc.name}`, type: 'work', isBusy: true };
        }
        const locActive = isLocationActiveNow(workLoc, currentMinutes, currentDay);
        const workDays = character.work_days || [1, 2, 3, 4, 5];
        const workStart = character.work_start_time || '09:00';
        const workEnd = character.work_end_time || '17:00';
        const charInWindow = workDays.includes(currentDay) && isInWindow(currentMinutes, workStart, workEnd);
        if (charInWindow && locActive !== false) {
          const jobTitle = character.work_details?.job_title || 'work';
          return { activity: `at work — ${jobTitle} at ${workLoc.name}`, type: 'work', isBusy: true };
        }
      }
    }

    if (character.additional_occupation_locations?.length > 0) {
      for (const extra of character.additional_occupation_locations) {
        const extraLoc = allLocations.find(l => l.id === extra.location_id);
        if (extraLoc) {
          const shift = getCharacterShift(character.id, extraLoc);
          if (shift && isShiftDay(shift, currentDay) && isInWindow(currentMinutes, shift.start, shift.end)) {
            return { activity: `at work — ${extra.job_title || 'work'} at ${extraLoc.name}`, type: 'work', isBusy: true };
          }
        }
      }
    }

    if (!character.occupation_location_id) {
      const workDays = character.work_days || [1, 2, 3, 4, 5];
      const workStart = character.work_start_time || '09:00';
      const workEnd = character.work_end_time || '17:00';
      if (workDays.includes(currentDay) && isInWindow(currentMinutes, workStart, workEnd)) {
        return { activity: `at work — ${character.work_details?.job_title || 'work'}`, type: 'work', isBusy: true };
      }
    }
  }

  // ── 4. SCHOOL / EDUCATION ─────────────────────────────────────────────────
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    if (character.education_location_id) {
      const eduLoc = allLocations.find(l => l.id === character.education_location_id);
      if (eduLoc) {
        const locActive = isLocationActiveNow(eduLoc, currentMinutes, currentDay);
        if (locActive === true) {
          return { activity: `at school — ${character.education_details?.course_name || character.current_education_activity} at ${eduLoc.name}`, type: 'school', isBusy: true };
        }
        if (locActive === null && currentHour >= 8 && currentHour < 21) {
          return { activity: `at school — ${character.education_details?.course_name || character.current_education_activity} at ${eduLoc.name}`, type: 'school', isBusy: true };
        }
      }
    }
    if (currentHour >= 8 && currentHour < 21) {
      return { activity: `at class — ${character.education_details?.course_name || character.current_education_activity}`, type: 'school', isBusy: true };
    }
  }

  // ── 5. JOB TRAINING ───────────────────────────────────────────────────────
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
    if (currentHour >= 8 && currentHour < 19) {
      return { activity: `in training — ${character.job_training_details?.training_name || character.current_job_training_activity}`, type: 'training', isBusy: false };
    }
  }

  // ── 6. RELIGIOUS ATTENDANCE ───────────────────────────────────────────────
  if (character.religion && character.religion !== 'None' && character.belief_level !== 'in_name_only') {
    const religionLoc = allLocations.find(l => l.category === 'religion' && !l.is_default_generic);
    if (religionLoc) {
      const locActive = isLocationActiveNow(religionLoc, currentMinutes, currentDay);
      if (locActive === true && character.belief_level === 'devout') {
        return { activity: `at ${religionLoc.name}`, type: 'worship', isBusy: false };
      }
    } else {
      const isServiceTime =
        (character.religion === 'Christianity' && currentDay === 0 && currentHour >= 9 && currentHour < 13) ||
        (character.religion === 'Islam' && currentDay === 5 && currentHour >= 11 && currentHour < 14) ||
        (character.religion === 'Judaism' && currentDay === 6 && currentHour >= 9 && currentHour < 12);
      if (isServiceTime && character.belief_level === 'devout') {
        const placeLabels = { Christianity: 'church', Islam: 'mosque', Judaism: 'synagogue' };
        return { activity: `at ${placeLabels[character.religion] || 'worship'}`, type: 'worship', isBusy: false };
      }
    }
  }

  // ── 7. NON-MEDICAL SCHEDULED EVENTS ───────────────────────────────────────
  const scheduledEvent = pendingScheduledEvents.find(e => {
    if (e.character_ids?.includes(character.id) && e.status === 'pending') {
      const triggerMs = new Date(e.trigger_time).getTime();
      return triggerMs >= now - 2 * 3600000 && triggerMs <= now + 1 * 3600000;
    }
    return false;
  });
  if (scheduledEvent) {
    return { activity: (scheduledEvent.description || 'at an event').substring(0, 60), type: 'out', isBusy: false };
  }

  // ── 8. MORNING ROUTINE ────────────────────────────────────────────────────
  const wakeMinutes = toMinutes(wakeUp) || 420;
  if (currentMinutes >= wakeMinutes && currentMinutes < wakeMinutes + 60) {
    return { activity: 'morning routine', type: 'home', isBusy: false };
  }

  // ── 9. FULL LIFE — NEEDS + PERSONALITY + TIME ENGINE ─────────────────────
  const hunger     = character.hunger_value       ?? 70;
  const energy     = character.energy_value       ?? 75;
  const socialNeed = character.social_value       ?? 65;
  const healthNeed = character.health_value       ?? 80;
  const mental     = character.mental_value       ?? 70;
  const financial  = character.financial_need_value ?? 60;
  const hygiene    = character.hygiene_value      ?? 75;
  const comfort    = character.comfort_value      ?? 70;
  const emotion    = (character.emotional_state || 'calm').toLowerCase();

  const personalityText = [
    character.archetype || '',
    character.personality_summary || '',
    (character.personality_traits || []).join(' '),
    character.communication_style || '',
  ].join(' ').toLowerCase();

  // Personality signals
  const isSocialChar     = personalityText.includes('extrovert') || personalityText.includes('social') || character.trait_flirty || character.social_energy === 'extrovert' || character.social_energy === 'mostly_extrovert';
  const socialActivityWeight = isSocialChar ? 1.2 : (isIntrovert ? 0.7 : 1.0);
  const isIntrovert      = character.social_energy === 'introvert' || character.social_energy === 'mostly_introvert';
  const isAmbitious      = personalityText.includes('ambitious') || personalityText.includes('driven') || character.trait_competitive;
  const isDisciplined    = personalityText.includes('disciplined') || personalityText.includes('structured') || personalityText.includes('organized');
  const isFitnessFocused = personalityText.includes('gym') || personalityText.includes('fitness') || personalityText.includes('workout') || personalityText.includes('run') || /run|jog|lift|cardio/.test(character.health_habits || '');
  const isImageConscious = personalityText.includes('image') || personalityText.includes('appearance') || personalityText.includes('style') || character.is_photogenic;
  const isNightOwl       = character.trait_night_owl;
  const isImpulsive      = personalityText.includes('impulsive') || personalityText.includes('spontaneous') || character.trait_hot_and_cold;
  const isHomebody       = personalityText.includes('homebody') || personalityText.includes('cozy') || personalityText.includes('private');
  const isNightlifeChar  = personalityText.includes('nightlife') || personalityText.includes('club') || personalityText.includes('party') || personalityText.includes('bar');

  // Quirk flags — influence behavior via existing candidate weights, never force
  const isCleanFreak      = character.trait_clean_freak === true;
  const isSelfCareFocused = character.trait_self_care_focused === true;
  const isHealthConscious = character.trait_health_conscious === true;

  const isEvening   = currentHour >= 17 && currentHour < 23;
  const isAfternoon = currentHour >= 12 && currentHour < 17;
  const isMorning   = currentHour >= 7  && currentHour < 12;
  const isLateNight = currentHour >= 23 || currentHour < 3;

  // Late night logic
  if (isLateNight) {
    if ((isSocialChar || isNightOwl || isNightlifeChar) && Math.random() < 0.3) {
      return { activity: pickRandom(['out late — bar or lounge', 'out late — after-hours hangout', 'still out — late night social']), type: 'out', isBusy: false };
    }
    return { activity: pickRandom(['at home, winding down', 'at home — late night']), type: 'home', isBusy: false };
  }

  const frequentedPlaces = character.frequented_places || [];
  const candidates = [];

  // ── HUNGER / FOOD — activity pressure only, NOT a destination ────────────
  // Hunger creates pressure to EAT. Not "go to restaurant." Not "get food out."
  // The character decides WHERE to eat later. This function only records the activity.
  if (hunger < 30) {
    candidates.push({ weight: 85, label: 'eating', type: 'hunger_activity', needsEffect: { hunger: 35 } });
  } else if (hunger < 50) {
    candidates.push({ weight: 55, label: 'eating', type: 'hunger_activity', needsEffect: { hunger: 25 } });
  } else if (hunger < 65 && (isMorning || isAfternoon) && financial >= 35) {
    candidates.push({ weight: 30, label: 'eating', type: 'hunger_activity', needsEffect: { hunger: 20 } });
  }

  // Grocery / supplies — only if food at home is depleted
  if (hunger < 60 || (isAfternoon && Math.random() < 0.25)) {
    candidates.push({ weight: hunger < 50 ? 35 : 20, label: 'grocery shopping', type: 'hunger_activity', needsEffect: { hunger: 15 } });
  }

  // ── HEALTH — activity pressure only ──────────────────────────────────────
  // Health Conscious quirk nudges care-seeking earlier and adds preventive maintenance.
  if (healthNeed < 35) {
    candidates.push({ weight: isHealthConscious ? 75 : 65, label: 'seeking medical care', type: 'health_activity', needsEffect: { health: 20 } });
  } else if (healthNeed < 50) {
    candidates.push({ weight: isHealthConscious ? 45 : 35, label: 'health maintenance', type: 'health_activity', needsEffect: { health: 10 } });
  } else if (isHealthConscious && healthNeed < 70) {
    candidates.push({ weight: 22, label: 'health maintenance', type: 'health_activity', needsEffect: { health: 8 } });
  }

  // ── GYM / FITNESS — activity pressure, not a destination ─────────────────
  if (energy >= 55) {
    if (isFitnessFocused) {
      if (isMorning || isAfternoon) {
        candidates.push({ weight: 60, label: 'exercising', type: 'fitness_activity', needsEffect: { health: 15, mental: 10 } });
      } else if (isEvening && Math.random() < 0.4) {
        candidates.push({ weight: 35, label: 'exercising', type: 'fitness_activity', needsEffect: { health: 12, mental: 8 } });
      }
    } else if (isDisciplined && Math.random() < 0.4) {
      candidates.push({ weight: 35, label: 'exercising', type: 'fitness_activity', needsEffect: { health: 10 } });
    } else if (Math.random() < 0.25) {
      candidates.push({ weight: 20, label: 'exercising', type: 'fitness_activity', needsEffect: { health: 8 } });
    }
  }

  // ── OUTDOOR / PARK / WALK — activity, not a destination ──────────────────
  if (energy >= 45) {
    const outdoorWeight = isFitnessFocused ? 40 : (isIntrovert ? 35 : 25);
    if (isMorning) {
      candidates.push({ weight: outdoorWeight, label: 'walking / fresh air', type: 'outdoor_activity', needsEffect: { mental: 10, social: 5 } });
    } else if (isAfternoon) {
      candidates.push({ weight: outdoorWeight - 5, label: 'walking / fresh air', type: 'outdoor_activity', needsEffect: { mental: 8 } });
    } else if (isEvening) {
      candidates.push({ weight: outdoorWeight - 5, label: 'walking / fresh air', type: 'outdoor_activity', needsEffect: { mental: 8, social: 5 } });
    }
  }

  // ── SOCIAL NEED ───────────────────────────────────────────────────────────
  if (socialNeed < 55) {
      // Autonomous social action - SAFE RECIPIENT REWORK
      const contacts = [
          ...(character.fictional_relationships || []).filter(r => r.related_character_id),
          ...(character.family_members || []).filter(m => m.character_id)
      ];
      
      const seen = new Set();
      const unique = contacts.filter(c => {
          const id = c.related_character_id || c.character_id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
      });

      const valid = unique.filter(c => (c.related_character_id || c.character_id) !== character.id);

      if (valid.length === 0) {
          console.warn(`[triggerAutonomousActions] SOCIAL BLOCKED | char=${character.name} | reason=NO_VALID_RECIPIENT`);
      } else {
          const chosen = valid[Math.floor(Math.random() * valid.length)];
          const receiverId = chosen.related_character_id || chosen.character_id;
          const receiverName = chosen.person_name || chosen.name || null;

          base44.functions.invoke('triggerCharacterContact', {
              senderCharacterId: character.id,
              receiverCharacterId: receiverId,
              receiverCharacterName: receiverName,
              topic: "Just thinking about you and wanted to reach out.",
              trigger_source: "autonomous",
              autonomy_marker: 'AUTONOMOUS_SOCIAL_ACTION_LOW_NEED'
          }).catch(e => {
              console.error(`[triggerAutonomousActions] SOCIAL FAILED | sender=${character.name} | receiver=${receiverId} | error=${e.message}`);
          });
      }
      
      // Activity pressure to seek social contact — character decides method (text, call, visit)
      candidates.push({ weight: 75 * socialActivityWeight, label: 'seeking social contact', type: 'social_activity', needsEffect: { social: 30, mental: 10 } });
  } else if (isSocialChar && isEvening) {
    candidates.push({ weight: 40 * socialActivityWeight, label: 'seeking social contact', type: 'social_activity', needsEffect: { social: 15 } });
  }

  // ── BARS / NIGHTLIFE / DRINKS — social activity, not a destination ───────
  if (isEvening) {
    if (isNightlifeChar) {
      candidates.push({ weight: 55, label: 'social drinking', type: 'social_activity', needsEffect: { social: 20, mental: 10 } });
    } else if (isSocialChar && Math.random() < 0.5) {
      candidates.push({ weight: 40, label: 'social drinking', type: 'social_activity', needsEffect: { social: 15, mental: 8 } });
    } else if (!isIntrovert && Math.random() < 0.3) {
      candidates.push({ weight: 28, label: 'social drinking', type: 'social_activity', needsEffect: { social: 10, mental: 8 } });
    }
  }

  // Post-work unwinding (evening, was working)
  if (isEvening && !isIntrovert) {
    candidates.push({ weight: 30, label: 'unwinding', type: 'rest_activity', needsEffect: { mental: 12, social: 8 } });
  }

  // ── RESTAURANTS / CAFÉS / DINING — activity pressure for eating out ──────
  if (isEvening && financial >= 30) {
    candidates.push({ weight: isSocialChar ? 38 : 22, label: 'dining out', type: 'hunger_activity', needsEffect: { hunger: 25, social: 10 } });
  }
  if (isMorning && financial >= 25) {
    candidates.push({ weight: 28, label: 'getting coffee', type: 'hunger_activity', needsEffect: { hunger: 10 } });
  }
  if (isAfternoon && financial >= 30 && Math.random() < 0.4) {
    candidates.push({ weight: 25, label: 'dining out', type: 'hunger_activity', needsEffect: { hunger: 20, social: 8 } });
  }

  // Weekend brunch / social meals
  if (isWeekend && isMorning && financial >= 30) {
    candidates.push({ weight: 40, label: 'dining out', type: 'hunger_activity', needsEffect: { hunger: 20, social: 15 } });
  }

  // Weekend social / fun outings
  if (isWeekend) {
    candidates.push({ weight: isSocialChar ? 45 : 25, label: 'weekend outing', type: 'social_activity', needsEffect: { social: 20, mental: 15 } });
    if (isAfternoon || isEvening) {
      candidates.push({ weight: 35, label: 'social plans', type: 'social_activity', needsEffect: { social: 20 } });
    }
  }

  // ── EMOTIONAL STATE — MOVEMENT DRIVERS ───────────────────────────────────
  const stressedEmotions = ['stressed', 'overwhelmed', 'anxious', 'frustrated', 'irritated', 'burnt out'];
  const lowEmotions = ['sad', 'lonely', 'loneliness', 'grief', 'disappointment', 'hopeless'];
  const highEmotions = ['joyful', 'excited', 'elation', 'happy', 'happiness', 'confident', 'flirtatious'];
  const restlessEmotions = ['bored', 'restless', 'apathy'];

  if (stressedEmotions.includes(emotion)) {
    candidates.push({ weight: 55, label: 'stress relief', type: 'mental_activity', needsEffect: { mental: 15 } });
  }
  if (lowEmotions.includes(emotion)) {
    if (Math.random() < 0.55) {
      candidates.push({ weight: 45, label: 'comfort seeking', type: 'mental_activity', needsEffect: { social: 15, mental: 10 } });
    }
  }
  if (highEmotions.includes(emotion) && isEvening) {
    candidates.push({ weight: 45, label: 'celebratory mood', type: 'social_activity', needsEffect: { social: 15 } });
  }
  if (restlessEmotions.includes(emotion)) {
    const travelWeight = isSocialChar ? 60 : 30;
    candidates.push({ weight: travelWeight, label: 'exploring', type: 'travel_activity', needsEffect: { mental: 15, social: 5 } });
    candidates.push({ weight: 50, label: 'restlessness outlet', type: 'mental_activity', needsEffect: { mental: 12, social: 8 } });
  }

  // ── MENTAL / COMFORT NEEDS — activity pressure, NOT destination ──────────
  if (mental < 40) {
    candidates.push({ weight: 55, label: 'mental reset', type: 'mental_activity', needsEffect: { mental: 20 } });
  } else if (mental < 55) {
    candidates.push({ weight: 30, label: 'getting fresh air', type: 'mental_activity', needsEffect: { mental: 12 } });
  }

  if (comfort < 40) {
    candidates.push({ weight: 40, label: 'improving comfort', type: 'comfort_activity', needsEffect: { comfort: 15 } });
  }

  // ── HYGIENE / GROOMING / SELF-CARE — activity, NOT destination ────────────
  // Hygiene at home (shower, grooming) is preferred. Supplies purchase is secondary.
  // Self-Care Focused quirk nudges hygiene care earlier and stronger.
  {
    const _hygThresh = isSelfCareFocused ? 55 : 45;
    const _hygW = isSelfCareFocused ? 50 : 40;
    const _hygGain = isSelfCareFocused ? 25 : 20;
    if (hygiene < _hygThresh) {
      candidates.push({ weight: _hygW, label: 'hygiene care', type: 'hygiene_activity', needsEffect: { hygiene: _hygGain } });
    }
  }

  // ── ERRANDS / PRACTICAL LIFE — activities, not destinations ──────────────
  if (isAfternoon) {
    candidates.push({ weight: 25, label: 'running errands', type: 'errand_activity', needsEffect: {} });
    if (isUnemployed) {
      candidates.push({ weight: 35, label: 'job searching', type: 'errand_activity', needsEffect: {} });
    }
  }
  if (isMorning) {
    candidates.push({ weight: 22, label: 'running errands', type: 'errand_activity', needsEffect: {} });
  }

  // ── SELF-CARE / GROOMING — activity, not destination ─────────────────────
  // Self-Care Focused quirk makes grooming more likely even without image-consciousness.
  {
    const _groomGate = isSelfCareFocused || isImageConscious;
    const _groomChance = isSelfCareFocused ? 0.6 : 0.4;
    const _groomW = isSelfCareFocused ? 40 : 30;
    if (_groomGate && Math.random() < _groomChance) {
      candidates.push({ weight: _groomW, label: 'grooming / self-care', type: 'hygiene_activity', needsEffect: { hygiene: 10 } });
    }
  }

  // ── CLEAN FREAK — household cleaning & organization (home activity) ───────
  // Clean Freak quirk makes tidying, cleaning, and laundry eligible more often.
  // These are home activities (no travel) that improve comfort and mental state.
  if (isCleanFreak) {
    candidates.push({ weight: 38, label: 'cleaning the house', type: 'home', needsEffect: { comfort: 10, mental: 8 } });
    candidates.push({ weight: 28, label: 'doing laundry and tidying up', type: 'home', needsEffect: { comfort: 8, mental: 6 } });
    candidates.push({ weight: 24, label: 'organizing and putting things away', type: 'home', needsEffect: { comfort: 6, mental: 7 } });
  }

  // ── AMBITIOUS / NETWORKING — activity ────────────────────────────────────
  if (isAmbitious && isAfternoon && Math.random() < 0.4) {
    candidates.push({ weight: 32, label: 'networking', type: 'social_activity', needsEffect: {} });
  }

  // ── FAMILY VISIT — social activity ───────────────────────────────────────
  const hasFamilyMembers = (character.family_members || []).length > 0;
  if (hasFamilyMembers && isWeekend && Math.random() < 0.35) {
    candidates.push({ weight: 38, label: 'family visit', type: 'social_activity', needsEffect: { social: 20, comfort: 10 } });
  }

  // ── IMPULSIVE / SPONTANEOUS — activity, not destination ──────────────────
  if (isImpulsive && Math.random() < 0.45) {
    candidates.push({ weight: 35, label: 'spontaneous outing', type: 'recreation_activity', needsEffect: { mental: 10 } });
  }

  // ── FREQUENTED PLACES — visiting a regular spot ──────────────────────────
  if (frequentedPlaces.length > 0) {
    const timeFiltered = frequentedPlaces.filter(p => {
      const pl = p.toLowerCase();
      if (isEvening) return true;
      if (isMorning) return pl.includes('gym') || pl.includes('park') || pl.includes('café') || pl.includes('coffee');
      if (isAfternoon) return !pl.includes('bar') && !pl.includes('club');
      return true;
    });
    if (timeFiltered.length > 0 && Math.random() < 0.45) {
      candidates.push({ weight: 40, label: 'visiting regular spot', type: 'recreation_activity', needsEffect: {} });
    }
  }

  // ── WORLD CONDITIONS — active environmental drivers ───────────────────────
  const wc = character._worldConditions || null;
  if (wc) {
    // Health alerts → push medical/pharmacy visits
    if (wc.hasHealthAlert && healthNeed < 75) {
      candidates.push({ weight: 50, label: pickRandom(['out — picking up medication', 'out — health errand', 'at the pharmacy', 'out — scheduled a checkup', 'out — health appointment']), type: 'out', needsEffect: { health: 12 } });
    }

    // High crime → remove late-night outings or reduce their weight
    if (wc.highCrime && (isEvening || isLateNight)) {
      for (const c of candidates) {
        if (/bar|lounge|club|night|social/i.test(c.label)) {
          c.weight = Math.floor(c.weight * 0.5); // less likely to go out at risky times
        }
      }
      // May mention safety as reason to stay closer to home
      if (isLateNight) candidates.push({ weight: 30, label: 'at home — not going out tonight, not safe', type: 'home', needsEffect: {} });
    }

    // High economic stress → more errands/budget behavior, fewer luxury outings
    if (wc.highEconomicStress) {
      // Reduce weight of expensive outings
      for (const c of candidates) {
        if (/restaurant|dinner out|bar|lounge|entertainment|club/i.test(c.label) && financial < 50) {
          c.weight = Math.floor(c.weight * 0.6);
        }
      }
      // Add budget-conscious alternatives
      candidates.push({ weight: 30, label: pickRandom(['out running errands — keeping it budget', 'at the grocery store — sticking to basics', 'out — handling necessities']), type: 'out', needsEffect: { hunger: 10 } });
    }
  }

  // ── LOCATION-ELIGIBLE HEALTH ACTIVITIES (supplemental) ──────────────────
  // Being at a supporting location makes health-improving activities AVAILABLE.
  // These are eligible candidates, not automatic — they pass through the same
  // weighted-random gate below. Existing pressure-driven health/gym/outdoor
  // candidates above remain fully functional. Activities are facility-gated and
  // role-appropriate; ordinary movement is never treated as exercise.
  const _curLoc = resolveCurrentLocationObj(character, allLocations);
  if (_curLoc) {
    const _healthCands = buildLocationHealthCandidates(character, _curLoc, {
      energy, healthNeed, isDaytime: isMorning || isAfternoon,
    });
    for (const _hc of _healthCands) candidates.push(_hc);
  }

  // ── HOMEBODY ADJUSTMENT ───────────────────────────────────────────────────
  // Homebodies still go out but at a lower rate
  if (isHomebody) {
    for (const c of candidates) c.weight = Math.floor(c.weight * 0.65);
  }

  // ── SELECT BY WEIGHTED RANDOM ─────────────────────────────────────────────
  if (candidates.length > 0) {
    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
    // Lower threshold = more realistic out-of-home frequency
    // Active characters are treated as having lives, not as props
        const HOME_STAY_THRESHOLD = isHomebody ? 55 : 40;
    if (totalWeight >= HOME_STAY_THRESHOLD) {
      let rand = Math.random() * totalWeight;
      for (const candidate of candidates) {
        rand -= candidate.weight;
        if (rand <= 0) {
          // TRAVEL REQUIRED: activity needs a destination — autoMovement handles routing
          // triggerAutonomousActions only sets activity pressure, NOT destinations
          if (candidate.type === 'travel_activity') {
            return { activity: candidate.label, type: 'travel_activity', isBusy: false, needsEffect: candidate.needsEffect || {} };
          }
          return { activity: candidate.label, type: candidate.type, isBusy: false, needsEffect: candidate.needsEffect || {} };
        }
      }
    }
  }

  // ── HOME-STAY — activities at current location, no travel implied ─────────
  const homeActivities = [];
  if (isMorning) homeActivities.push('at home — making breakfast', 'at home — getting ready', 'at home — morning routine', 'at home — slow morning');
  if (isAfternoon) homeActivities.push('at home — taking care of things', 'at home — relaxing', 'at home — doing chores', 'at home — cooking', 'at home — free time');
  if (isEvening) homeActivities.push('at home — cooking dinner', 'at home — winding down', 'at home — watching something', 'at home — low-key evening', 'at home — quiet night in');
  if (energy < 40) homeActivities.push('at home — resting', 'at home — low energy', 'at home — recovering');
  if (mental < 40) homeActivities.push('at home — quiet day', 'at home — taking a mental break', 'at home — keeping it simple');
  if (isIntrovert) homeActivities.push('at home — recharging', 'at home — solo time', 'at home — downtime');

  if (homeActivities.length > 0) {
    return { activity: pickRandom(homeActivities), type: 'home', isBusy: false, needsEffect: {} };
  }
  return { activity: 'at home', type: 'home', isBusy: false, needsEffect: {} };
}

function shouldTriggerAutonomy(character) {
  if (character.status !== 'active') return false;
  const now = new Date();
  const lastMessage = character.life_last_updated ? new Date(character.life_last_updated) : null;
  if (lastMessage) {
    const hoursSince = (now - lastMessage) / (1000 * 60 * 60);
    return hoursSince > Math.random() * 3 + 1.5; // Check more frequently
  }
  return Math.random() < 0.5;
}

/**
 * Apply needs effects from an outing to the character's need values
 */
function applyNeedsEffect(character, needsEffect) {
  if (!needsEffect || Object.keys(needsEffect).length === 0) return null;
  const updates = {};
  const needFields = {
    hunger: 'hunger_value',
    health: 'health_value',
    social: 'social_value',
    mental: 'mental_value',
    hygiene: 'hygiene_value',
    comfort: 'comfort_value',
    energy: 'energy_value',
  };
  let hasUpdate = false;
  for (const [need, delta] of Object.entries(needsEffect)) {
    const field = needFields[need];
    if (!field) continue;
    const current = character[field] ?? 70;
    const next = Math.min(100, Math.max(0, current + delta));
    if (next !== current) {
      updates[field] = next;
      hasUpdate = true;
    }
  }
  return hasUpdate ? updates : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      60
    );

    const now = new Date();
    const windowStart = new Date(now.getTime() - 4 * 3600000).toISOString();
    const windowEnd = new Date(now.getTime() + 2 * 3600000).toISOString();

    let pendingScheduledEvents = [];
    try {
      const allPending = await base44.asServiceRole.entities.ScheduledEvent.filter({ status: 'pending' }, '-trigger_time', 100);
      pendingScheduledEvents = allPending.filter(e => {
        const t = e.trigger_time;
        return t >= windowStart && t <= windowEnd;
      });
    } catch (_) {}

    let allLocations = [];
    try {
      allLocations = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
    } catch (_) {}

    // ── WORLD STATE: inject real-world conditions as activity drivers ──────────
    let worldConditions = null;
    try {
      const dateStr = now.toISOString().split('T')[0];
      const worldStates = await base44.asServiceRole.entities.AppWorldState.filter({ current_date: dateStr });
      if (worldStates?.[0]) {
        const ws = worldStates[0];
        worldConditions = {
          // High crime → characters go out less at night, avoid certain areas
          highCrime: ws.society?.crime_stats?.safety_level === 'high' || ws.society?.crime_stats?.safety_level === 'elevated',
          // Health alerts → push medical/pharmacy visits
          healthAlerts: ws.society?.health_alerts || {},
          hasHealthAlert: Object.values(ws.society?.health_alerts || {}).some(v => v && String(v).length > 10),
          // Economic stress → restrain spending, fewer social outings
          economicStress: ws.society?.economic_indicators?.overall_stress_level,
          highEconomicStress: ['high', 'very_high'].includes(ws.society?.economic_indicators?.overall_stress_level),
          // Entertainment → might drive social plans
          trending: ws.entertainment?.trending || [],
        };
      }
    } catch (_) {}

    const updated = [];

    for (const character of characters) {
      if (character.is_test_character) continue; // SAFETY GATE: skip test fixtures in production
      if (!shouldTriggerAutonomy(character)) continue;

      // Inject world conditions into character as temporary context
      if (worldConditions) {
        character._worldConditions = worldConditions;
      }

      const resolved = resolveCurrentActivity(character, pendingScheduledEvents, allLocations);

      const updates = {
        current_activity: resolved.activity,
        life_last_updated: now.toISOString(),
      };

      // Write current_situation based on whether the activity requires leaving
      // Activity types: home = stays put; all others = may require travel (decided by autoMovement)
      if (resolved.type === 'home') {
        updates.current_situation = `Home — ${resolved.activity}`;
      } else {
        // Activity that may require travel — autoMovement decides destination
        updates.current_situation = `${resolved.activity}`;
      }

      // Apply needs effects for activities
      if (resolved.needsEffect && Object.keys(resolved.needsEffect).length > 0) {
        const needUpdates = applyNeedsEffect(character, resolved.needsEffect);
        if (needUpdates) Object.assign(updates, needUpdates);
      }

      await base44.asServiceRole.entities.Character.update(character.id, updates);
      updated.push({ id: character.id, name: character.name, activity: resolved.activity, type: resolved.type });
    }

    return Response.json({
      success: true,
      autonomous_actions_triggered: updated.length,
      characters_updated: updated,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});