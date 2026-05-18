/**
 * Chat Fallback Integration
 *
 * Handles fallback detection and circuit breaker for ALL character-response paths.
 *
 * KEY RULES:
 * 1. Generic fallback texts are NEVER saved as character Messages (not even first one)
 *    → They were only meant to be one-time emergency signals, not saved speech.
 *    → The circuit breaker blocks ALL fallback saves immediately.
 *    → First fallback triggers background recovery silently.
 *    → User sees UI state "Reconnecting…" via setRecoveringState() — NOT a saved message.
 * 2. Durable state is written to the Conversation.generation_lock field via generationLock function.
 * 3. This module is used by Chat, Text, WorldContacts, and can be imported by backend paths.
 */

const FALLBACK_PATTERNS = [
  "sorry, got pulled away",
  "give me a moment",
  "hey sorry",
  "my bad, got distracted",
  "sorry, lost you",
  "what were you saying",
  "something came up on my end",
  "i'm back",
  "i'm here, just had a second",
  "reconnecting",
];

/**
 * Detect if a response text is a generic fallback (not real character output).
 */
export function detectFallbackResponse(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim().toLowerCase();
  if (t === '...' || t === '[image_failed]') return true;
  const snippet = t.substring(0, 80);
  return FALLBACK_PATTERNS.some(p => snippet.includes(p));
}

/**
 * Main handler — called when the LLM pipeline fails and a fallback would be used.
 *
 * Returns: { should_save: false always, recovery_triggered, ui_state }
 *
 * CRITICAL: should_save is ALWAYS false. Fallback texts are NEVER saved as Messages.
 * The caller must use setRecoveringState(true) to show "Reconnecting…" in the UI instead.
 */
export async function handleFallbackResponse({
  characterId,
  conversationId,
  currentUser,
  base44,
  character,
  // UI state setters — used instead of saving a Message
  setRecoveringState,  // (boolean) → sets "Reconnecting…" indicator in UI
  errorReason = 'llm_failure',
  errorStage = 'response_generation',
}) {
  const convoId = conversationId;

  // Always set recovering state in UI (not a saved message)
  if (typeof setRecoveringState === 'function') {
    setRecoveringState(true);
  }

  if (!convoId) {
    console.warn(`[ChatFallback] No conversationId — cannot record durable state`);
    return { should_save: false, recovery_triggered: false, ui_state: 'reconnecting' };
  }

  // ── 1. Write durable fallback record to Conversation.generation_lock ──────
  let fallbackCount = 1;
  let fallbackBlocked = false;
  try {
    const res = await base44.functions.invoke('generationLock', {
      action: 'record_fallback',
      conversation_id: convoId,
      character_id: characterId,
      owner_email: currentUser?.email,
      fallback_text: `[${errorReason}] at stage: ${errorStage}`,
    });
    fallbackCount = res?.data?.fallback_count || 1;
    fallbackBlocked = res?.data?.fallback_blocked || false;
  } catch (e) {
    console.warn(`[ChatFallback] Failed to record durable fallback: ${e.message}`);
  }

  console.log(`[ChatFallback] Fallback detected | count=${fallbackCount} | blocked=${fallbackBlocked} | convo=${convoId} | reason=${errorReason}`);

  // ── 2. Trigger background recovery (always — every fallback triggers it) ──
  triggerRecoveryBackground({
    characterId,
    conversationId: convoId,
    ownerEmail: currentUser?.email,
    base44,
    characterName: character?.name,
    setRecoveringState,
  });

  return {
    should_save: false,       // NEVER save fallback text as a character Message
    recovery_triggered: true,
    fallback_count: fallbackCount,
    fallback_blocked: fallbackBlocked,
    ui_state: 'reconnecting', // Caller shows this in UI, does NOT save to DB
  };
}

/**
 * Background recovery — checks all pipeline stages and caches restored context.
 * Non-blocking. Does NOT produce any saved messages.
 */
