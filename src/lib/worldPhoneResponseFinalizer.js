/**
 * worldPhoneResponseFinalizer.js
 *
 * RESULT-DRIVEN RESPONSE FINALIZER
 *
 * This is the single, authoritative finalization step for character responses
 * that involve World Phone communication. It replaces patchwork regex bypass logic.
 *
 * It receives the ACTUAL send result and applies rules based on what really happened:
 *
 * Case 1 — User-requested send SUCCEEDED (wpSendResult.success === true):
 *   ALLOW:  "I sent the message." / "I texted Vick." / "I let him know."
 *   STRIP:  All delivery/visibility confirmation claims ("it definitely sent",
 *           "they have it now", "I can see it", "it went through", etc.)
 *   REASON: The Message record exists. The character CAN confirm they sent.
 *           The character CANNOT confirm delivery, recipient visibility, or UI state.
 *
 * Case 2 — User-requested send FAILED (wpSendResult.success === false):
 *   STRIP:  ALL send confirmations AND delivery claims.
 *   REPLACE: With honest uncertainty: "I'm not seeing confirmation that it went through."
 *   REASON: No Message record was created. Any claim is fabricated.
 *
 * Case 3 — No World Phone intent this turn:
 *   PASS THROUGH to the existing enforceWorldPhoneStateGuard for DB verification.
 *   (no change from current behavior)
 *
 * IMPORTANT: This finalizer does NOT bypass the state guard for Case 3.
 * It only finalizes responses when we have a definitive send result from THIS turn.
 */

