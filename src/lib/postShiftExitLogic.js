/**
 * Post-Shift Exit Logic for Active Created Characters
 * Evaluates whether a character should leave their work location
 * based on job type, emotional state, needs, family role, and location type.
 */

// Job categories by emotional drainage
const JOB_DRAIN_LEVELS = {
  HIGH_DRAIN: ['hospital', 'clinic', 'medical', 'emergency', 'therapy', 'counseling'],
  MEDIUM_DRAIN: ['office', 'school', 'government', 'law', 'police', 'court'],
  LOW_DRAIN: ['retail', 'restaurant', 'bar', 'café', 'lounge', 'club', 'gym', 'salon'],
  VARIABLE_DRAIN: ['creative', 'tech', 'finance', 'manufacturing'],
};

const LOCATION_TYPES = {
  HIGH_DRAIN: ['hospital', 'clinic', 'school', 'office', 'government'],
  SOCIAL_LEISURE: ['bar', 'club', 'café', 'restaurant', 'lounge'],
  MIXED: ['gym', 'retail', 'community_center'],
  HOME: ['home', 'residence', 'apartment'],
};

/**
 * Determine job drain level
 */
export function getJobDrainLevel(character) {
  const jobTitle = character.work_details?.job_title || character.occupation || '';
  const workplaceType = character.work_details?.workplace_type || '';
  const combined = `${jobTitle} ${workplaceType}`.toLowerCase();

  for (const job of JOB_DRAIN_LEVELS.HIGH_DRAIN) {
    if (combined.includes(job)) return 'high';
  }
  for (const job of JOB_DRAIN_LEVELS.MEDIUM_DRAIN) {
    if (combined.includes(job)) return 'medium';
  }
  for (const job of JOB_DRAIN_LEVELS.LOW_DRAIN) {
    if (combined.includes(job)) return 'low';
  }
  return 'medium'; // default
}

/**
 * Determine location type
 */
export function getLocationDrainType(location) {
  if (!location) return 'unknown';
  const name = (location.name || '').toLowerCase();
  const category = (location.category || '').toLowerCase();
  const combined = `${name} ${category}`;

  for (const type of LOCATION_TYPES.HIGH_DRAIN) {
    if (combined.includes(type)) return 'high_drain';
  }
  for (const type of LOCATION_TYPES.SOCIAL_LEISURE) {
    if (combined.includes(type)) return 'social_leisure';
  }
  for (const type of LOCATION_TYPES.MIXED) {
    if (combined.includes(type)) return 'mixed';
  }
  for (const type of LOCATION_TYPES.HOME) {
    if (combined.includes(type)) return 'home';
  }
  return 'unknown';
}

/**
 * Calculate post-shift exit score (0-100)
 * Higher = more likely to leave
 */
export function calculateExitScore(character, currentLocation, hoursAtLocation = 0) {
  let score = 50; // baseline

  // Energy and mental state (major factors)
  const energy = character.energy_value || 75;
  const mental = character.mental_value || 75;
  const comfort = character.comfort_value || 75;

  if (energy < 40) score += 20;
  if (energy < 60) score += 10;
  if (mental < 40) score += 20;
  if (mental < 60) score += 10;
  if (comfort < 40) score += 15;

  // Job drain level
  const drainLevel = getJobDrainLevel(character);
  if (drainLevel === 'high') score += 25;
  if (drainLevel === 'medium') score += 15;

  // Location type
  const locationType = getLocationDrainType(currentLocation);
  if (locationType === 'high_drain') score += 20;
  if (locationType === 'social_leisure') score -= 10; // more likely to stay
  if (locationType === 'mixed') score += 5;

  // Family role (pull toward home)
  const familyMembers = character.family_members || [];
  const hasKids = familyMembers.some(f => ['daughter', 'son'].includes(f.relationship_type));
  if (hasKids) score += 15;

  // Overstimulation (social need)
  const socialNeed = character.social_value || 65;
  if (socialNeed < 50) score += 10; // needs alone time

  // Workaholism personality (some characters stay longer)
  const traits = character.personality_traits || [];
  const isWorkaholism = traits.some(t => t.toLowerCase().includes('ambitious') || t.toLowerCase().includes('driven'));
  if (isWorkaholism) score -= 10; // less likely to leave immediately

  // Location fatigue (time spent there)
  if (hoursAtLocation > 8) score += 10;
  if (hoursAtLocation > 10) score += 15;
  if (hoursAtLocation > 12) score += 20;

  // Hygiene and other needs
  const hygiene = character.hygiene_value || 75;
  const hunger = character.hunger_value || 75;
  if (hygiene < 50) score += 10; // want to shower at home
  if (hunger > 80) score -= 5; // might grab food instead

  return Math.max(0, Math.min(100, score));
}

