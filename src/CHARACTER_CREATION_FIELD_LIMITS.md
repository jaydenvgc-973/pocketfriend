# Character Creation Field Limits

This document outlines all text field character limits in the character creation form.

## Text Fields with Character Limits

| Field | Max Characters | Purpose |
|-------|----------------|---------|
| Backstory | 2000 | Background story and past |
| Personality Notes | 1500 | Personality overrides and raw traits |
| Current Situation | 1500 | What's happening in their life now |
| Occupation Description | 800 | What a typical work day looks like |
| Criminal Record | 1000 | Criminal history (optional) |
| Work Environment | 600 | Description of workplace setting |

## User Experience Features

### Live Character Counter
- Displays current character count and maximum allowed
- Updates in real-time as users type
- Format: `320 / 2000 characters`

### Visual Warnings
- **Green/Normal**: Below 80% of limit
- **Amber/Warning**: 80-100% of limit with countdown (`680 characters remaining`)
- **Red/Error**: Over limit with warning message

### Validation on Creation
When users try to create a character:
1. All fields are validated against their limits
2. If any field exceeds the limit:
   - Creation is blocked
   - User sees a clear error message listing all problematic fields
   - Example: `"Backstory is too long (2150/2000 characters)"`
3. User can then return to the affected field and shorten it
4. The character counter helps track progress as they edit

## Implementation Details

- Validation component: `components/character/ValidatedTextField.jsx`
- Validation logic in: `pages/CreateCharacter.jsx` (validateFields function)
- Fields automatically save to draft as user types
- No silent failures — all errors are user-facing