/**
 * triggerAutonomousActions
 *
 * Schedule-aware autonomous activity updater.
 * Uses character schedule data + location operating_hours + worker_shifts
 * to set current_activity accurately.
 *
 * Unified system: Work, School/Education, Religion, and Gym all use
 * the same two-layer schedule logic (location hours + character schedule).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

// Check if a location is currently active based on its operating_hours
function isLocationActiveNow(location, currentMinutes, currentDay) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return null; // unknown
  for (const window of hours) {
    const dayMatch = window.day_of_week == null || window.day_of_week === currentDay;
    if (dayMatch && isInWindow(currentMinutes, window.open_time, window.close_time)) {
      return true;
    }
  }
  return false;
}

// Get character's shift at a location from worker_shifts map
function getCharacterShift(characterId, location) {
  if (!location?.worker_shifts || !characterId) return null;
  const shift = location.worker_shifts[characterId];
  if (!shift?.start || !shift?.end) return null;
  return shift;
}

// Check if shift days match current day (defaults to Mon-Fri if no days set)
function isShiftDay(shift, currentDay) {
  const days = shift.days;
  if (!days || days.length === 0) return [1, 2, 3, 4, 5].includes(currentDay);
  return days.includes(currentDay);
}

/**
 * Determine what a character is actually doing right now
 * based on their schedule + location data.
 */
