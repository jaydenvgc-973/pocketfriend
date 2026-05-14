# Payload Contracts Audit: Complete Verification

## Purpose
Verify that ALL function callers send the exact field names that backend functions read.

---

## Function: extractMemoriesFromTurn

### Caller: `useChatBackgroundTasks.js` (Tier 3, 4000ms)

**Payload Sent:**
```javascript
safeInvoke('extractMemoriesFromTurn', {
  characterId,                          // ✓
  conversationId: convoId,              // ✓
  userMessage: enrichedUserMessage,     // ✓
  characterResponse: responseText,      // ✓
  recentMessages: (recentMsgs || []).slice(-10),  // ✓
  playAsCharacterId: activeCharacter?.id || null, // ✓
}, ...)
```

**Backend Function Reads:**
```javascript
const { 
  characterId,                 // ✓ matches
  conversationId,              // ✓ matches
  userMessage,                 // ✓ matches
  characterResponse,           // ✓ matches
  recentMessages,              // ✓ matches
  playAsCharacterId,           // ✓ matches
} = await req.json();
```

**Status:** ✅ PASS — All fields match

---

## Function: extractMemoriesFromConversation

### Caller: Profile page or UI components

**Payload Sent:**
```javascript
base44.functions.invoke('extractMemoriesFromConversation', {
  conversationId: convo.id  // ✓
})
```

**Backend Function Reads:**
```javascript
const { conversationId } = await req.json();  // ✓ matches
```

**Recovery Logic Added:**
```javascript
// If character_ids missing from convo, recover from messages
const charIdsFromMsgs = messages
  .filter(m => m.character_id && m.sender_type === 'character')
  .map(m => m.character_id);
```

**Status:** ✅ PASS — Field matches; recovery added for missing character_ids

---

## Function: syncWorldPhoneMemory

### Caller: `WorldContactsPopup.js` (bilateral character↔character sync)

**Payload Sent:**
```javascript
await base44.functions.invoke('syncWorldPhoneMemory', {
  senderCharacterId: character.id,      // ✓
  receiverCharacterId: contactChar.id,  // ✓
  messageContent: messageText,          // ✓
  messageSentAt: new Date().toISOString(),  // ✓
  conversation_id: conversation.id,     // ✓
})
```

**Backend Function Reads:**
```javascript
const {
  senderCharacterId,   // ✓ matches
  receiverCharacterId, // ✓ matches
  messageContent,      // ✓ matches
  messageSentAt,       // ✓ matches
  conversation_id,     // ✓ matches (note: snake_case in function)
} = await req.json();
```

**Status:** ✅ PASS — All fields match

---

## Function: generateImageAsync

### Caller: `ChatImageDispatch.js` (dispatchImageGeneration)

**Payload Sent:**
```javascript
const res = await base44.functions.invoke('generateImageAsync', {
  messageId: targetMsgId,                    // ✓
  prompt: imageGenPrompt,                    // ✓
  characterReferenceImages: publicCharRefs,  // ✓
  userReferenceImages: useUserRefs ? publicUserRefs : [],  // ✓
  characterName: character.name,             // ✓
  userWorldName: userSettings.fictional_world_name || currentUser.full_name || null,  // ✓
  subjectType,                               // ✓ ('character' or 'user')
  senderCharacterId: character.id,           // ✓
  characterId,                               // ✓ (subject character, may differ from sender)
  characterEmotionalState: character.emotional_state || 'calm',  // ✓
  liveLocationContext: buildLiveLocationContext(character, {}, true),  // ✓
  homeResolutionFailed,                      // ✓
  mayAssignTemporaryHousing,                 // ✓
  ownerEmail: currentUser.email,             // ✓
});
```

**Backend Function Reads:**
```javascript
const {
  messageId,                  // ✓ matches
  prompt,                     // ✓ matches
  characterReferenceImages,   // ✓ matches
  userReferenceImages,        // ✓ matches
  characterName,              // ✓ matches
  userWorldName,              // ✓ matches
  subjectType,                // ✓ matches
  senderCharacterId,          // ✓ matches
  characterId,                // ✓ matches
  characterEmotionalState,    // ✓ matches
  liveLocationContext,        // ✓ matches
  homeResolutionFailed,       // ✓ matches
  mayAssignTemporaryHousing,  // ✓ matches
  ownerEmail,                 // ✓ matches
} = await req.json();
```

**Status:** ✅ PASS — All fields match

---

## Function: recoverSingleImage

### Caller: `MessageBubble.js` (handleImageRetry)

**Payload Sent:**
```javascript
const res = await base44.functions.invoke('recoverSingleImage', {
  messageId: message.id,        // ✓
  forceRegenerate: false,       // ✓ (or true)
});
```

**Backend Function Reads:**
```javascript
const { messageId, forceRegenerate } = await req.json();  // ✓ both match
```

**Status:** ✅ PASS — All fields match

---

## Function: regenerateImageWithReason

### Caller: `RegenerateImageModal.js` (handleRegenSelect)

**Payload Sent:**
```javascript
const res = await base44.functions.invoke('regenerateImageWithReason', {
  messageId: message.id,            // ✓
  reason,                           // ✓
  customPrompt,                     // ✓
  manualLocationId: manualLocationId || null,  // ✓
  manualZoneId: manualZoneId || null,          // ✓
  directLocationImages: directLocationImages || null,  // ✓
  directZoneName: manualZoneId || null,        // ✓ (hmm—see issue below)
  directLocationName: directLocationName || null,  // ✓
  intendedSubjectIds: subjectData?.intendedSubjectIds || null,  // ✓
  includeUserSubject: subjectData?.includeUser || false,  // ✓
});
```

