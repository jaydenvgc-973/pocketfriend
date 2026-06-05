# CRITICAL: USER-FIRST PRIORITY HIERARCHY AUDIT

**Date**: June 5, 2026, 10:13 AM Eastern  
**Issue**: Recovery screen indicates background systems are still consuming resources needed for user actions  
**Root Cause**: Background automations fire on fixed EventBridge schedules WITHOUT pre-flight checks for user activity

---

## ACTUAL PRIORITY EXECUTION

### Browser-Side (Client)
✅ **CORRECT** — Foreground Priority Manager + SimulationGate

- Priority 1: User actions (chat, travel, alarms, profiles)
- Priority 2: Character responses
- Priority 3-4: Time-sensitive automation
- Priority 5-6: Maintenance + background

**Issue**: Browser can only gate background HOOKS, not server-side automations

### Server-Side (Backend Automations)
❌ **BROKEN** — No consistent pre-flight yield check

EventBridge fires these on FIXED schedules:

| Automation | Schedule | Priority | Yield Check | Status |
|---|---|---|---|---|
| `simulateActiveCharacterNeeds` | Every 2 hours | Priority 5 (Maintenance) | ✅ YES (AppWorldState) | Correct |
| `autonomousCharacterMovement` | Every 5 minutes | Priority 5 (Maintenance) | ✅ YES (AppWorldState) | Correct |
| `processScheduledRelocations` | Every 5 minutes | Priority 4 (Time-sensitive) | ❌ NO | **BROKEN** |
| `scheduledLocationEnforcement` | Every 10 minutes | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |
| `processScheduledCharacterAlarms` | Every 1 minute | Priority 4 (Time-sensitive) | ❌ PARTIAL | **BROKEN** |
| `processScheduledEvents` | Every 15 minutes | Priority 4 (Time-sensitive) | ❌ NO | **BROKEN** |
| `checkLifecycleEvents` | Every 30 minutes | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |
| `checkAchievements` | Every 1 hour | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |
| `processPayroll` | Daily 6 AM ET | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |
| `runAutomaticNarrativesForAllCharacters` | Every 30 min | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |
| `generateProactiveMessages` | Every 15 min | Priority 5 (Maintenance) | ❌ NO | **BROKEN** |

---

## TOP REQUEST GENERATORS

### Per-Run Cost (Worst Case)

1. **`autonomousCharacterMovement`**  
   - **200 characters** × **100ms per location fetch** = 20 seconds baseline
   - Plus **travel session creation** (403 errors × retry logic)
   - Plus **memory creation** fire-and-forget calls
   - **Total per 5-min run: ~45 second wall-clock impact**

2. **`simulateActiveCharacterNeeds`**  
   - **200 characters** × **50ms per update** = 10 seconds
   - Plus **memory creation** for escalations (async, non-blocking)
   - **Total per 2-hour run: ~12 seconds, but rare**

3. **`scheduledLocationEnforcement`**  
   - **200 characters** × **location fetch + resolution logic**
   - **LocationReference.filter(owner_email)** — per-user filter
   - **Worst case: 3+ seconds per user account**

4. **`processScheduledRelocations`**  
   - Legacy: **full `Character.list(null, 1000)`** = 1000-char fetch every 5 min
   - Now fixed: filters to only chars with pending data
   - **Still: ~2 seconds per run**

5. **`processScheduledCharacterAlarms`**  
   - **200 characters** filter + alarm check
   - **~3 seconds per minute**

---

## WRITE GENERATORS (Top Offenders)

### Character Entity Writes

- **`autonomousCharacterMovement`**: ~10–50 writes per run (location changes)
- **`processScheduledRelocations`**: 0–5 writes per run (rare)
- **`simulateActiveCharacterNeeds`**: ~50 writes per run (needs + state)
- **`scheduledLocationEnforcement`**: ~100 writes per run (location re-enforcement)
- **`processScheduledCharacterAlarms`**: ~10 writes per run (alarm state)

