/**
 * chatFallbackIntegration.js
 * 
 * Fallback recovery mechanism for Chat LLM failures.
 * 
 * Circuit Breaker Rule:
 * - Do NOT save "Sorry, got pulled away..." as a character Message
 * - Do NOT update memory, relationships, or progression with fallback signals
 * - Instead: record failure durable state, set isRecovering UI flag, trigger auto-recovery
 * - Fallback signals are TRANSIENT UI-only states, never persisted as dialogue
 */

import { base44 } from '@/api/base44Client';

export async function handleFallbackResponse({
  characterId,
  conversationId,
  currentUser,
  base44: b44,
  character,
  setRecoveringState,
  errorReason,    // 'rate_limit' | 'timeout' | 'llm_failure'
  errorStage,     // 'response_generation' | 'memory_load' | 'canonical_prompt'
  originalPrompt, // REQUIRED: full LLM prompt for recovery re-attempt
  sourceMessageId, // REQUIRED: user message ID for idempotency
  channel = 'direct', // OPTIONAL: communication channel
}) {
  // CRITICAL: Do NOT save any fallback message to the database
  // Instead: set UI state and record durable error metadata

  console.log(
    `[chatFallbackIntegration] Circuit breaker triggered:` +
    ` reason=${errorReason}` +
    ` stage=${errorStage}` +
    ` char=${character?.name}` +
    ` convo=${conversationId}` +
    ` fallback_saved=false` +
    ` reconnecting_ui_shown=true`
  );

  // Set UI state only — transient, never saved
  if (setRecoveringState) {
    setRecoveringState(true);
  }

  // Record durable error metadata for diagnostics (not a message)
  try {
    if (conversationId && characterId && currentUser?.email) {
      const convo = await b44.entities.Conversation.filter({ id: conversationId }, null, 1);
      if (convo?.length > 0) {
        // Write diagnostic metadata to conversation.generation_lock
        // This is NOT a message — it's metadata used by recovery systems
        await b44.entities.Conversation.update(conversationId, {
          generation_lock: {
            fallback_detected: true,
            fallback_reason: errorReason,
            fallback_stage: errorStage,
            fallback_count: (convo[0].generation_lock?.fallback_count || 0) + 1,
            fallback_blocked: true,  // This fallback was NOT saved as a message
            recovery_required: true,
            recovery_triggered_at: new Date().toISOString(),
            character_id: characterId,
          },
        });
      }
    }
  } catch (err) {
    console.warn('[chatFallbackIntegration] Failed to record fallback metadata:', err.message);
  }

  // Trigger automatic recovery in background
  try {
    if (conversationId && characterId && originalPrompt && sourceMessageId) {
      // Invoke recovery backend function
      // This will run asynchronously with exponential backoff and restore real character pipeline
      b44.functions.invoke('triggerRecoveryBackground', {
        conversation_id: conversationId,
        character_id: characterId,
        owner_email: currentUser?.email,
        channel,
        blocking_stage: errorStage,
        prompt: originalPrompt, // REQUIRED: full prompt for re-attempt
        source_message_id: sourceMessageId, // REQUIRED: user message for idempotency
        character_name: character?.name,
        failure_count: 0, // first attempt
      }).catch(err => {
        console.warn('[chatFallbackIntegration] Recovery trigger failed:', err?.message);
      });
    } else {
      console.warn('[chatFallbackIntegration] Missing recovery params: prompt=' + !!originalPrompt + ' sourceMsg=' + !!sourceMessageId);
    }
  } catch (err) {
    console.warn('[chatFallbackIntegration] Recovery dispatch failed:', err.message);
  }

  // Clear UI recovery state after 45 seconds if recovery completes, or on timeout
  setTimeout(() => {
    if (setRecoveringState) {
      setRecoveringState(false);
    }
  }, 45000);

  return { should_save: false, reason: 'circuit_breaker_active' };
}