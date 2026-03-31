import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork } from './workScheduleUtils';
import { isCharacterInPrayer } from './religionUtils';

/**
 * Determines what status/location to display on a character card
 * Considers: location, reason for being there, occupation, activity context
 * Returns: { icon: LucideIcon, label: string, color: string }
 */
export function getCharacterStatusDisplay(character) {
  if (!character) return null;

  // 1. SLEEPING — always top priority
  if (isCharacterAsleep(character)) {
    return {
      iconType: 'sleep',
      label: 'sleeping',
      color: 'text-blue-300'
    };
  }

  // 2. PRAYER — devout characters in a blocking prayer window
  const prayer = isCharacterInPrayer(character);
  if (prayer.active) {
    return {
      iconType: 'prayer',
      label: 'praying',
      color: 'text-violet-300'
    };
  }

  // 3. CHECK CURRENT ACTIVITY & HEALTH STATUS FOR PATIENT STATUS
  const activity = character.current_activity?.toLowerCase().trim();
  const isPatient = character.health_status?.toLowerCase().includes('sick') || 
                    character.health_status?.toLowerCase().includes('hospitali') ||
                    character.health_status?.toLowerCase().includes('patient') ||
                    activity?.includes('hospital') ||
                    activity?.includes('sick') ||
                    activity?.includes('patient');

  // PATIENT AT HOSPITAL — priority over work status
  if (isPatient) {
    return {
      iconType: 'hospital',
      label: 'at hospital',
      color: 'text-red-400'
    };
  }

  // 3. AT WORK — if currently in work schedule and at their workplace
  const atWork = isCharacterAtWork(character);
  if (atWork) {
    return {
      iconType: 'work',
      label: 'at work',
      color: 'text-blue-400'
    };
  }

  // 4. AT SCHOOL — if currently in education activity
  if (character.current_education_activity && character.current_education_activity !== 'none') {
    return {
      iconType: 'school',
      label: 'at school',
      color: 'text-amber-400'
    };
  }

  // 5. IN JOB TRAINING — if currently in job training
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') {
    return {
      iconType: 'work',
      label: 'in training',
      color: 'text-amber-400'
    };
  }

  // 6. EVALUATE OTHER ACTIVITIES

  // 7. MAP CURRENT_ACTIVITY TO DISPLAY STATUS
  if (activity) {
    // Medical / appointments
    if (activity.includes('doctor') || activity.includes('clinic') || activity.includes('appointment') || activity.includes('procedure') || activity.includes('surgery')) {
      return { iconType: 'hospital', label: 'at appointment', color: 'text-red-400' };
    }
    // Gym / fitness
    if (activity.includes('gym') || activity.includes('workout') || activity.includes('exercis') || activity.includes('yoga') || activity.includes('pilates') || activity.includes('crossfit') || activity.includes('spin class')) {
      return { iconType: 'gym', label: 'at gym', color: 'text-emerald-400' };
    }
    // Class / school (from activity string, not just education field)
    if (activity.includes('class') || activity.includes('school') || activity.includes('lecture') || activity.includes('campus') || activity.includes('library') || activity.includes('studying') || activity.includes('tutoring')) {
      return { iconType: 'school', label: 'at class', color: 'text-amber-400' };
    }
    // Training
    if (activity.includes('training') || activity.includes('internship') || activity.includes('shadowing')) {
      return { iconType: 'work', label: 'in training', color: 'text-amber-400' };
    }
    // Coffee shop / café
    if (activity.includes('coffee') || activity.includes('café') || activity.includes('cafe') || activity.includes('starbucks')) {
      return { iconType: 'out', label: 'at coffee shop', color: 'text-amber-400' };
    }
    // Park / outdoors
    if (activity.includes('park') || activity.includes('trail') || activity.includes('hike') || activity.includes('outside') || activity.includes('outdoor')) {
      return { iconType: 'out', label: 'outdoors', color: 'text-emerald-400' };
    }
    // Support group / therapy / church
    if (activity.includes('support group') || activity.includes('therapy') || activity.includes('therapist') || activity.includes('counseling') || activity.includes('church') || activity.includes('mosque') || activity.includes('temple') || activity.includes('service')) {
      return { iconType: 'prayer', label: 'at a meeting', color: 'text-violet-300' };
    }
    // Restaurant / food
    if (activity.includes('restaurant') || activity.includes('dinner') || activity.includes('lunch') || activity.includes('brunch') || activity.includes('eating out')) {
      return { iconType: 'out', label: 'at restaurant', color: 'text-orange-400' };
    }
    // Grocery / errands
    if (activity.includes('grocery') || activity.includes('store') || activity.includes('errand') || activity.includes('pharmacy') || activity.includes('laundromat')) {
      return { iconType: 'out', label: 'running errands', color: 'text-blue-400' };
    }
    // Bar
    if (activity.includes('bar') || activity.includes('lounge') || activity.includes('happy hour')) {
      return { iconType: 'bar', label: 'at bar', color: 'text-pink-400' };
    }
    // Club / nightlife
    if (activity.includes('club') || activity.includes('nightclub') || activity.includes('nightlife')) {
      return { iconType: 'club', label: 'at club', color: 'text-purple-400' };
    }
    // Mall / shopping
    if (activity.includes('mall') || activity.includes('shopping')) {
      return { iconType: 'mall', label: 'shopping', color: 'text-blue-400' };
    }
    // Home
    if (activity.includes('home') || activity.includes('house') || activity.includes('apartment') || activity.includes('winding down') || activity.includes('morning routine') || activity.includes('resting') || activity.includes('cooking') || activity.includes('watching tv') || activity.includes('cleaning')) {
      return { iconType: 'home', label: 'at home', color: 'text-pink-400' };
    }
    // Generic out
    if (activity.includes('out') || activity.includes('friend') || activity.includes('event') || activity.includes('evening')) {
      return { iconType: 'out', label: 'out', color: 'text-emerald-400' };
    }
  }

  // 8. DEFAULT — show neutral status
  return {
    iconType: 'calm',
    label: 'available',
    color: 'text-muted-foreground'
  };
}

/**
 * Map icon types to icon components
 * Used in CharacterCard to render the appropriate icon
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
  calm: 'Circle'
};