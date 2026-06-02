/**
 * useWorldPhoneIntentSend.js
 *
 * Handles pre-send World Phone intent detection and execution.
 * Called from Chat.jsx sendMessage() BEFORE the LLM call.
 *
 * Handles three cases:
 * 1. Explicit name: "text Maya that I'll be late" → sends immediately
 * 2. Recipient-only: "text Maya" / "message Devon" → sends with LLM-generated content
 * 3. Pronoun: "text him now" / "call her" → resolves him/her from conversation context then sends
 */

import { base44 } from "@/api/base44Client";
import { detectWorldPhoneIntent } from "@/lib/worldPhoneIntentDetector";

/**
 * Resolves a pronoun ("him", "her", "them") to a known contact name
 * by scanning recent conversation messages.
 */
function resolvePronounFromContext(pronoun, character, recentMessages) {
  const knownNames = [
    ...(character?.fictional_relationships || []).map(r => r.person_name).filter(Boolean),
    ...(character?.family_members || []).map(f => f.name).filter(Boolean),
  ];
  if (knownNames.length === 0) return null;

  // Scan from most recent message backward to find who was last mentioned
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const content = (recentMessages[i].content || '').toLowerCase();
    for (const name of knownNames) {
      if (name.length > 2 && content.includes(name.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Detects and executes a World Phone send based on the user's message.
 *
 * @returns {{ worldPhoneIntent: object|null, worldPhoneSendResult: object|null }}
 */
export async function detectAndSendWorldPhoneIntent({
  text,
  characterId,
  character,
  conversationId,
  currentUserEmail,
  recentMessages,
}) {
  const intent = detectWorldPhoneIntent(text);
  if (!intent) return { worldPhoneIntent: null, worldPhoneSendResult: null };

  let resolvedRecipient = intent.recipient;

  // ── PRONOUN RESOLUTION ────────────────────────────────────────────────────
  if (intent.pronounIntent) {
    resolvedRecipient = resolvePronounFromContext(intent.pronoun, character, recentMessages);
    if (!resolvedRecipient) {
      console.warn(`[WorldPhone] Pronoun "${intent.pronoun}" could not be resolved from conversation context — skipping send`);
      // Return the intent as detected but no send — character should not claim it was sent
      return { worldPhoneIntent: intent, worldPhoneSendResult: { data: { success: false, error: 'pronoun_unresolvable' } } };
    }
    console.log(`[WorldPhone] Pronoun "${intent.pronoun}" resolved to "${resolvedRecipient}" from context`);
  }

  if (!resolvedRecipient) {
    return { worldPhoneIntent: intent, worldPhoneSendResult: null };
  }

  // ── SEND ──────────────────────────────────────────────────────────────────
  // If no message content provided, pass the full user text as context
  // so the backend LLM can generate the message in the character's voice.
  const messageToSend = intent.message || text;

  const result = await base44.functions.invoke('sendWorldPhoneMessage', {
    sender_character_id: characterId,
    recipient_identifier: resolvedRecipient,
    requested_message: messageToSend,
    source: 'user_instruction',
    current_conversation_id: conversationId,
    owner_email: currentUserEmail,
  }).catch(err => ({ data: { success: false, error: err.message } }));

  console.log(`[WorldPhone] send result for "${resolvedRecipient}":`, result?.data);
  return { worldPhoneIntent: intent, worldPhoneSendResult: result };
}