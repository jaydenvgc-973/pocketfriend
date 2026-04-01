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

  // ── 9. PROBABILISTIC LOCATION based on frequented places + time ──────────
  const frequentedPlaces = character.frequented_places || [];
  const isEvening = currentHour >= 17 && currentHour < 22;
  const isAfternoon = currentHour >= 12 && currentHour < 17;
  const isMorning = currentHour >= 9 && currentHour < 12;
  const isNight = currentHour >= 22;

  if (isNight) {
    return { activity: 'at home, winding down', type: 'home', isBusy: false };
  }

  if (frequentedPlaces.length > 0 && Math.random() < 0.45) {
    const timeWeightedPlaces = frequentedPlaces.filter(p => {
      const pl = p.toLowerCase();
      if (isEvening) return true;
      if (isMorning) return pl.includes('coffee') || pl.includes('gym') || pl.includes('park');
      if (isAfternoon) return !pl.includes('bar') && !pl.includes('club');
      return true;
    });
    if (timeWeightedPlaces.length > 0) {
      const place = timeWeightedPlaces[Math.floor(Math.random() * timeWeightedPlaces.length)];
      return { activity: `at ${place.toLowerCase()}`, type: 'out', isBusy: false };
    }
  }

  // ── 10. DEFAULT ───────────────────────────────────────────────────────────
  if (isEvening && Math.random() < 0.35) {
    return { activity: 'out for the evening', type: 'out', isBusy: false };
  }
  if (isMorning && Math.random() < 0.3) {
    return { activity: 'out running errands', type: 'out', isBusy: false };
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