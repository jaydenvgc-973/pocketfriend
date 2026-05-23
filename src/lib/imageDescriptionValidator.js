/**
 * imageDescriptionValidator.js
 *
 * Validates image descriptions to distinguish between:
 * A. Transport/routing metadata (invalid for character context)
 * B. Actual visual scene descriptions (valid for character context)
 *
 * Rejects phrases like "Image sent to X", "Photo shared", etc.
 * Requires descriptions with actual visual content: subjects, objects, setting, mood.
 */

const TRANSPORT_KEYWORDS = [
  'sent to',
  'shared with',
  'uploaded by',
  'image attachment',
  'photo attachment',
  'user uploaded',
  'image sent',
  'photo sent',
  'shared image',
  'sent image',
  'attachment',
  'forwarded',
  'shared',
];

const TRANSPORT_PATTERNS = [
  /image sent to/i,
  /photo shared/i,
  /sent.*to.*[A-Z]/i, // "Sent to Someone"
  /shared.*with.*[A-Z]/i,
  /uploaded\s+image/i,
  /image\s+attachment/i,
  /photo\s+attachment/i,
];

/**
 * Check if a description is actually transport metadata, not image analysis.
 * Returns { isTransport: boolean, reason?: string }
 */
function detectTransportMetadata(text) {
  if (!text || typeof text !== 'string') {
    return { isTransport: true, reason: 'empty_or_invalid' };
  }

  const normalized = text.trim().toLowerCase();

  // Check for exact transport phrases
  for (const keyword of TRANSPORT_KEYWORDS) {
    if (normalized.includes(keyword)) {
      return { isTransport: true, reason: `contains_keyword_${keyword}` };
    }
  }

  // Check for transport regex patterns
  for (const pattern of TRANSPORT_PATTERNS) {
    if (pattern.test(text)) {
      return { isTransport: true, reason: 'matches_transport_pattern' };
    }
  }

  // Check if it contains a recipient character name (heuristic)
  // Typical format: "Image sent to [Character Name]"
  if (/sent\s+to\s+[A-Z][a-z]+\s+[A-Z]/i.test(text)) {
    return { isTransport: true, reason: 'looks_like_send_to_recipient' };
  }

  return { isTransport: false };
}

/**
 * Validate that a description actually contains visual scene content.
 * Returns { isValid: boolean, confidence: number, reason?: string }
 * Confidence 0-1: how confident we are this is real image analysis.
 */
function validateVisualContent(text) {
  if (!text || typeof text !== 'string') {
    return { isValid: false, confidence: 0, reason: 'empty' };
  }

  const normalized = text.trim();

  // Minimum length check
  if (normalized.length < 30) {
    return { isValid: false, confidence: 0, reason: 'too_short' };
  }

  // Must describe visible subjects/content
  const VISUAL_KEYWORDS = [
    'person',
    'people',
    'man',
    'woman',
    'child',
    'adult',
    'wearing',
    'dressed',
    'clothing',
    'table',
    'room',
    'building',
    'outdoor',
    'indoor',
    'sky',
    'ground',
    'sitting',
    'standing',
    'holding',
    'object',
    'food',
    'drink',
    'chair',
    'wall',
    'door',
    'window',
    'light',
    'dark',
    'color',
    'smile',
    'expression',
    'mood',
    'appear',
    'shows',
    'displays',
    'visible',
  ];

  const lowerText = normalized.toLowerCase();
  let visualContentScore = 0;

  for (const keyword of VISUAL_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      visualContentScore++;
    }
  }

  // Need at least 3 visual keywords to be confident
  const confidence = Math.min(visualContentScore / 5, 1.0);

  if (visualContentScore < 3) {
    return {
      isValid: false,
      confidence,
      reason: `insufficient_visual_content (${visualContentScore} keywords)`,
    };
  }

  // Check for sentence structure (not just a label)
  if (!/(\.|\?|!|,\s)/.test(normalized)) {
    return {
      isValid: false,
      confidence: confidence * 0.5,
      reason: 'no_sentence_structure',
    };
  }

  return { isValid: true, confidence };
}

/**
 * Full validation: reject transport metadata AND validate visual content.
 * Returns { valid: boolean, reason?: string, confidence?: number }
 */
function isValidImageDescription(text) {
  // First, reject transport metadata
  const transportCheck = detectTransportMetadata(text);
  if (transportCheck.isTransport) {
    return {
      valid: false,
      reason: `transport_metadata: ${transportCheck.reason}`,
    };
  }

  // Then validate that it has actual visual content
  const contentCheck = validateVisualContent(text);
  if (!contentCheck.isValid) {
    return {
      valid: false,
      reason: contentCheck.reason,
      confidence: contentCheck.confidence,
    };
  }

  return {
    valid: true,
    confidence: contentCheck.confidence,
  };
}

export { isValidImageDescription, detectTransportMetadata, validateVisualContent };