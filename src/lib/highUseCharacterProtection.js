/**
 * GLOBAL HIGH-USE CHARACTER PROTECTION LAYER
 * 
 * RULE: The most-used character is the highest-risk character to damage.
 * It must NEVER be automatically selected for testing, repairs, or destructive operations.
 * 
 * Heavy use means the user is invested and enjoying the app.
 * Breaking the most-used character damages the exact part the user likes most.
 * 
 * This layer enforces:
 * - No automatic selection of high-use characters for repairs
 * - No testing on production-critical characters
 * - No silent mutations of most-engaged characters
 * - Dry-run requirement for any operation on high-use characters
 * - Explicit user approval for risky operations
 */

/**
 * Calculate activity score for a character
 * High score = high engagement = protected character
 */
export function calculateActivityScore(char) {
  if (!char) return 0;
  
  const messageCount = char.message_count || 0;
  const lifeJournalCount = char.life_journal_count || 0;
  const memoryCount = char.memory_count || 0;
  const imageCount = char.generated_image_count || 0;
  const relationshipCount = char.relationship_count || 0;
  const openFrequency = char.open_frequency || 0;
  
  return (
    messageCount * 1 +
    lifeJournalCount * 2 +
    memoryCount * 1.5 +
    imageCount * 0.5 +
    relationshipCount * 1 +
    openFrequency * 10
  );
}

/**
 * Determine if a character is high-use (protected)
 */
export function isHighUseCharacter(char, allCharacters = []) {
  if (!char) return false;
  
  const activityScore = calculateActivityScore(char);
  const thresholds = {
    messages: 100,
    lifeJournal: 20,
    memories: 50,
    images: 30,
    openFrequency: 50, // times opened
  };
  
  const isHighUse = 
    (char.message_count || 0) >= thresholds.messages ||
    (char.life_journal_count || 0) >= thresholds.lifeJournal ||
    (char.memory_count || 0) >= thresholds.memories ||
    (char.generated_image_count || 0) >= thresholds.images ||
    (char.open_frequency || 0) >= thresholds.openFrequency;
  
  return isHighUse;
}

/**
 * Get a safe test character (low-use, disposable)
 * Returns null if no safe option exists
 */
export function getSafeTestCharacter(allCharacters = []) {
  if (!Array.isArray(allCharacters) || allCharacters.length === 0) {
    return null;
  }
  
  // Find lowest-activity character that's not the user's favorite
  const sortedByActivity = [...allCharacters].sort((a, b) => 
    calculateActivityScore(a) - calculateActivityScore(b)
  );
  
  // Return the lowest-activity character (safest for testing)
  return sortedByActivity[0] || null;
}

/**
 * GUARD: Prevent automatic selection of high-use characters for repairs
 * 
 * Use case: A repair function is about to mutate a character.
 * This guard checks if it's a high-use character and rejects auto-selection.
 */
export function guardHighUseCharacterFromRepair(character, allCharacters = []) {
  if (!character) {
    return { allowed: true, reason: null };
  }
  
  if (isHighUseCharacter(character, allCharacters)) {
    return {
      allowed: false,
      reason: `Cannot automatically repair high-use character "${character.name}". This is a protected character. Use a test character instead or require explicit user approval.`,
      protectedCharacter: character.id,
      recommendation: 'Use a sandbox test character or require dry-run approval before proceeding.'
    };
  }
  
  return { allowed: true, reason: null };
}

/**
 * GUARD: Prevent high-use characters from being used as default test subjects
 */
export function guardAgainstHighUseTestDefault(selectedCharacter, allCharacters = []) {
  if (!selectedCharacter) {
    return { compliant: true, reason: null };
  }
  
  if (isHighUseCharacter(selectedCharacter, allCharacters)) {
    return {
      compliant: false,
      reason: `Default test subject is a high-use character. This violates protection rules.`,
      violatingCharacter: selectedCharacter.id,
      recommendation: 'Switch to a low-use test character using getSafeTestCharacter()'
    };
  }
  
  return { compliant: true, reason: null };
}

/**
 * AUDIT LOG: Track all operations that attempted to use high-use characters
 */
const violationLog = [];

export function logHighUseCharacterViolation(operation, character, context = {}) {
  violationLog.push({
    timestamp: new Date().toISOString(),
    operation,
    character_id: character?.id,
    character_name: character?.name,
    activity_score: calculateActivityScore(character),
    context,
  });
  console.warn(`[HIGH-USE CHARACTER PROTECTION] Violation: ${operation} attempted on protected character "${character?.name}"`);
}

export function getViolationLog() {
  return violationLog;
}

export function clearViolationLog() {
  violationLog.length = 0;
}

/**
 * APPROVAL GATE: Require explicit confirmation before any risky operation on high-use characters
 */
export function requireApprovalForHighUseCharacter(character, operationType) {
  if (!isHighUseCharacter(character)) {
    return { requiresApproval: false };
  }
  
  return {
    requiresApproval: true,
    message: `This operation (${operationType}) will affect a high-use character. Explicit approval required.`,
    character: character.name,
    riskLevel: 'HIGH',
  };
}

/**
 * PROTECTION REPORT: Returns a summary of which characters are protected
 */
export function getProtectionReport(allCharacters = []) {
  const protected_chars = allCharacters.filter(c => isHighUseCharacter(c, allCharacters));
  const unprotected_chars = allCharacters.filter(c => !isHighUseCharacter(c, allCharacters));
  
  return {
    total_characters: allCharacters.length,
    protected_count: protected_chars.length,
    protected_characters: protected_chars.map(c => ({
      id: c.id,
      name: c.name,
      activity_score: calculateActivityScore(c),
    })),
    unprotected_count: unprotected_chars.length,
    safe_test_character: unprotected_chars.length > 0 ? unprotected_chars[0] : null,
  };
}

export default {
  calculateActivityScore,
  isHighUseCharacter,
  getSafeTestCharacter,
  guardHighUseCharacterFromRepair,
  guardAgainstHighUseTestDefault,
  logHighUseCharacterViolation,
  getViolationLog,
  clearViolationLog,
  requireApprovalForHighUseCharacter,
  getProtectionReport,
};