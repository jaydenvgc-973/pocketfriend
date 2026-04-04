/**
 * Schedule Awareness System
 * 
 * Bridges character schedules with real-time location, travel, and user interaction.
 * Ensures characters know their obligations, characters display correct locations,
 * and user influence (travel override) doesn't break the schedule system.
 */

import {
  isCharacterAtWork,
  isCharacterAtSchool,
  getCharacterShiftAtLocation,
  isCharacterOnShift,
} from './workScheduleUtils';

function getLocalMinutes() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

function getLocalDay() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getDay();
}

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

/**
 * Get character's current schedule context.
 * Returns info about what they should be doing, where, and when.
 */
export function getCharacterScheduleContext(character, workLocation = null) {
  if (!character) return null;

  const currentMinutes = getLocalMinutes();
  const currentDay = getLocalDay();
  const result = {
    hasSchedule: false,
    scheduleType: null, // 'work', 'school', 'none'
    status: null, // 'at_location', 'commuting', 'getting_ready', 'off_schedule'
    startTime: null,
    endTime: null,
    minutesUntilStart: null,
    minutesUntilEnd: null,
    isLate: false,
    location: null,
    locationId: null,
    mustReturn: false, // if user pulls them away, must return
  };

  // Check work schedule
  const workStart = toMinutes(character.work_start_time || '09:00');
  const workEnd = toMinutes(character.work_end_time || '17:00');
  const workDays = character.work_days || [1, 2, 3, 4, 5];
  
  if (character.work_details?.job_title && workDays.includes(currentDay)) {
    result.hasSchedule = true;
    result.scheduleType = 'work';
    result.startTime = workStart;
    result.endTime = workEnd;
    result.locationId = character.occupation_location_id;
    result.location = workLocation?.name || 'work';

    if (currentMinutes < workStart - 30) {
      result.status = 'off_schedule';
      result.minutesUntilStart = workStart - currentMinutes;
    } else if (currentMinutes < workStart) {
      result.status = 'getting_ready';
      result.minutesUntilStart = workStart - currentMinutes;
    } else if (currentMinutes < workEnd) {
      result.status = 'at_location';
      result.minutesUntilEnd = workEnd - currentMinutes;
      result.mustReturn = true;
    } else {
      result.status = 'off_schedule';
    }

    return result;
  }

  // Check school schedule
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    const schoolStart = toMinutes('08:00');
    const schoolEnd = toMinutes('15:00');
    
    result.hasSchedule = true;
    result.scheduleType = 'school';
    result.startTime = schoolStart;
    result.endTime = schoolEnd;
    result.locationId = character.education_location_id;
    result.location = 'school';

    if (currentMinutes < schoolStart - 30) {
      result.status = 'off_schedule';
      result.minutesUntilStart = schoolStart - currentMinutes;
    } else if (currentMinutes < schoolStart) {
      result.status = 'getting_ready';
      result.minutesUntilStart = schoolStart - currentMinutes;
    } else if (currentMinutes < schoolEnd) {
      result.status = 'at_location';
      result.minutesUntilEnd = schoolEnd - currentMinutes;
      result.mustReturn = true;
    } else {
      result.status = 'off_schedule';
    }

    return result;
  }

  result.status = 'off_schedule';
  return result;
}

/**
 * Generate schedule-aware dialogue for a character.
 * Used in chat/dialogue to have them reference their obligations naturally.
 */
