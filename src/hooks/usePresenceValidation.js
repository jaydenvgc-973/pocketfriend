import { useEffect, useState } from 'react';
import { validateSystemIntegrity } from '@/lib/presenceEnforcementEngine';

/**
 * Hook: Validate presence integrity on page load
 * Returns violations and system health status
 */
export function usePresenceValidation(characters = [], locations = []) {
  const [violations, setViolations] = useState(null);
  const [isValidating, setIsValidating] = useState(true);
  const [isHealthy, setIsHealthy] = useState(true);

  useEffect(() => {
    if (!characters.length || !locations.length) {
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    const violations = validateSystemIntegrity(characters, locations);
    setViolations(violations);
    setIsHealthy(violations.summary.critical === 0);
    setIsValidating(false);
  }, [characters, locations]);

  return { violations, isValidating, isHealthy };
}

/**
 * Hook: Get formatted violation report
 */
export function useViolationReport(violations) {
  if (!violations) return null;

  return {
    totalViolations: violations.summary.total,
    criticalViolations: violations.summary.critical,
    warningViolations: violations.summary.warning,
    vgcTowerIssues: violations.vgcTowers.length,
    characterIssues: violations.characters.length,
    
    // Group violations by character
    violationsByCharacter: violations.characters.reduce((acc, cv) => {
      acc[cv.characterId] = {
        name: cv.characterName,
        violations: cv.violations,
      };
      return acc;
    }, {}),

    // Get critical violations only
    criticalIssues: [
      ...violations.vgcTowers.filter(v => v.severity === 'CRITICAL'),
      ...violations.characters.flatMap(cv => 
        cv.violations.filter(v => v.severity === 'CRITICAL')
      ),
    ],
  };
}