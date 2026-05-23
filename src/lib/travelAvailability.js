import { resolveCharacterLocation } from './locationResolutionEngine';
import { isCharacterAsleep } from './sleepUtils';
import { toDisplay12h } from './timeFormat';

/**
 * Returns availability info for a character for travel.
 * { available: boolean, reason: { iconType, message, color }, availableAt: string|null }
 */
// CANONICAL NPC types: these characters have no work/school schedules, only sleep blocks them.
// active_created_character goes through resolveCharacterLocation() — NOT this list.
const NPC_TYPES = ['npc_fictitious', 'npc_family_member', 'npc_regular', 'npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'];

export function getCharacterTravelAvailability(character, locationMap = {}) {
  if (!character) return { available: false, reason: { iconType: 'out', message: 'Unknown status', color: 'text-muted-foreground' }, availableAt: null };

  // JAIL/PRISON CONFINEMENT: hard block — confined characters cannot travel until released.
  // This mirrors how "at work" and "asleep" block travel — jail is a locked presence state.
  if (character.is_jailed === true) {
    const facilityName = character.incarceration_facility_name || 'a confinement facility';
    const releaseDate = character.jail_release_date
      ? new Date(character.jail_release_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;
    return {
      available: false,
      reason: { iconType: 'out', message: `${character.name} is incarcerated at ${facilityName} and cannot travel.`, color: 'text-red-400' },
      availableAt: releaseDate ? `Expected release: ${releaseDate}` : 'Not available until released',
    };
  }

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
  // CANONICAL sleep detection: cover all sleep source_reasons + status fields
  const SLEEP_SOURCES = new Set([
    'home_sleeping', 'sleep_location_correction', 'adaptive_sleep_location_lock',
    'sleep_return_home', 'pass_out_recovery', 'adaptive_pre_sleep_return', 'recovery_nap',
  ]);
  const isSleeping = resolved.resolved_presence_status === 'sleeping' ||
    resolved.resolved_presence_status === 'napping' ||
    SLEEP_SOURCES.has(resolved.resolved_source_reason);
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
 * Returns true if a character is currently at home.
 * SINGLE SOURCE OF TRUTH: reads resolved_presence_status directly from DB.
 * This matches what every other UI surface (Home card, Travel popup) reads.
 */
export function isCharacterHome(character, locationMap = {}) {
  // Use the authoritative DB field first — avoids drift between recomputed and stored state
  // NOTE: 'traveling' is NOT a home state — but it is also NOT a blocker in the new system.
  const status = character.resolved_presence_status;
  if (status === 'home' || status === 'sleeping' || status === 'napping') return true;
  // Fallback: check if resolved location matches their home
  const homeId = character.current_home_location_id || character.home_location_id;
  if (!homeId) return false;
  return character.resolved_current_location_id === homeId;
}