### Memory Entity Writes (Fire-and-Forget)

- **`autonomousCharacterMovement`**: escalation events + location history
- **`simulateActiveCharacterNeeds`**: escalation events + sleep consequences
- **`autonomousCharacterSocialBeats`**: interaction logs + relationship updates

### Total Write Load at Peak

**5-minute window** (autonomousCharacterMovement + processScheduledRelocations + 1/3 of alarms):
- **~200 Character writes**
- **~50 Memory writes**
- **Plus subscription events** (Character writes trigger character.update subscriptions → badge recounts on all CharacterCard components)

**Subscription cascades** = each Character write fires a subscription event → HomeUnreadCounts hook evaluates ALL character cards → potential re-renders across all 200 cards

---

## WHY RECOVERY MODE WAS TRIGGERED

### The Storm

1. **User opens Chat at 6:28 PM ET**
2. **`usePageContext` → `signalUserActiveSession()` writes token to `AppWorldState`**
3. **Browser-side foreground priority activates** ✅
4. BUT:
5. **`autonomousCharacterMovement` EventBridge fires at 6:30 PM ET** (scheduled every 5 min)
6. **It checks `AppWorldState` token** ✅ — sees user is active
7. **It yields optional wandering** ✅
8. BUT also runs **mandatory work/school enforcement** — still ~30 writes
9. Plus at the same time: **subscription events from Character writes**
10. Plus: **`scheduledLocationEnforcement` fires at 6:30 PM ET** — **NO yield check** ❌
11. Plus: **`processScheduledCharacterAlarms` fires at 6:31 PM ET** — **partial yield check** ❌
12. **All three automations run in parallel → API contention**
13. **Chat message responses get stuck waiting for automations to clear**
14. **Retry handler detects delays** → escalates to recovery mode

### The Real Problem

The server-side automations that have **correct yield logic** are outnumbered by those that **have no yield logic at all**.

When multiple no-yield automations fire simultaneously, they can consume the API quota before any one of them checks the yield token.

---

## REQUIRED FIXES

### TIER 1 (CRITICAL) — Add Yield Checks to All Server-Side Automations

Every scheduled automation MUST check `AppWorldState key='user_active_session'` BEFORE doing bulk work:

- `scheduledLocationEnforcement`
- `processScheduledCharacterAlarms`
- `processScheduledEvents`
- `checkLifecycleEvents`
- `checkAchievements`
- `processPayroll`
- `runAutomaticNarrativesForAllCharacters`
- `generateProactiveMessages`

### TIER 2 (CRITICAL) — Reduce Per-Run Cost

- Reduce `autonomousCharacterMovement` from 200→100 characters per run
- Split into multiple smaller runs
- Add rate limiting between internal API calls

### TIER 3 — Prevent Subscription Cascades

- Batch Character writes to reduce subscription events
- Use service-role writes only when necessary
- Defer non-critical subscription updates

### TIER 4 — Enforce Mandatory vs. Optional Work

**Mandatory** (always run, even during user activity):
- Work/school arrivals
- Alarms
- Movement commitments
- Critical health/energy states

**Optional** (skip during user activity):
- Autonomous wandering
- Social beats
- Proactive messages
- Narrative generation
- Achievement checking
- Lifecycle progression

---

## SUCCESS METRICS

After repairs:

- User opens chat → response time < 2 seconds (even if automation runs simultaneously)
- Alarms fire on-time → within 5-second jitter
- Movement confirmations execute instantly
- Profile loads < 1 second
- Travel actions < 1 second
- Recovery mode triggered < 1x per day (should be rare)

---

## CURRENT STATE

- Browser-side: ✅ Correct priority enforcement
- Server-side: ❌ Broken — multiple automations have no yield checks
- Result: ⚠️ Recovery mode still appearing
- Root cause: Simultaneous uncontrolled server automations consuming API quota