# Character Action + Dialogue + Autonomy System

## Overview

This system separates character **actions** from **dialogue** and enables autonomous behavior. It is a pure add-on to the existing system and does not break any current functionality.

## Core Concepts

### Action (NarrativeAction)
What the character is doing — behavior, movement, body language, physical interaction.

**Examples:**
- Ethan walks down the street, phone in hand.
- Ethan leans against the wall and exhales.
- Ethan passes Jayden a drink.

**Storage:** Message entity with `is_narrative: true`

### Dialogue
What the character says — spoken words.

**Examples:**
- "You really think you can keep me here?"
- "I'm outside now."
- "Hold on, I need a second."

**Storage:** Message entity with `is_narrative: false`

### Autonomous Action
An action the character performs independently, without user input.

**Examples:**
- Ethan grabs his keys and heads out the door.
- Ethan sits on the couch listening to music.
- Ethan calls his best friend.

**Storage:** Message entity with `is_narrative: true`

## System Architecture

### 1. Response Parsing
**Function:** `parseCharacterResponse.js`

Separates raw character response into action and dialogue components.

```
Input: raw character response or structured object
Output: { action, dialogue }
```

This allows the LLM to produce combined responses like:
```
Ethan looks up at Jayden, a sharp grin on his face.
"You really think you can keep me here?"
```

But the system splits it into two separate messages.

### 2. Action + Dialogue Submission
**Function:** `submitCharacterActionAndDialogue.js`

Submits action and dialogue as separate Message records.

**Flow:**
1. STEP 1: Submit action as narrative entry (is_narrative: true)
2. STEP 2: Submit dialogue as dialogue message (is_narrative: false)

Both use the existing Message entity.

### 3. Autonomous Action Generation
**Function:** `generateAutonomousAction.js`

Generates an autonomous action based on character personality and context.

Triggered probabilistically after character responses (30% chance by default in Chat.jsx line ~1625).

## Integration Points

### Chat Response Flow (pages/Chat.jsx)

When a user sends a message:

1. LLM generates character response
2. Response is parsed into action + dialogue
3. Both are submitted separately using `submitCharacterActionAndDialogue`
4. Memory extraction includes both action and dialogue
5. Autonomy: Occasionally (30% chance) an autonomous action is generated and submitted

### Memory Extraction (functions/extractMemoriesFromTurn.js)

Characters remember both actions and dialogue.

When extracting memories:
- `characterAction` is included along with `characterReply`
- The system extracts meaningful actions as memories
- Character can later recall "what they did"

### Rendering (components/chat/MessageBubble.jsx)

Already supports narrative rendering:
- `is_narrative: true` → renders as narrative entry (italicized, centered)
- `is_narrative: false` → renders as dialogue bubble (normal message)

## Implementation Details

### Message Storage Format

**Action (NarrativeAction):**
```json
{
  "text": "Ethan walks down the street, phone in hand.",
  "is_narrative": true,
  "sender_type": "character",
  "character_id": "...",
  "character_name": "Ethan"
}
```

**Dialogue:**
```json
{
  "text": "You really think you can keep me here?",
  "is_narrative": false,
  "sender_type": "character",
  "character_id": "...",
  "character_name": "Ethan"
}
```

### Autonomy Generation

Autonomous actions are submitted directly as narrative entries:

```javascript
// In Chat.jsx autonomy section (line ~1625)
base44.entities.Message.create({
  conversation_id: convoId,
  sender_type: 'character',
  character_id: characterId,
  character_name: character.name,
  content: res.data.action,  // autonomous action text
  emotional_state: emotionalState,
  is_narrative: true,        // crucial: actions are narratives
  timestamp: new Date().toISOString(),
});
```

## Location Compatibility

Actions can include location references:
- "Ethan heads to St Joseph's Hospital in Paterson."
- Existing location detection systems should pick this up
- Character's location can be updated based on detected location in action

## Proximity Compatibility

Actions respect proximity rules:
- If character is with user: direct actions toward user are allowed
- If character is away: only independent actions are allowed
- Example "Ethan grabs Jayden's hand" only valid if in same location

## Memory & Recall

Actions are stored in long-term memory via `extractMemoriesFromTurn`:

**User later asks:** "What did you do yesterday?"
**Character remembers:** "I headed to the hospital and called my friend."

This works because both actions and dialogue are included in memory extraction.

## Success Criteria (All Met)

✅ NarrativeAction is clearly understood and implemented
✅ NarrativeAction uses existing Message system with `is_narrative: true`
✅ Dialogue uses `is_narrative: false`
✅ Action and dialogue always submitted separately
✅ Action always comes before dialogue (separate submissions in order)
✅ Characters generate autonomous NarrativeActions
✅ Existing systems keep working (pure add-on)
✅ Rendering clearly distinguishes narrative from dialogue
✅ Memory and location compatibility maintained
✅ No existing data erased or broken

## Key Files

- `functions/parseCharacterResponse.js` — Parse response into action + dialogue
- `functions/submitCharacterActionAndDialogue.js` — Submit separately
- `functions/generateAutonomousAction.js` — Generate autonomous behavior
- `functions/extractMemoriesFromTurn.js` — Extract memories from both action and dialogue
- `pages/Chat.jsx` — Integration points (lines ~1200, ~1625)
- `components/chat/MessageBubble.jsx` — Already renders narratives correctly

## Backward Compatibility

This system is 100% backward compatible:
- Existing messages continue to work
- Existing narrative system continues to work
- All existing features remain functional
- No data migration required
- No breaking changes to any entity schema