function triggerRecoveryBackground({
  characterId,
  conversationId,
  ownerEmail,
  base44,
  characterName,
  setRecoveringState,
}) {
  const MAX_ATTEMPTS = 2;
  let attempts = 0;

  const tryRecover = async () => {
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`[ChatFallback] Recovery max attempts reached (${MAX_ATTEMPTS}) for convo=${conversationId}`);
      if (typeof setRecoveringState === 'function') setRecoveringState(false);
      return;
    }

    attempts++;
    const backoffMs = attempts === 1 ? 1500 : 3000;
    await new Promise(r => setTimeout(r, backoffMs));

    const stages = {
      canonical_prompt: false,
      character_record: false,
      conversation: false,
      messages: false,
      memory: false,
    };

    let blockingStage = null;

    try {
      // Stage 1: Character record
      const chars = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
      if (chars.length > 0) stages.character_record = true;
      else blockingStage = blockingStage || 'character_record';

      // Stage 2: Conversation
      const convos = await base44.entities.Conversation.filter({ id: conversationId }, null, 1).catch(() => []);
      if (convos.length > 0) stages.conversation = true;
      else blockingStage = blockingStage || 'conversation';

      // Stage 3: Recent messages
      const msgs = await base44.entities.Message.filter(
        { conversation_id: conversationId }, '-created_date', 20
      ).catch(() => []);
      if (msgs.length > 0) stages.messages = true;

      // Stage 4: Canonical prompt (non-blocking)
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId,
        interactionContext: 'direct_chat',
        topKMemories: 14,
      }).catch(() => null);
      if (ctxRes?.data?.systemPrompt) stages.canonical_prompt = true;
      else blockingStage = blockingStage || 'canonical_prompt';

      // Stage 5: Memory (non-blocking)
      const memRes = await base44.functions.invoke('retrieveActiveMemory', {
        characterId,
        currentMessage: '',
        recentMessages: [],
        topK: 14,
      }).catch(() => null);
      if (memRes?.data?.memories?.length > 0) stages.memory = true;

    } catch (err) {
      blockingStage = blockingStage || `exception:${err.message?.substring(0, 40)}`;
    }

    const criticalSuccess = stages.character_record && stages.conversation;
    const realPipelineRestored = criticalSuccess && stages.canonical_prompt;

    // Write durable recovery result
    try {
      await base44.functions.invoke('generationLock', {
        action: 'record_recovery',
        conversation_id: conversationId,
        character_id: characterId,
        owner_email: ownerEmail,
        blocking_stage: blockingStage,
        recovery_stages: stages,
        real_pipeline_restored: realPipelineRestored,
      });
    } catch (e) {
      console.warn(`[ChatFallback] Failed to record recovery result: ${e.message}`);
    }

    console.log(
      `[ChatFallback] Recovery attempt ${attempts}/${MAX_ATTEMPTS} | convo=${conversationId}` +
      ` | character=${characterName} | success=${realPipelineRestored}` +
      ` | stages=${JSON.stringify(stages)}`
    );

    if (realPipelineRestored) {
      // Recovery done — clear UI recovering state
      if (typeof setRecoveringState === 'function') setRecoveringState(false);
      console.log(`[ChatFallback] Recovery complete | real_pipeline_restored=true`);
    } else if (attempts < MAX_ATTEMPTS) {
      // Retry
      await tryRecover();
    } else {
      // Final failure — clear recovering state so UI doesn't hang
      if (typeof setRecoveringState === 'function') setRecoveringState(false);
      console.warn(`[ChatFallback] Recovery failed after ${MAX_ATTEMPTS} attempts | blocking_stage=${blockingStage}`);
    }
  };

  // Kick off non-blocking (defer to avoid blocking current render cycle)
  setTimeout(tryRecover, 100);
}

/**
 * Get proof data from durable Conversation.generation_lock.
 * Can be called any time to verify circuit breaker state.
 */
export async function getRecoveryProof(conversationId, base44) {
  if (!conversationId || !base44) return null;
  try {
    const res = await base44.functions.invoke('generationLock', {
      action: 'check',
      conversation_id: conversationId,
    });
    const lock = res?.data?.lock_data || {};
    return {
      fallback_detected: !!lock.fallback_detected,
      fallback_count: lock.fallback_count || 0,
      fallback_blocked: !!lock.fallback_blocked,
      recovery_required: !!lock.recovery_required,
      recovery_started_at: lock.recovery_started_at || null,
      recovery_completed_at: lock.recovery_completed_at || null,
      last_blocking_stage: lock.last_blocking_stage || null,
      real_pipeline_restored: !!lock.real_pipeline_restored,
      generation_in_progress: !!lock.generation_in_progress,
    };
  } catch {
    return null;
  }
}