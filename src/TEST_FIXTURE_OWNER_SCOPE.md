# Test Fixture Owner-Scope Documentation

## Five Disposable Test Fixtures

All five fixtures live under `murqart@gmail.com` ownership:

| Fixture | Character ID | Purpose |
|---------|-------------|---------|
| Test Character A | `6a3983dac02e86d7175d14fa` | Control (no modification) |
| Test Character B | `6a3983dafa6a0ad2dedf165d` | Normal nap lifecycle |
| Test Character C | `6a3983da100ace8e196383ae` | Energy recovery |
| Test Character D | `6a3a84d929c5041ef33f7215` | Missed alarm recovery |
| Test Character E | `6a3a84d9612fb6b449cb6d79` | Communication (sleeping state) |

## Duplicate Test Character A — OWNER SCOPE WARNING

There is a **second** "Test Character A" in a different owner scope:

| ID | Owner Email | Scope |
|----|-----------|-------|
| `6a3983dac02e86d7175d14fa` | murqart@gmail.com | Primary fixture (control) |
| `6a361f19458486ddadfd633a` | adobevgc@gmail.com | Secondary — used as World Phone sender in communication tests |

**Why two exist:** The communication test (Fixture E) required a sender character in the same owner scope as the recipient. Since Fixture E lives under murqart, an isolated sender was needed. The adobevgc Test Character A was used as the sender to avoid creating a sixth fixture and to test cross-scope World Phone routing.

**Future test rule:** When running communication tests, always verify both sender and recipient IDs belong to the correct owner scope. Never assume "Test Character A" refers to a single record — always use the character ID, not the name, for fixture resolution.

## Canon Character Safety

Canon characters (Ethan Thompson, Andre, Melody, Khalil, etc.) must NEVER be used in fixture tests.
No friendships, family ties, memories, messages, or relationship history may be created between
disposable test characters and actual canon characters.

If a real character must be used for a test, stop and ask for user approval first.

## Fixture Reset Standard

After every test cycle, all five fixtures must be reset to:
- `resolved_presence_status: home`
- `energy_value: 75`
- `presence_stay_lock: false`
- `pending_alarm_time: null`
- `last_wake_time: <current time>`
- All stay-lock sub-fields cleared