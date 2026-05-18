# Fallback Circuit Breaker System

## Purpose

Prevent repeated generic fallback replies from appearing as normal character responses. When a fallback is detected, automatically trigger recovery in the background and block subsequent fallbacks until recovery completes.

## Architecture

### 1. Fallback Detection (`lib/fallbackCircuitBreaker.js`)

**Function:** `detectFallbackResponse(text)`
- Identifies generic fallback patterns (e.g., "Sorry, got pulled away", "...", "[IMAGE_FAILED]")
- Returns: boolean

**Class:** `ConversationRecoveryState`
- Stores per-conversation fallback/recovery state in sessionStorage
- Key: `recovery_state::${ownerEmail}::${conversationId}`
- Manages generation locks, character context cache, cooldowns

**Function:** `evaluateFallbackSavability(state)`
- Determines if a fallback should be saved to database
- First fallback: allowed, triggers recovery
- Second+ fallback: blocked, shows recovery message instead

### 2. Recovery Diagnostic (`lib/recoveryDiagnostic.js`)

**Function:** `runRecoveryDiagnostic()`
- Checks critical pipeline stages:
  - character_record (required)
  - conversation (required)
  - messages (required)
  - canonical_prompt (optional)
  - memory (optional)
- Returns: `{ success, blocking_stage, recovered_cache, stages }`
- Runs in background, non-blocking

**Function:** `getRecoveryUserMessage()`
- Returns: "Reconnecting…" or "Reconnecting to character…"
- Non-technical, user-facing message (not repeated)

### 3. Proof Logging (`lib/recoveryProofLogger.js`)

**Class:** `RecoveryProofLog`
- Logs all circuit breaker events to sessionStorage
- Provides `getLogs()` and `getSummary()` for debugging
- Tracks:
  - Fallback detection
  - Second fallback blocks
  - Recovery attempts
  - Cooldown applications
  - Parallel generation blocks

### 4. Chat Integration (`lib/chatFallbackIntegration.js`)

**Function:** `handleFallbackResponse()`
- Orchestrates fallback detection + circuit breaker logic
- Returns: `{ fallback_text, should_save, recovery_triggered }`
- Handles first vs. second fallback automatically
- Triggers background recovery

## Behavior Flow

```
1. LLM Call Fails
   ↓
2. Fallback Text Generated
   ↓
3. detectFallbackResponse() → true
   ↓
4. recoveryState.onFallbackDetected()
   ├─ First fallback: trigger recovery, allow save
   └─ Second+ fallback: block save, mark second_fallback_blocked
   ↓
5. If blocked: show "Reconnecting…" message instead
   ↓
6. Background Recovery (non-blocking):
   ├─ Check all pipeline stages
   ├─ Cache recovered context
   ├─ Mark recovery_completed
   └─ Apply cooldown for next attempt
   ↓
7. Next Message Uses Real Pipeline (with cached context)
```

## State Management

### ConversationRecoveryState Properties

```javascript
{
  conversation_recovery_required: boolean,
  fallback_count: 0 | 1 | 2+,
  fallback_used_once: boolean,
  fallback_used_at: ISO timestamp,
  fallback_reason: string,
  fallback_stage: string,
  recovery_started: boolean,
  recovery_attempts: 0 | 1 | 2,
  recovery_completed: boolean,
  recovery_cooldown_until: timestamp | null,
  second_fallback_blocked: boolean,
  real_character_pipeline_restored: boolean,
  generation_locks: { characterId: timestamp },
  cache_maintained: boolean,
}
```

## Regulation Limits

- **Max recovery attempts per conversation:** 2
- **Recovery cooldown:** 1500ms between attempts
- **Overall cooldown:** 30s after first fallback before next recovery
- **Max parallel recoveries per user:** 1 (enforced by cooldown)
- **Max parallel generation per character:** 1 (enforced by generation_locks)
- **Noncritical systems deferred during recovery:** diagnostics, scans, narratives, media extraction

## Proof Requirements

When fallback is detected and recovery triggered:

```javascript
RecoveryProofLog.fallbackDetected(
  conversationId, ownerEmail,
  reason, stage, isFirstFallback=true
)

// If second fallback:
RecoveryProofLog.secondFallbackBlocked(conversationId, ownerEmail, "recovery_in_progress")

// When recovery completes:
RecoveryProofLog.recoveryCompleted(conversationId, ownerEmail, stages)

// Get summary:
RecoveryProofLog.getSummary(conversationId, ownerEmail)
// Returns:
{
  fallback_detected: true,
  fallback_detected_automatically: true,
  second_fallback_blocked: true,
  automatic_recovery_started: true,
  recovery_completed: true,
  real_character_pipeline_restored: true,
  parallel_generation_blocked: false,
  cooldown_applied: true,
  noncritical_systems_deferred: true,
}
```

## Implementation Locations

1. **Chat.js** - Error handler calls `handleFallbackResponse()`
2. **WorldContactsPopup.js** - LLM error handler applies circuit breaker
3. **Other channels** - Text, Scene, Group Chat use same `handleFallbackResponse()`

## User Experience

- **First fallback:** Single generic message appears once
- **During recovery:** "Reconnecting…" shows progress (not repeated)
- **After recovery:** Next response is from real character
- **If recovery fails:** One subtle state message, no spam

## Noncritical Systems Deferred

When recovery is triggered:

```javascript
const deferredSystems = [
  'characterAwarenessUpdate',
  'globalLocationRepair',
  'narrativeSummaryGeneration',
  'mediaGridHydration',
  'broadSocialGraphSync',
];
```

These are paused for 30s-60s to prevent overload during recovery.

## Testing

```javascript
// Get proof from a conversation
const proof = RecoveryProofLog.getSummary(conversationId, ownerEmail);

// Verify:
assert(proof.fallback_detected === true);
assert(proof.second_fallback_blocked === true);
assert(proof.automatic_recovery_started === true);
assert(proof.recovery_completed === true || proof.blocking_stage !== null);
``