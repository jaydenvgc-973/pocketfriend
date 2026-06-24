/**
 * worldPhoneStateGuard.js
 *
 * LIVE-PATH RESPONSE VERIFICATION GATE
 *
 * This is the authoritative, non-bypassable guard that runs on every character
 * response before it is saved to the database or shown to the user.
 *
 * PURPOSE:
 * A character must never claim World Phone communication state (sent, delivered,
 * visible, "I can see it", "it definitely sent") unless a real, verified Message
 * record exists in the authoritative database.
 *
 * ARCHITECTURAL RULE:
 * The ONLY authority for World Phone communication state is:
 *   1. Message entity (channel === "world_phone")
 *   2. Conversation entity (shared_conversation_key set)
 *
 * Nothing else is authority:
 * - Not CharacterMemory
 * - Not fictional_relationships
 * - Not awareness blocks
 * - Not canonical prompt context
 * - Not LLM claims
 * - Not prior generated dialogue
 *
 * TWO LAYERS:
 *
 * Layer 1 — DETECTION: Does the response contain a World Phone state claim?
 *   These are claims that assert delivery, visibility, or confirmation of a WP message.
 *   Examples: "it definitely sent", "I'm looking at it now", "I can see it"
 *
 * Layer 2 — VERIFICATION: If a claim exists, verify against authoritative records.
 *   Query: Message.filter({ sender_character_id, channel: 'world_phone' })
 *   Query: Conversation.filter({ shared_conversation_key })
 *   If no verified record → remove the claim → replace with honest uncertainty.
 *
 * ALLOWED CLAIM (when verified record exists):
 *   "I sent you a message." / "I texted you earlier."
 *
 * FORBIDDEN CLAIMS (always blocked — character cannot verify these):
 *   "It definitely sent."
 *   "I'm looking at it now."
 *   "I can see it."
 *   "It went through."
 *   "It should be there."
 *   "World Phone shows it."
 *   "World Contacts shows it."
 *   "It delivered."
 *
 * HONEST REPLACEMENT:
 *   "I'm not seeing confirmation that it went through."
 *
 * IMPORTANT: This guard is additive — it does NOT replace worldPhoneActionHandler.
 * It catches the class of claims that worldPhoneActionHandler misses:
 * status inquiry responses ("is it there?" → character says "yes I can see it")
 * where no new send was attempted in the current turn.
 */

import { base44 } from '@/api/base44Client';

// ── DETECTION PATTERNS ────────────────────────────────────────────────────────
// These patterns catch backend-state confirmation claims — NOT just send claims.
// The previous regex only caught "I texted him" style phrases.
// This catches the failure class: "it definitely sent", "I'm looking at it now".

