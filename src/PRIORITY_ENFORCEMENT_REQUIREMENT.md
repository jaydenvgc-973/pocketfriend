# Priority Enforcement Requirement

## The Problem

The "Too many requests" failure in Chat proves that lower-priority systems (background jobs) were allowed to consume capacity that Chat needed.

This is a **priority authority violation**. Not a rate-limit issue. Not a recovery issue.

## The Solution

**ONE authority** for priority state:
- Frontend: `lib/ForegroundPriorityContext.jsx` writes to `sessionStorage['foregroundPriority']`
- Background: Every background function must check this before making ANY request

## Enforcement Points

Every background system that makes HTTP requests must have a guard:

### Pattern 1: Frontend JavaScript (browser context)
```javascript
import { isBackgroundTaskAllowed } from '@/lib/backgroundPriorityCheck';

async function backgroundTask() {
  if (!isBackgroundTaskAllowed()) {
    console.log('[Background] Skipped — foreground active');
    return; // Do NOT make the request
  }
  // Safe to proceed
  const data = await base44.entities.SomeEntity.list();
}
```

### Pattern 2: Backend Function (Deno)
```javascript
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  
  // If an authenticated user made this request, they are active on the app
  // Don't let background work consume resources while they're here
  if (user) {
    console.log('[Background] Skipped — user active');
    return Response.json({ skipped: true });
  }
  
  // This is a scheduled/automated task (no user context) — safe to proceed
  // ... make requests
});
```

## Failing Systems to Audit

These systems can make requests and must be checked:

- autonomousCharacterMovement
- runAutomaticNarrativesForAllCharacters
- generateProactiveMessages
- autonomousCharacterSocialBeats
- triggerProactiveMessagesForAllCharacters
- simulateActiveCharacterNeeds
- processTravelArrivals
- checkAchievements
- checkLifecycleEvents
- unifiedEnforcementOrchestrator
- enforceLocationPresenceForOwner
- enforceCharacterLocationAccuracy
- any scheduled automation
- any polling loop
- any preloader
- any cleanup job

## Success Criteria

✅ **True Fix:**
- User opens Chat
- Chat loads immediately with no "Too many requests" error
- Background tasks were BLOCKED before they started, not paused after they consumed quota

❌ **Not a Fix:**
- Chat shows "Too many requests"
- Then system shows "Recovering..."
- Then user sees "retry" button
- This means background systems were already allowed to consume resources

## The Goal

**Eliminate the failure before it happens.**

Not: "Recover after background systems broke Chat"
But: "Prevent background systems from running while Chat is active"

This is not a feature request. This is a critical bug fix.