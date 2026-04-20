import { resolveCharacterLocation } from './locationResolutionEngine';
import { isCharacterAsleep } from './sleepUtils';
import { toDisplay12h } from './timeFormat';

/**
 * Returns availability info for a character for travel.
 * { available: boolean, reason: { iconType, message, color }, availableAt: string|null }
 */
const NPC_TYPES = ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'];

export function getCharacterTravelAvailability(character, locationMap = {}) {
  if (!character) return { available: false, reason: { iconType: 'out', message: 'Unknown status', color: 'text-muted-foreground' }, availableAt: null };

  // NPCs (standalone or family-embedded) are always available for travel —
  // they have no jobs, school, or strict schedules to block them.
  // Only sleep can block an NPC, handled below via isCharacterAsleep.
  if (NPC_TYPES.includes(character.character_type)) {
    if (isCharacterAsleep(character)) {
      const wakeTime = character.wake_up_time || '07:00';
      return {
        available: false,
        reason: { iconType: 'sleep', message: `${character.name} is asleep right now and can't join.`, color: 'text-blue-300' },
        availableAt: `May be free after ${toDisplay12h(wakeTime)}`,
      };
    }
    return { available: true, reason: null, availableAt: null };
  }

  // Use location resolution engine to determine current state
  const resolved = resolveCharacterLocation(character, locationMap);
  const locationObj = locationMap[resolved.resolved_current_location_id];
  const isSleeping = resolved.resolved_source_reason === 'home_sleeping';
  const isPraying = resolved.resolved_source_reason === 'praying_at_home';
  const category = locationObj?.category || 'generic';
  
  // Determine travel blockage based on resolved state
  let iconType = 'calm';
  if (isSleeping) iconType = 'sleep';
  else if (isPraying) iconType = 'prayer';
  else if (resolved.resolved_source_reason === 'work_schedule') iconType = 'work';
  else if (resolved.resolved_source_reason === 'school_schedule') iconType = 'school';
  else if (category === 'medical') iconType = 'hospital';

  if (iconType === 'sleep') {
    const wakeTime = character.wake_up_time || '07:00';
    return {
      available: false,
      reason: { iconType: 'sleep', message: `${character.name} is asleep right now and can't join.`, color: 'text-blue-300' },
      availableAt: `May be free after ${toDisplay12h(wakeTime)}`,
    };
  }

  if (iconType === 'work') {
    // Only block if the character actually has a defined job
    const hasJob = character?.work_details?.job_title || character?.occupation_location_id;
    if (!hasJob) return { available: true, reason: null, availableAt: null };

    // Look up the real shift end from the location's worker_shifts first
    let workEnd = null;
    if (character.occupation_location_id && locationMap[character.occupation_location_id]) {
      const workLoc = locationMap[character.occupation_location_id];
      const shift = workLoc.worker_shifts?.[character.id];
      if (shift?.end) workEnd = shift.end;
    }
    // Fall back to character's own work_end_time only if no shift data found
    if (!workEnd) workEnd = character.work_end_time || null;

    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at work${workEnd ? ` until ${toDisplay12h(workEnd)}` : ''}`,
      availableAt: workEnd ? `May be free after ${toDisplay12h(workEnd)}` : null,
    };
  }

  if (iconType === 'school') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at school right now`,
      availableAt: null,
    };
  }

  if (iconType === 'hospital') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is at the hospital right now`,
      availableAt: null,
    };
  }

  if (iconType === 'prayer') {
    return {
      available: false,
      isBusy: true,
      reason: `${character.name} is praying right now`,
      availableAt: 'Should be free soon',
    };
  }

  return { available: true, reason: null, availableAt: null };
}

/**
 * Returns true if a character is currently at home (not at work, school, etc.)
 * CRITICAL: Uses location resolution engine to determine actual location
 */
export function isCharacterHome(character, locationMap = {}) {
  const resolved = resolveCharacterLocation(character, locationMap);
  // They're home only if their resolved location is their home location
  if (!resolved.resolved_current_location_id || !character.current_home_location_id) return false;
  return resolved.resolved_current_location_id === character.current_home_location_id;
}