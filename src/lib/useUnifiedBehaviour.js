/**
 * useUnifiedBehaviour Hook
 * 
 * Central hook that all pages (Chat, Scene, Travel, Home) use to reference
 * character behavior decisions instead of independently guessing.
 * 
 * Ensures one shared reality across the app.
 */

import { useEffect, useState, useCallback } from 'react';
import calculateCharacterBehaviour from './behaviourCalculator';
import validateCharacterState, { applyStateFixes } from './stateValidator';

export function useUnifiedBehaviour(character, context = {}) {
  const [behaviour, setBehaviour] = useState(null);
  const [validation, setValidation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Calculate unified behaviour on mount and when character changes
  useEffect(() => {
    if (!character) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // 1. Validate state
    const validationResult = validateCharacterState(character, context);

    // 2. Auto-fix if needed
    let characterToUse = character;
    if (validationResult.shouldAutoFix) {
      characterToUse = applyStateFixes(character, validationResult.fixes);
    }

    // 3. Calculate behaviour
    const behaviourResult = calculateCharacterBehaviour(characterToUse, context);

    setBehaviour(behaviourResult);
    setValidation(validationResult);
    setIsLoading(false);
  }, [character?.id, context.locationId, context.sceneLocation]);

  // Refetch without recreating (memoized)
  const refetch = useCallback(() => {
    if (!character) return;
    const validationResult = validateCharacterState(character, context);
    const characterToUse = validationResult.shouldAutoFix 
      ? applyStateFixes(character, validationResult.fixes)
      : character;
    const behaviourResult = calculateCharacterBehaviour(characterToUse, context);
    setBehaviour(behaviourResult);
    setValidation(validationResult);
  }, [character, context]);

  return {
    // Behaviour decisions (what to do, how to act, where to go)
    primaryAction: behaviour?.primaryAction,
    fallbackActions: behaviour?.fallbackActions,
    tone: behaviour?.tone,
    responseDelay: behaviour?.responseDelay,
    likelyLocations: behaviour?.likelyLocations,
    actionWeight: behaviour?.actionWeight,

    // Validation (state consistency)
    isValid: validation?.isValid,
    errors: validation?.errors,
    warnings: validation?.warnings,
    shouldAutoFix: validation?.shouldAutoFix,

    // State snapshot (for debugging/context)
    stateSnap: behaviour?.stateSnap,

    // Methods
    refetch,
    isLoading
  };
}

export default useUnifiedBehaviour;