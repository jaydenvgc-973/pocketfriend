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
 *
 * Also exports buildWorldPhonePayload — used by Chat.jsx's inline World Phone dispatch path
 * to ensure both paths apply identical intent-to-message logic.
 */

import { base44 } from "@/api/base44Client";
import { detectWorldPhoneIntent } from "@/lib/worldPhoneIntentDetector";

/**
 * buildWorldPhonePayload
 *
 * Constructs the sendWorldPhoneMessage payload from a detected intent + conversation context.
 * Shared by both Chat.jsx inline path and useWorldPhoneIntentSend hook.
 *
 * KEY RULE: Never pass the raw user instruction as requested_message.
 * - If intent.message exists (actual content to relay) → use it as requested_message
 * - If intent.message is null (bare command like "send it", "text him") → pass null
 *   and pass user_instruction_context + recent_conversation_context so the backend
 *   can recover the pending intent from conversation history.
 */
export function buildWorldPhonePayload({
  intent,
  text,
  characterId,
  conversationId,
  currentUserEmail,
  recentMessages,
  characterName,
}) {
  const recentConvoContext = recentMessages.slice(-20).map(m =>
    `${m.sender_type === 'user' ? 'User' : characterName}: ${m.content || ''}`
  ).join('\n') + `\nUser: ${text}`;

  const payload = {
    sender_character_id: characterId,
    requested_message: intent.message || null,
    user_instruction_context: intent.message ? null : text,
    recent_conversation_context: intent.message ? null : recentConvoContext,
    source: 'user_instruction',
    current_conversation_id: conversationId,
    owner_email: currentUserEmail,
  };

  if (intent.pronounIntent) {
    payload.pronoun_context = recentConvoContext;
    payload.recipient_identifier = null;
  } else {
    payload.recipient_identifier = intent.recipient;
  }

  return payload;
}

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
  // Use buildWorldPhonePayload — the single source of truth for intent-to-payload conversion.
  // resolvedRecipient may differ from intent.recipient if pronoun was resolved.
  const effectiveIntent = { ...intent, recipient: resolvedRecipient };
  const wpPayload = buildWorldPhonePayload({
    intent: effectiveIntent,
    text,
    characterId,
    conversationId,
    currentUserEmail,
    recentMessages,
    characterName: character?.name || '',
  });

  const result = await base44.functions.invoke('sendWorldPhoneMessage', wpPayload).catch(err => ({ data: { success: false, error: err.message } }));

  console.log(`[WorldPhone] send result for "${resolvedRecipient}":`, result?.data);
  return { worldPhoneIntent: intent, worldPhoneSendResult: result };
}