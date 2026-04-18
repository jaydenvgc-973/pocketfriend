import { useEffect, useState } from 'react';
import { useCharacterAwareness } from './useCharacterAwareness';

/**
 * Wrapper hook that provides character awareness context ready for prompt injection
 * Handles caching and provides awareness string formatted for LLM integration
 */
export const useCharacterAwarenessContext = (characterId, character) => {
  const { awarenessContext } = useCharacterAwareness(characterId);
  const [finalContext, setFinalContext] = useState('');

  useEffect(() => {
    if (awarenessContext) {
      setFinalContext(awarenessContext);
    } else {
      setFinalContext('');
    }
  }, [awarenessContext]);

  return finalContext;
};