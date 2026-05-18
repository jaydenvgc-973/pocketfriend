/**
 * Recovery Proof Logger
 * 
 * Centralized logging for fallback detection, circuit breaker state, and recovery success.
 * Proof that the system is working correctly without user-facing chaos.
 */

export class RecoveryProofLog {
  static log(conversationId, ownerEmail, message, details) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      conversationId,
      ownerEmail,
      message,
      ...details,
    };
    
    console.log(`[RecoveryProof] ${JSON.stringify(logEntry)}`);
    
    // Store in sessionStorage for dashboard/debugging
    try {
      const key = `recovery_proof::${ownerEmail}::${conversationId}`;
      const existing = sessionStorage.getItem(key);
      const logs = existing ? JSON.parse(existing) : [];
      logs.push(logEntry);
      // Keep only last 50 entries per conversation
      if (logs.length > 50) logs.shift();
      sessionStorage.setItem(key, JSON.stringify(logs));
    } catch (e) {
      // Silently fail if storage is full
    }
  }

  static fallbackDetected(conversationId, ownerEmail, reason, stage, isFirstFallback) {
    this.log(conversationId, ownerEmail, 'Fallback detected', {
      reason,
      stage,
      is_first_fallback: isFirstFallback,
      recovery_triggered: isFirstFallback,
    });
  }

  static secondFallbackBlocked(conversationId, ownerEmail, reason) {
    this.log(conversationId, ownerEmail, 'Second fallback blocked', {
      block_reason: reason,
      second_fallback_blocked: true,
    });
  }

  static recoveryStarted(conversationId, ownerEmail) {
    this.log(conversationId, ownerEmail, 'Recovery started', {
      automatic_recovery_started: true,
    });
  }

  static recoveryCompleted(conversationId, ownerEmail, stages) {
    this.log(conversationId, ownerEmail, 'Recovery completed', {
      recovery_completed: true,
      real_character_pipeline_restored: true,
      stages,
    });
  }

  static recoveryFailed(conversationId, ownerEmail, blockingStage, attempt) {
    this.log(conversationId, ownerEmail, 'Recovery failed', {
      blocking_stage: blockingStage,
      recovery_attempt: attempt,
    });
  }

  static generationLockAcquired(conversationId, ownerEmail, characterId) {
    this.log(conversationId, ownerEmail, 'Generation lock acquired', {
      character_id: characterId,
    });
  }

  static parallelGenerationBlocked(conversationId, ownerEmail, characterId) {
    this.log(conversationId, ownerEmail, 'Parallel generation blocked', {
      character_id: characterId,
      parallel_generation_blocked: true,
    });
  }

  static cooldownApplied(conversationId, ownerEmail, cooldownMs) {
    this.log(conversationId, ownerEmail, 'Cooldown applied', {
      cooldown_ms: cooldownMs,
      cooldown_applied: true,
    });
  }

  static noncriticalSystemsDeferred(conversationId, ownerEmail, systems) {
    this.log(conversationId, ownerEmail, 'Noncritical systems deferred', {
      deferred_systems: systems,
      noncritical_systems_deferred: true,
    });
  }

  static getLogs(conversationId, ownerEmail) {
    try {
      const key = `recovery_proof::${ownerEmail}::${conversationId}`;
      const stored = sessionStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  static getSummary(conversationId, ownerEmail) {
    const logs = this.getLogs(conversationId, ownerEmail);
    
    return {
      total_entries: logs.length,
      fallback_detected: logs.some(l => l.message === 'Fallback detected'),
      fallback_detected_automatically: logs.some(l => l.is_first_fallback),
      second_fallback_blocked: logs.some(l => l.second_fallback_blocked),
      automatic_recovery_started: logs.some(l => l.automatic_recovery_started),
      recovery_completed: logs.some(l => l.recovery_completed),
      real_character_pipeline_restored: logs.some(l => l.real_character_pipeline_restored),
      parallel_generation_blocked: logs.some(l => l.parallel_generation_blocked),
      cooldown_applied: logs.some(l => l.cooldown_applied),
      noncritical_systems_deferred: logs.some(l => l.noncritical_systems_deferred),
      latest_log: logs[logs.length - 1] || null,
    };
  }
}