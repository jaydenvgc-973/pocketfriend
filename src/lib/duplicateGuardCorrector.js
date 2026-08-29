/**
 * duplicateGuardCorrector.js
 *
 * Encapsulates the duplicate-response guard's retry + stale-discard logic,
 * extracted from Chat.jsx to keep the send path within file-size limits.
 *
 * RULE: A completed historical response has ZERO active-response authority.
 * If the LLM produces an exact duplicate of a previously completed character
 * response, that result is a FAILED generation. It is DISCARDED — it cannot
 * proceed to commit, receive a new message ID, be recycled, or remain pending.
 *
 * The flow:
 * 1. Anti-repeat retries: regenerate with an explicit "do not repeat" suffix.
 * 2. Forced-fresh call: if the stale duplicate survived all retries, make one
 *    final call anchored to the user's CURRENT message with a hard prohibition
 *    on reusing any prior response. This is NOT recycling the same candidate —
 *    it is a fresh attempt with a fundamentally different instruction.
 * 3. Terminal discard: if the forced-fresh call ALSO produces a stale duplicate
 *    (extreme edge), discard it entirely. The stale result never receives a new
 *    message ID or is committed.
 *
 * No infinite retry loop: a failed result is discarded, not repeatedly
 * regenerated as the same active candidate.
 */

import { isExactDuplicateResponse, buildAntiRepeatPromptSuffix } from './duplicateResponseGuard';
import { callLLMWithRetry } from './llmUtils';

/**
 * @param {object} opts
 * @param {string} opts.responseText   - initial parsed response text
 * @param {object} opts.responseObj    - initial parsed response object
 * @param {string} opts.msgType        - initial message type
 * @param {array}  opts.sequenceItems   - initial sequence items
 * @param {array}  opts.fallbackNarratives - initial fallback narratives
 * @param {Set}    opts.previousCharTexts - normalized set of previous character texts
 * @param {string} opts.fullPrompt     - the full LLM prompt (conversation log included)
 * @param {string} opts.userText       - the current user message text
 * @param {function} opts.parseAndExtract - closure that parses an LLM raw response
 *   into { responseObj, msgType, responseText, sequenceItems, fallbackNarratives }
 * @returns {Promise<{responseObj, msgType, responseText, sequenceItems, fallbackNarratives}>}
 */
export async function correctDuplicateResponse({
  responseText, responseObj, msgType, sequenceItems, fallbackNarratives,
  previousCharTexts, fullPrompt, userText, parseAndExtract,
}) {
  let duplicateRetries = 0;
  const MAX_DUPLICATE_RETRIES = 3;
  let currentText = responseText;
  let currentObj = responseObj;
  let currentType = msgType;
  let currentSeq = sequenceItems;
  let currentFb = fallbackNarratives;

  // ── ANTI-REPEAT RETRIES ─────────────────────────────────────────────────
  while (currentText && isExactDuplicateResponse(currentText, previousCharTexts) && duplicateRetries < MAX_DUPLICATE_RETRIES) {
    console.error(`[DUPLICATE_GUARD] Exact duplicate response detected (retry ${duplicateRetries + 1}/${MAX_DUPLICATE_RETRIES}). Regenerating with anti-repeat instruction.`);
    const antiRepeatSuffix = buildAntiRepeatPromptSuffix([...previousCharTexts]);
    const response = await callLLMWithRetry(fullPrompt + antiRepeatSuffix, 'gemini_3_flash', 3, true);
    const parsed = parseAndExtract(response);
    currentObj = parsed.responseObj;
    currentType = parsed.msgType;
    currentText = parsed.responseText;
    currentSeq = parsed.sequenceItems;
    currentFb = parsed.fallbackNarratives;
    duplicateRetries++;
  }

  // ── STALE-DUPLICATE DISCARD + FORCED-FRESH CALL ─────────────────────────
  // The stale duplicate survived all anti-repeat retries → it is DEAD for
  // active-response purposes. Discard it. Make one forced-fresh call anchored
  // to the user's CURRENT message with a hard prohibition on reusing any prior
  // response. This is a fresh attempt with a fundamentally different instruction.
  if (currentText && isExactDuplicateResponse(currentText, previousCharTexts)) {
    console.error(`[DUPLICATE_GUARD] Stale duplicate survived ${duplicateRetries} retries. Discarding stale result — no active-response authority for completed historical response.`);
    const userSnippet = (userText || '').substring(0, 300).replace(/\s+/g, ' ').trim();
    const forcedFreshSuffix =
      `\n\n═══════════════════════════════════════════════════\n` +
      `⚠️ CRITICAL — STALE RESPONSE REJECTED\n` +
      `Your generated response was an EXACT DUPLICATE of a message you already sent earlier in this conversation. That response is REJECTED and discarded.\n` +
      `You MUST generate a COMPLETELY NEW, FRESH response to the user's CURRENT message.\n` +
      `User's current message: "${userSnippet}"\n` +
      `RULES:\n` +
      `- Do NOT repeat, paraphrase, or reuse ANY response you have previously sent in this conversation.\n` +
      `- Respond ONLY to what the user just said right now.\n` +
      `- If you cannot think of a new response, say something brief and direct that acknowledges their current message.\n` +
      `═══════════════════════════════════════════════════`;
    const response = await callLLMWithRetry(fullPrompt + forcedFreshSuffix, 'gemini_3_flash', 3, true);
    const parsed = parseAndExtract(response);
    currentObj = parsed.responseObj;
    currentType = parsed.msgType;
    currentText = parsed.responseText;
    currentSeq = parsed.sequenceItems;
    currentFb = parsed.fallbackNarratives;

    // If the forced-fresh call STILL produced a stale duplicate, discard it
    // entirely. The stale result must never receive a new message ID or be
    // committed as an active response. This is an extreme edge case — the
    // forced-fresh instruction is strong enough that a non-duplicate is
    // virtually always produced, giving the user a valid current-turn response.
    if (currentText && isExactDuplicateResponse(currentText, previousCharTexts)) {
      console.error(`[DUPLICATE_GUARD] Stale duplicate persisted after forced-fresh call. DISCARDING — stale response will not be committed or receive a new message ID.`);
      currentText = '';
      currentSeq = null;
      currentFb = [];
    }
  }

  if (duplicateRetries > 0) {
    const stillDup = isExactDuplicateResponse(currentText || '', previousCharTexts);
    console.log(`[DUPLICATE_GUARD] Correction complete after ${duplicateRetries} retry/retries. Duplicate resolved: ${!stillDup}`);
  }

  return {
    responseObj: currentObj,
    msgType: currentType,
    responseText: currentText,
    sequenceItems: currentSeq,
    fallbackNarratives: currentFb,
  };
}