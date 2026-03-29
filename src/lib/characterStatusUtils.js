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
    // Exact matches
    if (activity.includes('gym') || activity.includes('workout') || activity.includes('exercis')) {
      return {
        iconType: 'gym',
        label: 'at gym',
        color: 'text-emerald-400'
      };
    }
    if (activity.includes('bar')) {
      return {
        iconType: 'bar',
        label: 'at bar',
        color: 'text-pink-400'
      };
    }
    if (activity.includes('club') || activity.includes('nightclub')) {
      return {
        iconType: 'club',
        label: 'at club',
        color: 'text-purple-400'
      };
    }
    if (activity.includes('mall') || activity.includes('shopping')) {
      return {
        iconType: 'mall',
        label: 'at mall',
        color: 'text-blue-400'
      };
    }
    if (activity.includes('home') || activity.includes('house') || activity.includes('apartment')) {
      return {
        iconType: 'home',
        label: 'at home',
        color: 'text-pink-400'
      };
    }
    if (activity.includes('out') || activity.includes('outside')) {
      return {
        iconType: 'out',
        label: 'out',
        color: 'text-emerald-400'
      };
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