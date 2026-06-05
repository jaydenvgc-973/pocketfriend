# Background Task Request Gating Pattern

All background functions must check the request gate BEFORE making API requests.

## Pattern

```javascript
import { checkBackgroundGate } from '@/lib/useBackgroundTaskGating';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const taskId = 'myBackgroundTask';
  
  // CRITICAL: Check the gate BEFORE making the request
  if (!checkBackgroundGate(taskId)) {
    console.log(`[BackgroundTask] ${taskId} blocked — foreground active`);
    return Response.json({ skipped: true, reason: 'foreground active' });
  }
  
  // Safe to proceed — foreground is not active
  try {
    const data = await base44.entities.SomeEntity.list();
    // ... process data
    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
```

## Rules

1. **Always check before the request**: Call `checkBackgroundGate()` before making ANY API call
2. **Return immediately if blocked**: If the gate returns false, skip the request entirely
3. **Never retry across cooldowns**: Don't wait and retry; just return and let the scheduler retry later
4. **Track task ID**: Use a meaningful task ID for diagnostics (e.g., 'autonomousCharacterMovement')
5. **Log the block**: Always log when a task is blocked so we can see in server logs

## What NOT to do

❌ **Bad**: Make the request and handle 429 after the fact
```javascript
try {
  const data = await base44.entities.SomeEntity.list();
} catch (error) {
  if (error.status === 429) {
    // Too late — we already consumed quota
  }
}
```

❌ **Bad**: Use timers or cooldowns
```javascript
await new Promise(r => setTimeout(r, 5000)); // Wrong
```

❌ **Bad**: Assume 5 seconds is enough
```javascript
if (Date.now() - lastCheck < 5000) return; // Wrong — user might still be in chat
```

## Frontend Activity Recording

Chat and user-facing pages should record activity to keep foreground active:

```javascript
import { recordUserActivity } from '@/lib/requestGate';

// On user interactions
<input onChange={() => recordUserActivity()} />
<button onClick={() => recordUserActivity()} />
```

This extends the time foreground stays active, preventing background systems from resuming while user is still using the page.

## Goal

✅ **Success**: Background requests are prevented before they're made, never reaching the "Too many requests" error screen
✅ **Never blocked**: Active chat/text/profile/travel pages never see rate-limit errors because background tasks never competed for quota
✅ **Clean pausing**: When background resumes, it's because the user has genuinely stopped interacting with the page (10+ seconds)