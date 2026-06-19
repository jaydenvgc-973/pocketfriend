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

  // ── HUNGER / FOOD ─────────────────────────────────────────────────────────
  if (hunger < 30) {
    candidates.push({ weight: 85, label: pickRandom(['out getting food', 'at a restaurant', 'grabbing something to eat']), type: 'out', needsEffect: { hunger: 35 } });
  } else if (hunger < 50) {
    candidates.push({ weight: 55, label: pickRandom(['out grabbing a bite', 'at a café or diner', 'picking up lunch']), type: 'out', needsEffect: { hunger: 25 } });
  } else if (hunger < 65 && (isMorning || isAfternoon) && financial >= 35) {
    candidates.push({ weight: 30, label: pickRandom(['out for a meal', 'grabbing coffee and food', 'lunch run']), type: 'out', needsEffect: { hunger: 20 } });
  }

  // Grocery / supplies
  if (hunger < 60 || (isAfternoon && Math.random() < 0.25)) {
    candidates.push({ weight: hunger < 50 ? 35 : 20, label: pickRandom(['picking up groceries', 'out getting groceries', 'grocery run', 'picking up supplies']), type: 'out', needsEffect: { hunger: 15 } });
  }

  // ── HEALTH ─────────────────────────────────────────────────────────────────
  if (healthNeed < 35) {
    candidates.push({ weight: 65, label: pickRandom(['at a clinic or pharmacy', 'out — health errand', 'at the doctor', 'picking up medication']), type: 'out', needsEffect: { health: 20 } });
  } else if (healthNeed < 50) {
    candidates.push({ weight: 35, label: pickRandom(['pharmacy run', 'out — quick health errand']), type: 'out', needsEffect: { health: 10 } });
  }

  // ── GYM / FITNESS ─────────────────────────────────────────────────────────
  if (energy >= 55) {
    if (isFitnessFocused) {
      if (isMorning || isAfternoon) {
        candidates.push({ weight: 60, label: pickRandom(['at the gym', 'working out', 'at the gym — lifting', 'at the gym — cardio']), type: 'out', needsEffect: { health: 15, mental: 10 } });
      } else if (isEvening && Math.random() < 0.4) {
        candidates.push({ weight: 35, label: pickRandom(['evening workout', 'at the gym after work']), type: 'out', needsEffect: { health: 12, mental: 8 } });
      }
    } else if (isDisciplined && Math.random() < 0.4) {
      candidates.push({ weight: 35, label: 'at the gym', type: 'out', needsEffect: { health: 10 } });
    } else if (Math.random() < 0.25) {
      candidates.push({ weight: 20, label: 'at the gym', type: 'out', needsEffect: { health: 8 } });
    }
  }

  // ── OUTDOOR / PARK / WALK ─────────────────────────────────────────────────
  if (energy >= 45) {
    const outdoorWeight = isFitnessFocused ? 40 : (isIntrovert ? 35 : 25);
    if (isMorning) {
      candidates.push({ weight: outdoorWeight, label: pickRandom(['out for a morning walk', 'out for a run', 'at the park', 'morning walk']), type: 'out', needsEffect: { mental: 10, social: 5 } });
    } else if (isAfternoon) {
      candidates.push({ weight: outdoorWeight - 5, label: pickRandom(['out for a walk', 'at the park', 'getting some air', 'outside for a bit']), type: 'out', needsEffect: { mental: 8 } });
    } else if (isEvening) {
      candidates.push({ weight: outdoorWeight - 5, label: pickRandom(['evening walk', 'out for fresh air', 'evening stroll']), type: 'out', needsEffect: { mental: 8, social: 5 } });
    }
  }

  // ── SOCIAL NEED ───────────────────────────────────────────────────────────
  if (socialNeed < 55) {
    // Autonomous social action
    const contacts = [
        ...(character.fictional_relationships || []).filter(r => r.related_character_id || r.person_name),
        ...(character.family_members || []).filter(m => m.character_id || m.name)
    ];

    if (contacts.length > 0) {
        const recipientContact = contacts[Math.floor(Math.random() * contacts.length)];
        const receiverId = recipientContact.related_character_id || recipientContact.character_id;
        const receiverName = recipientContact.person_name || recipientContact.name;

        if (receiverId || receiverName) {
            base44.functions.invoke('triggerCharacterContact', {
                senderCharacterId: character.id,
                receiverCharacterId: receiverId,
                receiverCharacterName: receiverName,
                topic: "Just thinking about you and wanted to reach out.",
                trigger_source: "autonomous_low_social",
                autonomy_marker: 'AUTONOMOUS_SOCIAL_ACTION_V2_LOW_NEED'
            }).catch(e => console.error(`[triggerAutonomousActions] Social contact failed for ${character.name}: ${e.message}`));
        }
    }

    const label = isSocialChar
      ? pickRandom(['out with people', 'out socializing', 'visiting someone', 'out for the evening'])
      : pickRandom(['visiting someone', 'spending time with someone', 'out — needed company']);
    candidates.push({ weight: 75 * socialActivityWeight, label, type: 'out', needsEffect: { social: 30, mental: 10 } });
  } else if (isSocialChar && isEvening) {
    candidates.push({ weight: 40 * socialActivityWeight, label: pickRandom(['out for the evening', 'out with friends', 'out socializing']), type: 'out', needsEffect: { social: 15 } });
  }

  // ── BARS / NIGHTLIFE / DRINKS ─────────────────────────────────────────────
  if (isEvening) {
    if (isNightlifeChar) {
      candidates.push({ weight: 55, label: pickRandom(['out at a bar', 'at a lounge', 'out for drinks', 'out — bar or lounge', 'out tonight']), type: 'out', needsEffect: { social: 20, mental: 10 } });
    } else if (isSocialChar && Math.random() < 0.5) {
      candidates.push({ weight: 40, label: pickRandom(['out for drinks', 'out tonight', 'at a bar', 'out for the evening']), type: 'out', needsEffect: { social: 15, mental: 8 } });
    } else if (!isIntrovert && Math.random() < 0.3) {
      candidates.push({ weight: 28, label: pickRandom(['out for a drink', 'out this evening', 'out grabbing drinks']), type: 'out', needsEffect: { social: 10, mental: 8 } });
    }
  }

  // Post-work unwinding (evening, was working)
  if (isEvening && !isIntrovert) {
    candidates.push({ weight: 30, label: pickRandom(['unwinding after work', 'out to decompress', 'out — needed a reset', 'grabbing a drink after work']), type: 'out', needsEffect: { mental: 12, social: 8 } });
  }

  // ── RESTAURANTS / CAFÉS / DINING OUT ─────────────────────────────────────
  if (isEvening && financial >= 30) {
    candidates.push({ weight: isSocialChar ? 38 : 22, label: pickRandom(['out for dinner', 'at a restaurant', 'out for dinner with someone', 'dinner out']), type: 'out', needsEffect: { hunger: 25, social: 10 } });
  }
  if (isMorning && financial >= 25) {
    candidates.push({ weight: 28, label: pickRandom(['out for coffee', 'grabbing coffee', 'at a café', 'coffee run']), type: 'out', needsEffect: { hunger: 10 } });
  }
  if (isAfternoon && financial >= 30 && Math.random() < 0.4) {
    candidates.push({ weight: 25, label: pickRandom(['out for lunch', 'out at a café', 'lunch out', 'grabbing lunch']), type: 'out', needsEffect: { hunger: 20, social: 8 } });
  }

  // Weekend brunch / social meals
  if (isWeekend && isMorning && financial >= 30) {
    candidates.push({ weight: 40, label: pickRandom(['out for brunch', 'brunch with someone', 'weekend brunch']), type: 'out', needsEffect: { hunger: 20, social: 15 } });
  }

  // Weekend social / fun outings
  if (isWeekend) {
    candidates.push({ weight: isSocialChar ? 45 : 25, label: pickRandom(['out for the day', 'out this weekend', 'out exploring', 'weekend outing']), type: 'out', needsEffect: { social: 20, mental: 15 } });
    if (isAfternoon || isEvening) {
      candidates.push({ weight: 35, label: pickRandom(['out with people today', 'hanging out this weekend', 'social plans today']), type: 'out', needsEffect: { social: 20 } });
    }
  }

  // ── EMOTIONAL STATE — MOVEMENT DRIVERS ───────────────────────────────────
  const stressedEmotions = ['stressed', 'overwhelmed', 'anxious', 'frustrated', 'irritated', 'burnt out'];
  const lowEmotions = ['sad', 'lonely', 'loneliness', 'grief', 'disappointment', 'hopeless'];
  const highEmotions = ['joyful', 'excited', 'elation', 'happy', 'happiness', 'confident', 'flirtatious'];
  const restlessEmotions = ['bored', 'restless', 'apathy'];

  if (stressedEmotions.includes(emotion)) {
    candidates.push({ weight: 55, label: pickRandom(['out clearing their head', 'out — needed air', 'out to decompress', 'out — stress relief', 'out cooling off', 'at the gym', 'out for a walk']), type: 'out', needsEffect: { mental: 15 } });
  }
  if (lowEmotions.includes(emotion)) {
    if (Math.random() < 0.55) {
      candidates.push({ weight: 45, label: pickRandom(['out — went somewhere familiar', 'out — comfort outing', 'visiting someone', 'out for fresh air']), type: 'out', needsEffect: { social: 15, mental: 10 } });
    }
  }
  if (highEmotions.includes(emotion) && isEvening) {
    candidates.push({ weight: 45, label: pickRandom(['out — feeling good, went out', 'out tonight', 'out — good mood', 'celebrating something']), type: 'out', needsEffect: { social: 15 } });
  }
  if (restlessEmotions.includes(emotion)) {
    const travelWeight = isSocialChar ? 60 : 30;
    candidates.push({ weight: travelWeight, label: 'out exploring', type: 'travel', needsEffect: { mental: 15, social: 5 } });

    candidates.push({ weight: 50, label: pickRandom(['out — needed to get out of the house', 'out — restless', 'out — bored at home', 'went out — had to do something']), type: 'out', needsEffect: { mental: 12, social: 8 } });
  }

  // ── MENTAL / COMFORT NEEDS ────────────────────────────────────────────────
  if (mental < 40) {
    candidates.push({ weight: 55, label: pickRandom(['out — mental reset', 'out — needed a change of scenery', 'out for a walk to clear head', 'out — quiet time somewhere else']), type: 'out', needsEffect: { mental: 20 } });
  } else if (mental < 55) {
    candidates.push({ weight: 30, label: pickRandom(['out for some fresh air', 'out — getting a breather', 'out for a walk']), type: 'out', needsEffect: { mental: 12 } });
  }

  if (comfort < 40) {
    candidates.push({ weight: 40, label: pickRandom(['out — needed a change', 'out — getting out of the house', 'somewhere that feels better']), type: 'out', needsEffect: { comfort: 15 } });
  }

  // ── HYGIENE / GROOMING / SELF-CARE ───────────────────────────────────────
  if (hygiene < 45) {
    candidates.push({ weight: 40, label: pickRandom(['out — personal errand', 'picking up hygiene items', 'grooming errand', 'out — self-care run']), type: 'out', needsEffect: { hygiene: 20 } });
  }

  // ── ERRANDS / PRACTICAL LIFE ──────────────────────────────────────────────
  if (isAfternoon) {
    candidates.push({ weight: 25, label: pickRandom(['out running errands', 'handling errands', 'out taking care of things']), type: 'out', needsEffect: {} });
    if (isUnemployed) {
      candidates.push({ weight: 35, label: pickRandom(['out job searching', 'out — handling things', 'out for the day']), type: 'out', needsEffect: {} });
    }
  }
  if (isMorning) {
    candidates.push({ weight: 22, label: pickRandom(['out running morning errands', 'out early — errands', 'morning errands']), type: 'out', needsEffect: {} });
  }

  // ── SELF-CARE / GROOMING OUTINGS ─────────────────────────────────────────
  if (isImageConscious && Math.random() < 0.4) {
    candidates.push({ weight: 30, label: pickRandom(['out — shopping', 'out getting a haircut', 'appearance errand', 'out — self-care']), type: 'out', needsEffect: { hygiene: 10 } });
  }

  // ── AMBITIOUS / NETWORKING ────────────────────────────────────────────────
  if (isAmbitious && isAfternoon && Math.random() < 0.4) {
    candidates.push({ weight: 32, label: pickRandom(['out — meetings or networking', 'out on business', 'handling business']), type: 'out', needsEffect: {} });
  }

  // ── FAMILY VISIT ──────────────────────────────────────────────────────────
  const hasFamilyMembers = (character.family_members || []).length > 0;
  if (hasFamilyMembers && isWeekend && Math.random() < 0.35) {
    candidates.push({ weight: 38, label: pickRandom(['visiting family', 'spending time with family', 'family visit today']), type: 'out', needsEffect: { social: 20, comfort: 10 } });
  }

  // ── IMPULSIVE / SPONTANEOUS OUTINGS ──────────────────────────────────────
  if (isImpulsive && Math.random() < 0.45) {
    candidates.push({ weight: 35, label: pickRandom(['out spontaneously', 'just left the house — no specific plan', 'out on a whim', 'went out — felt like it']), type: 'out', needsEffect: { mental: 10 } });
  }

  // ── FREQUENTED PLACES ─────────────────────────────────────────────────────
  if (frequentedPlaces.length > 0) {
    const timeFiltered = frequentedPlaces.filter(p => {
      const pl = p.toLowerCase();
      if (isEvening) return true;
      if (isMorning) return pl.includes('gym') || pl.includes('park') || pl.includes('café') || pl.includes('coffee');
      if (isAfternoon) return !pl.includes('bar') && !pl.includes('club');
      return true;
    });
    if (timeFiltered.length > 0 && Math.random() < 0.45) {
      const place = pickRandom(timeFiltered);
      candidates.push({ weight: 40, label: `at ${place.toLowerCase()}`, type: 'out', needsEffect: {} });
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
          if (candidate.type === 'travel') {
            const availableLocations = allLocations.filter(l => l.category !== 'home' && l.category !== 'work' && l.category !== 'school');
            const destination = pickBestFreeTimeLocation(availableLocations, character);
            if (destination) {
              base44.functions.invoke('createTravelSession', {
                characterId: character.id,
                destinationLocationId: destination.id,
                travel_reason: 'autonomous_exploration'
              }).catch(e => console.error(e));
              return { activity: `exploring — heading to ${destination.name}`, type: 'travel', isBusy: true, needsEffect: candidate.needsEffect || {} };
            }
          }
          return { activity: candidate.label, type: candidate.type, isBusy: false, needsEffect: candidate.needsEffect || {} };
        }
      }
    }
  }

  // ── HOME-STAY WITH REALISTIC REASON ───────────────────────────────────────
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

      if (resolved.type === 'out') {
        updates.current_situation = `Out — ${resolved.activity}`;
      } else if (resolved.type === 'home') {
        updates.current_situation = `Home — ${resolved.activity}`;
      }

      // Apply needs effects when going out
      if (resolved.type === 'out' && resolved.needsEffect) {
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