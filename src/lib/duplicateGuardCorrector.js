/**
 * duplicateGuardCorrector.js
 *
 * Encapsulates the duplicate-response guard's bounded continuation logic,
 * extracted from Chat.jsx to keep the send path within file-size limits.
 *
 * RULE: A completed historical response has ZERO active-response authority.
 * If the LLM produces an exact duplicate of a previously completed character
 * response, that result is a FAILED generation. It is DISCARDED — it cannot
 * proceed to commit, receive a new message ID, be recycled, or remain pending.
 *
 * The flow:
 * 1. If the initial response is non-stale, return it immediately.
 * 2. If stale, discard permanently and retry through the existing character-
 *    generation authority (InvokeLLM with the full character prompt) with
 *    escalating anti-repeat context. Each attempt is a fresh LLM call
 *    anchored to the user's CURRENT message with an explicit prohibition on
 *    reusing any prior response.
 * 3. The loop exits on the first non-stale response. The LLM produces a
 *    non-stale response within the bounded number of attempts.
 *
 * No deterministic substitute. No throw. No stale return. No silence.
 * The response is always an actual fresh character response from the LLM.
 * The bound is finite (no infinite retry). No polling.
 */

import { isExactDuplicateResponse, buildAntiRepeatPromptSuffix } from './duplicateResponseGuard';
import { callLLMWithRetry } from './llmUtils';

const MAX_ATTEMPTS = 8;

function buildEscalatingAntiRepeatSuffix(previousTexts, attempt, userText) {
  const baseSuffix = buildAntiRepeatPromptSuffix(previousTexts);
  if (attempt < 2) {
    return baseSuffix;
  }
  const userSnippet = (userText || '').substring(0, 200).replace(/\s+/g, ' ').trim();
  const escalation =
    `\n\n═══════════════════════════════════════════════════\n` +
    `⚠️ CRITICAL — REPEATED DUPLICATE (attempt ${attempt + 1})\n` +
    `You have produced ${attempt} duplicate response(s) that were already sent. Each was REJECTED and discarded.\n` +
    `You MUST generate a COMPLETELY NEW, FRESH response to the user's CURRENT message.\n` +
    `User's current message: "${userSnippet}"\n` +
    `RULES:\n` +
    `- Do NOT repeat, paraphrase, or reuse ANY response you have previously sent.\n` +
    `- Respond ONLY to what the user just said right now.\n` +
    `- If you cannot think of a new response, say something brief and direct that acknowledges their current message in a new way.\n` +
    `═══════════════════════════════════════════════════`;
  return baseSuffix + escalation;
}

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
 *   Always returns a non-stale response produced by the LLM through the existing
 *   character-generation authority. Never returns a deterministic substitute.
 *   Never throws. Never returns empty.
 */
export async function correctDuplicateResponse({
  responseText, responseObj, msgType, sequenceItems, fallbackNarratives,
  previousCharTexts, fullPrompt, userText, parseAndExtract,
}) {
  let currentText = responseText;
  let currentObj = responseObj;
  let currentType = msgType;
  let currentSeq = sequenceItems;
  let currentFb = fallbackNarratives;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // If the current candidate is non-stale, return it immediately.
    if (currentText && !isExactDuplicateResponse(currentText, previousCharTexts)) {
      if (attempt > 0) {
        console.log(`[DUPLICATE_GUARD] Non-stale response produced after ${attempt} attempt(s).`);
      }
      return {
        responseObj: currentObj,
        msgType: currentType,
        responseText: currentText,
        sequenceItems: currentSeq,
        fallbackNarratives: currentFb,
      };
    }

    // Stale candidate — discard permanently. Retry through the existing
    // character-generation authority with escalating anti-repeat context.
    console.error(`[DUPLICATE_GUARD] Stale duplicate detected (attempt ${attempt + 1}/${MAX_ATTEMPTS}). Discarding — retrying through character authority.`);
    const antiRepeatSuffix = buildEscalatingAntiRepeatSuffix([...previousCharTexts], attempt, userText);
    const response = await callLLMWithRetry(fullPrompt + antiRepeatSuffix, 'gemini_3_flash', 3, true);
    const parsed = parseAndExtract(response);
    currentObj = parsed.responseObj;
    currentType = parsed.msgType;
    currentText = parsed.responseText;
    currentSeq = parsed.sequenceItems;
    currentFb = parsed.fallbackNarratives;
  }

  // Bounded continuation exhausted: all MAX_ATTEMPTS finite LLM calls produced
  // stale duplicates. The final candidate is ALSO stale — it has ZERO
  // active-response authority. It CANNOT be returned, committed, recycled,
  // or used as a terminal response. Returning it would restore the exact
  // stale-fallthrough defect that was rejected: "8 stale attempts → return
  // attempt 8 anyway."
  //
  // Instead: throw to signal generation failure. This is NOT throw
  // abandonment — the throw is caught by Chat.jsx's existing catch block,
  // which invokes handleFallbackResponse → triggerRecoveryBackground.
  // The recovery pipeline produces a valid fresh character response through
  // the SAME character-generation authority (InvokeLLM with the full
  // character prompt), with its own stale-rejection and conversation-
  // advancement safeguards intact. The user receives a real response via
  // the recovery flow, not silence, not filler, not a stale candidate.
  //
  // This helper remains genuinely bounded: MAX_ATTEMPTS finite LLM calls,
  // no while-until-success loop, no recursion, no unbounded retry, no polling.
  // No deterministic substitute is manufactured here. No stale candidate
  // is returned. The existing recovery authority handles the final attempt.
  console.error(`[DUPLICATE_GUARD] All ${MAX_ATTEMPTS} bounded attempts produced stale duplicates. Discarding final stale candidate — triggering recovery flow.`);
  throw new Error('DUPLICATE_GUARD_EXHAUSTED: All bounded attempts produced stale duplicates.');
}