import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Hook to fetch and cache character awareness context
 * Fetches current awareness data based on character interests and profile
 * Caches result for 1 hour or uses stored cache if available
 */
export const useCharacterAwareness = (characterId) => {
  const [awarenessContext, setAwarenessContext] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!characterId) {
      setAwarenessContext('');
      return;
    }

    const fetchAwareness = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // First check if we have a cached profile with recent awareness
        const profiles = await base44.entities.CharacterAwarenessProfile.filter({ character_id: characterId });
        const profile = profiles[0];

        // If we have a cache that's less than 1 hour old, use it
        if (profile?.cached_awareness_context && profile?.last_awareness_refresh_at) {
          const lastRefresh = new Date(profile.last_awareness_refresh_at);
          const now = new Date();
          const hoursSinceRefresh = (now - lastRefresh) / (1000 * 60 * 60);

          if (hoursSinceRefresh < 1) {
            setAwarenessContext(profile.cached_awareness_context);
            setIsLoading(false);
            return;
          }
        }

        // Otherwise fetch fresh awareness
        const res = await base44.functions.invoke('buildCharacterAwarenessContext', {
          characterId,
        });

        if (res?.data?.awareness_context) {
          setAwarenessContext(res.data.awareness_context);
        } else {
          setAwarenessContext('');
        }
      } catch (err) {
        console.error('Failed to fetch character awareness:', err.message);
        setError(err.message);
        // Silently fail — awareness is optional, don't break chat
        setAwarenessContext('');
      } finally {
        setIsLoading(false);
      }
    };

    fetchAwareness();
  }, [characterId]);

  return { awarenessContext, isLoading, error };
};