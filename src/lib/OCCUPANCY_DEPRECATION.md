# OCCUPANCY SYSTEM DEPRECATION & REBUILD

## CRITICAL CHANGE

All location occupancy (resident_character_ids, worker_character_ids) has been **deprecated and made read-only**.

**WHY:**
- These arrays were being written inconsistently, creating duplicate presence
- Home and Travel screens read different sources (occupancy vs. current_location_id)
- Characters appeared in multiple places simultaneously
- Occupancy wasn't synced with authoritative current_location_id

## NEW SYSTEM

**Occupancy is NOW COMPUTED ONLY from character `current_location_id`.**

### Rules
1. **NO CODE** should write to resident_character_ids or worker_character_ids
2. **ALL occupancy reads** must derive from `current_location_id`
3. **Single source of truth:** getAuthoritativeCharacterLocation(character, locationMap)

### Where Occupancy is Read
- TravelLocationGrid: Shows characters at each location (computed from charactersByLocationId)
- Travel page presence summary: Filters characters by authoritative location
- Scene page: Should use authoritative location only
- Any occupancy display in the UI

### Where Occupancy MUST NEVER be Written
- Travel page (was writing to resident_character_ids)
- Scene page (was writing to worker_character_ids)
- Any location mutation that updates occupancy arrays
- Character creation/movement flows

### Backend Functions Affected
These functions should NO LONGER write occupancy arrays:
- assignCharacterToHome
- assignCharacterToWork
- updateCharacterLocationFromMessage
- recordCharacterInviteAccepted
- Any "place character" logic

## Transition
- UI has been migrated to read from charactersByLocationId (derived from current_location_id)
- checkHomeAccess now uses getAuthoritativeCharacterLocation
- All location presence displays now filter authoritative locations

## Verification
If you see occupancy arrays being written, that's a BUG that must be fixed immediately.