/**
 * descriptionResolver.js
 *
 * Centralized description resolution engine.
 * All systems (Chat, Media Gallery, World Phone, character context) must use this resolver
 * to determine which description to show/send to characters.
 *
 * This ensures consistency and prioritizes user edits over automatic analysis.
 */

/**
 * Resolve the best available description for an image message.
 * Priority order (user edits win; transport metadata loses).
 *
 * @param {object} message - Message record with image
 * @returns {string|null} - Best available description or null
 */
export function resolveBestImageDescription(message) {
  if (!message) return null;

  // Priority 1: User-edited description (locked, immutable by auto-analysis)
  if (message.user_edited_description && message.user_edited_description.trim().length > 5) {
    return message.user_edited_description.trim();
  }

  // Priority 2: Validated visual analysis description
  if (message.visual_analysis_description && message.visual_analysis_description.trim().length > 5) {
    // Reject transport metadata
    if (!isTransportMetadata(message.visual_analysis_description)) {
      return message.visual_analysis_description.trim();
    }
  }

  // Priority 3: Inferred description (from post-send visual analysis or manual generation)
  if (message.inferred_image_description && message.inferred_image_description.trim().length > 5) {
    if (!isTransportMetadata(message.inferred_image_description)) {
      return message.inferred_image_description.trim();
    }
  }

  // Priority 4: Standard image_description field
  if (message.image_description && message.image_description.trim().length > 5) {
    if (!isTransportMetadata(message.image_description)) {
      return message.image_description.trim();
    }
  }

  // Priority 5: Original prompt (if it's valid as a description, not raw generation syntax)
  const gc = message.generation_context || {};
  const originalPrompt = gc.original_raw_prompt || gc.scene_prompt || null;
  if (originalPrompt && originalPrompt.trim().length > 10 && isValidPromptAsDescription(originalPrompt)) {
    if (!isTransportMetadata(originalPrompt)) {
      return originalPrompt.trim();
    }
  }

  // No valid description found
  return null;
}

/**
 * Check if a string is transport metadata (routing label, not actual image analysis).
 * @param {string} text
 * @returns {boolean}
 */
function isTransportMetadata(text) {
  if (!text || text.trim().length < 2) return false;
  const lower = text.trim().toLowerCase();
  const transportPatterns = [
    /image sent to/i,
    /photo shared/i,
    /sent to [A-Z]/,
    /shared with [A-Z]/i,
    /image attachment/i,
    /photo attachment/i,
    /uploaded image/i,
  ];
  for (const pat of transportPatterns) {
    if (pat.test(text)) return true;
  }
  return lower.includes('sent to') || lower.includes('shared with') || lower.includes('image attachment');
}

/**
 * Check if an original prompt is valid as a description (not raw generation syntax).
 * Rejects prompts containing generation metadata, camera syntax, seeds, etc.
 * @param {string} prompt
 * @returns {boolean}
 */
function isValidPromptAsDescription(prompt) {
  if (!prompt || prompt.length < 10) return false;
  const lower = prompt.toLowerCase();
  // Reject generation syntax
  const rejectedKeywords = [
    'camera',
    'seed',
    'lora',
    'negative prompt',
    'steps:',
    'cfg',
    'render',
    'quality:',
    'style:',
    'model:',
  ];
  for (const keyword of rejectedKeywords) {
    if (lower.includes(keyword)) return false;
  }
  // Accept if it reads like natural description text (has subjects, objects, verbs)
  return prompt.split(' ').length > 5 && /[a-z]+ (is|are|wearing|sitting|standing|holding)/.test(lower);
}

/**
 * Get the source/reason for the resolved description (for audit/diagnostics).
 * @param {object} message - Message record
 * @returns {string} - Description source label
 */
export function getDescriptionSource(message) {
  if (!message) return 'none';
  if (message.user_edited_description && message.user_edited_description.trim().length > 5) {
    return 'user_edited';
  }
  if (message.visual_analysis_description && message.visual_analysis_description.trim().length > 5 && !isTransportMetadata(message.visual_analysis_description)) {
    return 'visual_analysis';
  }
  if (message.inferred_image_description && message.inferred_image_description.trim().length > 5 && !isTransportMetadata(message.inferred_image_description)) {
    return 'inferred_analysis';
  }
  if (message.image_description && message.image_description.trim().length > 5 && !isTransportMetadata(message.image_description)) {
    return 'image_description';
  }
  if (message.generation_context?.original_raw_prompt && isValidPromptAsDescription(message.generation_context.original_raw_prompt)) {
    return 'original_prompt';
  }
  return 'none';
}