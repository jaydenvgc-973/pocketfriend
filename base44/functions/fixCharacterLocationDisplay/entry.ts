import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixCharacterLocationDisplay — Authoritative Location Contradiction Repair
 *
 * ARCHITECTURE:
 *   - Covers: active_created_character, npc_fictitious, npc_family_member
 *   - Skips: internal family files (family_members[] without standalone Character record)
 *   - Calls resolveCharacterPresence for authoritative resolver service (no inline duplication)
 *   - Runs in DRY-RUN mode by default (no writes)
 *   - Writes only when { confirm: true } is passed in request body
 *
 * FIELDS THAT CAN BE WRITTEN:
 *   resolved_current_location_id, resolved_current_location_name,
 *   resolved_presence_status, resolved_location_type (only when status changes),
 *   resolved_source_reason
 *
 * FIELDS THAT ARE NEVER WRITTEN:
 *   current_home_location_id, current_work_location_id, occupation_location_id,
 *   travel_status, traveling_to_location_id, resident arrays, any LocationReference record,
 *   resolved_last_updated_at
 *
 * ACCOUNT ISOLATION:
 *   All queries scoped to user.email. No cross-account reads or writes.
 *
 * TRAVEL PROTECTION:
 *   If character is in valid active travel, SKIP without modification.
 *   If travel destination is stale/invalid, FLAG without correction.
 *   No time-based travel expiration logic.
 *   No future/scheduled travel logic.
 */

// ── CALL RESOLVER SERVICE ──────────────────────────────────────────────────────
async function callResolveCharacterPresence(base44, characterId, characterObject, locationMap) {
  try {
    const res = await base44.functions.invoke('resolveCharacterPresence', {
      character_id: characterId,
      characterObject,
      locationMap,
    });
    return res?.data || null;
  } catch (err) {
    console.error(`[fixCharacterLocationDisplay] Resolver call failed for ${characterId}:`, err.message);
    return null;
  }
}

