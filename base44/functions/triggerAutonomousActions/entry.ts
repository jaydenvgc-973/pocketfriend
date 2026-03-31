/**
 * triggerAutonomousActions
 *
 * Schedule-aware autonomous activity updater.
 * Uses actual character schedule data (sleep, work, education, training,
 * upcoming ScheduledEvents, frequented places) to set current_activity
 * accurately instead of naive time-of-day guessing.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// Parse "HH:MM" string into total minutes since midnight
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function isInWindow(currentMinutes, startStr, endStr) {
  const start = toMinutes(startStr);
  const end = toMinutes(endStr);
  if (start == null || end == null) return false;
  if (start <= end) return currentMinutes >= start && currentMinutes < end;
  // Crosses midnight (e.g. sleep 23:00 -> 07:00)
  return currentMinutes >= start || currentMinutes < end;
}

function getCurrentDayIndex() {
  const now = new Date();
  // Use Eastern time to match the rest of the app
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etNow.getDay(); // 0=Sun
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

/**
 * Determine what a character is actually doing right now
 * based on their schedule data, not just random time-of-day guessing.
 */
function resolveCurrentActivity(character, pendingScheduledEvents) {
  const currentMinutes = getCurrentMinutesET();
  const currentDay = getCurrentDayIndex();
  const currentHour = getCurrentHourET();

  // 1. SLEEPING — check sleep window
  const sleepStart = character.sleep_start_time || '23:00';
  const wakeUp = character.wake_up_time || '07:00';
  if (isInWindow(currentMinutes, sleepStart, wakeUp)) {
    return { activity: 'sleeping', type: 'sleep', isBusy: true };
  }

  // 2. HOSPITAL / MEDICAL — check for upcoming scheduled medical events in next 2h or currently active
  const now = Date.now();
  const medicalEvent = pendingScheduledEvents.find(e => {
    if (e.character_ids?.includes(character.id) && e.status === 'pending') {
      const triggerMs = new Date(e.trigger_time).getTime();
      const desc = (e.description || '').toLowerCase();
      const isMedical = desc.includes('hospital') || desc.includes('surgery') || desc.includes('doctor') || desc.includes('appointment') || desc.includes('clinic') || desc.includes('procedure');
      // Active window: within 2 hours before or 4 hours after trigger
      return isMedical && triggerMs >= now - 4 * 3600000 && triggerMs <= now + 2 * 3600000;
    }
    return false;
  });
  if (medicalEvent) {
    const desc = medicalEvent.description?.toLowerCase() || '';
    if (desc.includes('surgery') || desc.includes('hospital')) {
      return { activity: 'at hospital', type: 'hospital', isBusy: true };
    }
    return { activity: 'at doctor appointment', type: 'hospital', isBusy: true };
  }

  // 3. WORK — check work schedule
  const workDays = character.work_days || [1, 2, 3, 4, 5];
  const workStart = character.work_start_time || '09:00';
  const workEnd = character.work_end_time || '17:00';
  if (workDays.includes(currentDay) && isInWindow(currentMinutes, workStart, workEnd)) {
    const jobTitle = character.work_details?.job_title || 'work';
    const workplace = character.work_details?.workplace_type || '';
    // Unemployed / no job — don't show at work
    const unemployedKeywords = ['unemployed', 'between jobs', 'student', 'crime'];
    const isUnemployed = unemployedKeywords.some(k => workplace.toLowerCase().includes(k));
    if (!isUnemployed) {
      return { activity: `at work — ${jobTitle}`, type: 'work', isBusy: true };
    }
  }

  // 4. EDUCATION — check if currently in active education
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    const eduDetails = character.education_details || {};
    // Only show during plausible class hours (8am-9pm)
    if (currentHour >= 8 && currentHour < 21) {
      const courseName = eduDetails.course_name || character.current_education_activity;
      return { activity: `at class — ${courseName}`, type: 'school', isBusy: true };
    }
  }

  // 5. JOB TRAINING — check active job training
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
    if (currentHour >= 8 && currentHour < 19) {
      const trainingDetails = character.job_training_details || {};
      const trainingName = trainingDetails.training_name || character.current_job_training_activity;
      return { activity: `in training — ${trainingName}`, type: 'training', isBusy: false };
    }
  }

  // 6. NON-MEDICAL SCHEDULED EVENTS — appointments, events
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

  // 7. MORNING ROUTINE (wake up → 1.5h after wake up)
  const wakeMinutes = toMinutes(wakeUp) || 420;
  if (currentMinutes >= wakeMinutes && currentMinutes < wakeMinutes + 90) {
    return { activity: 'morning routine', type: 'home', isBusy: false };
  }

  // 8. PROBABILISTIC LOCATION based on frequented places + time of day
  const frequentedPlaces = character.frequented_places || [];
  const isEvening = currentHour >= 17 && currentHour < 22;
  const isAfternoon = currentHour >= 12 && currentHour < 17;
  const isMorning = currentHour >= 9 && currentHour < 12;
  const isNight = currentHour >= 22;

  // Weight locations by time of day
  if (isNight) {
    return { activity: 'at home, winding down', type: 'home', isBusy: false };
  }

  // Try to pick from their frequented places weighted by time
  if (frequentedPlaces.length > 0 && Math.random() < 0.45) {
    const timeWeightedPlaces = frequentedPlaces.filter(p => {
      const pl = p.toLowerCase();
      if (isEvening) return true; // all places ok in the evening
      if (isMorning) return pl.includes('coffee') || pl.includes('gym') || pl.includes('park');
      if (isAfternoon) return !pl.includes('bar') && !pl.includes('club');
      return true;
    });
    if (timeWeightedPlaces.length > 0) {
      const place = timeWeightedPlaces[Math.floor(Math.random() * timeWeightedPlaces.length)];
      return { activity: `at ${place.toLowerCase()}`, type: 'out', isBusy: false };
    }
  }

  // 9. DEFAULT — home or out based on time
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
    return hoursSince > Math.random() * 4 + 2; // 2-6 hours
  }
  return Math.random() < 0.4;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      50
    );

    // Fetch pending scheduled events for this user's characters once (batch, not per-character)
    const now = new Date();
    const windowStart = new Date(now.getTime() - 4 * 3600000).toISOString();
    const windowEnd = new Date(now.getTime() + 2 * 3600000).toISOString();

    let pendingScheduledEvents = [];
    try {
      const allPending = await base44.asServiceRole.entities.ScheduledEvent.filter({ status: 'pending' }, '-trigger_time', 100);
      // Filter to relevant window
      pendingScheduledEvents = allPending.filter(e => {
        const t = e.trigger_time;
        return t >= windowStart && t <= windowEnd;
      });
    } catch (_) {}

    const updated = [];

    for (const character of characters) {
      if (!shouldTriggerAutonomy(character)) continue;

      const resolved = resolveCurrentActivity(character, pendingScheduledEvents);

      const updates = {
        current_activity: resolved.activity,
        life_last_updated: now.toISOString(),
      };

      // Update current_situation only for location-type activities
      if (resolved.type === 'out') {
        updates.current_situation = `Out — ${resolved.activity}`;
      } else if (resolved.type === 'home') {
        updates.current_situation = `Home — ${resolved.activity}`;
      }
      // Don't overwrite current_situation for work/school/sleep — those are handled by the status display

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