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
 * 2. Forced-fresh attempts: if the stale duplicate survived all retries, make
 *    up to MAX_FORCED_FRESH_ATTEMPTS fresh calls anchored to the user's CURRENT
 *    message with a hard prohibition on reusing any prior response. Each stale
 *    result is DISCARDED before the next attempt — this is NOT recycling the
 *    same candidate, it is a fresh attempt with a fundamentally different
 *    instruction.
 * 3. If any forced-fresh attempt produces a non-duplicate, return it so the
 *    existing Chat lifecycle commits the valid current-turn response.
 * 4. If ALL bounded attempts produce stale duplicates (extreme edge), THROW an
 *    error so Chat's existing catch block triggers handleFallbackResponse →
 *    triggerRecoveryBackground — the SAME lifecycle used for any failed LLM
 *    generation. The UI shows "Reconnecting…" (NOT a saved "..." message), and
 *    recovery re-runs the LLM with backoff. The stale result is NEVER committed,
 *    NEVER given a new message ID, and NEVER returned as empty text.
 *
 * No infinite retry loop: attempts are bounded. No empty/"" terminal state:
 * the corrector either returns a valid non-duplicate or throws to the existing
 * fallback path. It never returns currentText = ''.
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
 *   Never returns responseText = ''. On total stale-duplicate exhaustion, throws
 *   so Chat's existing catch/fallback/recovery lifecycle handles the failed turn.
 */
export async function correctDuplicateResponse({
  responseText, responseObj, msgType, sequenceItems, fallbackNarratives,
  previousCharTexts, fullPrompt, userText, parseAndExtract,
}) {
  let duplicateRetries = 0;
  const MAX_DUPLICATE_RETRIES = 3;
  const MAX_FORCED_FRESH_ATTEMPTS = 3;
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

  // ── FORCED-FRESH ATTEMPTS (bounded) ─────────────────────────────────────
  // The stale duplicate survived all anti-repeat retries → it is DEAD for
  // active-response purposes. Discard it. Make up to MAX_FORCED_FRESH_ATTEMPTS
  // fresh calls anchored to the user's CURRENT message with a hard prohibition
  // on reusing any prior response. Each stale result is discarded before the
  // next attempt. If any attempt produces a non-duplicate, return it so the
  // existing Chat lifecycle commits the valid current-turn response.
  let forcedFreshAttempts = 0;
  while (currentText && isExactDuplicateResponse(currentText, previousCharTexts) && forcedFreshAttempts < MAX_FORCED_FRESH_ATTEMPTS) {
    if (forcedFreshAttempts === 0) {
      console.error(`[DUPLICATE_GUARD] Stale duplicate survived ${duplicateRetries} anti-repeat retries. Discarding stale result — initiating forced-fresh attempts.`);
    } else {
      console.error(`[DUPLICATE_GUARD] Forced-fresh attempt ${forcedFreshAttempts} still produced stale duplicate. Discarding — trying again.`);
    }
    const userSnippet = (userText || '').substring(0, 300).replace(/\s+/g, ' ').trim();
    const forcedFreshSuffix =
      `\n\n═══════════════════════════════════════════════════\n` +
      `⚠️ CRITICAL — STALE RESPONSE REJECTED (attempt ${forcedFreshAttempts + 1}/${MAX_FORCED_FRESH_ATTEMPTS})\n` +
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
    forcedFreshAttempts++;
  }

  // ── TOTAL EXHAUSTION → THROW TO EXISTING FALLBACK/RECOVERY LIFECYCLE ─────
  // All bounded attempts (anti-repeat + forced-fresh) produced stale duplicates.
  // The stale result is permanently discarded. Rather than returning empty text
  // (which Chat would commit as "..." — an invalid terminal state), THROW so
  // Chat's existing catch block triggers handleFallbackResponse →
  // triggerRecoveryBackground — the SAME lifecycle used for any failed LLM
  // generation. The UI shows "Reconnecting…" (NOT a saved "..." message), and
  // recovery re-runs the LLM with exponential backoff. The stale result is never
  // committed, never given a new message ID, and never returned as empty text.
  if (currentText && isExactDuplicateResponse(currentText, previousCharTexts)) {
    console.error(
      `[DUPLICATE_GUARD] All ${duplicateRetries + forcedFreshAttempts} attempts produced stale duplicates. ` +
      `Throwing to existing fallback/recovery lifecycle — stale result permanently discarded, no empty terminal.`
    );
    throw new Error('DUPLICATE_RESPONSE_EXHAUSTED: all bounded generation attempts produced stale duplicates');
  }

  if ((duplicateRetries + forcedFreshAttempts) > 0) {
    const stillDup = isExactDuplicateResponse(currentText || '', previousCharTexts);
    console.log(
      `[DUPLICATE_GUARD] Correction complete after ${duplicateRetries} anti-repeat + ${forcedFreshAttempts} forced-fresh attempts. ` +
      `Duplicate resolved: ${!stillDup}`
    );
  }

  return {
    responseObj: currentObj,
    msgType: currentType,
    responseText: currentText,
    sequenceItems: currentSeq,
    fallbackNarratives: currentFb,
  };
}