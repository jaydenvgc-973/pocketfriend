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
  // This overrides all inference and is the source of truth for where character physically is
  // CRITICAL: If set, use this and STOP. Do not continue to work/school inference below.
  if (character?.current_location_id && currentLocation) {
    const catIconMap = {
      home: { icon: 'home', label: `at ${currentLocation.name}`, color: 'text-pink-400' },
      work: { icon: 'work', label: `at ${currentLocation.name}`, color: 'text-blue-400' },
      school: { icon: 'school', label: `at ${currentLocation.name}`, color: 'text-amber-400' },
      gym: { icon: 'gym', label: `at ${currentLocation.name}`, color: 'text-emerald-400' },
      food_drink: { icon: 'out', label: `at ${currentLocation.name}`, color: 'text-orange-400' },
      social: { icon: 'bar', label: `at ${currentLocation.name}`, color: 'text-pink-400' },
      medical: { icon: 'hospital', label: `at ${currentLocation.name}`, color: 'text-red-400' },
      outdoor: { icon: 'out', label: `at ${currentLocation.name}`, color: 'text-emerald-400' },
    };
    const result = catIconMap[currentLocation.category];
    if (result) {
      return { iconType: result.icon, label: result.label, color: result.color };
    }
    // Fallback for unknown categories
    return { iconType: 'out', label: `at ${currentLocation.name}`, color: 'text-blue-400' };
  }

  // 4. AT WORK FIRST (higher priority than patient status)
  // Check work status BEFORE patient status, because a character can work at a hospital
  const activity = character.current_activity?.toLowerCase().trim() || '';
  const unemployedKeywords = ['unemployed', 'between jobs'];
  const workType = (character?.work_details?.workplace_type || '').toLowerCase();
  const isUnemployed = unemployedKeywords.some(k => workType.includes(k));

  if (!isUnemployed && isCharacterAtWork(character, workLocation)) {
    // Check if activity suggests NOT working despite being at work location
    const hangingOutKeywords = ['hanging out', 'hanging', 'chillin', 'chilling', 'relaxing', 'taking a break', 'off the clock', 'off work', 'after work'];
    const isHangingOut = hangingOutKeywords.some(k => activity.includes(k));
    
    if (isHangingOut && workLocation) {
      // They're at a venue (bar, restaurant, etc.) but hanging out, not working
      const catIconMap = {
        social: 'bar',
        food_drink: 'out',
        bar: 'bar',
      };
      const icon = catIconMap[workLocation.category] || 'out';
      return { iconType: icon, label: `at ${workLocation.name}`, color: 'text-orange-400' };
    }

    // Otherwise, they're actually working (including at hospital)
    const jobTitle = character.work_details?.job_title;
    const locationName = workLocation?.name;
    let label = 'at work';
    if (jobTitle) label = `at work`;
    if (locationName) label = `at ${locationName}`;
    return { iconType: 'work', label, color: 'text-blue-400' };
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
    const label = eduLocationName ? `at ${eduLocationName}` : 'in class';
    return { iconType: 'school', label, color: 'text-amber-400' };
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

  // 11. MAP CURRENT_ACTIVITY TO DISPLAY STATUS (fallback only — stale data ignored if explicit location set)
  if (activity) {
    if (activity.includes('doctor') || activity.includes('clinic') || activity.includes('appointment') || activity.includes('procedure') || activity.includes('surgery')) {
      return { iconType: 'hospital', label: 'at appointment', color: 'text-red-400' };
    }
    if (activity.includes('gym') || activity.includes('workout') || activity.includes('exercis') || activity.includes('yoga') || activity.includes('pilates') || activity.includes('crossfit') || activity.includes('spin class')) {
      return { iconType: 'gym', label: 'at gym', color: 'text-emerald-400' };
    }
    // School / education activity strings — same weight as work
    if (activity.includes('class') || activity.includes('school') || activity.includes('lecture') || activity.includes('campus') || activity.includes('library') || activity.includes('studying') || activity.includes('tutoring') || activity.includes('at school') || activity.includes('in class')) {
      const label = educationLocation ? `at ${educationLocation.name}` : 'in class';
      return { iconType: 'school', label, color: 'text-amber-400' };
    }
    if (activity.includes('training') || activity.includes('internship') || activity.includes('shadowing')) {
      return { iconType: 'work', label: 'in training', color: 'text-amber-400' };
    }
    if (activity.includes('coffee') || activity.includes('café') || activity.includes('cafe') || activity.includes('starbucks')) {
      return { iconType: 'out', label: 'at coffee shop', color: 'text-amber-400' };
    }
    if (activity.includes('evening') || activity.includes('out for')) {
      return { iconType: 'out', label: 'out for the evening', color: 'text-emerald-400' };
    }
    if (activity.includes('park') || activity.includes('trail') || activity.includes('hike') || activity.includes('outside') || activity.includes('outdoor')) {
      return { iconType: 'out', label: 'outdoors', color: 'text-emerald-400' };
    }
    if (activity.includes('laundromat') || activity.includes('laundry') || activity.includes('dry cleaning')) {
      return { iconType: 'out', label: 'at laundromat', color: 'text-blue-400' };
    }
    if ((activity.includes('church') || activity.includes('mosque') || activity.includes('temple') || activity.includes('synagogue') || activity.includes('kingdom hall') || activity.includes('mass')) && religionLocation) {
      const label = `at ${religionLocation.name}`;
      return { iconType: 'prayer', label, color: 'text-violet-300' };
    }
    // NOTE: "worship" keyword handled separately above (Step 9) to distinguish home worship vs church attendance
    if (activity.includes('support group') || activity.includes('therapy') || activity.includes('therapist') || activity.includes('counseling')) {
      return { iconType: 'prayer', label: 'at a meeting', color: 'text-violet-300' };
    }
    if (activity.includes('restaurant') || activity.includes('dinner') || activity.includes('lunch') || activity.includes('brunch') || activity.includes('eating out')) {
      return { iconType: 'out', label: 'at restaurant', color: 'text-orange-400' };
    }
    if (activity.includes('grocery') || activity.includes('store') || activity.includes('errand') || activity.includes('pharmacy') || activity.includes('laundromat')) {
      return { iconType: 'out', label: 'running errands', color: 'text-blue-400' };
    }
    if (activity.includes('bar') || activity.includes('lounge') || activity.includes('happy hour')) {
      return { iconType: 'bar', label: 'at bar', color: 'text-pink-400' };
    }
    if (activity.includes('club') || activity.includes('nightclub') || activity.includes('nightlife')) {
      return { iconType: 'club', label: 'at club', color: 'text-purple-400' };
    }
    if (activity.includes('mall') || activity.includes('shopping')) {
      return { iconType: 'mall', label: 'shopping', color: 'text-blue-400' };
    }
    if (activity.includes('home') || activity.includes('house') || activity.includes('apartment') || activity.includes('winding down') || activity.includes('morning routine') || activity.includes('resting') || activity.includes('cooking') || activity.includes('watching tv') || activity.includes('cleaning')) {
      return { iconType: 'home', label: 'at home', color: 'text-pink-400' };
    }
    if (activity.includes('out') || activity.includes('friend') || activity.includes('event') || activity.includes('evening')) {
      return { iconType: 'out', label: 'out', color: 'text-emerald-400' };
    }
  }

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