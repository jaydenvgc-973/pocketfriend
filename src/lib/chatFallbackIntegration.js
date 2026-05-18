/**
 * Chat Fallback Integration
 * 
 * Handles fallback detection and recovery orchestration for Chat page.
 * Extracted from Chat.js to keep it under file size limits.
 */

import { ConversationRecoveryState, detectFallbackResponse, evaluateFallbackSavability } from '@/lib/fallbackCircuitBreaker';
import { runRecoveryDiagnostic, getRecoveryUserMessage } from '@/lib/recoveryDiagnostic';

const FALLBACK_TEXTS = [
  "Sorry, got pulled away for a sec — what were you saying?",
  "Give me a moment, something came up on my end.",
  "Hey sorry — I'm here, just had a second. What's up?",
  "My bad, got distracted. Say that again?",
  "Sorry, lost you for a second — I'm back.",
];

/**
 * Handle fallback response with circuit breaker logic.
 * Returns: { fallback_text, should_save, recovery_triggered }
 */
export async function handleFallbackResponse({
  characterId,
  conversationId,
  currentUser,
  base44,
  character,
  isMountedRef,
  setMessages,
}) {
  const convoId = conversationId;
  if (!convoId) {
    return { fallback_text: FALLBACK_TEXTS[0], should_save: true, recovery_triggered: false };
  }

  const fallbackText = FALLBACK_TEXTS[Math.floor(Math.random() * FALLBACK_TEXTS.length)];
  const recoveryState = new ConversationRecoveryState(currentUser?.email, convoId);
  
  // Detect if this is a fallback
  const isFallback = detectFallbackResponse(fallbackText);
  if (!isFallback) {
    return { fallback_text: fallbackText, should_save: true, recovery_triggered: false };
  }

  // Check circuit breaker
  const fallbackCheck = recoveryState.onFallbackDetected('llm_failure', 'response_generation');
  const savability = evaluateFallbackSavability(recoveryState);

  console.log(`[Chat] Fallback detected | should_trigger_recovery=${fallbackCheck.should_trigger_recovery} | should_save=${savability.should_save}`);

  if (!savability.should_save) {
    // Block second+ fallback, show recovery message
    const recoveryMsg = getRecoveryUserMessage(recoveryState.getState().blocking_stage);
    if (isMountedRef.current) {
      base44.entities.Message.create({
        conversation_id: convoId,
        sender_type: "character",
        character_id: characterId,
        character_name: character.name,
        content: recoveryMsg,
        emotional_state: "calm",
        is_read: true,
        timestamp: new Date().toISOString(),
      }).then(msg => {
        if (msg?.id && isMountedRef.current) {
          setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
        }
      }).catch(() => {});
    }

    // Trigger recovery in background
    if (fallbackCheck.should_trigger_recovery) {
      triggerRecoveryBackground(characterId, convoId, currentUser?.email, base44, character, recoveryState);
    }

    return { fallback_text: recoveryMsg, should_save: false, recovery_triggered: fallbackCheck.should_trigger_recovery };
  }

  // FIRST FALLBACK: allow save and trigger recovery
  return { fallback_text: fallbackText, should_save: true, recovery_triggered: fallbackCheck.should_trigger_recovery };
}

/**
 * Start recovery diagnostic in background without blocking the user.
 */
function triggerRecoveryBackground(characterId, convoId, ownerEmail, base44, character, recoveryState) {
  setTimeout(async () => {
    if (!recoveryState.canAttemptRecovery()) return;

    const diagnostic = await runRecoveryDiagnostic({
      characterId,
      conversationId: convoId,
      ownerEmail,
      base44,
    });

    if (diagnostic.success) {
      recoveryState.markRecoveryComplete();
      if (character?.id) {
        recoveryState.setCharacterCache(character.id, diagnostic.recovered_cache);
      }
      console.log(`[Chat] Recovery completed and cached`);
    } else {
      recoveryState.recordRecoveryAttempt(Object.keys(diagnostic.stages).find(k => diagnostic.stages[k]));
      recoveryState.markRecoveryFailed(diagnostic.blocking_stage);
      console.warn(`[Chat] Recovery failed at stage: ${diagnostic.blocking_stage}`);
    }
  }, 100);
}

/**
 * Get proof logs from recovery state.
 * For debugging and monitoring.
 */
export function getRecoveryProof(conversationId, ownerEmail) {
  if (!conversationId || !ownerEmail) return null;
  const recoveryState = new ConversationRecoveryState(ownerEmail, conversationId);
  return recoveryState.getProof();
}