/**
 * Determine post-shift action
 * Returns: 'go_home', 'stay_briefly', 'stay_longer', 'go_out'
 */
export function determinePostShiftAction(character, currentLocation, hoursAtLocation = 0) {
  const exitScore = calculateExitScore(character, currentLocation, hoursAtLocation);
  const locationType = getLocationDrainType(currentLocation);

  // High drain locations: strong default to leave
  if (locationType === 'high_drain' && exitScore > 45) {
    return 'go_home';
  }

  // Social leisure: may stay, but not always
  if (locationType === 'social_leisure') {
    if (exitScore > 70) return 'stay_longer';
    if (exitScore > 50) return 'stay_briefly';
    return 'go_out'; // do something else
  }

  // Default thresholds
  if (exitScore > 75) return 'go_home';
  if (exitScore > 60) return 'stay_briefly';
  if (exitScore > 40) return 'stay_longer';
  return 'go_out';
}

/**
 * Generate reason for post-shift decision
 */
export function generateExitReason(character, action, location) {
  const mental = character.mental_value || 75;
  const energy = character.energy_value || 75;

  const reasons = {
    go_home: [
      'need to decompress',
      'mentally drained',
      'want to rest',
      'family is waiting',
      'long shift today',
      'need a break',
      'just want to be home',
    ],
    stay_briefly: [
      'wrapping up some things',
      'talking with coworkers',
      'finishing a task',
      'waiting for someone',
      'taking a few minutes',
    ],
    stay_longer: [
      'enjoying the vibe here',
      'coworkers are cool',
      'not ready to leave yet',
      'might as well stay',
      'habit',
    ],
    go_out: [
      'want to grab food',
      'need to stop somewhere',
      'going out instead',
      'change of scenery',
      'running errands',
    ],
  };

  const actionReasons = reasons[action] || reasons.go_home;
  return actionReasons[Math.floor(Math.random() * actionReasons.length)];
}

/**
 * Should evaluate exit periodically (every 30+ mins)
 */
export function shouldEvaluateExit(lastEvaluatedAt) {
  if (!lastEvaluatedAt) return true;
  const minutesAgo = (Date.now() - new Date(lastEvaluatedAt).getTime()) / (1000 * 60);
  return minutesAgo > 30;
}

/**
 * Check if a character is invalidly asleep at work
 * Returns true if sleeping at work with no valid justification
 */
export function isAsleepAtWorkInvalid(character, currentLocationId) {
  const workLocId = character.current_work_location_id || character.occupation_location_id;
  if (!workLocId || currentLocationId !== workLocId) return false;

  const isSleeping = character.resolved_presence_status === 'sleeping'
    || character.resolved_presence_status === 'napping';
  if (!isSleeping) return false;

  // Valid reasons to be asleep at work
  const activity = (character.current_activity || '').toLowerCase();
  const validReasons = ['overnight_shift', 'on_call', 'emergency', 'user_directed'];
  return !validReasons.some(r => activity.includes(r));
}

/**
 * Determine the correct post-shift destination and status.
 * Low energy strongly prioritizes going home to sleep.
 */
export function resolvePostShiftDestination(character) {
  const energy = character.energy_value ?? 75;
  const homeLocId = character.current_home_location_id;

  // Low/critical energy → go home to sleep
  if (energy < 40 && homeLocId) {
    return {
      locationId: homeLocId,
      presenceStatus: 'sleeping',
      locationType: 'home',
      reason: 'POST_SHIFT_HOME_SLEEP — low energy after shift',
    };
  }

  // Default → go home
  if (homeLocId) {
    return {
      locationId: homeLocId,
      presenceStatus: 'home',
      locationType: 'home',
      reason: 'POST_SHIFT_HOME — shift ended, returning home',
    };
  }

  return null; // No home assigned — can't relocate
}