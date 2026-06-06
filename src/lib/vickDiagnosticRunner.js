/**
 * vickDiagnosticRunner.js
 *
 * Entry point for Chat.jsx to route Vick Servicio messages.
 * Delegates ALL intelligence to vickServiceBridge.js — the same source as
 * the Settings page Account Help & Repair assistant.
 *
 * This is NOT a separate diagnostic system.
 * There is NO one-shot summary injection.
 * There is NO separate Vick knowledge database.
 *
 * Vick uses userAccountDiagnostic (same as SupportAssistant) + the full
 * architecture map prompt + persistent conversation history per conversation.
 */

import { isVickServicioCharacter, hasVickServiceIntent } from '@/lib/vickDiagnosticIntentCheck';
import { handleVickMessage } from '@/lib/vickServiceBridge';
import { base44 } from '@/api/base44Client';

/**
 * Returns true if this Vick message should be routed through the service bridge.
 * Vick routes through the bridge whenever the user asks a service question.
 * Normal conversational messages (greetings, non-system topics) still use the
 * standard NPC path so Vick can have personality outside diagnostic conversations.
 */
export function shouldUseVickFastPath(character, text) {
  return isVickServicioCharacter(character) && hasVickServiceIntent(text);
}

// Re-export for backward compat
export { isVickServicioCharacter };

/**
 * Full Vick service path execution.
 * Routes through vickServiceBridge which uses the same source as SupportAssistant.
 * Saves the response message and returns { handled: true } on success.
 */
export async function executeVickDiagnosticFastPath({
  character, characterId, text, convoId, userMsg,
  callLLMWithRetry, parseCharacterResponse, filterDashes, stripCharacterNamePrefix,
  base44: _base44, setMessages, setIsTyping, releaseFgTask, isMountedRef,
  ownerEmail, isPrivate = true,
  imageUrls = [],
}) {
  console.log(`[VICK_BRIDGE] executeVickDiagnosticFastPath START char=${character.name} private=${isPrivate} images=${imageUrls.length}`);

  const result = await handleVickMessage({
    text,
    conversationId: convoId,
    ownerEmail: ownerEmail || userMsg?.owner_email,
    character,
    isPrivate,
    imageUrls,
  });

  if (!result.handled || !result.responseText) {
    console.warn(`[VICK_BRIDGE] handleVickMessage returned unhandled — falling through to normal NPC path`);
    return { handled: false };
  }

  const vickMsg = await base44.entities.Message.create({
    conversation_id: convoId,
    sender_type: 'character',
    character_id: characterId,
    character_name: character.name,
    content: result.responseText,
    is_read: true,
    timestamp: new Date().toISOString(),
    source_message_id: userMsg?.id || null,
    reply_to_message_id: userMsg?.id || null,
    recovery_signal: false,
    memory_eligible: false,
    relationship_eligible: false,
    channel: 'direct',
  });

  if (vickMsg?.id && isMountedRef.current) {
    setMessages(prev => prev.some(m => m.id === vickMsg.id) ? prev : [...prev, vickMsg]);
    console.log(`[VICK_BRIDGE] Message saved id=${vickMsg.id} preview="${result.responseText.substring(0, 100)}"`);
  }

  if (isMountedRef.current) setIsTyping(false);
  releaseFgTask();

  await base44.entities.Conversation.update(convoId, {
    last_message_preview: result.responseText.substring(0, 100),
    last_message_date: new Date().toISOString(),
  }).catch(() => {});

  return { handled: true, responseText: result.responseText };
}

// Legacy exports kept for backward compat — no longer used internally
export function buildVickFastPathPrompt() { return ''; }
export async function runVickDiagnosticIfNeeded() { return null; }