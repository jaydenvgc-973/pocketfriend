// characterStatusUtils.js
import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork, isCharacterAtSchool, isCharacterAtReligiousLocation, isCharacterAtGym } from './workScheduleUtils';
import { isCharacterInPrayer } from './religionUtils';
import { getAuthoritativeCharacterLocation } from './authoritativeLocationResolver';

/**
 * Determines what status/location to display on a character card.
 *
 * Uses the authoritative location resolver to ensure ONE TRUTH across all UI surfaces.
 * 
 * Priority (highest to lowest):
 *   1. Sleeping at home
 *   2. Prayer (blocking)
 *   3. Active work schedule → work location
 *   4. Active school schedule → school location
 *   5. Explicit current_location_id (travel, events, manual placement)
 *   6. Home (fallback when no active obligation)
 *
 * Returns: { iconType: string, label: string, color: string }
 */
export function getCharacterStatusDisplay(character, locationData = {}) {
  if (!character) return null;

  // Build location map from locationData
  const locationMap = {};
  if (locationData.workLoc) locationMap[locationData.workLoc.id] = locationData.workLoc;
  if (locationData.eduLoc) locationMap[locationData.eduLoc.id] = locationData.eduLoc;
  if (locationData.currentLoc) locationMap[locationData.currentLoc.id] = locationData.currentLoc;
  if (locationData.homeLocation) locationMap[locationData.homeLocation.id] = locationData.homeLocation;
  if (locationData.gymLoc) locationMap[locationData.gymLoc.id] = locationData.gymLoc;
  if (locationData.religionLoc) locationMap[locationData.religionLoc.id] = locationData.religionLoc;

  // Get AUTHORITATIVE location — single source of truth
  const authLoc = getAuthoritativeCharacterLocation(character, locationMap);

  if (!authLoc || !authLoc.id) {
    return { iconType: 'calm', label: 'available', color: 'text-muted-foreground' };
  }

  // Map category to icon and color
  const locationObj = locationMap[authLoc.id];
  const category = locationObj?.category || 'generic';

  const catIconMap = {
    home: { icon: 'home', color: 'text-pink-400' },
    work: { icon: 'work', color: 'text-blue-400' },
    school: { icon: 'school', color: 'text-amber-400' },
    gym: { icon: 'gym', color: 'text-emerald-400' },
    food_drink: { icon: 'out', color: 'text-orange-400' },
    social: { icon: 'bar', color: 'text-pink-400' },
    medical: { icon: 'hospital', color: 'text-red-400' },
    outdoor: { icon: 'out', color: 'text-emerald-400' },
    generic: { icon: 'out', color: 'text-blue-400' }
  };

  const result = catIconMap[category] || catIconMap.generic;

  // Source-specific display logic
  let label = `at ${authLoc.name}`;

  // Special case: sleeping
  if (authLoc.source === 'sleeping_at_home') {
    return { iconType: 'sleep', label: 'sleeping', color: 'text-blue-300' };
  }

  // Special case: praying
  if (authLoc.source === 'praying_at_home') {
    return { iconType: 'prayer', label: 'praying', color: 'text-violet-300' };
  }

  return { iconType: result.icon, label, color: result.color };
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