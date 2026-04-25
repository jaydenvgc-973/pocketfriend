/**
 * NARRATIVE ANTI-LOOP ENGINE
 * 
 * Detects and prevents repeated narrative beats.
 * Ensures each narrative advances the story, not repeats it.
 * 
 * Exported:
 *   detectNarrativeLoop(newNarrative, recentNarratives) → { loopDetected: bool, similarity: number }
 *   validateNarrativeProgression(newNarrative, character) → { valid: bool, reason: string }
 */

/**
 * Detects if a new narrative is too similar to recent ones.
 * Returns loop detection + similarity score (0–1).
 */
export function detectNarrativeLoop(newNarrative, recentNarratives = []) {
  if (!newNarrative || typeof newNarrative !== 'string') {
    return { loopDetected: false, similarity: 0, matched: null };
  }

  if (recentNarratives.length === 0) {
    return { loopDetected: false, similarity: 0, matched: null };
  }

  const normalizeText = (text) => {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .trim()
      .split(/\s+/);
  };

  const newWords = new Set(normalizeText(newNarrative));
  const newLen = newWords.size;

  let highestSimilarity = 0;
  let matchedNarrative = null;

  for (const recent of recentNarratives.slice(-5)) {
    if (!recent || typeof recent !== 'string') continue;

    const recentWords = new Set(normalizeText(recent));
    const recentLen = recentWords.size;

    // Intersection = common words
    const intersection = [...newWords].filter(w => recentWords.has(w)).length;
    const union = newLen + recentLen - intersection;

    // Jaccard similarity
    const similarity = union > 0 ? intersection / union : 0;

    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      matchedNarrative = recent;
    }

    // Hard threshold: > 0.65 similarity = loop detected
    if (similarity > 0.65) {
      console.warn(`[antiLoop] LOOP DETECTED | Similarity: ${(similarity * 100).toFixed(1)}% | Matched:`, recent.substring(0, 80));
      return {
        loopDetected: true,
        similarity: similarity,
        matched: recent.substring(0, 100),
      };
    }
  }

  console.log(`[antiLoop] No loop detected | Max similarity: ${(highestSimilarity * 100).toFixed(1)}%`);
  return {
    loopDetected: false,
    similarity: highestSimilarity,
    matched: null,
  };
}

/**
 * Validates that a narrative represents progression, not stagnation.
 * Checks for:
 *   - Action variety (not same action as last beat)
 *   - State change (time, location, emotion, activity)
 *   - Cause-effect structure
 */
export function validateNarrativeProgression(newNarrative, character, previousBeat = null) {
  if (!newNarrative || newNarrative.length < 20) {
    return {
      valid: false,
      reason: 'Narrative too short or empty',
      score: 0,
    };
  }

  const lower = newNarrative.toLowerCase();
  let progressionScore = 0;

  // Check for action keywords that indicate progression
  const progressionKeywords = [
    'then', 'next', 'after', 'soon', 'later',
    'moved', 'went', 'walked', 'arrived', 'left',
    'finished', 'completed', 'done', 'over',
    'now', 'currently', 'started', 'began',
  ];

  const hasProgressionKeyword = progressionKeywords.some(kw => lower.includes(kw));
  if (hasProgressionKeyword) progressionScore += 30;

  // Check for state/emotion/activity changes
  const stateChangeKeywords = [
    'felt', 'tired', 'energized', 'hungry', 'satisfied',
    'mood', 'stressed', 'relaxed', 'focus', 'distracted',
    'changed', 'different', 'shifted', 'new', 'fresh',
  ];

  const hasStateChange = stateChangeKeywords.some(kw => lower.includes(kw));
  if (hasStateChange) progressionScore += 25;

  // Check for location/movement indicators
  const movementKeywords = [
    'home', 'work', 'gym', 'kitchen', 'bedroom', 'couch',
    'outside', 'inside', 'door', 'room', 'away', 'back',
    'walked', 'drove', 'took', 'went', 'left', 'arrived',
  ];

  const hasMovement = movementKeywords.some(kw => lower.includes(kw));
  if (hasMovement) progressionScore += 20;

  // Check for time indicators
  const timeKeywords = [
    'minute', 'hour', 'morning', 'afternoon', 'evening',
    'early', 'late', 'soon', 'later', 'now', 'awhile',
  ];

  const hasTimeRef = timeKeywords.some(kw => lower.includes(kw));
  if (hasTimeRef) progressionScore += 15;

  // Compare with previous beat for novelty
  if (previousBeat) {
    const prevLower = previousBeat.toLowerCase();
    const overlapThreshold = 0.7;
    
    // Basic overlap check
    const prevWords = prevLower.split(/\s+/).slice(0, 10); // First 10 words
    const newWords = lower.split(/\s+/).slice(0, 10);
    const overlap = prevWords.filter(w => newWords.includes(w)).length / Math.max(prevWords.length, 1);

    if (overlap > overlapThreshold) {
      return {
        valid: false,
        reason: 'Too similar to previous beat (likely loop)',
        score: progressionScore,
      };
    }

    progressionScore += 10; // Bonus for being different
  }

  // Check cause-effect language
  if (lower.includes('because') || lower.includes('as a result') || lower.includes('so')) {
    progressionScore += 15;
  }

  const isValid = progressionScore >= 40;

  return {
    valid: isValid,
    reason: isValid
      ? `Progression detected (score: ${progressionScore})`
      : `Insufficient progression (score: ${progressionScore} < 40)`,
    score: progressionScore,
  };
}

/**
 * Main validation function for action tool / narrative generation.
 * Returns decision: proceed or reject.
 */
export function validateNarrativeGeneration(newNarrative, recentNarratives, character, previousBeat = null) {
  const loopCheck = detectNarrativeLoop(newNarrative, recentNarratives);
  if (loopCheck.loopDetected) {
    return {
      proceed: false,
      reason: `Loop detected (${(loopCheck.similarity * 100).toFixed(1)}% similar to recent beat)`,
      type: 'loop',
    };
  }

  const progressionCheck = validateNarrativeProgression(newNarrative, character, previousBeat);
  if (!progressionCheck.valid) {
    return {
      proceed: false,
      reason: progressionCheck.reason,
      type: 'no_progression',
    };
  }

  return {
    proceed: true,
    reason: 'Narrative passes validation',
    type: 'valid',
  };
}