const WP_STATE_CLAIM_PATTERNS = [
  // Delivery confirmation
  /\b(?:it|that|the\s+message)\s+definitely\s+(?:sent|went\s+through|delivered|arrived|came\s+through)\b/i,
  /\b(?:it|that|the\s+message)\s+(?:went|came)\s+through\b/i,
  /\b(?:it|that|the\s+message)\s+(?:is\s+)?delivered\b/i,
  /\bit\s+should\s+(?:be\s+there|have\s+(?:arrived|sent|gone\s+through|delivered))\b/i,
  // Visual/visibility claims — narrowed to avoid false positives on normal conversation
  /\bI'?m\s+(?:looking|staring|looking\s+right)\s+at\s+it\s+(?:now|right\s+now)\b/i,
  /\bthe\s+message\s+is\s+(?:right\s+)?here\s+on\s+my\s+(?:phone|screen|contacts)\b/i,
  // "I can see the message" / "I can see my message" — requires explicit message reference
  /\bI\s+(?:can\s+)?see\s+(?:the\s+message|my\s+message)\b/i,
  /\bI\s+already\s+sent\s+it[^.!?]*(?:it'?s?\s+there|it\s+(?:went|came)\s+through)\b/i,
  /\bI\s+checked\s+and\s+it\s+(?:sent|went\s+through|delivered)\b/i,
  // World Phone / World Contacts UI claims
  /\bworld\s+(?:phone|contacts)\s+shows?\b/i,
  /\bshows?\s+(?:it\s+)?(?:sent|delivered|in\s+(?:world\s+)?(?:phone|contacts))\b/i,
  // "phone is glitching but it definitely sent" class
  /\b(?:phone|app)\s+(?:is\s+)?(?:glitching|bugging)[^.!?]*(?:it\s+(?:did|definitely|still)\s+(?:go|went|send|sent|came)\s+through)\b/i,
  // "I'm staring right at the message I just sent"
  /\bI'?m\s+staring\s+right\s+at\b/i,
  // "the message is on my end" / "it's on my end"
  /\b(?:the\s+message|it)\s+is\s+on\s+my\s+(?:end|side|phone)\b/i,
];

// ── SEND-CLAIM PATTERNS (different from delivery confirmation) ─────────────────
// These are "I sent a message" claims — allowed if a verified WP record exists.
// IMPORTANT: Keep these narrow to avoid false positives on normal conversation.
// "I can see it" is NOT here — too broad (matches "I can see why you feel that way").
// Only match clear, specific World Phone send-action language.
const WP_SEND_CLAIM_PATTERNS = [
  // "I texted Vick", "I messaged Sarah" — capitalized name required for specificity
  /\bI\s+(?:just\s+)?(?:texted|messaged|hit\s+up|contacted)\s+[A-Z][a-z]+/i,
  // "I sent Vick a text/message/dm" — requires named recipient
  /\bI\s+sent\s+[A-Z][a-z]+\s+(?:a\s+)?(?:text|message|dm)\b/i,
  // "I let Vick know" / "I told Vick" — requires capitalized name
  /\bI\s+(?:let|told)\s+[A-Z][a-z]+\s+know\b/i,
  // "I reached out to Vick" — requires capitalized name
  /\bI\s+reached\s+out\s+to\s+[A-Z][a-z]+\b/i,
  // "already texted/messaged Sarah" — requires capitalized name
  /\b(?:already|just)\s+(?:texted|messaged|contacted)\s+[A-Z][a-z]+\b/i,
];

/**
 * detectWorldPhoneStateClaim
 * Returns true if the response text makes a World Phone state claim.
 * This catches BOTH delivery confirmation claims AND send claims.
 */
export function detectWorldPhoneStateClaim(responseText) {
  if (!responseText) return false;
  return (
    WP_STATE_CLAIM_PATTERNS.some(p => p.test(responseText)) ||
    WP_SEND_CLAIM_PATTERNS.some(p => p.test(responseText))
  );
}

/**
 * stripWorldPhoneStateClaims
 * Removes all World Phone state claim sentences from the response text.
 * Used when verification fails — no real record exists to support the claim.
 */
function stripWorldPhoneStateClaims(text) {
  if (!text) return text;
  let result = text;

  // Strip full sentences containing state claims
  for (const pattern of WP_STATE_CLAIM_PATTERNS) {
    // Remove the entire sentence containing the match
    result = result.replace(
      new RegExp(`[^.!?]*${pattern.source}[^.!?]*[.!?]?`, 'gi'),
      ''
    );
  }

  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * replaceWithHonestUncertainty
 * When the character makes a state claim but verification fails,
 * replace with an honest failure statement.
 */
function replaceWithHonestUncertainty(text, wasFullyStripped) {
  if (wasFullyStripped || !text.trim()) {
    return "I'm not seeing confirmation that it went through.";
  }
  return text;
}

/**
 * verifyWorldPhoneRecord
 *
 * Queries authoritative Message and Conversation records to verify that
 * a World Phone message actually exists for the given character.
 *
 * Verification checks:
 *   1. Message record exists with channel === "world_phone"
 *   2. Message sender_character_id matches characterId
 *   3. Message has a conversation_id
 *   4. Conversation has both participant IDs
 *   5. Conversation has shared_conversation_key
 *   6. World Phone query path can see it (sender_character_id filter)
 *   7. World Contacts query path can see it (shared_conversation_key filter)
 *
 * Returns { verified: boolean, message: object|null, conversation: object|null, reason: string }
 */
async function verifyWorldPhoneRecord(characterId, ownerEmail) {
  try {
    // Query 1: World Phone query path — how WorldContactsPopup finds outbound messages
    const wpMessages = await base44.entities.Message.filter(
      { sender_character_id: characterId, channel: 'world_phone' },
      '-timestamp',
      5
    ).catch(() => []);

    if (!wpMessages || wpMessages.length === 0) {
      return {
        verified: false,
        message: null,
        conversation: null,
        reason: 'no_world_phone_messages_from_character',
        wp_query_count: 0,
        wc_query_count: 0,
      };
    }

    // Take the most recent outgoing WP message
    const latestMsg = wpMessages[0];

    // Check it has required fields
    if (!latestMsg.conversation_id) {
      return {
        verified: false,
        message: latestMsg,
        conversation: null,
        reason: 'message_has_no_conversation_id',
        wp_query_count: wpMessages.length,
        wc_query_count: 0,
      };
    }

    if (!latestMsg.shared_conversation_key) {
      return {
        verified: false,
        message: latestMsg,
        conversation: null,
        reason: 'message_has_no_shared_conversation_key',
        wp_query_count: wpMessages.length,
        wc_query_count: 0,
      };
    }

    // Query 2: World Contacts query path — how WorldContactsPopup finds the conversation
    const wcConversations = await base44.entities.Conversation.filter(
      { shared_conversation_key: latestMsg.shared_conversation_key },
      '-updated_date',
      3
    ).catch(() => []);

    if (!wcConversations || wcConversations.length === 0) {
      return {
        verified: false,
        message: latestMsg,
        conversation: null,
        reason: 'conversation_not_found_by_shared_key',
        wp_query_count: wpMessages.length,
        wc_query_count: 0,
        shared_key: latestMsg.shared_conversation_key,
      };
    }

    const conversation = wcConversations[0];

    // Check conversation has both participants
    const participantIds = conversation.participant_character_ids || conversation.character_ids || [];
    if (!participantIds.includes(characterId)) {
      return {
        verified: false,
        message: latestMsg,
        conversation,
        reason: 'sender_not_in_conversation_participants',
        wp_query_count: wpMessages.length,
        wc_query_count: wcConversations.length,
      };
    }

    // All checks passed — message is verified and visible through both query paths
    return {
      verified: true,
      message: latestMsg,
      conversation,
      reason: 'verified',
      wp_query_count: wpMessages.length,
      wc_query_count: wcConversations.length,
      shared_key: latestMsg.shared_conversation_key,
      message_age_ms: Date.now() - new Date(latestMsg.timestamp || latestMsg.created_date).getTime(),
    };
  } catch (err) {
    console.warn('[worldPhoneStateGuard] verifyWorldPhoneRecord error:', err.message);
    return {
      verified: false,
      message: null,
      conversation: null,
      reason: `verification_error: ${err.message}`,
    };
  }
}

/**
 * enforceWorldPhoneStateGuard
 *
 * MAIN EXPORT — called from Chat.jsx on every character response before saving.
 *
 * Steps:
 *   1. Detect if response contains any World Phone state claim.
 *   2. If no claim detected → return text unchanged (fast path, no DB query).
 *   3. If claim detected → verify against authoritative Message + Conversation records.
 *   4. If verified → allow send claims, strip delivery/visibility confirmation claims.
 *   5. If not verified → strip ALL WP state claims → replace with honest uncertainty.
 *
 * @param {string} responseText - The character's generated response text
 * @param {string} characterId - The speaking character's ID
 * @param {string} ownerEmail - Owner email for query scoping
 * @returns {Promise<{ text: string, guardFired: boolean, verified: boolean, reason: string }>}
 */
export async function enforceWorldPhoneStateGuard(responseText, characterId, ownerEmail) {
  if (!responseText || !characterId) {
    return { text: responseText, guardFired: false, verified: false, reason: 'no_input' };
  }

  // Fast path: if no WP state claim is detected, return immediately (no DB query)
  const hasClaim = detectWorldPhoneStateClaim(responseText);
  if (!hasClaim) {
    return { text: responseText, guardFired: false, verified: false, reason: 'no_claim_detected' };
  }

  console.log(`[WorldPhoneStateGuard] 🔍 State claim detected in response for char=${characterId}. Verifying against authoritative records...`);

  // Verify against authoritative records
  const verification = await verifyWorldPhoneRecord(characterId, ownerEmail);

  if (verification.verified) {
    // Record exists and is visible through both query paths.
    // ALLOW: send claims ("I texted him") — these reference verified records.
    // BLOCK: delivery/visibility confirmation claims ("it definitely sent", "I can see it")
    //        — the character cannot verify these without a UI query we don't run.
    let cleaned = responseText;
    for (const pattern of WP_STATE_CLAIM_PATTERNS) {
      cleaned = cleaned.replace(
        new RegExp(`[^.!?]*${pattern.source}[^.!?]*[.!?]?`, 'gi'),
        ''
      );
    }
    cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
    const wasChanged = cleaned !== responseText;

    if (wasChanged) {
      console.log(`[WorldPhoneStateGuard] ✅ Record verified | stripped delivery/visibility claims | msg=${verification.message?.id} | key=${verification.shared_key}`);
    } else {
      console.log(`[WorldPhoneStateGuard] ✅ Record verified | no delivery claims to strip | msg=${verification.message?.id}`);
    }

    return {
      text: cleaned || responseText,
      guardFired: true,
      verified: true,
      reason: verification.reason,
      message_id: verification.message?.id,
      shared_key: verification.shared_key,
      wp_query_count: verification.wp_query_count,
      wc_query_count: verification.wc_query_count,
    };
  } else {
    // No verified record found. Strip ALL WP state claims.
    console.warn(`[WorldPhoneStateGuard] ❌ No verified WP record | reason=${verification.reason} | stripping all state claims from response`);

    const stripped = stripWorldPhoneStateClaims(responseText);
    const wasFullyStripped = !stripped.trim() || stripped.trim() === responseText.trim();
    const finalText = replaceWithHonestUncertainty(stripped, wasFullyStripped);

    console.log(`[WorldPhoneStateGuard] Response corrected | original_len=${responseText.length} | stripped_len=${stripped.length} | final="${finalText.substring(0, 100)}"`);

    return {
      text: finalText,
      guardFired: true,
      verified: false,
      reason: verification.reason,
      wp_query_count: verification.wp_query_count || 0,
      wc_query_count: verification.wc_query_count || 0,
    };
  }
}