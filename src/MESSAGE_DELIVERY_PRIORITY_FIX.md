# Message Delivery Priority Fix
**Date: 2026-03-28**

## Critical Changes Made

### 1. **Separated Message Delivery from Audio Generation**
- **Before**: Voice generation blocked message delivery
- **After**: Messages are saved and displayed BEFORE voice generation starts
- Voice generation now runs as fire-and-forget after message is safe
- Audio errors no longer affect message visibility

### 2. **Removed Blocking Voice Logic**
- Deleted `playCharacterVoice()` function (was entangled with message flow)
- Created `generateAndPlayVoice()` as independent, non-blocking operation
- Voice failures log warnings but do NOT affect message display

### 3. **Fixed Query Invalidation Pattern**
- Removed `queryClient.invalidateQueries` on message operations
- Subscription system now handles all message state updates in real-time
- Stale data from queries can no longer overwrite newly delivered messages

### 4. **Guaranteed Message Persistence**
- Text messages saved to database BEFORE voice generation attempts
- Image placeholders created immediately when requested
- Subscription updates messages in real-time (images complete)
- Messages stay visible even if audio attachment fails

### 5. **Simplified State Management**
- Messages are added once via subscription (prevents duplicates)
- No redundant query refetches
- Only character state invalidated (for relationship updates)
- Message state managed purely via subscription

## Priority Order (Now Enforced)

1. **Text Message Created** → Saved to DB → Added to UI
2. **Text Message Displayed** → Visible in thread immediately
3. **Image Message Created** → Placeholder saved → Displayed
4. **Image Generation** → Happens in background → Placeholder updates when ready
5. **Voice Generation** → Attempts after message is safe (optional)
6. **Voice Playback** → Optional enhancement only
7. **Emotion/Relationship Updates** → Process successfully saved messages

## Message Delivery Flow (New)

```
Text Input
    ↓
[Save to DB] ← BLOCKING (must succeed)
    ↓
[Add to UI] ← BLOCKING (must display)
    ↓
[Fire voice generation] ← NON-BLOCKING (optional)
    ↓
[Character state updates] ← NON-BLOCKING
```

## Voice Behavior (New)

- Voice will generate IF: global enabled + API key + character configured + not phone mode
- Voice will SKIP IF: any of above conditions false
- Voice CANNOT prevent message from being delivered
- Voice failures are logged as warnings, not errors
- Message stays visible and functional regardless of voice state

## Testing Requirements

✓ Send text message → stays visible
✓ Send image request → placeholder appears
✓ Image generates → placeholder updates with image
✓ Audio fails → message still visible, still saved, still usable
✓ Switch characters → no message bleed between conversations
✓ Refresh page → messages still visible
✓ Check console → logs show delivery sequence without voice errors blocking

## Diagnostic Logging

Console logs now show:
- `[Chat] LOAD:` - Initial conversation loading
- `[Chat] SUB:` - Subscription updates
- `[Chat] USER MESSAGE SAVED:` - User messages created
- `[Chat] CHARACTER TEXT MESSAGE SAVED:` - Character replies created
- `[VOICE-xxx]` - Voice generation attempts (non-blocking)
- `[PLAYBACK-xxx]` - Audio playback attempts

## Files Modified

- `pages/Chat.jsx`
  - Replaced `playCharacterVoice()` with `generateAndPlayVoice()`
  - Moved voice generation to fire-and-forget callbacks
  - Removed blocking voice await patterns
  - Simplified subscription logic
  - Removed redundant query invalidations
  - Added clear message delivery logging

## What This Fixes

❌ Messages disappearing after appearing
✓ Messages now save first, voice attempts after

❌ Repeated context/responses
✓ Delivered messages stay in conversation state

❌ Audio failures blocking message delivery  
✓ Audio is now completely independent

❌ Image messages blocked by voice
✓ Image placeholders appear immediately

❌ Stale data overwrites from queries
✓ Only subscription updates messages

## Next Steps (If Issues Remain)

If any messages still disappear:
1. Check console for `[Chat]` logs showing delivery
2. Verify subscription is firing (`[Chat] SUB:` logs)
3. Check for any remaining query invalidations
4. Verify database writes are completing
5. Look for JavaScript errors in console

## Rollback If Needed

All changes are additive/isolated to message flow. If issues arise:
- Voice will degrade gracefully (optional only)
- Subscription still handles real-time updates
- Database saves are synchronous first