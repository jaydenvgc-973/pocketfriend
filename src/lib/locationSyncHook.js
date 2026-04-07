/**
 * LOCATION SYNC HOOK
 *
 * Ensures character card and travel page always display the authoritative live location
 * from the backend without waiting for user navigation.
 */

import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Hook: Subscribe to live location updates for a character
 * Forces card + travel page to re-render with true backend location
 */
export function useCharacterLocationSync(characterId, userEmail) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!characterId || !userEmail) return;

    // Subscribe to character changes (live updates)
    const unsubscribe = base44.entities.Character.subscribe((event) => {
      // Only care about location-related updates
      if (event.id === characterId && ['create', 'update'].includes(event.type)) {
        const updatedChar = event.data;

        // Check if location fields changed
        const locationFieldsChanged = [
          'resolved_current_location_id',
          'resolved_current_location_name',
          'resolved_location_type',
          'location_status',
          'traveling_to_location_id',
          'last_location_update_time'
        ].some(field => updatedChar[field] !== undefined);

        if (locationFieldsChanged) {
          // Invalidate all location-related queries so card/travel page re-fetch
          queryClient.invalidateQueries({ queryKey: ['characters', userEmail] });
          queryClient.invalidateQueries({ queryKey: ['character', characterId] });
        }
      }
    });

    return () => unsubscribe();
  }, [characterId, userEmail, queryClient]);
}

/**
 * Hook: Keep character card location in sync with backend for all characters
 */
export function useAllCharacterLocationSync(userEmail) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userEmail) return;

    const unsubscribe = base44.entities.Character.subscribe((event) => {
      if (event.type === 'update' && event.data) {
        const locationFieldsChanged = [
          'resolved_current_location_id',
          'traveling_to_location_id',
          'location_status'
        ].some(field => event.data[field] !== undefined);

        if (locationFieldsChanged) {
          // Force re-fetch all characters to reflect new location state
          queryClient.invalidateQueries({ queryKey: ['characters', userEmail] });
        }
      }
    });

    return () => unsubscribe();
  }, [userEmail, queryClient]);
}

/**
 * Manually sync a character's location after invite acceptance/decline
 */
export async function syncCharacterLocationAfterInvite(characterId, userEmail, queryClient) {
  // Fetch fresh character data to get true backend location
  try {
    const freshChar = await base44.entities.Character.read(characterId);
    
    // Invalidate caches to force re-render with fresh location
    queryClient.invalidateQueries({ queryKey: ['characters', userEmail] });
    queryClient.invalidateQueries({ queryKey: ['character', characterId] });

    return freshChar.resolved_current_location_id;
  } catch (error) {
    console.error('Failed to sync character location:', error);
    return null;
  }
}