/**
 * VGC TOWERS PRESENCE + TRAVEL ENGINE
 * 
 * Manages presence and travel for npc_fictitious characters living at VGC Towers.
 * 
 * Rules:
 * - npc_fictitious at VGC Towers rotate through world locations 10 AM - 1 AM
 * - Outside that window, they return to VGC Towers
 * - Cannot be at VGC Towers and elsewhere simultaneously
 * - resolved_current_location_id is authoritative
 * - VGC Towers must not show them as present when out
 * - VGC Towers must not be falsely empty if residents are there
 */

/**
 * Get the active travel window for VGC Towers residents.
 * Returns { isActiveNow, activeStart, activeEnd, localTimeZone }
 */
export function getVGCTowersActiveWindow(currentTime = new Date(), timeZone = 'America/New_York') {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(currentTime);
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const currentMinutes = hour * 60 + minute;

  const activeStartMinutes = 10 * 60; // 10:00 AM
  const activeEndMinutes = 1 * 60; // 1:00 AM (next day)

  // 1 AM is end of next day, so wrap logic
  const isActiveNow =
    (currentMinutes >= activeStartMinutes) || // After 10 AM
    (currentMinutes < activeEndMinutes); // Before 1 AM

  return {
    isActiveNow,
    activeStart: '10:00 AM',
    activeEnd: '1:00 AM',
    localTimeZone: timeZone,
  };
}

/**
 * Check if an npc_fictitious character should be at VGC Towers right now.
 * 
 * Returns { shouldBeAtHome, reason }
 */
export function shouldVGCResidentBeAtHome(character, currentTime = new Date(), timeZone = 'America/New_York') {
  if (!character || character.character_type !== 'npc_fictitious') {
    return { shouldBeAtHome: false, reason: 'Not npc_fictitious' };
  }

  const window = getVGCTowersActiveWindow(currentTime, timeZone);

  if (!window.isActiveNow) {
    return {
      shouldBeAtHome: true,
      reason: 'Outside active hours (10 AM - 1 AM), must be at home',
    };
  }

  // During active window, they may be traveling
  return {
    shouldBeAtHome: false,
    reason: 'Within active travel window',
  };
}

/**
 * Validate VGC Towers presence consistency.
 * 
 * Returns array of violations.
 */
export function validateVGCTowersPresence(vgcTowersLocation, characters = [], currentTime = new Date(), timeZone = 'America/New_York') {
  if (!vgcTowersLocation || vgcTowersLocation.name !== 'VGC Towers') {
    return [];
  }

  const violations = [];
  const vgcResidents = characters.filter(c =>
    c.character_type === 'npc_fictitious' &&
    c.current_home_location_id === vgcTowersLocation.id
  );

  vgcResidents.forEach(resident => {
    const { shouldBeAtHome, reason: homeReason } = shouldVGCResidentBeAtHome(resident, currentTime, timeZone);

    // If should be home but resolved location says elsewhere
    if (shouldBeAtHome && resident.resolved_current_location_id && resident.resolved_current_location_id !== vgcTowersLocation.id) {
      violations.push({
        characterId: resident.id,
        characterName: resident.name,
        violation: 'WRONGLY_AWAY_DURING_HOME_HOURS',
        reason: homeReason,
        resolvedLocation: resident.resolved_current_location_id,
      });
    }

    // If should be traveling but resolved location says VGC Towers
    if (!shouldBeAtHome && resident.resolved_current_location_id === vgcTowersLocation.id) {
      violations.push({
        characterId: resident.id,
        characterName: resident.name,
        violation: 'WRONGLY_HOME_DURING_TRAVEL_HOURS',
        reason: 'Should be traveling during active hours',
        resolvedLocation: vgcTowersLocation.id,
      });
    }
  });

  return violations;
}

/**
 * Distribute VGC Towers residents to random valid world locations during active hours.
 * 
 * Used by auto-distribution logic on page load and periodic syncs.
 */
export function distributeVGCResidentsForCurrentTime(
  vgcTowersLocation,
  vgcResidents = [],
  allLocations = [],
  currentTime = new Date(),
  timeZone = 'America/New_York'
) {
  const window = getVGCTowersActiveWindow(currentTime, timeZone);
  const updates = [];

  if (!window.isActiveNow) {
    // Outside active window: send all home
    vgcResidents.forEach(resident => {
      if (resident.resolved_current_location_id !== vgcTowersLocation.id) {
        updates.push({
          characterId: resident.id,
          characterName: resident.name,
          targetLocation: vgcTowersLocation,
          reason: 'Outside active hours, returning home',
        });
      }
    });
    return updates;
  }

  // During active window: rotate them through valid locations (not VGC Towers)
  const validDestinations = allLocations.filter(
    loc => loc.id !== vgcTowersLocation.id && loc.category !== 'home' && loc.category !== 'generic'
  );

  if (validDestinations.length === 0) {
    // No valid destinations, keep at home
    vgcResidents.forEach(resident => {
      if (resident.resolved_current_location_id !== vgcTowersLocation.id) {
        updates.push({
          characterId: resident.id,
          characterName: resident.name,
          targetLocation: vgcTowersLocation,
          reason: 'No valid world destinations available',
        });
      }
    });
    return updates;
  }

  // Distribute residents round-robin to valid locations
  vgcResidents.forEach((resident, index) => {
    const targetLocation = validDestinations[index % validDestinations.length];
    
    // Only update if they're not already at a different location or at home during travel hours
    if (resident.resolved_current_location_id !== targetLocation.id) {
      updates.push({
        characterId: resident.id,
        characterName: resident.name,
        targetLocation,
        reason: 'Rotating to world location during active hours',
      });
    }
  });

  return updates;
}