export function generateScheduleAwarenessDialogue(character, scheduleContext) {
  if (!scheduleContext?.hasSchedule) return null;

  const phrases = {
    work: {
      at_location: [
        `I'm in the middle of my shift right now.`,
        `I should be working...`,
        `I'm supposed to be at work.`,
      ],
      getting_ready: [
        `I need to get ready for work. My shift starts soon.`,
        `I'm about to head to work.`,
        `My shift starts in a few minutes.`,
      ],
      off_schedule: [
        `I just got off work.`,
        `My shift is over.`,
        `I'm done with work for the day.`,
      ],
    },
    school: {
      at_location: [
        `I'm in the middle of class.`,
        `I'm at school right now.`,
        `I can't leave—I'm still in session.`,
      ],
      getting_ready: [
        `I need to get to school soon.`,
        `My classes start soon.`,
        `I should be heading out to school.`,
      ],
      off_schedule: [
        `School's out for the day.`,
        `I'm done with classes.`,
        `Just got out of school.`,
      ],
    },
  };

  const type = scheduleContext.scheduleType;
  const status = scheduleContext.status;
  const pool = phrases[type]?.[status] || [];
  
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/**
 * Determines if a character should stay at their scheduled location
 * or if they can be pulled away by the user.
 * 
 * Returns { canLeave, reason }
 */
export function canCharacterLeaveSchedule(character, scheduleContext) {
  if (!scheduleContext?.hasSchedule) {
    return { canLeave: true, reason: 'no scheduled obligation' };
  }

  if (scheduleContext.status === 'off_schedule') {
    return { canLeave: true, reason: 'schedule is over' };
  }

  // During an active shift/class, they CAN leave but should be convinced
  return {
    canLeave: true, // User can influence
    reason: `they're in the middle of ${scheduleContext.scheduleType}`,
  };
}

/**
 * When user pulls character away from schedule,
 * track the travel override state.
 * 
 * Returns override context for later return.
 */
export function createTravelOverride(character, scheduleContext) {
  if (!scheduleContext?.hasSchedule || scheduleContext.status === 'off_schedule') {
    return null;
  }

  return {
    characterId: character.id,
    scheduledLocation: scheduleContext.location,
    scheduledLocationId: scheduleContext.locationId,
    scheduleType: scheduleContext.scheduleType,
    shiftEndTime: scheduleContext.endTime,
    minutesRemainingWhenLeft: scheduleContext.minutesUntilEnd,
    leftAtTime: new Date().toISOString(),
    overrideActive: true,
  };
}

/**
 * After travel, determine where character should return.
 * 
 * If shift/class is still active: return to scheduled location
 * If shift/class is over: return home
 */
export function determinePostTravelDestination(character, travelOverride, allLocations = []) {
  if (!travelOverride?.overrideActive) {
    return null; // No override was active
  }

  const currentMinutes = getLocalMinutes();
  const shiftEndMinutes = travelOverride.shiftEndTime;

  // Is the shift still active?
  if (currentMinutes < shiftEndMinutes) {
    return {
      destination: 'scheduled_location',
      locationId: travelOverride.scheduledLocationId,
      locationName: travelOverride.scheduledLocation,
      reason: `${travelOverride.scheduleType} shift is still active`,
    };
  }

  // Shift is over, go home
  const homeLocation = allLocations.find(l =>
    l.resident_character_ids?.includes(character.id) && l.category === 'home'
  );

  return {
    destination: 'home',
    locationId: homeLocation?.id,
    locationName: homeLocation?.name || 'home',
    reason: `${travelOverride.scheduleType} is over`,
  };
}

/**
 * Create a memory of the schedule interruption.
 * Records that the character left their obligation.
 */
export function createScheduleInterruptionMemory(character, travelOverride) {
  if (!travelOverride) return null;

  const minutesMissed = travelOverride.minutesRemainingWhenLeft || 0;
  const hoursMissed = Math.round(minutesMissed / 60);

  return {
    character_id: character.id,
    memory_type: 'event',
    memory_text: `Left ${travelOverride.scheduleType} early to go with the user (missed ${hoursMissed} hours)`,
    memory_summary: `Skipped part of ${travelOverride.scheduleType}`,
    importance_score: 6,
    confidence_score: 1.0,
    permanence: 'long_term',
  };
}

/**
 * Generate realistic dialogue when character realizes they left their obligation.
 */
export function generateScheduleConsequenceDialogue(character, travelOverride) {
  if (!travelOverride) return null;

  const responsibility = character.work_details?.job_title ? 'high' :
                        character.current_education_activity ? 'medium' : 'low';
  
  const phrases = {
    high: [
      `I shouldn't have left work like that. My boss is gonna be mad.`,
      `I'm gonna hear about this tomorrow.`,
      `That was risky leaving my shift.`,
    ],
    medium: [
      `I hope I don't get in trouble for skipping class.`,
      `I can't keep doing this or I'll fall behind.`,
      `That was probably not the best idea.`,
    ],
  };

  const pool = phrases[responsibility] || [];
  return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
}

/**
 * Real-time sync check: ensure character card reflects actual schedule status.
 * Called whenever time advances or page updates.
 */
export function syncScheduleToLocation(character, scheduleContext, currentLocation) {
  if (!scheduleContext?.hasSchedule) {
    return { synced: true, message: null };
  }

  const atScheduledLocation = currentLocation?.id === scheduleContext.locationId;

  if (scheduleContext.status === 'at_location' && !atScheduledLocation) {
    return {
      synced: false,
      message: `${character.name} should be at ${scheduleContext.location} but isn't`,
      expectedLocation: scheduleContext.location,
    };
  }

  return { synced: true, message: null };
}