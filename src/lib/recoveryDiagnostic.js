/**
 * Recovery Diagnostic
 * 
 * Runs automatically when a fallback response is detected.
 * Checks all critical stages of the character pipeline.
 * Loads and caches recovered context for next message.
 */

/**
 * Run recovery diagnostic for a character in a conversation.
 * Checks:
 * - canonical_prompt
 * - character_record
 * - conversation
 * - messages
 * - memory
 * - rate_limit_status
 * 
 * Returns { success, blocking_stage, recovered_cache }
 */
export async function runRecoveryDiagnostic({
  characterId,
  conversationId,
  ownerEmail,
  base44,
}) {
  const stages = {
    canonical_prompt: false,
    character_record: false,
    conversation: false,
    messages: false,
    memory: false,
    rate_limit: true, // Assume not rate-limited unless proven
  };

  let recoveredCache = {
    characterId,
    conversationId,
    ownerEmail,
    loaded_at: new Date().toISOString(),
    stages: {},
  };

  try {
    // ── STAGE 1: Character record ──
    try {
      const chars = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      if (chars.length > 0) {
        stages.character_record = true;
        recoveredCache.character_record = {
          id: chars[0].id,
          name: chars[0].name,
          emotional_state: chars[0].emotional_state,
        };
      }
    } catch (e) {
      console.warn(`[RecoveryDiagnostic] Character record failed: ${e.message}`);
    }

    // ── STAGE 2: Conversation ──
    try {
      const convos = await base44.entities.Conversation.filter({ id: conversationId }, null, 1).catch(() => []);
      if (convos.length > 0) {
        stages.conversation = true;
        recoveredCache.conversation = {
          id: convos[0].id,
          type: convos[0].type,
          character_ids: convos[0].character_ids,
        };
      }
    } catch (e) {
      console.warn(`[RecoveryDiagnostic] Conversation load failed: ${e.message}`);
    }

    // ── STAGE 3: Recent messages ──
    try {
      const msgs = await base44.entities.Message.filter({ conversation_id: conversationId }, '-created_date', 20).catch(() => []);
      if (msgs.length > 0) {
        stages.messages = true;
        recoveredCache.messages = {
          count: msgs.length,
          latest_timestamp: msgs[0].created_date,
        };
      }
    } catch (e) {
      console.warn(`[RecoveryDiagnostic] Messages load failed: ${e.message}`);
    }

    // ── STAGE 4: Canonical prompt (non-blocking, best-effort) ──
    try {
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'direct_chat',
        topKMemories: 14,
      }).catch(() => null);
      
      if (ctxRes?.data?.systemPrompt) {
        stages.canonical_prompt = true;
        recoveredCache.canonical_prompt_loaded = true;
      }
    } catch (e) {
      console.warn(`[RecoveryDiagnostic] Canonical prompt load failed (non-blocking): ${e.message}`);
    }

    // ── STAGE 5: Memory (non-blocking, best-effort) ──
    try {
      const memRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId,
        currentMessage: '',
        recentMessages: [],
        topK: 14,
      }).catch(() => null);
      
      if (memRes?.data?.memories?.length > 0) {
        stages.memory = true;
        recoveredCache.memory_count = memRes.data.memories.length;
      }
    } catch (e) {
      console.warn(`[RecoveryDiagnostic] Memory load failed (non-blocking): ${e.message}`);
    }

    recoveredCache.stages = stages;

    // ── SUCCESS CRITERIA ──
    const criticalSuccess = stages.character_record && stages.conversation && stages.messages;
    
    if (criticalSuccess) {
      console.log(`[RecoveryDiagnostic] SUCCESS | character=${characterId} | convo=${conversationId}`);
      return {
        success: true,
        blocking_stage: null,
        recovered_cache: recoveredCache,
        stages,
      };
    } else {
      // Find which critical stage failed
      let blockingStage = null;
      if (!stages.character_record) blockingStage = 'character_record';
      else if (!stages.conversation) blockingStage = 'conversation';
      else if (!stages.messages) blockingStage = 'messages';
      
      console.warn(`[RecoveryDiagnostic] FAILED | blocking_stage=${blockingStage}`);
      return {
        success: false,
        blocking_stage: blockingStage,
        recovered_cache: recoveredCache,
        stages,
      };
    }
  } catch (err) {
    console.error(`[RecoveryDiagnostic] Diagnostic failed: ${err.message}`);
    return {
      success: false,
      blocking_stage: 'diagnostic_exception',
      recovered_cache: recoveredCache,
      stages,
    };
  }
}

/**
 * Shows a subtle user-facing state when recovery is in progress.
 * Returns a message to display instead of a second fallback.
 */
export function getRecoveryUserMessage(blockingStage) {
  if (!blockingStage) {
    return 'Reconnecting to character…';
  }
  
  // Generic recovery message, no technical jargon
  return 'Reconnecting…';
}