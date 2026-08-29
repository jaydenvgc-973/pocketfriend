/**
 * duplicateResponseGuard.js
 *
 * Pre-commit guard for exact duplicate character responses.
 *
 * An exact duplicate of a previously completed character response is a
 * generation failure — it must be corrected BEFORE the message is committed
 * to Chat. This module provides the detection and anti-repeat prompt building
 * used by the existing Chat generation/retry path.
 *
 * This does NOT prevent characters from revisiting subjects, repeating an
 * opinion intentionally, or expressing the same general idea in new wording.
 * It only catches the exact reuse of a previously completed response payload.
 */

/**
 * Normalize text for exact-duplicate comparison.
 * Collapses all whitespace (spaces, newlines, tabs) into single spaces and trims.
 * Case-sensitive — "Hello" and "hello" are NOT considered duplicates.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * Build a Set of normalized previous character message texts from the
 * current conversation's message list.
 *
 * Includes both regular dialogue messages and narrative messages
 * (is_narrative: true). Excludes empty content, image-only messages,
 * and system/status messages.
 *
 * @param {Array} messages - Message records from the current conversation
 * @returns {Set<string>} Set of normalized previous character texts
 */
export function buildPreviousCharacterTexts(messages) {
  const set = new Set();
  if (!messages || !Array.isArray(messages)) return set;

  for (const m of messages) {
    if (m.sender_type !== 'character') continue;
    const content = (m.content || '').trim();
    if (!content) continue;
    // Skip image-only / failed-image placeholder messages
    if (content === '[IMAGE_FAILED]') continue;
    // Skip pure image messages with no text content
    if (m.image_url && !content) continue;
    const normalized = normalizeText(content);
    if (normalized) set.add(normalized);
  }
  return set;
}

/**
 * Check whether a newly generated response is an exact duplicate of any
 * previously completed character message.
 *
 * @param {string} text - The newly generated response text
 * @param {Set<string>} previousTextsSet - Set of normalized previous character texts
 * @returns {boolean}
 */
export function isExactDuplicateResponse(text, previousTextsSet) {
  if (!text || !previousTextsSet || previousTextsSet.size === 0) return false;
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return previousTextsSet.has(normalized);
}

/**
 * Build an anti-repeat instruction to append to the LLM prompt when a
 * duplicate response has been detected and correction is required.
 *
 * The instruction tells the LLM:
 * 1. Its previous response was an exact duplicate — generation failure.
 * 2. Lists the previous responses it must not repeat.
 * 3. Directs it to generate a genuinely new response to the current user message.
 *
 * @param {Array<string>} previousTextsArray - Array of previous character texts (raw)
 * @returns {string} Prompt suffix to append to the full prompt
 */
export function buildAntiRepeatPromptSuffix(previousTextsArray) {
  if (!previousTextsArray || previousTextsArray.length === 0) return '';

  // Include up to 5 previous responses, truncated to 300 chars each
  const samples = previousTextsArray
    .filter(t => t && t.trim())
    .slice(-5)
    .map((t, i) => `${i + 1}. "${t.substring(0, 300)}${t.length > 300 ? '...' : ''}"`)
    .join('\n');

  return `

════════════════════════════════════
⚠️ DUPLICATE RESPONSE DETECTED — GENERATION FAILURE
Your previous response was an EXACT DUPLICATE of a message you already sent earlier in this conversation.
This is a generation failure. You must NOT reuse a previously completed response payload as a new answer.

The following are your previous responses that you MUST NOT repeat verbatim:
${samples}

CORRECTION REQUIRED:
Generate a COMPLETELY NEW response to the user's current message.
- If the same idea still fits the current turn, express it in genuinely new wording appropriate to this moment.
- If the previous response does not fit the current conversation, generate a fresh response to what the user actually just said.
- Do NOT simply paraphrase an irrelevant stale response to defeat duplicate detection.
- Do NOT repeat any of the previous responses listed above.
- The response must genuinely answer the user's current message in the current continuity.
════════════════════════════════════`;
}