function resolveCurrentActivity(character, pendingScheduledEvents, allLocations) {
  const currentMinutes = getCurrentMinutesET();
  const currentDay = getCurrentDayIndexET();
  const currentHour = getCurrentHourET();
  const now = Date.now();

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

  // ── 3. WORK — two-layer: shift at location → character schedule ─────────
  const unemployedKeywords = ['unemployed', 'between jobs', 'crime'];
  const workType = (character.work_details?.workplace_type || '').toLowerCase();
  const isUnemployed = unemployedKeywords.some(k => workType.includes(k));

  if (!isUnemployed) {
    // Check primary occupation location
    if (character.occupation_location_id) {
      const workLoc = allLocations.find(l => l.id === character.occupation_location_id);
      if (workLoc) {
        // Layer 1: shift
        const shift = getCharacterShift(character.id, workLoc);
        if (shift && isShiftDay(shift, currentDay) && isInWindow(currentMinutes, shift.start, shift.end)) {
          const jobTitle = workLoc.worker_job_titles?.[character.id] || character.work_details?.job_title || 'work';
          return { activity: `at work — ${jobTitle} at ${workLoc.name}`, type: 'work', isBusy: true };
        }
        // Layer 2: location open hours + character's own work schedule
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

    // Check additional occupation locations
    if (character.additional_occupation_locations?.length > 0) {
      for (const extra of character.additional_occupation_locations) {
        const extraLoc = allLocations.find(l => l.id === extra.location_id);
        if (extraLoc) {
          const shift = getCharacterShift(character.id, extraLoc);
          if (shift && isShiftDay(shift, currentDay) && isInWindow(currentMinutes, shift.start, shift.end)) {
            const jobTitle = extra.job_title || 'work';
            return { activity: `at work — ${jobTitle} at ${extraLoc.name}`, type: 'work', isBusy: true };
          }
        }
      }
    }

    // Fallback: character's own work schedule (no location linked)
    if (!character.occupation_location_id) {
      const workDays = character.work_days || [1, 2, 3, 4, 5];
      const workStart = character.work_start_time || '09:00';
      const workEnd = character.work_end_time || '17:00';
      if (workDays.includes(currentDay) && isInWindow(currentMinutes, workStart, workEnd)) {
        const jobTitle = character.work_details?.job_title || 'work';
        return { activity: `at work — ${jobTitle}`, type: 'work', isBusy: true };
      }
    }
  }

  // ── 4. SCHOOL / EDUCATION — same weight as work ───────────────────────────
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    // Layer 1: Education location hours
    if (character.education_location_id) {
      const eduLoc = allLocations.find(l => l.id === character.education_location_id);
      if (eduLoc) {
        const locActive = isLocationActiveNow(eduLoc, currentMinutes, currentDay);
        if (locActive === true) {
          const courseName = character.education_details?.course_name || character.current_education_activity;
          return { activity: `at school — ${courseName} at ${eduLoc.name}`, type: 'school', isBusy: true };
        }
        if (locActive === false) {
          // Explicitly closed — skip to next check
        } else if (currentHour >= 8 && currentHour < 21) {
          // No hours defined, fall back to time-of-day
          const courseName = character.education_details?.course_name || character.current_education_activity;
          return { activity: `at school — ${courseName} at ${eduLoc.name}`, type: 'school', isBusy: true };
        }
      }
    }

    // Additional education locations
    if (character.additional_education_locations?.length > 0) {
      for (const extra of character.additional_education_locations) {
        const extraLoc = allLocations.find(l => l.id === extra.location_id);
        if (extraLoc) {
          const locActive = isLocationActiveNow(extraLoc, currentMinutes, currentDay);
          if (locActive === true || (locActive === null && currentHour >= 8 && currentHour < 21)) {
            const programName = extra.program_name || character.current_education_activity;
            return { activity: `at school — ${programName} at ${extraLoc.name}`, type: 'school', isBusy: true };
          }
        }
      }
    }

    // Fallback: plausible class hours
    if (currentHour >= 8 && currentHour < 21) {
      const courseName = character.education_details?.course_name || character.current_education_activity;
      return { activity: `at class — ${courseName}`, type: 'school', isBusy: true };
    }
  }

  // ── 5. JOB TRAINING ───────────────────────────────────────────────────────
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
    if (currentHour >= 8 && currentHour < 19) {
      const trainingDetails = character.job_training_details || {};
      const trainingName = trainingDetails.training_name || character.current_job_training_activity;
      return { activity: `in training — ${trainingName}`, type: 'training', isBusy: false };
    }
  }

  // ── 6. RELIGIOUS ATTENDANCE — location-aware ───────────────────────────────
  if (character.religion && character.religion !== 'None' && character.belief_level !== 'in_name_only') {
    const religionLoc = allLocations.find(l => l.category === 'religion' && !l.is_default_generic);
    if (religionLoc) {
      const locActive = isLocationActiveNow(religionLoc, currentMinutes, currentDay);
      if (locActive === true && character.belief_level === 'devout') {
        return { activity: `at ${religionLoc.name}`, type: 'worship', isBusy: false };
      }
    } else {
      // No religion location linked, check time-of-day heuristics
      const isServiceTime =
        (character.religion === 'Christianity' && currentDay === 0 && currentHour >= 9 && currentHour < 13) ||
        (character.religion === 'Islam' && currentDay === 5 && currentHour >= 11 && currentHour < 14) ||
        (character.religion === 'Judaism' && currentDay === 6 && currentHour >= 9 && currentHour < 12);
      if (isServiceTime && character.belief_level === 'devout') {
        const placeLabels = { Christianity: 'church', Islam: 'mosque', Judaism: 'synagogue' };
        const place = placeLabels[character.religion] || 'worship';
        return { activity: `at ${place}`, type: 'worship', isBusy: false };
      }
    }
  }

  // ── 7. NON-MEDICAL SCHEDULED EVENTS ──────────────────────────────────────
  const scheduledEvent = pendingScheduledEvents.find(e => {
    if (e.character_ids?.includes(character.id) && e.status === 'pending') {
      const triggerMs = new Date(e.trigger_time).getTime();
      return triggerMs >= now - 2 * 3600000 && triggerMs <= now + 1 * 3600000;
    }
    return false;
  });
  if (scheduledEvent) {
    const desc = scheduledEvent.description || 'at an event';
    return { activity: desc.substring(0, 60), type: 'out', isBusy: false };
  }

  // ── 8. MORNING ROUTINE ────────────────────────────────────────────────────
  const wakeMinutes = toMinutes(wakeUp) || 420;
  if (currentMinutes >= wakeMinutes && currentMinutes < wakeMinutes + 90) {
    return { activity: 'morning routine', type: 'home', isBusy: false };
  }

  const frequentedPlaces = character.frequented_places || [];
  const isEvening = currentHour >= 17 && currentHour < 22;
  const isAfternoon = currentHour >= 12 && currentHour < 17;
  const isMorning = currentHour >= 9 && currentHour < 12;
  const isNight = currentHour >= 22;

  if (isNight) {
    // Late night: mostly home but socially active characters may still be out
    const isSocial = (character.social_value ?? 65) >= 75;
    const isNightOwl = character.trait_night_owl;
    if ((isSocial || isNightOwl) && Math.random() < 0.25) {
      return { activity: 'out late — bar or social venue', type: 'out', isBusy: false };
    }
    return { activity: 'at home, winding down', type: 'home', isBusy: false };
  }

  // ── 9. NEEDS-DRIVEN MOVEMENT ENGINE ──────────────────────────────────────
  // Build a movement score from needs + emotional state + personality
  // Higher score → more likely to leave home for a specific reason.

  const hunger       = character.hunger_value    ?? 70;
  const energy       = character.energy_value    ?? 75;
  const socialNeed   = character.social_value    ?? 65;
  const healthNeed   = character.health_value    ?? 80;
  const mental       = character.mental_value    ?? 70;
  const financial    = character.financial_need_value ?? 60;
  const hygiene      = character.hygiene_value   ?? 75;
  const comfort      = character.comfort_value   ?? 70;
  const emotion      = (character.emotional_state || 'calm').toLowerCase();

  // Personality signals
  const personalityText = [
    character.archetype || '',
    character.personality_summary || '',
    (character.personality_traits || []).join(' '),
  ].join(' ').toLowerCase();
  const isSocialPersonality  = personalityText.includes('extrovert') || personalityText.includes('social') || character.trait_flirty;
  const isAmbitious          = personalityText.includes('ambitious') || personalityText.includes('driven') || personalityText.includes('competitive');
  const isDisciplined        = personalityText.includes('disciplined') || personalityText.includes('structured') || personalityText.includes('organized');
  const isImageConscious     = personalityText.includes('image') || personalityText.includes('appearance') || personalityText.includes('style') || character.is_photogenic;
  const isUnemployedChar = ['unemployed', 'between jobs', 'crime'].some(k => (character.work_details?.workplace_type || '').toLowerCase().includes(k));

  // ── CANDIDATE OUTINGS: each has a need trigger, a label, and a weight ─────
  const candidates = [];

  // FOOD / HUNGER
  if (hunger < 40) {
    candidates.push({ weight: hunger < 20 ? 80 : 50, activity: 'getting food', label: 'out getting food', type: 'out' });
  }
  if (hunger < 55 && (isMorning || isAfternoon) && financial >= 40) {
    candidates.push({ weight: 30, activity: 'at a restaurant or café', label: 'out for a meal', type: 'out' });
  }
  if (hunger < 60 && Math.random() < 0.3) {
    candidates.push({ weight: 20, activity: 'picking up groceries', label: 'out getting groceries', type: 'out' });
  }

  // HEALTH
  if (healthNeed < 40) {
    candidates.push({ weight: 60, activity: 'at a clinic or pharmacy', label: 'out — health errand', type: 'out' });
  }

  // GYM / FITNESS — energy + personality driven
  if (energy >= 60 && (isMorning || isAfternoon)) {
    const gymDrive = isDisciplined || isImageConscious || personalityText.includes('gym') || personalityText.includes('fitness');
    if (gymDrive && Math.random() < 0.5) {
      candidates.push({ weight: 45, activity: 'at the gym', label: 'at the gym', type: 'out' });
    }
  }
  if (energy >= 50 && (isMorning || isAfternoon) && Math.random() < 0.3) {
    candidates.push({ weight: 25, activity: 'out for a walk or run', label: 'out for a walk', type: 'out' });
  }

  // SOCIAL NEED
  if (socialNeed < 45) {
    const socialLabel = isSocialPersonality ? 'out socializing' : 'visiting someone';
    candidates.push({ weight: socialNeed < 25 ? 70 : 45, activity: socialLabel, label: socialLabel, type: 'out' });
  }
  if (isSocialPersonality && isEvening && Math.random() < 0.5) {
    candidates.push({ weight: 40, activity: 'out for the evening', label: 'out for the evening', type: 'out' });
  }

  // EMOTION-DRIVEN MOVEMENT
  if (['lonely', 'loneliness'].includes(emotion) || socialNeed < 50) {
    candidates.push({ weight: 55, activity: 'visiting someone or going somewhere social', label: 'out — seeking company', type: 'out' });
  }
  if (['stressed', 'overwhelmed', 'anxious', 'frustrated'].includes(emotion)) {
    candidates.push({ weight: 50, activity: 'out clearing their head', label: 'out — needed air', type: 'out' });
  }
  if (['bored', 'restless'].includes(emotion) || (comfort < 40 && energy >= 55)) {
    candidates.push({ weight: 45, activity: 'out — needed to get out of the house', label: 'out — restless', type: 'out' });
  }
  if (['confident', 'excited', 'elation', 'happy', 'happiness'].includes(emotion) && isEvening) {
    candidates.push({ weight: 40, activity: 'out — feeling good, went out', label: 'out — feeling good', type: 'out' });
  }
  if (['sad', 'grief', 'disappointment'].includes(emotion)) {
    if (Math.random() < 0.4) {
      candidates.push({ weight: 35, activity: 'out — went somewhere familiar', label: 'out — comfort errand', type: 'out' });
    }
  }
  if (['angry', 'rage', 'resentment'].includes(emotion)) {
    candidates.push({ weight: 45, activity: 'out — needed to leave and cool off', label: 'out — cooling off', type: 'out' });
  }

  // ERRANDS / PRACTICAL
  if (isAfternoon && financial < 60 && Math.random() < 0.3) {
    // Unemployed characters may job-hunt, others may run errands
    if (isUnemployedChar) {
      candidates.push({ weight: 35, activity: 'out — job search or errand', label: 'out on errands', type: 'out' });
    } else {
      candidates.push({ weight: 25, activity: 'out running errands', label: 'out running errands', type: 'out' });
    }
  }
  if (isMorning && Math.random() < 0.3) {
    candidates.push({ weight: 25, activity: 'out running morning errands', label: 'out running errands', type: 'out' });
  }

  // AMBITIOUS / IMAGE-CONSCIOUS outings
  if (isAmbitious && isAfternoon && Math.random() < 0.4) {
    candidates.push({ weight: 30, activity: 'out — meetings or networking', label: 'out on business', type: 'out' });
  }
  if (isImageConscious && Math.random() < 0.35) {
    candidates.push({ weight: 30, activity: 'out — shopping or appearance errand', label: 'out shopping', type: 'out' });
  }

  // FREQUENTED PLACES — personality-weighted
  if (frequentedPlaces.length > 0) {
    const timeWeightedPlaces = frequentedPlaces.filter(p => {
      const pl = p.toLowerCase();
      if (isEvening) return true;
      if (isMorning) return pl.includes('gym') || pl.includes('park') || pl.includes('café') || pl.includes('coffee');
      if (isAfternoon) return !pl.includes('bar') && !pl.includes('club');
      return true;
    });
    if (timeWeightedPlaces.length > 0 && Math.random() < 0.4) {
      const place = timeWeightedPlaces[Math.floor(Math.random() * timeWeightedPlaces.length)];
      candidates.push({ weight: 35, activity: `at ${place.toLowerCase()}`, label: `at ${place.toLowerCase()}`, type: 'out' });
    }
  }

  // ── SELECT BEST CANDIDATE BY WEIGHTED RANDOM ─────────────────────────────
  if (candidates.length > 0) {
    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
    // Apply a home-stay bias: if total weight < threshold, stay home
    // This ensures characters don't always leave — only when the pull is real
    const HOME_STAY_THRESHOLD = 60;
    if (totalWeight >= HOME_STAY_THRESHOLD) {
      let rand = Math.random() * totalWeight;
      for (const candidate of candidates) {
        rand -= candidate.weight;
        if (rand <= 0) {
          return { activity: candidate.label, type: candidate.type, isBusy: false };
        }
      }
    }
  }

  // ── 10. HOME-STAY WITH REALISTIC REASON ───────────────────────────────────
  // If staying home, pick a specific home activity instead of vague "at home"
  const homeActivities = [];
  if (isMorning) homeActivities.push('at home — morning routine', 'at home — making breakfast', 'at home — getting ready');
  if (isAfternoon) homeActivities.push('at home — taking care of things', 'at home — relaxing', 'at home — doing chores');
  if (isEvening) homeActivities.push('at home — cooking dinner', 'at home — winding down', 'at home — watching something');
  if (energy < 45) homeActivities.push('at home — resting', 'at home — low energy day');
  if (mental < 45) homeActivities.push('at home — quiet day', 'at home — taking a mental break');
  if (homeActivities.length > 0) {
    const pick = homeActivities[Math.floor(Math.random() * homeActivities.length)];
    return { activity: pick, type: 'home', isBusy: false };
  }
  return { activity: 'at home', type: 'home', isBusy: false };
}

function shouldTriggerAutonomy(character) {
  if (character.status !== 'active') return false;
  const now = new Date();
  const lastMessage = character.life_last_updated ? new Date(character.life_last_updated) : null;
  if (lastMessage) {
    const hoursSince = (now - lastMessage) / (1000 * 60 * 60);
    return hoursSince > Math.random() * 4 + 2;
  }
  return Math.random() < 0.4;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      50
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

    // Fetch all locations once for this user — used for location-aware scheduling
    let allLocations = [];
    try {
      allLocations = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
    } catch (_) {}

    const updated = [];

    for (const character of characters) {
      if (!shouldTriggerAutonomy(character)) continue;

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

      await base44.asServiceRole.entities.Character.update(character.id, updates);
      updated.push({ id: character.id, name: character.name, activity: resolved });
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