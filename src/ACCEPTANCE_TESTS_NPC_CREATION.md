# NPC Character Creation — Acceptance Tests

## Overview
These tests verify that the shared NPC character creation payload builder (`buildNpcCharacterCreatePayload`) correctly prevents RLS permission errors and maintains ownership integrity across all character creation routes.

## Test Environment Setup
1. Create 2+ test accounts (different email addresses)
2. Log in to each account separately
3. Ensure at least one Active Creative Character exists on each account before running NPC creation tests

---

## Test Suite 1: AddPeopleInTheirWorldPanel (Character Profile)

### Test 1.1: Add New NPC Fictitious
**Route**: Character Profile → People In Their World → Add New Person

**Steps**:
1. Open a Character Profile for an existing Active Creative Character
2. Click "Add New Person" button
3. Type a new NPC name (e.g., "Test Friend Sally")
4. Click "Add"

**Expected Result**:
- ✅ Character created with `character_type: npc_fictitious`
- ✅ Character has `owner_email: current_user_email`
- ✅ Character has `owner_user_id: current_user_id`
- ✅ NO `created_by` field in create payload
- ✅ Character added to linked character's `fictional_relationships`
- ✅ Relationship type set to "friend"
- ✅ Diagnostic log shows pre-create info (console output)

**Failure Indicators**:
- ❌ "Permission denied for create operation" error
- ❌ Character created with `created_by` field
- ❌ Character created with missing `owner_email`
- ❌ Relationship not added to parent character

---

### Test 1.2: Add Existing NPC Fictitious
**Route**: Character Profile → People In Their World → Add Existing

**Steps**:
1. Create an NPC Fictitious character in advance (via Edit Character Type or Test 1.1)
2. Open Character Profile for a different Active Creative Character
3. Click "Add Existing" button
4. Select the pre-created NPC from dropdown
5. Click "Add"

**Expected Result**:
- ✅ Relationship added without re-creating character
- ✅ Existing character is unchanged
- ✅ Relationship added to current character's `fictional_relationships`

**Failure Indicators**:
- ❌ Character not appearing in selection dropdown
- ❌ Error adding existing character

---

## Test Suite 2: EditCharacterType (Settings)

### Test 2.1: Create New NPC Fictitious
**Route**: Settings → Edit Character Type → Create New

**Steps**:
1. Go to Settings → Edit Character Type (expand panel)
2. Search for a non-existent name (e.g., "Brand New Test NPC")
3. Click "Create new character..." button
4. Select "NPC Fictitious" type
5. Link to an Active Creative Character (required)
6. Select a relationship type from dropdown (e.g., "Friend")
7. Click "Create Character"

**Expected Result**:
- ✅ Character created with `character_type: npc_fictitious`
- ✅ Character has `owner_email`, `owner_user_id`
- ✅ NO `created_by` field in payload
- ✅ Character linked to parent character's `fictional_relationships`
- ✅ Diagnostic log shows successful creation with all metadata

**Failure Indicators**:
- ❌ "Permission denied" error
- ❌ Missing `owner_email` in payload
- ❌ Relationship type hardcoded as "friend" instead of user selection

---

### Test 2.2: Create New NPC Family Member
**Route**: Settings → Edit Character Type → Create New

**Steps**:
1. Settings → Edit Character Type
2. Create new character, search for non-existent name
3. Select "NPC Family Member" type
4. Link to Active Creative Character (required)
5. Select family title from dropdown (e.g., "mother", "brother")
6. Click "Create Character"

**Expected Result**:
- ✅ Character created with `character_type: npc_family_member`
- ✅ Character has `owner_email`, `owner_user_id`
- ✅ NO `created_by` in payload
- ✅ Added to parent character's `family_members` list
- ✅ Also added to `fictional_relationships` with relationship_type: "family"

**Failure Indicators**:
- ❌ "Permission denied" error
- ❌ Family member not added to `family_members` array
- ❌ Missing `owner_email`

---

### Test 2.3: Create New NPC Regular
**Route**: Settings → Edit Character Type → Create New

**Steps**:
1. Settings → Edit Character Type
2. Create new character (no linked character required for this type)
3. Select "NPC Regular" type
4. Click "Create Character"

**Expected Result**:
- ✅ Character created with `character_type: npc_regular`
- ✅ Character has `owner_email`, `owner_user_id`
- ✅ NO `created_by` in payload
- ✅ `exclude_from_homepage: true` set automatically
- ✅ Character visible in character lists

**Failure Indicators**:
- ❌ "Permission denied" error
- ❌ Character hidden from lists
- ❌ Missing ownership fields

---

### Test 2.4: Promote Existing Character to Active Creative Character
**Route**: Settings → Edit Character Type → Promote Existing