// ── CONTRADICTION DETECTION ────────────────────────────────────────────────────
function detectContradiction(char, resolverResult) {
  if (!resolverResult || !resolverResult.success) {
    return {
      action: 'ERROR',
      detail: resolverResult?.error || 'Resolver failed',
      before: null,
      after: null,
      changedFields: [],
    };
  }

  const { resolved_presence, validation_issues, is_in_valid_travel } = resolverResult;

  // ── TRAVEL PROTECTION: valid active travel → skip entirely ──
  if (is_in_valid_travel) {
    return {
      action: 'SKIP_TRAVEL',
      detail: 'Character in valid active travel — protected',
      before: null,
      after: null,
      changedFields: [],
    };
  }

  // ── STALE TRAVEL DESTINATION → flag only, no correction ──
  const staleTravel = validation_issues?.find(i => i.type === 'stale_travel_destination');
  if (staleTravel) {
    return {
      action: 'FLAG_TRAVEL_ISSUE',
      flag: 'stale_travel_destination',
      detail: staleTravel.detail,
      before: null,
      after: null,
      changedFields: [],
    };
  }

  // ── OTHER FLAGS (stale pointer, broken home) ──
  const otherFlag = validation_issues?.find(i => ['stale_pointer', 'broken_home_pointer'].includes(i.type));
  if (otherFlag) {
    return {
      action: 'FLAG',
      flag: otherFlag.type,
      detail: otherFlag.detail,
      before: null,
      after: null,
      changedFields: [],
    };
  }

  // ── COMPARE RESOLVED FIELDS ──
  const truthId     = resolved_presence.resolved_current_location_id;
  const truthName   = resolved_presence.resolved_current_location_name;
  const truthStatus = resolved_presence.resolved_presence_status;
  const truthType   = resolved_presence.resolved_location_type;
  const truthReason = resolved_presence.resolved_source_reason;

  const idMatches     = char.resolved_current_location_id   === truthId;
  const nameMatches   = char.resolved_current_location_name === truthName;
  const statusMatches = char.resolved_presence_status       === truthStatus;
  const typeMatches   = !truthType || char.resolved_location_type === truthType;

  if (idMatches && nameMatches && statusMatches && typeMatches) {
    return { action: 'NO_CHANGE', detail: 'Fields already correct', before: null, after: null, changedFields: [] };
  }

  // Build the correction diff
  const changedFields = [];
  const before = {};
  const after  = {};

  if (!idMatches) {
    changedFields.push('resolved_current_location_id');
    before.resolved_current_location_id = char.resolved_current_location_id;
    after.resolved_current_location_id  = truthId;
  }
  if (!nameMatches) {
    changedFields.push('resolved_current_location_name');
    before.resolved_current_location_name = char.resolved_current_location_name;
    after.resolved_current_location_name  = truthName;
  }
  if (!statusMatches) {
    changedFields.push('resolved_presence_status');
    before.resolved_presence_status = char.resolved_presence_status;
    after.resolved_presence_status  = truthStatus;
    // Sync location_type when status changes
    if (truthType) {
      changedFields.push('resolved_location_type');
      before.resolved_location_type = char.resolved_location_type;
      after.resolved_location_type  = truthType;
    }
  }

  let action = 'COMBINED_SYNC';
  if (changedFields.length === 1) {
    action = changedFields[0].includes('status') ? 'STATUS_SYNC' : 'FIELD_SYNC';
  }

  return { action, detail: truthReason || 'correction', before, after, changedFields };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const confirmWrite = body?.confirm === true;

    console.log(`[FIX_LOCATIONS] Starting | user=${user.email} | confirmWrite=${confirmWrite}`);

    // ── STEP 1: Load all LocationReference records (owned + created + shared) ─
    const [allLocationsOwned, allLocationsCreated, allLocationsShared] = await Promise.all([
      base44.entities.LocationReference.filter({ owner_email: user.email }).catch(() => []),
      base44.entities.LocationReference.filter({ created_by: user.email }).catch(() => []),
      base44.entities.LocationReference.filter({ scope: 'shared' }).catch(() => []),
    ]);
    const locSeen = new Set();
    const allLocations = [...allLocationsOwned, ...allLocationsCreated, ...allLocationsShared].filter(l => {
      if (locSeen.has(l.id)) return false;
      locSeen.add(l.id);
      return true;
    });
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    console.log(`[FIX_LOCATIONS] Loaded ${allLocations.length} locations`);

    // ── STEP 2: Load all three character types (account-scoped) ───────────────
    const [activeCharsOwned, activeCharsCreated,
           npcFictOwned, npcFictCreated,
           npcFamOwned, npcFamCreated] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'active_created_character', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ created_by: user.email, character_type: 'active_created_character', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ created_by: user.email, character_type: 'npc_fictitious', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ owner_email: user.email, character_type: 'npc_family_member', status: 'active' }).catch(() => []),
      base44.entities.Character.filter({ created_by: user.email, character_type: 'npc_family_member', status: 'active' }).catch(() => []),
    ]);

    const charSeen = new Set();
    const allCharacters = [
      ...activeCharsOwned, ...activeCharsCreated,
      ...npcFictOwned, ...npcFictCreated,
      ...npcFamOwned, ...npcFamCreated,
    ].filter(c => {
      if (charSeen.has(c.id)) return false;
      charSeen.add(c.id);
      return true;
    });
    console.log(`[FIX_LOCATIONS] Loaded ${allCharacters.length} characters`);

    // ── STEP 3: Identify internal family files (not standalone Character records) ─
    const standaloneCharIds = new Set(allCharacters.map(c => c.id));
    const internalFamilyFiles = [];
    for (const char of allCharacters) {
      for (const fm of (char.family_members || [])) {
        if (fm.name && !standaloneCharIds.has(fm.character_id)) {
          internalFamilyFiles.push({
            name: fm.name,
            parent_character_id: char.id,
            parent_character_name: char.name,
          });
        }
      }
    }

    // ── STEP 4: Call resolveCharacterPresence for each character ──────────────
    const results = [];
    let travel_protected_count = 0;
    let stale_travel_count = 0;

    for (const char of allCharacters) {
      const resolverResult = await callResolveCharacterPresence(base44, char.id, char, locationMap);
      const contradiction = detectContradiction(char, resolverResult);

      if (contradiction.action === 'SKIP_TRAVEL') travel_protected_count++;
      else if (contradiction.action === 'FLAG_TRAVEL_ISSUE') stale_travel_count++;

      results.push({
        character_id:   char.id,
        character_name: char.name,
        character_type: char.character_type,
        action:         contradiction.action,
        flag:           contradiction.flag || null,
        detail:         contradiction.detail,
        before:         contradiction.before,
        after:          contradiction.after,
        changedFields:  contradiction.changedFields || [],
      });
    }

    // Categorize results
    const toWrite       = results.filter(r => !['NO_CHANGE', 'FLAG', 'FLAG_TRAVEL_ISSUE', 'SKIP_TRAVEL', 'ERROR'].includes(r.action));
    const noChange      = results.filter(r => r.action === 'NO_CHANGE');
    const flagged       = results.filter(r => ['FLAG', 'FLAG_TRAVEL_ISSUE'].includes(r.action));
    const travelSkipped = results.filter(r => r.action === 'SKIP_TRAVEL');

    // ── STEP 5: DRY RUN — return preview, no writes ───────────────────────────
    if (!confirmWrite) {
      console.log(`[FIX_LOCATIONS] DRY RUN | to_write=${toWrite.length} | no_change=${noChange.length} | flagged=${flagged.length} | travel_protected=${travelSkipped.length}`);
      return Response.json({
        dry_run: true,
        to_write_count: toWrite.length,
        no_change_count: noChange.length,
        flagged_count: flagged.length,
        travel_protected_count,
        stale_travel_count,
        internal_family_count: internalFamilyFiles.length,
        flagged_items: flagged,
        internal_family_items: internalFamilyFiles,
        corrections_preview: toWrite,
      });
    }

    // ── STEP 6: WRITE MODE — apply corrections only ───────────────────────────
    const written = [];
    const writeErrors = [];

    for (const result of toWrite) {
      if (!result.after || Object.keys(result.after).length === 0) continue;

      const updatePayload = { ...result.after };
      updatePayload.resolved_source_reason = result.detail || 'fix_location_repair';

      // HARD GUARD: never write these fields
      delete updatePayload.current_home_location_id;
      delete updatePayload.current_work_location_id;
      delete updatePayload.occupation_location_id;
      delete updatePayload.travel_status;
      delete updatePayload.traveling_to_location_id;
      delete updatePayload.resolved_last_updated_at;

      try {
        await base44.entities.Character.update(result.character_id, updatePayload);
        written.push(result);
      } catch (writeErr) {
        console.error(`[FIX_LOCATIONS] Write failed for ${result.character_name}:`, writeErr.message);
        writeErrors.push({ name: result.character_name, error: writeErr.message });
      }
    }

    console.log(`[FIX_LOCATIONS] WRITE complete | written=${written.length} | errors=${writeErrors.length}`);

    return Response.json({
      dry_run: false,
      corrected_count: written.length,
      corrections: written,
      flagged_count: flagged.length,
      flagged_items: flagged,
      travel_protected_count,
      stale_travel_count,
      internal_family_count: internalFamilyFiles.length,
      no_change_count: noChange.length,
      write_errors: writeErrors,
      summary: written.length === 0 && flagged.length === 0
        ? 'Location check complete. No contradictions found.'
        : `${written.length} contradiction${written.length !== 1 ? 's' : ''} repaired.${flagged.length > 0 ? ` ${flagged.length} issue${flagged.length !== 1 ? 's' : ''} flagged for review.` : ''}`,
    });

  } catch (error) {
    console.error('[FIX_LOCATIONS] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});