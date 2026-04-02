import { getCharacterStatusDisplay } from './characterStatusUtils';
import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork } from './workScheduleUtils';

/**
 * Returns availability info for a character for travel.
 * { available: boolean, reason: { iconType, message, color }, availableAt: string|null }
 */
export function getCharacterTravelAvailability(character, locationMap = {}) {
  if (!character) return { available: false, reason: { iconType: 'out', message: 'Unknown status', color: 'text-muted-foreground' }, availableAt: null };

  const workLocation = character.occupation_location_id ? locationMap[character.occupation_location_id] : null;
  const educationLocation = character.education_location_id ? locationMap[character.education_location_id] : null;

  const statusDisplay = getCharacterStatusDisplay(character, { workLocation, educationLocation });
  const iconType = statusDisplay?.iconType || 'calm';

  if (iconType === 'sleep') {
    const wakeTime = character.wake_up_time || '07:00';
    return {
      available: false,
      reason: { iconType: 'sleep', message: `${character.name} is asleep right now and can't join.`, color: 'text-blue-300' },
      availableAt: `May be free after ${wakeTime}`,
    };
  }

  if (iconType === 'work') {
    const workEnd = character.work_end_time || null;
    return {
      available: false,
      reason: { iconType: 'work', message: `${character.name} is at work right now and can't come.`, color: 'text-blue-400' },
      availableAt: workEnd ? `May be free after ${workEnd}` : null,
    };
  }

  if (iconType === 'school') {
    return {
      available: false,
      reason: { iconType: 'school', message: `${character.name} is at school right now and can't join.`, color: 'text-amber-400' },
      availableAt: null,
    };
  }

  if (iconType === 'hospital') {
    return {
      available: false,
      reason: { iconType: 'hospital', message: `${character.name} is at the hospital and can't come.`, color: 'text-red-400' },
      availableAt: null,
    };
  }

  if (iconType === 'prayer') {
    return {
      available: false,
      reason: { iconType: 'prayer', message: `${character.name} is praying right now and can't join.`, color: 'text-violet-300' },
      availableAt: 'Should be free soon',
    };
  }

  return { available: true, reason: null, availableAt: null };
}