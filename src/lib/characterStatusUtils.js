// characterStatusUtils.js
import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork, isCharacterAtSchool, isCharacterAtReligiousLocation, isCharacterAtGym } from './workScheduleUtils';
import { isCharacterInPrayer } from './religionUtils';

/**
 * Determines what status/location to display on a character card.
 *
 * Priority (highest to lowest):
 *   1. Sleeping
 *   2. Prayer (blocking)
 *   3. Explicit current_location_id (real-time authoritative location tracking)
 *   4. Patient / hospital
 *   5. At Work (location-aware)
 *   6. At School / In Class (same weight as work)
 *   7. In Job Training
 *   8. At Religious Location (service attendance)
 *   9. Activity-string inference (fallback)
 *   10. Default
 *
 * Accepts optional `locationData` = { workLocation, educationLocation, religionLocation, gymLocation, currentLocation }
 * These are LocationReference records — pass them in from the character card if available.
 *
 * Returns: { iconType: string, label: string, color: string }
 */
export function getCharacterStatusDisplay(character, locationData = {}) {
  if (!character) return null;

  const {
    workLocation = null,
    educationLocation = null,
    religionLocation = null,
    gymLocation = null,
    currentLocation = null,
  } = locationData;

  // 1. SLEEPING — always top priority (unless decided to stay up)
  if (isCharacterAsleep(character)) {
    // But if they decided to stay up, show their location instead
    if (character?.decided_to_stay_up_until) {
      const stayUpUntil = new Date(character.decided_to_stay_up_until);
      if (new Date() < stayUpUntil) {
        // Still in "decided to stay up" window — show home location if available
        return { iconType: 'home', label: `at ${character.current_home_location_id ? 'home' : 'home'}`, color: 'text-pink-400' };
      }
    }
    return { iconType: 'sleep', label: 'sleeping', color: 'text-blue-300' };
  }

  // 2. PRAYER — devout characters in a blocking prayer window
  const prayer = isCharacterInPrayer(character);
  if (prayer.active && prayer.blocks_response) {
    return { iconType: 'prayer', label: 'praying', color: 'text-violet-300' };
  }

  // 3. EXPLICIT CURRENT LOCATION — real-time authoritative location tracking (like Sims 4)
  // THIS IS HIGHEST PRIORITY after sleep/prayer — overrides ALL activity inference
  // CRITICAL: NAMED LOCATION RULE — Always use location.name, NEVER collapse to category type
  if (character?.current_location_id && currentLocation) {
    const catIconMap = {
      home: { icon: 'home', color: 'text-pink-400' },
      work: { icon: 'work', color: 'text-blue-400' },
      school: { icon: 'school', color: 'text-amber-400' },
      gym: { icon: 'gym', color: 'text-emerald-400' },
      food_drink: { icon: 'out', color: 'text-orange-400' },
      social: { icon: 'bar', color: 'text-pink-400' },
      medical: { icon: 'hospital', color: 'text-red-400' },
      outdoor: { icon: 'out', color: 'text-emerald-400' },
    };
    const result = catIconMap[currentLocation.category];
    
    // CRITICAL: Use location.name (e.g., "VGC Gym"), never collapse to type (e.g., "gym")
    const displayName = currentLocation.name || 'Unknown Location';
    const iconType = result?.icon || 'out';
    const color = result?.color || 'text-blue-400';
    
    return { iconType, label: `at ${displayName}`, color };
  }

  // 4. HOME LOCATION (if no explicit current location)
  // If current_location_id is not set, but current_home_location_id is, use the home location name
  // This ensures world-specific location names (e.g., "VGC Gym") are shown, not generic labels
  if (!character?.current_location_id && character?.current_home_location_id && locationData?.homeLocation) {
    const homeLoc = locationData.homeLocation;
    return { iconType: 'home', label: `at ${homeLoc.name}`, color: 'text-pink-400' };
  }

  // 4. AT WORK FIRST (higher priority than patient status)
  // Check work status BEFORE patient status, because a character can work at a hospital
  const activity = character.current_activity?.toLowerCase().trim() || '';
  const unemployedKeywords = ['unemployed', 'between jobs'];
  const workType = (character?.work_details?.workplace_type || '').toLowerCase();
  const isUnemployed = unemployedKeywords.some(k => workType.includes(k));

  if (!isUnemployed && isCharacterAtWork(character, workLocation)) {
    // Shift schedule is authoritative — if they're on shift, they're working
    // Activity keywords don't override verified shift status
    const locationName = workLocation?.name;
    // CRITICAL RULE: NEVER use 'at work' as fallback — must use actual workplace name
    // If no location object, this character's current_location_id should already be set to workplace
    if (locationName) {
      return { iconType: 'work', label: `at ${locationName}`, color: 'text-blue-400' };
    }
    // If we reach here, work location data is missing — this is a data integrity error
    // Return early to prevent generic fallback
  }

  // 5. PATIENT / SICK (only if NOT at work)
  // Do NOT show hospital icon if they work there
  // STRICT: Only show hospital if health_status explicitly says 'sick' or 'patient', NOT activity text
  const isPatient =
    (character.health_status?.toLowerCase().includes('sick') && !character.health_status?.toLowerCase().includes('hospital worker')) ||
    (character.health_status?.toLowerCase().includes('patient') && !character.health_status?.toLowerCase().includes('hospital worker'));

  if (isPatient) {
    return { iconType: 'hospital', label: 'at hospital', color: 'text-red-400' };
  }

  // 6. AT SCHOOL / IN CLASS — same weight as work
  const schoolResult = isCharacterAtSchool(character, educationLocation);
  if (schoolResult.attending) {
    const eduLocationName = educationLocation?.name;
    // CRITICAL RULE: NEVER use 'in class' as fallback — must use actual school name
    if (eduLocationName) {
      return { iconType: 'school', label: `at ${eduLocationName}`, color: 'text-amber-400' };
    }
    // If we reach here, education location data is missing — this is a data integrity error
  }

  // 8. IN JOB TRAINING
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
    return { iconType: 'work', label: 'in training', color: 'text-amber-400' };
  }

  // 9. PRAYING / WORSHIP ACTIVITY (regardless of location)
  // "Worship" and "praying" are ACTIVITIES, not locations
  // Show prayer icon when actively praying/worshipping, even at home
  if (prayer.active && !prayer.blocks_response) {
    return { iconType: 'prayer', label: 'praying', color: 'text-violet-300' };
  }

  // ONLY show "at worship" if actually AT a religious location (service attendance)
  const religiousResult = isCharacterAtReligiousLocation(character, religionLocation);
  if (religiousResult.attending) {
    const label = religiousResult.label || 'at worship';
    return { iconType: 'prayer', label, color: 'text-violet-300' };
  }

  // 10. AT HOME — activity keyword fallback (only if explicit location not set)
  // If character is in bed, sleeping in, sprawled out, etc. they're clearly at home
  const homeKeywords = ['bed', 'bedroom', 'in bed', 'laying', 'sprawled', 'asleep', 'waking', 'morning routine', 'home', 'house', 'apartment'];
  const isHomeActivity = homeKeywords.some(k => activity.includes(k));
  if (isHomeActivity) {
    return { iconType: 'home', label: 'at home', color: 'text-pink-400' };
  }

  // 11. ACTIVITY FALLBACK — ONLY for display hints, NEVER use as location truth
  // CRITICAL: current_location_id must always be set by enforceLocationCoherence backend
  // This section is purely informational and must NOT override explicit location state
  // REMOVED: All generic activity-based labels (at gym, at work, in class, at bar, etc.)
  // These were causing collapse-to-generic-category failures
  if (activity && !character?.current_location_id) {
    // If current_location_id is truly missing, that's a data integrity error
    // Return early rather than use generic fallback labels
    // The enforceLocationCoherence backend should have set current_location_id
  } // end: only fallback to activity if NO explicit current_location_id

  // 12. DEFAULT
  return { iconType: 'calm', label: 'available', color: 'text-muted-foreground' };
}

/**
 * Map icon types to Lucide icon names.
 * Used in CharacterCard to render the appropriate icon.
 */
export const statusIconMap = {
  sleep: 'Moon',
  work: 'Briefcase',
  school: 'BookOpen',
  gym: 'Dumbbell',
  bar: 'Wine',
  club: 'Music',
  mall: 'ShoppingBag',
  home: 'Home',
  out: 'MapPin',
  hospital: 'AlertTriangle',
  prayer: 'Sparkles',
  calm: 'Circle',
};

/**
 * Determine if a character should be at work right now.
 * Returns { shouldBeAtWork, workLocationId, shiftTime }
 */
export function isCharacterScheduledNow(character) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return { shouldBeAtWork: false };
  }

  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay();
  
  const [workStart] = character.work_start_time.split(':').map(Number);
  const [workEnd] = character.work_end_time.split(':').map(Number);
  const isWorkDay = character.work_days.includes(dayOfWeek);
  const isWorkHours = currentHour >= workStart && currentHour < workEnd;

  return {
    shouldBeAtWork: isWorkDay && isWorkHours,
    workLocationId: character.current_work_location_id,
    shiftTime: `${character.work_start_time} - ${character.work_end_time}`
  };
}