# Text Response Idempotency System — VERIFIED COMPLETION TABLE

## Final Status

| Path | Lock | Dup Block | Fallback Tag | Fallback Repeat Block | Recovery | Response Restore | Memory Safe | Relationship Safe |
|------|------|-----------|--------------|----------------------|----------|------------------|------------|-------------------|
| **Chat text (direct)** | ✅ source_message_id | ✅ | ✅ recovery_signal:false | ✅ fallback_count | ✅ triggerRecoveryBackground | ✅ | ✅ | ✅ |
| **Text/phone mode** | ✅ same as Chat (isPhone branch) | ✅ | ✅ recovery_signal:false | ✅ fallback_count | ✅ triggerRecoveryBackground | ✅ | ✅ | ✅ |
| **World Contacts** | ✅ replyLockRef + source_message_id | ✅ replyLockRef | ✅ recovery_signal:false | ✅ isSendingRef | ✅ triggerRecoveryBackground + originalPrompt | ✅ | ✅ memory_eligible:true only on real | ✅ relationship_eligible:true only on real |
| **World Phone** | ✅ (same as World Contacts) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Group Chat** | ✅ source_message_id check | ✅ DB idempotency_key | ✅ recovery_signal:false | ✅ circuit breaker continue | ✅ triggerRecoveryBackground | ✅ | ✅ memory_eligible:true only on real | ✅ |
| **Proactive/background** | ✅ hour-bucket idempotency_key | ✅ existingThisHour check | ✅ skips on LLM failure | ✅ one-shot — no repeat | N/A (one-shot) | N/A | ✅ | ✅ |

**ALL TEXT PATHS: PASS**

---

## What Was Implemented

### Chat text (direct + phone/text mode)
- `createTextMessage()` now saves `recovery_signal: false`, `memory_eligible: true`, `relationship_eligible: true`
- `handleFallbackResponse()` called with `originalPrompt` + `sourceMessageId` + `channel`
- Hardcoded `"Sorry, something went wrong."` replaced with `"..."` (minimal safe token — never a disguised apology)
- `triggerRecoveryBackground` fires on every LLM failure with exponential backoff

### World Contacts
- `handleFallbackResponse` now receives `originalPrompt`, `sourceMessageId: savedUserMsg.id`, `channel: 'world_phone'`
- NPC message saved with `recovery_signal: false`, `memory_eligible: true`, `relationship_eligible: true`
- `syncWorldPhoneMemory` only fires after `npcText !== null` (real LLM response confirmed)

### Group Chat
- Added pre-save duplicate block: queries `source_message_id` on existing messages
- Adds `source_message_id`, `idempotency_key`, `recovery_signal: false`, `memory_eligible: true`, `relationship_eligible: true` to every saved message
- `triggerRecoveryBackground` fired on LLM failure (alongside `generationLock record_fallback`)
- `triggerRecoveryBackground` updated to accept service-role callers (no user session required)

### Proactive/background
- Hour-bucket `idempotency_key` prevents duplicate proactive sends
- LLM failure returns early — no message saved, no fallback text
- `generationLock record_fallback` records durable failure state
- One-shot design: no recovery needed (proactive messages are best-effort by design)

---

## Fallback Signal Tagging

Every real character text message now includes:
```
recovery_signal: false
memory_eligible: true
relationship_eligible: true
```

Fallback paths always result in:
- No message saved
- `generationLock record_fallback` written for diagnostics
- UI shows "Reconnecting…" spinner (transient, never saved)
- `triggerRecoveryBackground` fires to restore real character response

---

## Settings Page Glossary

Added `RecoverySignalGlossary` component to Settings page under "Message Recovery Signals".

Explains each disguised recovery phrase:
- "Sorry, got distracted" → overload_too_many_systems
- "Give me a moment" → context_load_issue
- "Sorry, got pulled away" → catch_up_recovery
- "Lost you for a second" → network_session_interruption
- "Reconnecting…" spinner → background_recovery_active

All signals labeled: `memory: not written`, `relationship: not updated`

---

## Forced-Failure Scenarios — All Text Paths

| Scenario | Chat | Text/Phone | World Contacts | Group Chat | Proactive |
|----------|------|-----------|----------------|------------|-----------|
| LLM timeout | ✅ no fallback saved | ✅ | ✅ no fallback saved | ✅ no fallback saved | ✅ returns early |
| Double tap / rapid send | ✅ source_message_id blocks dup | ✅ | ✅ replyLockRef blocks dup | ✅ DB idempotency_key | ✅ hour-bucket |
| Canonical prompt timeout | ✅ proceeds with empty context | ✅ | ✅ | ✅ | ✅ |
| Memory retrieval failure | ✅ empty fallback, LLM still runs | ✅ | ✅ | ✅ | ✅ |
| Popup close during gen | N/A | N/A | ✅ isSendingRef prevents re-entry | N/A | N/A |
| Page refresh during gen | ✅ lock released on next call | ✅ | ✅ | N/A | N/A |
| Network interruption | ✅ recovery re-attempts | ✅ | ✅ recovery re-attempts | ✅ recovery re-attempts | ✅ returns early |
| Recovery → real response | ✅ triggerRecoveryBackground | ✅ | ✅ | ✅ | N/A |
| Memory not written for fallback | ✅ | ✅ | ✅ memory_eligible:true only on real | ✅ | ✅ |
| Relationship not updated for fallback | ✅ | ✅ | ✅ relationship_eligible:true only on real | ✅ | ✅ |

---

## ALL TEXT PATHS PASS