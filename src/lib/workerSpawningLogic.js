/**
 * Smart NPC Worker Spawning Logic
 * 
 * Priority:
 * 1. Check assigned characters with matching role
 * 2. Only spawn NPCs if no assigned character is on shift
 * 3. Never create duplicates for the same role
 */

import { isCharacterOnShift } from './workScheduleUtils';

/**
 * Get workers for a location, prioritizing assigned characters over NPCs
 * 
 * @param {Object} location - The location record
 * @param {Array} characters - All user characters
 * @param {String} roleNeeded - The specific role to fill (e.g. "bartender")
 * @returns {Array} Worker objects [{ id, name, type, role, isAssigned }]
 */
export function getWorkersForRole(location, characters, roleNeeded) {
  const workers = [];
  const workerIds = location.worker_character_ids || [];

  // FIRST: Check assigned active characters for this role
  for (const workerId of workerIds) {
    const assignedChar = characters.find(c => c.id === workerId);
    if (!assignedChar) continue; // Skip if character not found

    const assignedRole = location.worker_job_titles?.[workerId] || '';
    
    // Check if this assigned character has the role we need
    if (assignedRole.toLowerCase() === roleNeeded.toLowerCase()) {
      // Check if on shift
      if (isCharacterOnShift(assignedChar, location)) {
        workers.push({
          id: assignedChar.id,
          name: assignedChar.name,
          type: 'character',
          role: assignedRole,
          isAssigned: true,
          isOnShift: true,
        });
      }
    }
  }

  return workers;
}

/**
 * Determine if an NPC should be spawned for a role
 * 
 * @param {Object} location - The location
 * @param {Array} characters - All characters
 * @param {String} roleNeeded - Role to fill
 * @returns {Boolean} true if NPC should be spawned
 */
export function shouldSpawnNPC(location, characters, roleNeeded) {
  // Get assigned characters for this role
  const assignedWorkers = getWorkersForRole(location, characters, roleNeeded);
  
  // If any assigned character is on shift for this role, don't spawn NPC
  if (assignedWorkers.length > 0) {
    return false;
  }

  // Otherwise, spawn NPC
  return true;
}

/**
 * Get all workers (assigned + NPCs) that should appear at a location for a role
 * 
 * @param {Object} location - The location
 * @param {Array} characters - All user characters
 * @param {String} roleNeeded - The role to fill
 * @param {String} generatedNPCName - Optional: pre-generated NPC name
 * @returns {Array} Complete list of workers for this role
 */
export function getWorkersWithNPCFallback(location, characters, roleNeeded, generatedNPCName = null) {
  const workers = getWorkersForRole(location, characters, roleNeeded);

  // If no assigned character is on shift, add generated NPC
  if (workers.length === 0 && shouldSpawnNPC(location, characters, roleNeeded)) {
    const npcName = generatedNPCName || `${roleNeeded} (NPC)`;
    workers.push({
      id: `npc_${location.id}_${roleNeeded}_${Date.now()}`,
      name: npcName,
      type: 'npc',
      role: roleNeeded,
      isAssigned: false,
      isOnShift: true,
    });
  }

  return workers;
}

/**
 * Check if a specific character is assigned to a location for a given role
 */
export function isCharacterAssignedToRole(characterId, location, roleNeeded) {
  const workerIds = location.worker_character_ids || [];
  if (!workerIds.includes(characterId)) return false;

  const assignedRole = location.worker_job_titles?.[characterId] || '';
  return assignedRole.toLowerCase() === roleNeeded.toLowerCase();
}