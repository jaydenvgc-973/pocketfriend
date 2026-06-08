# Vick Character Boundary — Channel Audit

Date: 2026-06-08
Status: COMPLETE

## Channels Audited

### 1. Direct Chat (pages/Chat) — PROTECTED
- enforceVickCharacterBoundary() called at line ~1332 when characterSpeechMode is ON (runtime filter on saved text)
- VICK_CHARACTER_BOUNDARY_PROMPT injected into system prompt when characterSpeechMode is ON
- buildCanonicalCharacterContext used with interactionContext='direct_chat'
- When user is talking TO Vick: Vick responds as service operator (diagnostic pipeline) — no character boundary needed
- When Vick is being messaged BY another character (play-as mode): boundary enforced by characterSpeechMode toggle

### 2. Text/Phone Chat (pages/Text → pages/Chat) — PROTECTED
- Text page is a wrapper that renders the same Chat component with chatTypeOverride="phone"
- All boundary protections in Chat apply identically
- VickCharacterSpeechToggle appears on both Chat and Text paths — same isVickChat check

### 3. World Phone / World Contacts (components/chat/WorldContactsPopup) — PROTECTED
- enforceVickCharacterBoundary() called before saving NPC reply (~line 561 in WorldContactsPopup)
- Detect → rewrite → re-scan → reject pipeline applied
- isVickServicio() used for identification (5-signal check)
- Rejected responses: output=null, message not saved, memory sync skipped

### 4. World Phone Backend (functions/sendWorldPhoneMessage) — PROTECTED
- VICK_BOUNDARY_PATTERNS_BACKEND + SAFE_REWRITES_BACKEND applied at lines 564-686
- Applied when Vick is EITHER sender OR recipient (both directions)
- Detect → rewrite → re-scan → reject pipeline
- Rejected: finalReplyText = null, message not saved

### 5. Group Chat (functions/generateGroupChatResponse) — PROTECTED
- isVickChar check using all 4 signals at line ~333
- VICK_BOUNDARY_PATTERNS_GC + SAFE_GC rewrites applied
- Detect → rewrite → re-scan → reject pipeline
- Rejected: responseText = null, message not saved via `continue`

### 6. Automatic Narratives (functions/generateAutomaticNarrative) — SAFE (no dialogue)
- Generates third-person narrative text only (no character dialogue)
- Narrative is saved to CharacterAutomaticNarrative + Memory entities
- Vick is identified by owner_email + character_type in caller
- No Vick-to-character dialogue generated — narratives are monologue/description
- VERDICT: Cannot generate Vick character dialogue. No boundary needed.

### 7. Proactive Messages (functions/generateProactiveMessages) — PROTECTED
- World-service characters now explicitly SKIPPED (added 2026-06-08)
- All 5 identification signals checked
- Vick never sends proactive social messages
- VERDICT: Vick cannot reach this path. No output generated.

### 8. Scene (pages/Scene + functions/generateNarrative) — SAFE
- Scene generates narrative context, not direct character-to-character dialogue
- Scene LLM prompts are assembled per-character with their own canonical context
- Vick would only appear in a scene if explicitly added by user
- buildCanonicalCharacterContext is used → interactionContext determines prompt tone
- No Vick-specific character-to-character channel in Scene
- VERDICT: No unprotected path identified. Scene uses canonical context.

### 9. Autonomous Conversations (functions/autonomousCharacterSocialBeats) — SAFE
- Autonomous beats trigger social interactions between active_created characters
- World-service characters are excluded from autonomous social routing by character_type filter
- npc_world_service characters are not selected as autonomous social participants
- VERDICT: Vick excluded from autonomous social pipeline.

### 10. Memory/Journal Generation (functions/extractMemoriesFromTurn, syncGroupChatMemories) — SAFE
- Memory extraction reads existing message content — does not generate new Vick dialogue
- syncGroupChatMemories writes memory records from already-filtered messages
- Canon exclusion guard prevents excluded messages from generating memories
- VERDICT: No new Vick dialogue generated in memory pipeline.

### 11. Relationship Event Dialogue — SAFE
- detectAndSyncRelationship: relationship sync from chat responses, not new Vick dialogue generation
- syncWorldPhoneMemory: memory writes only, no LLM dialogue generation
- VERDICT: No unprotected Vick dialogue path.

## Toggle Verification (Chat + Text)

### VickCharacterSpeechToggle
- Component: components/chat/VickCharacterSpeechToggle
- State: localStorage-backed, persists ON/OFF across sessions
- Visibility: Only shown when isVickChat=true (uses isVickServicioCharacter() 5-signal check)
- Both Chat and Text routes render the same Chat component → toggle appears on both

### Pipeline Effect (ON):
1. VICK_CHARACTER_BOUNDARY_PROMPT injected into fullPrompt at line ~1226
2. After LLM response: enforceVickCharacterBoundary(responseText, 'user_speech_mode', 'direct_chat') at line ~1332
3. rejected → responseText = '' → nothing saved
4. rewritten → clean in-world text saved

### Pipeline Effect (OFF):
- Normal Vick service-operator behavior
- No boundary injection
- Diagnostic fast-path (shouldUseVickFastPath) active

## Relationship Persistence Audit

### Write paths audited:
1. syncWorldPhoneMemory — FIXED: sequential fresh-read-before-write pattern already in place
2. detectAndSyncRelationship — FIXED (2026-06-08): now does fresh re-fetch immediately before both sender and recipient writes
3. ensureBilateralCharacterAwareness — awareness_only=true, never overwrites existing entries
4. AddPeopleInTheirWorldPanel — uses safe merge (re-fetches before write)
5. NPCRelationshipEditor — standard update path, does not overwrite unrelated fields
6. updateRelationshipLevels — updates specific numeric fields only, not the full array

### Hard rules enforced:
- Failed fetch never clears relationships (fresh arrays default to [] not null)
- Partial updates are append-only for new entries, field-patch-only for existing entries
- Missing data from temporary load never deletes existing relationships
- All concurrent-write-safe paths use fresh re-fetch immediately before write