**Steps**:
1. Settings → Edit Character Type
2. Search for an existing NPC (any type: fictitious, family, regular)
3. Click to select it
4. Select "Active Creative Character" type
5. Click "Apply — Reclassify..."

**Expected Result**:
- ✅ Character type updated to `active_created_character`
- ✅ Character moves to Active Creative Characters list
- ✅ All existing data (relationships, memories, etc.) preserved
- ✅ Can now be used as parent for new NPCs

**Failure Indicators**:
- ❌ Character type not updated
- ❌ Data loss or corruption
- ❌ Character becomes invisible

---

### Test 2.5: GUARD — Block New Active Creative Character Creation
**Route**: Settings → Edit Character Type → Create New (with active_created_character selected)

**Steps**:
1. Settings → Edit Character Type
2. Create new character workflow
3. Select "Active Creative Character" type
4. Try to continue/create

**Expected Result**:
- ✅ Error message displayed:
  - "Active Creative Characters must be created from the dedicated character creation page, not from this lightweight panel. Please navigate to the character creation flow."
- ✅ Create button disabled or blocked
- ✅ Character.create() is NOT called
- ✅ User redirected to proper character creation page

**Failure Indicators**:
- ❌ Character created despite guard
- ❌ No error message shown
- ❌ Lightweight create succeeds for active_created_character

---

## Test Suite 3: Cross-Account Verification

### Test 3.1: Ownership Isolation (Account A ≠ Account B)
**Steps**:
1. Account A: Create NPC "Alice" (npc_fictitious) via Add People In Their World
2. Account B: Log in with different account
3. Account B: Search for "Alice" in Settings → Edit Character Type
4. Check visibility

**Expected Result**:
- ✅ Account A can see "Alice" in own character lists
- ✅ Account B cannot see "Alice" in own character lists
- ✅ Account A's "Alice" has `owner_email: accountA@example.com`
- ✅ Account B's search results only show their own characters

**Failure Indicators**:
- ❌ Cross-account character visibility
- ❌ Wrong `owner_email` on character
- ❌ Shared character between accounts

---

### Test 3.2: Ownership Metadata Persistence
**Steps**:
1. Create NPC in Account A via Add People workflow
2. Open that character's profile
3. Refresh page, check character data

**Expected Result**:
- ✅ `owner_email` unchanged
- ✅ `owner_user_id` unchanged
- ✅ Character remains visible
- ✅ No "created_by" field in database

---

## Test Suite 4: Diagnostic Logging

### Test 4.1: Pre-Create Diagnostics (AddPeopleInTheirWorldPanel)
**Check Console Logs**:
1. Open Character Profile, Add New Person
2. Create new NPC
3. Check browser console for log: `[AddPeopleInTheirWorldPanel] handleAddNew PRE-CREATE:`
4. Verify log contains:
   - `ownerEmail: current_user_email` ✅
   - `owner_user_id_present: true` ✅
   - `payloadHasOwnerEmail: true` ✅
   - `attemptingCharacterCreate: true` ✅

---

### Test 4.2: Pre-Create Diagnostics (EditCharacterType)
**Check Console Logs**:
1. Settings → Edit Character Type → Create New NPC Fictitious
2. Complete creation
3. Check browser console for log: `[EditCharacterType] handleCreateNew PRE-CREATE:`
4. Verify contains:
   - `activeCreatedCharacterGuardPassed: true` ✅
   - `ownerEmail: current_user_email` ✅
   - `payloadHasOwnerEmail: true` ✅

---

## Pass/Fail Criteria

✅ **PASS**: All 2+ accounts can successfully:
- Create NPC Fictitious via both routes
- Create NPC Family Member via Edit Character Type
- Create NPC Regular via Edit Character Type
- Promote existing NPCs to Active Creative Characters
- Cannot create new Active Creative Characters from lightweight panel
- All characters have correct ownership metadata
- Cross-account isolation maintained
- Console diagnostics appear with correct data

❌ **FAIL**: Any of:
- Permission denied errors on create
- Missing `owner_email` or `owner_user_id`
- `created_by` field in create payload
- Cross-account character visibility
- Character creation succeeds for active_created_character from lightweight panel
- Diagnostic logs missing or incomplete

---

## Regression Checks

After passing all tests, verify:
- [ ] Existing Active Creative Characters still work
- [ ] Existing NPCs still visible and functional
- [ ] Character list refresh shows all expected characters
- [ ] Relationships intact after NPC creation
- [ ] No hidden or "lost" characters

---

## Sign-Off

**Tester Name**: ________________  
**Test Date**: ________________  
**Accounts Tested**: ________________  
**Result**: ☐ PASS ☐ FAIL

**Notes**: