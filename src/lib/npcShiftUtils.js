/**
 * Check if an NPC is currently on shift
 * @param {object} location - Location object with worker_shifts
 * @param {string} npcKey - NPC key (e.g., "npc_mikey_dj")
 * @returns {boolean} true if on shift, false otherwise
 */
export function isNPCOnShift(location, npcKey) {
  if (!location?.worker_shifts || !location.worker_shifts[npcKey]) {
    return false;
  }

  const shift = location.worker_shifts[npcKey];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Check if today is in the shift days and current time is within shift hours
  return (
    shift.days?.includes(dayOfWeek) &&
    currentTime >= shift.start &&
    currentTime <= shift.end
  );
}

/**
 * Get the location where an NPC is currently working (if on shift)
 * @param {string} npcKey - NPC key to find
 * @param {array} locations - Array of all locations
 * @returns {object|null} Location object if NPC is on shift, null otherwise
 */
export function getNPCCurrentLocation(npcKey, locations) {
  // Find the location where this NPC is defined and currently on shift
  for (const location of locations) {
    const isWorker = location.worker_job_titles?.[npcKey];
    if (isWorker && isNPCOnShift(location, npcKey)) {
      return location;
    }
  }
  return null;
}

/**
 * Check if an NPC exists at a location and is on shift
 * @param {string} npcName - NPC display name
 * @param {object} location - Location to check
 * @returns {boolean} true if NPC is on shift at this location
 */
export function isNPCAtLocation(npcName, location) {
  if (!location?.worker_job_titles) {
    return false;
  }

  // Find NPC key by matching the name pattern
  const npcKey = Object.keys(location.worker_job_titles).find(key => {
    if (key.startsWith("npc_")) {
      const displayName = key.replace(/^npc_/, "").replace(/_/g, " ");
      return displayName.toLowerCase() === npcName.toLowerCase();
    }
    return false;
  });

  return npcKey && isNPCOnShift(location, npcKey);
}