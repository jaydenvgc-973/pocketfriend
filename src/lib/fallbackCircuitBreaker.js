/**
 * Fallback Circuit Breaker
 * 
 * Detects when a conversation is using generic fallback responses instead of real character replies.
 * Automatically triggers recovery without user action.
 * Blocks repeated fallbacks and maintains recovered context across the conversation.
 */

const FALLBACK_PATTERNS = [
  "Sorry, got pulled away",
  "Give me a moment",
  "got distracted",
  "lost you for a second",
  "I'm here",
  "got pulled away for a sec",
  "something came up on my end",
  "I'm back",
  "pulling away",
  "away for a sec",
];

const GENERIC_RESPONSES = [
  "...",
  "[IMAGE_FAILED]",
];

/**
 * Detects if a response is a generic fallback (not real character output).
 * Used to trigger circuit breaker on first detection.
 */
export function detectFallbackResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return false;
  
  const text = responseText.trim().toLowerCase();
  
  // Check for ellipsis-only or error markers
  if (GENERIC_RESPONSES.includes(text)) return true;
  
  // Check for fallback pattern matches (first ~50 chars)
  const snippet = text.substring(0, 50);
  for (const pattern of FALLBACK_PATTERNS) {
    if (snippet.includes(pattern.toLowerCase())) return true;
  }
  
  return false;
}

/**
 * Conversation recovery state — per conversation, tracks fallback usage and recovery status.
 * Stored in browser sessionStorage keyed by ${ownerEmail}:${conversationId}
 */
export class ConversationRecoveryState {
  constructor(ownerEmail, conversationId) {
    this.ownerEmail = ownerEmail;
    this.conversationId = conversationId;
    this.stateKey = `recovery_state::${ownerEmail}::${conversationId}`;
    this.cachKey = `character_cache::${ownerEmail}::${conversationId}`;
  }

  // ── STATE MANAGEMENT ──
  getState() {
    try {
      const stored = sessionStorage.getItem(this.stateKey);
      return stored ? JSON.parse(stored) : this.createInitialState();
    } catch {
      return this.createInitialState();
    }
  }

  setState(state) {
    try {
      sessionStorage.setItem(this.stateKey, JSON.stringify(state));
    } catch (e) {
      console.warn(`[RecoveryState] Failed to persist state: ${e.message}`);
    }
  }

  createInitialState() {
    return {
      conversation_recovery_required: false,
      fallback_count: 0,
      fallback_used_once: false,
      fallback_used_at: null,
      fallback_reason: null,
      fallback_stage: null,
      recovery_started: false,
      recovery_started_at: null,
      recovery_attempts: 0,
      recovery_completed: false,
      recovery_completed_at: null,
      last_successful_stage: null,
      blocking_stage: null,
      second_fallback_blocked: false,
      duplicate_generation_blocked: false,
      cache_maintained: false,
      real_character_pipeline_restored: false,
      recovery_cooldown_until: null,
      generation_locks: {}, // ${characterId} -> timestamp
    };
  }

  // ── FIRST FALLBACK DETECTION ──
  onFallbackDetected(reason, stage) {
    const state = this.getState();
    
    if (state.fallback_count === 0) {
      // FIRST FALLBACK: mark and trigger recovery
      state.conversation_recovery_required = true;
      state.fallback_count = 1;
      state.fallback_used_once = true;
      state.fallback_used_at = new Date().toISOString();
      state.fallback_reason = reason;
      state.fallback_stage = stage;
      state.recovery_started = true;
      state.recovery_started_at = new Date().toISOString();
      state.recovery_cooldown_until = Date.now() + 30000; // 30s cooldown
      
      this.setState(state);
      console.log(`[FallbackCircuitBreaker] FIRST FALLBACK DETECTED — recovery triggered | reason=${reason} | stage=${stage}`);
      return { should_trigger_recovery: true, fallback_blocked: false };
    } else if (state.fallback_count >= 1) {
      // SECOND+ FALLBACK: BLOCK IT
      state.second_fallback_blocked = true;
      this.setState(state);
      console.warn(`[FallbackCircuitBreaker] SECOND FALLBACK BLOCKED | reason=${reason} | stage=${stage}`);
      return { should_trigger_recovery: false, fallback_blocked: true };
    }
  }

