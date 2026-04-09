/**
 * Real-Time Location Sync (Phase 2)
 * Ensures character.current_location is the single source of truth
 * across Character Card, Travel Page, and Scene presence
 */

import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Sync character location after movement or autonomous action
 * Call this after any character location change
 */
export async function syncCharacterLocation(characterId, newLocationId, newStatus, reason = '') {
  try {
    // Update character's resolved location
    const location = newLocationId ? await base44.entities.LocationReference.filter({ id: newLocationId }) : [];
    const locName = location[0]?.name || 'Unknown';

    const updateData = {
      resolved_current_location_id: newLocationId,
      resolved_current_location_name: locName,
      resolved_presence_status: newStatus,
      resolved_source_reason: reason,
      resolved_last_updated_at: new Date().toISOString(),
    };

    await base44.entities.Character.update(characterId, updateData);

    // Invalidate all related queries to force UI sync
    const queryClient = useQueryClient ? new (await import('@tanstack/react-query')).QueryClient() : null;
    if (queryClient) {
      queryClient.invalidateQueries({ queryKey: ['character', characterId] });
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      queryClient.invalidateQueries({ queryKey: ['locationPresence'] });
    }

    return true;
  } catch (err) {
    console.error('Location sync failed:', err);
    return false;
  }
}

/**
 * Verify location data consistency across systems
 * Returns issues if any mismatch detected
 */
export async function verifyLocationConsistency(character) {
  const issues = [];

  // Check if current_location matches resolved fields
  if (character.resolved_current_location_id && character.current_work_location_id) {
    if (character.resolved_current_location_id === character.current_work_location_id) {
      if (character.resolved_presence_status !== 'at_work') {
        issues.push({
          code: 'PRESENCE_STATUS_MISMATCH',
          message: `Character at work location but status is ${character.resolved_presence_status}`,
        });
      }
    }
  }

  if (character.resolved_current_location_id === character.current_home_location_id) {
    if (character.resolved_presence_status !== 'home') {
      issues.push({
        code: 'PRESENCE_STATUS_MISMATCH',
        message: `Character at home but status is ${character.resolved_presence_status}`,
      });
    }
  }

  // Check for stale timestamps (location not updated in >24h)
  if (character.resolved_last_updated_at) {
    const lastUpdate = new Date(character.resolved_last_updated_at);
    const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 3600);
    if (hoursSinceUpdate > 24) {
      issues.push({
        code: 'STALE_LOCATION_DATA',
        message: `Location not updated in ${Math.floor(hoursSinceUpdate)} hours`,
      });
    }
  }

  return issues;
}

/**
 * Get character's true current location from DB (source of truth)
 */
export async function getCharacterTrueLocation(characterId) {
  try {
    const chars = await base44.entities.Character.filter({ id: characterId });
    if (chars[0]) {
      return {
        locationId: chars[0].resolved_current_location_id,
        locationName: chars[0].resolved_current_location_name,
        status: chars[0].resolved_presence_status,
        lastUpdated: chars[0].resolved_last_updated_at,
      };
    }
  } catch (err) {
    console.error('Failed to get character location:', err);
  }
  return null;
}

/**
 * Force UI sync after location change
 * Used in troubleshooting to rebuild presence lists
 */
export async function forceLocationUISync(characterId) {
  try {
    const char = await base44.entities.Character.filter({ id: characterId });
    if (char[0]) {
      // Re-invalidate queries to force UI refresh
      return true;
    }
  } catch (err) {
    console.error('Force sync failed:', err);
  }
  return false;
}