// ── DELIVERY / VISIBILITY CLAIM PATTERNS ─────────────────────────────────────
// These are claims that assert delivery confirmed, recipient visibility,
// or "I can verify the state" — none of which a character can know after a send.
// Keep these narrow: only match explicit delivery/visibility language.
const DELIVERY_CLAIM_PATTERNS = [
  // "it definitely sent/went through/delivered/arrived"
  /\b(?:it|that|the\s+message)\s+definitely\s+(?:sent|went\s+through|delivered|arrived|came\s+through)\b/i,
  // "it went through" / "it came through"
  /\b(?:it|that|the\s+message)\s+(?:went|came)\s+through\b/i,
  // "it delivered" / "it's delivered"
  /\b(?:it|that|the\s+message)\s+(?:is\s+)?delivered\b/i,
  // "it should be there" / "it should have arrived"
  /\bit\s+should\s+(?:be\s+there|have\s+(?:arrived|sent|gone\s+through|delivered))\b/i,
  // "I'm looking at it now" (with "now" — narrowed to avoid "I'm looking at it")
  /\bI'?m\s+(?:looking|staring|looking\s+right)\s+at\s+it\s+(?:now|right\s+now)\b/i,
  // "the message is right here on my phone/screen"
  /\bthe\s+message\s+is\s+(?:right\s+)?here\s+on\s+my\s+(?:phone|screen|contacts)\b/i,
  // "I can see the message" / "I can see my message" — explicit message reference only
  /\bI\s+(?:can\s+)?see\s+(?:the\s+message|my\s+message)\b/i,
  // "I already sent it [and] it's there/went through"
  /\bI\s+already\s+sent\s+it[^.!?]*(?:it'?s?\s+there|it\s+(?:went|came)\s+through)\b/i,
  // "I checked and it sent/went through/delivered"
  /\bI\s+checked\s+and\s+it\s+(?:sent|went\s+through|delivered)\b/i,
  // "World Phone/Contacts shows it"
  /\bworld\s+(?:phone|contacts)\s+shows?\b/i,
  // "I'm staring right at"
  /\bI'?m\s+staring\s+right\s+at\b/i,
  // "the message is on my end/side/phone"
  /\b(?:the\s+message|it)\s+is\s+on\s+my\s+(?:end|side|phone)\b/i,
  // "they have it" / "they got it" — recipient confirmation claims
  /\bthey\s+(?:have|got|received|should\s+have)\s+it\b/i,
  // "they can see it" / "they should see it"
  /\bthey\s+(?:can|should)\s+see\s+it\b/i,
];

// ── SEND CONFIRMATION PATTERNS ─────────────────────────────────────────────────
// These are claims that assert the character performed the send action.
// ALLOWED after a confirmed successful send. STRIPPED after a failed send.
const SEND_CONFIRMATION_PATTERNS = [
  // "I texted/messaged/called/hit up [Name]"
  /\bI\s+(?:just\s+)?(?:texted|messaged|called|hit\s+up|contacted)\s+[A-Z][a-z]+/i,
  // "I sent [Name] a text/message/dm"
  /\bI\s+sent\s+[A-Z][a-z]+\s+(?:a\s+)?(?:text|message|dm)\b/i,
  // "I let/told [Name] know"
  /\bI\s+(?:let|told)\s+[A-Z][a-z]+\s+know\b/i,
  // "I reached out to [Name]"
  /\bI\s+reached\s+out\s+to\s+[A-Z][a-z]+\b/i,
  // "I sent the message" / "I sent it" / "I sent a message"
  /\bI\s+sent\s+(?:the\s+|a\s+)?message\b/i,
  /\bI\s+sent\s+it\b/i,
  // "already texted/messaged [Name]"
  /\b(?:already|just)\s+(?:texted|messaged|called|contacted)\s+[A-Z][a-z]+\b/i,
  // "message sent" / "text sent"
  /\b(?:message|text)\s+sent\b/i,
];

/**
 * Strip all delivery/visibility confirmation claims from a response.
 * Operates sentence-by-sentence to avoid over-stripping unrelated content.
 */
function stripDeliveryClaims(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of DELIVERY_CLAIM_PATTERNS) {
    // Remove the entire sentence containing the match
    result = result.replace(
      new RegExp(`[^.!?]*${pattern.source}[^.!?]*[.!?]?`, 'gi'),
      ' '
    );
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Strip all send confirmation claims from a response.
 * Used when the send failed — character must not claim they sent anything.
 */
function stripSendConfirmations(text) {
  if (!text) return text;
  let result = text;
  for (const pattern of SEND_CONFIRMATION_PATTERNS) {
    result = result.replace(
      new RegExp(`[^.!?]*${pattern.source}[^.!?]*[.!?]?`, 'gi'),
      ' '
    );
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * finalizeWorldPhoneResponse
 *
 * MAIN EXPORT — call this from Chat.jsx after a World Phone send was attempted.
 *
 * @param {string} responseText - The character's generated response text
 * @param {object|null} wpSendResult - The result from sendWorldPhoneMessage (null if no intent)
 * @param {boolean} hadWorldPhoneIntent - Whether the user explicitly requested a send this turn
 * @returns {{ text: string, finalized: boolean, case: string, stripped: string[] }}
 */
export function finalizeWorldPhoneResponse(responseText, wpSendResult, hadWorldPhoneIntent) {
  if (!responseText) {
    return { text: responseText, finalized: false, case: 'no_text', stripped: [] };
  }

  // Case 3: No World Phone intent this turn — pass through unchanged.
  // The enforceWorldPhoneStateGuard will handle DB verification separately.
  if (!hadWorldPhoneIntent) {
    return { text: responseText, finalized: false, case: 'no_intent', stripped: [] };
  }

  const sendSucceeded = !!(wpSendResult?.success);

  if (sendSucceeded) {
    // Case 1: Send succeeded — allow send confirmations, strip delivery/visibility claims.
    const stripped = stripDeliveryClaims(responseText);
    const changed = stripped !== responseText;
    
    const finalText = stripped || responseText; // never return empty if send succeeded
    
    console.log(
      `[WPResponseFinalizer] case=send_success | changed=${changed}` +
      ` | msg=${wpSendResult?.message_id || 'none'}` +
      ` | before_len=${responseText.length} | after_len=${finalText.length}`
    );

    return {
      text: finalText,
      finalized: true,
      case: 'send_success',
      stripped: changed ? ['delivery_claims'] : [],
      message_id: wpSendResult?.message_id,
      conversation_id: wpSendResult?.conversation_id,
    };
  } else {
    // Case 2: Send failed — strip ALL send confirmations AND delivery claims.
    // Character must not claim they sent anything.
    let cleaned = stripDeliveryClaims(responseText);
    cleaned = stripSendConfirmations(cleaned);
    const isEmpty = !cleaned.trim();

    const finalText = isEmpty
      ? "I'm not seeing confirmation that it went through."
      : cleaned;

    console.log(
      `[WPResponseFinalizer] case=send_failed | reason=${wpSendResult?.error || 'unknown'}` +
      ` | was_empty=${isEmpty} | before_len=${responseText.length} | after_len=${finalText.length}`
    );

    return {
      text: finalText,
      finalized: true,
      case: 'send_failed',
      stripped: ['send_confirmations', 'delivery_claims'],
      error: wpSendResult?.error,
    };
  }
}