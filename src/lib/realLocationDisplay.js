/**
 * Utility to get the real-world display name for a character's location.
 * If they're at a bar/restaurant with validation, shows the actual business name.
 * If they're at work, shows workplace name.
 * Otherwise shows the location name.
 *
 * Never returns generic labels like "at bar", "eating", "out", etc.
 */

export function getCharacterLocationDisplay(character, locationMap = {}) {
  if (!character) return 'Unknown location';

  // Priority 1: If they're on a work shift, show workplace
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();
    
    const [workStart] = character.work_start_time.split(':').map(Number);
    const [workEnd] = character.work_end_time.split(':').map(Number);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours && character.current_work_location_id) {
      const workLoc = locationMap[character.current_work_location_id];
      if (workLoc) {
        return `At ${workLoc.name} (working)`;
      }
    }
  }

  // Priority 2: If current_location_id is set, use that location's name
  if (character.current_location_id) {
    const loc = locationMap[character.current_location_id];
    if (loc) {
      return `At ${loc.name}`;
    }
  }

  // Priority 3: Check if they have a validated rabbit hole location stored
  if (character.rabbit_hole_location_name) {
    return `At ${character.rabbit_hole_location_name}`;
  }

  // Priority 4: Home location as fallback
  if (character.current_home_location_id) {
    const homeLoc = locationMap[character.current_home_location_id];
    if (homeLoc) {
      return `At home (${homeLoc.name})`;
    }
  }

  return 'Location unknown';
}

/**
 * Check if character's location system matches their schedule.
 * Returns { isSynced, issue } for diagnostics.
 */
export function validateLocationSync(character, locationMap = {}) {
  const issues = [];

  // Check 1: If scheduled for work now, must be at work
  if (character.work_start_time && character.work_end_time && character.work_days) {
    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();
    
    const [workStart] = character.work_start_time.split(':').map(Number);
    const [workEnd] = character.work_end_time.split(':').map(Number);
    const isWorkDay = character.work_days.includes(dayOfWeek);
    const isWorkHours = currentHour >= workStart && currentHour < workEnd;

    if (isWorkDay && isWorkHours) {
      if (character.current_location_id !== character.current_work_location_id) {
        issues.push({
          severity: 'CRITICAL',
          message: `${character.name} is scheduled for work but not at workplace`
        });
      }
    }
  }

  // Check 2: No generic location labels in current_activity
  const activityPatterns = /\b(bar|club|nightclub|lounge|pub|tavern|happy hour|restaurant|eating|out)\b/i;
  if (character.current_activity && activityPatterns.test(character.current_activity)) {
    issues.push({
      severity: 'WARNING',
      message: `${character.name} has generic activity label: "${character.current_activity}"`
    });
  }

  return {
    isSynced: issues.length === 0,
    issues
  };
}