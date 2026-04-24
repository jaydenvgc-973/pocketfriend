/**
 * Real-time character availability calculation
 * Checks work schedules, time, state, and location hours
 */

export function calculateCharacterAvailability(character, allLocations, currentLocationIdBeingEdited = null) {
  if (!character) return { status: 'unavailable', jobs: [] };

  const now = new Date();
  const currentDay = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Extract all jobs: primary + additional
  const allJobs = [];

  // Primary job
  if (character.occupation_location_id) {
    const primaryLoc = allLocations.find(l => l.id === character.occupation_location_id);
    if (primaryLoc) {
      allJobs.push({
        location_id: character.occupation_location_id,
        location_name: character.occupation_location_name || primaryLoc.name,
        job_title: character.work_details?.job_title || null,
        shifts: character.work_details?.shifts || null, // fallback
      });
    }
  }

  // Additional jobs
  if (character.additional_occupation_locations && Array.isArray(character.additional_occupation_locations)) {
    character.additional_occupation_locations.forEach(addlLoc => {
      if (addlLoc?.location_id) {
        const locRef = allLocations.find(l => l.id === addlLoc.location_id);
        allJobs.push({
          location_id: addlLoc.location_id,
          location_name: addlLoc.location_name || locRef?.name || 'Unknown',
          job_title: addlLoc.job_title || null,
          shifts: locRef?.worker_shifts?.[character.id] || null,
        });
      }
    });
  }

  // Check if character is on shift right now
  let isOnShiftNow = false;
  let activeJob = null;

  for (const job of allJobs) {
    const locationShifts = allLocations.find(l => l.id === job.location_id)?.worker_shifts;
    const shift = locationShifts?.[character.id];

    if (shift && shift.start && shift.end && shift.days) {
      if (shift.days.includes(currentDay)) {
        const [startH, startM] = shift.start.split(':').map(Number);
        const [endH, endM] = shift.end.split(':').map(Number);

        const startTotalMins = startH * 60 + startM;
        const endTotalMins = endH * 60 + endM;
        const nowTotalMins = currentHour * 60 + currentMinute;

        if (nowTotalMins >= startTotalMins && nowTotalMins < endTotalMins) {
          isOnShiftNow = true;
          activeJob = job;
          break;
        }
      }
    }
  }

  // Determine status
  let status = 'available';

  if (character.is_jailed) {
    status = 'unavailable_jailed';
  } else if (isCharacterAsleep(character)) {
    status = 'unavailable_sleeping';
  } else if (isOnShiftNow) {
    status = 'at_work';
  } else if (allJobs.length === 0) {
    status = 'available';
  } else if (allJobs.length === 1) {
    status = 'available'; // has one job but not currently working
  } else if (allJobs.length >= 2) {
    status = 'between_shifts'; // has multiple jobs, currently between them
  }

  return {
    status,
    jobCount: allJobs.length,
    activeJob,
    allJobs,
    isOnShiftNow,
  };
}

export function isCharacterAsleep(character) {
  if (!character) return false;

  const now = new Date();
  const hour = now.getHours();

  const sleepStart = character.sleep_time ? parseInt(character.sleep_time.split(':')[0]) : 23;
  const wakeUp = character.wake_up_time ? parseInt(character.wake_up_time.split(':')[0]) : 7;

  if (sleepStart > wakeUp) {
    // Sleep crosses midnight
    return hour >= sleepStart || hour < wakeUp;
  } else {
    // Sleep doesn't cross midnight
    return hour >= sleepStart && hour < wakeUp;
  }
}

export function getAvailabilityLabel(availability) {
  const labelMap = {
    available: '✓ Available',
    at_work: '🕐 At Work',
    between_shifts: '⟳ Between Shifts',
    unavailable_sleeping: '😴 Sleeping',
    unavailable_jailed: '🔒 Jailed',
    unavailable: '✗ Unavailable',
  };
  return labelMap[availability.status] || 'Unknown';
}

export function formatShiftDisplay(shift) {
  if (!shift || !shift.start || !shift.end) return null;
  const days = shift.days?.map(d => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d]).join('/') || '';
  return `${shift.start}–${shift.end} ${days}`.trim();
}