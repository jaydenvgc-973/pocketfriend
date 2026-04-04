/**
 * Travel Override System
 * 
 * Manages user influence: pulling characters away from their schedules.
 * Tracks override state and return logic without breaking the schedule system.
 */

/**
 * When user attempts to travel with a busy/scheduled character,
 * create the override request object.
 */
export function createTravelOverrideRequest(character, destinationLocation, scheduleContext) {
  return {
    characterId: character.id,
    characterName: character.name,
    destinationLocationId: destinationLocation.id,
    destinationLocationName: destinationLocation.name,
    scheduledLocationId: scheduleContext?.locationId,
    scheduledLocationName: scheduleContext?.location,
    scheduleType: scheduleContext?.scheduleType,
    scheduleStatus: scheduleContext?.status,
    minutesUntilScheduleEnd: scheduleContext?.minutesUntilEnd,
    requestedAt: new Date().toISOString(),
    approved: false,
    response: null,
  };
}

/**
 * Character responds to travel request based on personality.
 * Returns { approved: boolean, response: string }
 */
export function generateTravelOverrideResponse(character, request, personalities = {}) {
  const responsibility = character.work_details?.job_title ? 'high' :
                        character.current_education_activity ? 'medium' : 'low';
  const social = character.social_energy || 'ambivert';
  const personality = character.personality_summary || 'friendly';

  // High responsibility — less likely to abandon shift
  if (responsibility === 'high') {
    const refusals = [
      `I can't just leave work. My boss will kill me.`,
      `I'm in the middle of my shift, I can't bail.`,
      `I wish I could, but I can't just abandon my post.`,
    ];
    const hesitant = [
      `I... okay, but I'll have to call in or something.`,
      `I really shouldn't, but... fine. Let me think about it.`,
      `This is risky, but if you really need me...`,
    ];
    
    const rand = Math.random();
    if (rand < 0.6) {
      return { approved: false, response: refusals[Math.floor(Math.random() * refusals.length)] };
    } else if (rand < 0.85) {
      return { approved: false, response: hesitant[Math.floor(Math.random() * hesitant.length)] };
    } else {
      return { approved: true, response: `Okay, let's go. I'll deal with work later.` };
    }
  }

  // Medium responsibility (school)
  if (responsibility === 'medium') {
    const refusals = [
      `I can't skip class, I'll get marked absent.`,
      `I need to be here for the lesson.`,
      `As much as I'd like to, I can't leave.`,
    ];
    const hesitant = [
      `Okay... I guess I can make it up later.`,
      `This better be worth it.`,
      `Alright, but just for a bit.`,
    ];
    
    const rand = Math.random();
    if (rand < 0.4) {
      return { approved: false, response: refusals[Math.floor(Math.random() * refusals.length)] };
    } else {
      return { approved: true, response: hesitant[Math.floor(Math.random() * hesitant.length)] };
    }
  }

  // Low responsibility or social pressure
  if (social === 'extrovert' || social === 'mostly_extrovert') {
    return { approved: true, response: `Yes! Let's go!` };
  }

  return { approved: true, response: `Sure, let's do it.` };
}

/**
 * Apply the travel override.
 * Stores in sessionStorage or character state.
 */
export function applyTravelOverride(characterId, destinationLocationId, scheduleContext) {
  const override = {
    characterId,
    destinationLocationId,
    currentLocationId: destinationLocationId, // where they actually are now
    scheduledLocationId: scheduleContext?.locationId,
    scheduleType: scheduleContext?.scheduleType,
    overrideStartedAt: new Date().toISOString(),
    minutesLeftInShift: scheduleContext?.minutesUntilEnd,
    overrideActive: true,
  };

  // Store in sessionStorage for quick access
  sessionStorage.setItem(`travelOverride_${characterId}`, JSON.stringify(override));
  
  return override;
}

/**
 * Retrieve active travel override for a character.
 */
export function getTravelOverride(characterId) {
  const stored = sessionStorage.getItem(`travelOverride_${characterId}`);
  return stored ? JSON.parse(stored) : null;
}

/**
 * Clear travel override (when trip ends or character returns to schedule).
 */
export function clearTravelOverride(characterId) {
  sessionStorage.removeItem(`travelOverride_${characterId}`);
}

/**
 * Check if override time has expired (can happen if shift ended during trip).
 */
export function isOverrideStillValid(override) {
  if (!override?.overrideActive) return false;
  
  const startedMs = new Date(override.overrideStartedAt).getTime();
  const elapsedMs = Date.now() - startedMs;
  const maxDurationMs = 2 * 60 * 60 * 1000; // 2 hours max for a trip
  
  return elapsedMs < maxDurationMs;
}

/**
 * When trip ends, determine next action for character.
 * Returns { action: 'return_to_schedule' | 'go_home' | 'stay_at_location' }
 */
export function determineTripEndAction(override, currentTime = new Date()) {
  if (!override?.overrideActive) {
    return { action: 'unknown', reason: 'no active override' };
  }

  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const shiftEndMinutes = override.minutesLeftInShift;

  // Is shift still active?
  if (currentMinutes < shiftEndMinutes) {
    return {
      action: 'return_to_schedule',
      reason: `${override.scheduleType} is still active`,
      destination: override.scheduledLocationId,
    };
  }

  // Shift is over
  return {
    action: 'go_home',
    reason: `${override.scheduleType} has ended`,
  };
}

/**
 * Generate dialogue for returning to schedule.
 */
export function generateReturnToScheduleDialogue(character, override) {
  const phrases = {
    work: [
      `I should get back to work.`,
      `I need to head back to my shift.`,
      `Come on, I'm already late as it is.`,
    ],
    school: [
      `I should get back to school.`,
      `I need to get back before I miss too much.`,
      `Come on, class isn't over yet.`,
    ],
  };

  const type = override.scheduleType || 'work';
  const pool = phrases[type] || phrases.work;
  
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Generate dialogue for going home after shift ends.
 */
export function generateGoingHomeDialogue(character) {
  const phrases = [
    `That was fun, but I'm exhausted.`,
    `Good timing—I'm done for the day.`,
    `I need to rest. Let's head home.`,
    `That was a good break. Now I can relax.`,
  ];

  return phrases[Math.floor(Math.random() * phrases.length)];
}