**Backend Function Reads:**
```javascript
const {
  messageId,            // ✓ matches
  reason,               // ✓ matches
  customPrompt,         // ✓ matches
  manualLocationId,     // ✓ matches
  manualZoneId,         // ✓ matches
  directLocationImages, // ✓ matches
  directZoneName,       // ⚠️ MISMATCH DETECTED
  directLocationName,   // ✓ matches
  intendedSubjectIds,   // ✓ matches
  includeUserSubject,   // ✓ matches
} = await req.json();
```

**Issue Found:** 
- Caller sends `directZoneName: manualZoneId || null` (should be zone name string)
- Backend reads `directZoneName` but expects it to be the zone NAME, not the ID

**Status:** ⚠️ ISSUE — directZoneName is being passed as an ID instead of name. Need to fix caller.

---

## Function: mediaGridGenerate

### Caller: `MediaGallery.js` (handleGenerate)

**Payload Sent:**
```javascript
const genRes = await base44.functions.invoke('mediaGridGenerate', {
  messageId: newMsg.id,                        // ✓
  prompt: enrichedPrompt,                      // ✓
  subjectType: effectiveSubjectType,           // ✓
  characterId: resolvedCharacterId,            // ✓
  characterName: resolvedCharacterName,        // ✓
  characterRefImages: resolvedCharRefImages,   // ✓
  userRefImages,                               // ✓
  userName: userSettings?.fictional_world_name || userChar?.world_name || userChar?.name || 'the user',  // ✓
  locationId: selectedLocation?.id || null,   // ✓
  locationName: selectedLocation?.name || null,  // ✓
  zoneName: selectedZone || (...),             // ✓
  zoneImageUrls,                               // ✓
  multiPersonSelection: finalMultiPersonSelection,  // ✓
  referenceImageUrl: referenceImageUrl || null,    // ✓
  referenceImageMode: referenceImageUrl ? referenceImageMode : 'prompt_only',  // ✓
  referenceImagePurpose: referenceImageUrl ? referenceImagePurpose : null,  // ✓
});
```

**Backend Function Reads:**
```javascript
const {
  messageId,                // ✓ matches
  prompt,                   // ✓ matches
  subjectType,              // ✓ matches
  characterId,              // ✓ matches
  characterName,            // ✓ matches
  characterRefImages,       // ✓ matches
  userRefImages,            // ✓ matches
  userName,                 // ✓ matches
  locationId,               // ✓ matches
  locationName,             // ✓ matches
  zoneName,                 // ✓ matches
  zoneImageUrls,            // ✓ matches
  multiPersonSelection,     // ✓ matches
  referenceImageUrl,        // ✓ matches
  referenceImageMode,       // ✓ matches
  referenceImagePurpose,    // ✓ matches
} = await req.json();
```

**Status:** ✅ PASS — All fields match

---

## Function: commitCharacterTravelToUser (NEW)

### Caller: `useChatBackgroundTasks.js` (Tier 1, immediate)

**Payload Sent:**
```javascript
safeInvoke('commitCharacterTravelToUser', {
  characterId,          // ✓
  characterResponse: responseText,  // ✓
  conversationId: convoId,  // ✓
}, ...)
```

**Backend Function Reads:**
```javascript
const { characterId, characterResponse, conversationId } = await req.json();  // ✓ all match
```

**Status:** ✅ PASS — All fields match

---

## Summary of Issues

### Issue 1: regenerateImageWithReason directZoneName mismatch

**Location:** `components/chat/RegenerateImageModal.js` line ~450

**Problem:**
```javascript
directZoneName: manualZoneId || null,  // ❌ passing ID, not name
```

**Should Be:**
```javascript
directZoneName: selectedZone?.zone_name || manualZoneId || null,  // ✓ pass name
```

**Impact:** Backend receives zone ID instead of zone name → may fail zone image lookup

**Fix:** Update RegenerateImageModal.js to pass the actual zone NAME string, not the ID.

---

## AVIF/HEIC Image Format Handling

### Current State
- Zone image_urls array may contain .avif or .heic files
- These formats are silently skipped by frontend providers
- Result: environment context missing from generation

### Required Fix
Add format detection and fallback to LocationReference:
1. Filter zone.image_urls for JPEG/PNG only
2. If none exist, show diagnostic: "Zone unsupported format — add JPEG photos"
3. Allow re-upload without removing the zone record

**Files to Update:**
- `components/chat/RegenerateImageModal.js` (zone image picker)
- `lib/locationResolutionEngine.js` (buildLiveLocationContext — document unsupported formats)

---

## Final Status

| Function | Caller | Contract | Status |
|----------|--------|----------|--------|
| extractMemoriesFromTurn | useChatBackgroundTasks | All fields match | ✅ PASS |
| extractMemoriesFromConversation | Profile/UI | Field matches; recovery added | ✅ PASS |
| syncWorldPhoneMemory | WorldContactsPopup | All fields match | ✅ PASS |
| generateImageAsync | ChatImageDispatch | All fields match | ✅ PASS |
| recoverSingleImage | MessageBubble | All fields match | ✅ PASS |
| regenerateImageWithReason | RegenerateImageModal | directZoneName mismatch | ⚠️ NEEDS FIX |
| mediaGridGenerate | MediaGallery | All fields match | ✅ PASS |
| commitCharacterTravelToUser | useChatBackgroundTasks | All fields match | ✅ PASS |

**Action Required:** Fix directZoneName mismatch in RegenerateImageModal.js before final acceptance.

---

**Audit Date:** 2026-05-14  
**Auditor:** Base44 System Verification  
**Next Step:** Fix AVIF/HEIC handling + directZoneName issue → Full runtime testing