  // ── RECOVERY LIFECYCLE ──
  canAttemptRecovery() {
    const state = this.getState();
    
    // Already recovered
    if (state.recovery_completed) return false;
    
    // Cooldown active
    if (state.recovery_cooldown_until && Date.now() < state.recovery_cooldown_until) {
      return false;
    }
    
    // Max attempts reached
    if (state.recovery_attempts >= 2) return false;
    
    return true;
  }

  recordRecoveryAttempt(successfulStage) {
    const state = this.getState();
    state.recovery_attempts += 1;
    state.last_successful_stage = successfulStage;
    
    // Apply cooldown for next attempt
    if (state.recovery_attempts < 2) {
      state.recovery_cooldown_until = Date.now() + 1500; // 1.5s backoff
    }
    
    this.setState(state);
  }

  markRecoveryComplete() {
    const state = this.getState();
    state.recovery_completed = true;
    state.recovery_completed_at = new Date().toISOString();
    state.real_character_pipeline_restored = true;
    state.cache_maintained = true;
    this.setState(state);
    console.log(`[FallbackCircuitBreaker] Recovery completed | attempts=${state.recovery_attempts}`);
  }

  markRecoveryFailed(blockingStage) {
    const state = this.getState();
    state.blocking_stage = blockingStage;
    this.setState(state);
  }

  // ── GENERATION LOCKS (prevent parallel generation for same character) ──
  acquireGenerationLock(characterId) {
    const state = this.getState();
    const lockKey = `${characterId}`;
    
    if (state.generation_locks[lockKey]) {
      return false; // Lock already held
    }
    
    state.generation_locks[lockKey] = Date.now();
    this.setState(state);
    return true;
  }

  releaseGenerationLock(characterId) {
    const state = this.getState();
    delete state.generation_locks[`${characterId}`];
    this.setState(state);
  }

  // ── CHARACTER CONTEXT CACHE ──
  getCharacterCache(characterId) {
    try {
      const cacheKey = `${this.cachKey}::${characterId}`;
      const cached = sessionStorage.getItem(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  setCharacterCache(characterId, cache) {
    try {
      const cacheKey = `${this.cachKey}::${characterId}`;
      sessionStorage.setItem(cacheKey, JSON.stringify(cache));
    } catch (e) {
      console.warn(`[RecoveryState] Failed to cache character context: ${e.message}`);
    }
  }

  clearCharacterCache(characterId) {
    try {
      const cacheKey = `${this.cachKey}::${characterId}`;
      sessionStorage.removeItem(cacheKey);
    } catch {}
  }

  // ── PROOF LOGGING ──
  getProof() {
    const state = this.getState();
    return {
      fallback_detected: state.fallback_count > 0,
      fallback_detected_automatically: state.fallback_used_once,
      fallback_used_once_only: state.fallback_count === 1,
      second_fallback_blocked: state.second_fallback_blocked,
      automatic_recovery_started: state.recovery_started,
      recovery_completed: state.recovery_completed,
      recovery_attempts: state.recovery_attempts,
      real_character_pipeline_restored: state.real_character_pipeline_restored,
      cache_maintained_during_conversation: state.cache_maintained,
      parallel_recovery_blocked: state.recovery_cooldown_until ? Date.now() < state.recovery_cooldown_until : false,
      cooldown_applied: state.recovery_cooldown_until !== null,
      blocking_stage: state.blocking_stage,
      last_successful_stage: state.last_successful_stage,
    };
  }
}

/**
 * Determines if a fallback should be saved or blocked.
 * Returns { should_save, block_reason }
 */
export function evaluateFallbackSavability(recoveryState) {
  const state = recoveryState.getState();
  
  if (state.second_fallback_blocked) {
    return {
      should_save: false,
      block_reason: 'second_fallback_blocked',
    };
  }
  
  if (!state.fallback_used_once && !state.recovery_started) {
    // First fallback is allowed (triggers recovery)
    return {
      should_save: true,
      block_reason: null,
    };
  }
  
  return {
    should_save: false,
    block_reason: 'recovery_in_progress',
  };
}