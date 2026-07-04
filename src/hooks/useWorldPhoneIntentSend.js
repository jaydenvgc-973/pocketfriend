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
import { checkEcho, isVerificationRequest, isExactSendInstruction } from "@/lib/worldPhoneEchoGuard";
import { resolveRelationshipRoleRecipient } from "@/lib/relationshipRoleResolver";

/**
 * buildWorldPhonePayload
 *
 * Constructs the sendWorldPhoneMessage payload from a detected intent + conversation context.
 * Shared by both Chat.jsx inline path and useWorldPhoneIntentSend hook.
 *
 * PIPELINE AUTHORITY RULES:
 *
 * Field classifications:
 *   user_instruction_context   — what the user told Character A to do. NEVER becomes Message.content.
 *   requested_message          — outbound content ONLY if (a) the user explicitly said "send this exact
 *                                message" OR (b) the detected message is clearly NOT the user's instruction
 *                                text (i.e. it passed the echo guard).
 *   generated_outbound_message — the backend generates this in Character A's voice when requested_message is null.
 *
 * The echo guard blocks any case where the user's raw sentence would become Character B's received message.
 * Past-tense queries ("Did you reach out to X?") are verification requests — they never trigger a send.
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

  // ── ECHO GUARD: never let the user's instruction become the outbound message ──
  // If intent.message was extracted from the user's text, check whether it's actually
  // a user instruction sentence rather than explicit relay content.
  let safeRequestedMessage = intent.message || null;

  if (safeRequestedMessage) {
    // Block if the candidate message echoes the user's trigger sentence
    const { isEcho, reason } = checkEcho(text, safeRequestedMessage);
    if (isEcho) {
      console.warn(`[WorldPhone:EchoGuard] Blocked echo (${reason}) — user instruction will not become outbound message. Regenerating in character voice.`);
      safeRequestedMessage = null;
    }
    // Block if this is a verification request — "did you reach out to X?" is not a send trigger
    // and the extracted "message" would be the question itself
    if (safeRequestedMessage && isVerificationRequest(text)) {
      console.warn('[WorldPhone:EchoGuard] Blocked: user message is a verification request, not a send instruction.');
      safeRequestedMessage = null;
    }
    // Only allow verbatim if user explicitly asked for exact-send
    if (!safeRequestedMessage && isExactSendInstruction(text)) {
      safeRequestedMessage = intent.message;
    }
  }

  const payload = {
    sender_character_id: characterId,
    // Only pass requested_message if it survived the echo guard
    requested_message: safeRequestedMessage,
    // Always pass user_instruction_context so the backend knows what the user asked for
    // (used as topic context for LLM generation, never as message body)
    user_instruction_context: text,
    recent_conversation_context: recentConvoContext,
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

  // ── RELATIONSHIP-ROLE RESOLUTION ("text your dad") ───────────────────────────
  // Resolve the role against the acting character's authoritative family_members /
  // fictional_relationships. Pass the resolved character ID to sendWorldPhoneMessage
  // (backend recipient path #1: direct character ID). Conversation history is never
  // consulted for relationship-role recipients.
  if (intent.relationshipRoleIntent) {
    const resolved = resolveRelationshipRoleRecipient(character, intent.role);
    if (!resolved) {
      console.warn(`[WorldPhone] Relationship role "${intent.role}" unresolved from authoritative data — skipping send`);
      return { worldPhoneIntent: intent, worldPhoneSendResult: { data: { success: false, error: 'relationship_role_unresolvable', role: intent.role } } };
    }
    console.log(`[WorldPhone] Relationship role "${intent.role}" → character ${resolved.characterId} (${resolved.name || 'unnamed'}) from authoritative data`);
    const effectiveIntent = { ...intent, recipient: resolved.characterId };
    const wpPayload = buildWorldPhonePayload({ intent: effectiveIntent, text, characterId, conversationId, currentUserEmail, recentMessages, characterName: character?.name || '' });
    const result = await base44.functions.invoke('sendWorldPhoneMessage', wpPayload).catch(err => ({ data: { success: false, error: err.message } }));
    console.log(`[WorldPhone] send result for role "${intent.role}":`, result?.data);
    return { worldPhoneIntent: intent, worldPhoneSendResult: result };
  }

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