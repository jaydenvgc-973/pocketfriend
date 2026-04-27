import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixCharacterLocationDisplay — Authoritative Location Contradiction Repair
 *
 * ARCHITECTURE:
 *   - Covers: active_created_character, npc_fictitious, npc_family_member
 *   - Skips: internal family files (family_members[] without standalone Character record)
 *   - Uses the SAME priority chain as lib/locationResolutionEngine.js (inlined for Deno)
 *     Cannot import frontend ES modules in Deno — logic is a faithful port, not a paraphrase.
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
 *   resolved_last_updated_at (omitted — platform auto-updates if applicable)
 *
 * ACCOUNT ISOLATION:
 *   All queries scoped to user.email. No cross-account reads or writes.
 */

// ── EASTERN TIME HELPER ───────────────────────────────────────────────────────
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// ── SHIFT CHECK (from locationResolutionEngine.js: isOnShiftNow) ─────────────
function isOnShiftNow(shift, nowET) {
  if (!shift?.start || !shift?.end) return false;
  if (shift.days && shift.days.length > 0) {
    if (!shift.days.includes(nowET.getDay())) return false;
  }
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = shift.start.split(':').map(Number);
  const [eh, em] = shift.end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

// ── WORK SCHEDULE CHECK (from locationResolutionEngine.js: isCharacterOnWorkSchedule) ─
function isCharacterOnWorkSchedule(char, nowET) {
  if (!char.work_start_time || !char.work_end_time || !char.work_days) return false;
  const dayOfWeek = nowET.getDay();
  if (!char.work_days.includes(dayOfWeek)) return false;
  const now = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = char.work_start_time.split(':').map(Number);
  const [eh, em] = char.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin < startMin) return now >= startMin || now < endMin;
  return now >= startMin && now < endMin;
}

// ── SLEEP CHECK (from locationResolutionEngine.js: isCharacterSleeping) ──────
function isCharacterSleeping(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const nowET = getNowET();
  const hour = nowET.getHours();
  const sleepStart = parseInt(char.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(char.wake_up_time.split(':')[0]);
  if (sleepStart > wakeUp) return hour >= sleepStart || hour < wakeUp;
  return hour >= sleepStart && hour < wakeUp;
}

// ── LOCATION OPEN CHECK (simplified from locationHoursUtils.js: isLocationOpen) ─
function isLocationOpen(location, nowET) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return null; // null = always open / unknown
  const dayOfWeek = nowET.getDay();
  const currentMin = nowET.getHours() * 60 + nowET.getMinutes();
  const isInWindow = (open, close) => {
    if (!open || !close) return false;
    const [oh, om] = open.split(':').map(Number);
    const [ch, cm] = close.split(':').map(Number);
    const oMin = oh * 60 + om;
    const cMin = ch * 60 + cm;
    if (oMin <= cMin) return currentMin >= oMin && currentMin <= cMin;
    return currentMin >= oMin || currentMin <= cMin;
  };
  const daySpecific = hours.filter(h => h.day_of_week != null);
  const dayAgnostic = hours.filter(h => h.day_of_week == null);
  const todayEntries = daySpecific.filter(h => h.day_of_week === dayOfWeek);
  if (todayEntries.length > 0) return todayEntries.some(h => isInWindow(h.open_time, h.close_time));
  if (daySpecific.length > 0 && todayEntries.length === 0) return false;
  if (dayAgnostic.length > 0) return dayAgnostic.some(h => isInWindow(h.open_time, h.close_time));
  return null;
}

// ── LOCATION RESOLVER (faithful port of locationResolutionEngine.js: resolveCharacterLocation) ─
// Returns: { resolved_current_location_id, resolved_current_location_name,
//            resolved_location_type, resolved_presence_status, resolved_source_reason }
function resolveCharacterLocationBackend(char, locationMap) {
  const nowET = getNowET();

  // HOME CONTRADICTION GUARD (same as locationResolutionEngine.js line 41-67)
  const trueHomeId = char.current_home_location_id || char.home_location_id || null;
  if (
    char.resolved_presence_status === 'home' &&
    char.resolved_current_location_id &&
    trueHomeId &&
    char.resolved_current_location_id !== trueHomeId
  ) {
    const trueHome = locationMap[trueHomeId];
    if (trueHome) {
      return {
        resolved_current_location_id: trueHomeId,
        resolved_current_location_name: trueHome.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_contradiction_corrected',
      };
    }
  }

  // LAYER 1: Work schedule (locationResolutionEngine.js lines 69-117)
  const allWorkLocIds = [];
  if (char.occupation_location_id) allWorkLocIds.push(char.occupation_location_id);
  if (char.current_work_location_id && !allWorkLocIds.includes(char.current_work_location_id)) {
    allWorkLocIds.push(char.current_work_location_id);
  }
  (char.additional_occupation_locations || []).forEach(loc => {
    if (loc.location_id && !allWorkLocIds.includes(loc.location_id)) allWorkLocIds.push(loc.location_id);
  });

  for (const workLocId of allWorkLocIds) {
    const workLocation = locationMap[workLocId];
    if (!workLocation) continue;
    if (isLocationOpen(workLocation, nowET) === false) continue;
    const locationShift = workLocation.worker_shifts?.[char.id];
    if (locationShift) {
      if (isOnShiftNow(locationShift, nowET)) {
        return {
          resolved_current_location_id: workLocId,
          resolved_current_location_name: workLocation.name || 'Work',
          resolved_location_type: 'work',
          resolved_presence_status: 'at_work',
          resolved_source_reason: 'work_schedule',
        };
      }
      continue;
    }
    if (isCharacterOnWorkSchedule(char, nowET)) {
      return {
        resolved_current_location_id: workLocId,
        resolved_current_location_name: workLocation.name || 'Work',
        resolved_location_type: 'work',
        resolved_presence_status: 'at_work',
        resolved_source_reason: 'work_schedule',
      };
    }
  }

  // LAYER 2: School schedule (locationResolutionEngine.js lines 119-132)
  if (char.student_status === 'enrolled' && char.education_location_id) {
    const schoolLocation = locationMap[char.education_location_id];
    if (schoolLocation && isLocationOpen(schoolLocation, nowET) !== false) {
      return {
        resolved_current_location_id: char.education_location_id,
        resolved_current_location_name: schoolLocation.name || 'School',
        resolved_location_type: 'school',
        resolved_presence_status: 'at_school',
        resolved_source_reason: 'school_schedule',
      };
    }
  }

  // LAYER 2.5: Rabbit hole (locationResolutionEngine.js lines 135-146)
  if (char.resolved_presence_status === 'rabbit_hole' || char.is_rabbit_hole === true) {
    const label = char.rabbit_hole_label || char.resolved_current_location_name || 'Off-screen';
    return {
      resolved_current_location_id: null,
      resolved_current_location_name: label,
      resolved_location_type: 'rabbit_hole',
      resolved_presence_status: 'rabbit_hole',
      resolved_source_reason: char.resolved_source_reason || 'rabbit_hole',
    };
  }

  // LAYER 3: Active travel (locationResolutionEngine.js lines 148-161)
  if (char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id) {
    const destLocation = locationMap[char.travel_destination_location_id];
    if (destLocation) {
      return {
        resolved_current_location_id: char.travel_destination_location_id,
        resolved_current_location_name: destLocation.name || 'Traveling',
        resolved_location_type: 'traveling',
        resolved_presence_status: 'traveling',
        resolved_source_reason: char.travel_status,
      };
    }
  }

  // LAYER 3.5: Social visit / system-placed away state (locationResolutionEngine.js lines 163-189)
  const homeIdForVisitCheck = char.current_home_location_id || char.home_location_id;
  const resolvedLocIdForVisit = char.resolved_current_location_id;
  const isAwayFromHome = resolvedLocIdForVisit && resolvedLocIdForVisit !== homeIdForVisitCheck;
  const isSystemPlacedVisit =
    char.presence_state === 'social_visit' ||
    char.resolved_presence_status === 'visiting' ||
    char.resolved_source_reason === 'autonomous_needs_driven' ||
    char.resolved_source_reason === 'autonomous_movement' ||
    char.resolved_source_reason === 'user_travel';

  if (isAwayFromHome && isSystemPlacedVisit) {
    const socialLocation = locationMap[resolvedLocIdForVisit];
    if (socialLocation) {
      return {
        resolved_current_location_id: resolvedLocIdForVisit,
        resolved_current_location_name: socialLocation.name || char.resolved_current_location_name || 'Visiting',
        resolved_location_type: 'visit',
        resolved_presence_status: char.resolved_presence_status || 'visiting',
        resolved_source_reason: char.resolved_source_reason || 'social_visit_from_system',
      };
    }
  }

  // LAYER 5: Sleeping (locationResolutionEngine.js lines 198-211)
  const resolvedHomeId = char.current_home_location_id || char.home_location_id || null;
  if (isCharacterSleeping(char)) {
    const homeLocation = resolvedHomeId ? locationMap[resolvedHomeId] : null;
    if (homeLocation) {
      return {
        resolved_current_location_id: resolvedHomeId,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'sleeping',
        resolved_source_reason: 'home_sleeping',
      };
    }
  }

  // LAYER 7: Home fallback (locationResolutionEngine.js lines 228-248)
  const allHomeFieldCandidates = [
    char.current_home_location_id,
    char.home_location_id,
    char.residence_id,
    char.assigned_residence,
  ].filter(Boolean);

  for (const candidateId of allHomeFieldCandidates) {
    const homeLocation = locationMap[candidateId];
    if (homeLocation) {
      return {
        resolved_current_location_id: candidateId,
        resolved_current_location_name: homeLocation.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_free_time',
      };
    }
  }

  // LAYER 7.5: Resident scan from locationMap (locationResolutionEngine.js lines 251-278)
  for (const [locId, loc] of Object.entries(locationMap)) {
    if (loc.category !== 'home' && loc.category !== 'generic') continue;
    if ((loc.resident_character_ids || []).includes(char.id)) {
      return {
        resolved_current_location_id: locId,
        resolved_current_location_name: loc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_from_location_residents',
      };
    }
    if ((loc.residents || []).some(r => r.character_id === char.id)) {
      return {
        resolved_current_location_id: locId,
        resolved_current_location_name: loc.name || 'Home',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'home_from_location_residents',
      };
    }
  }

  // LAYER 8: No home — keep last known location (locationResolutionEngine.js lines 281-295)
  if (char.resolved_current_location_id) {
    const lastLoc = locationMap[char.resolved_current_location_id];
    if (lastLoc) {
      return {
        resolved_current_location_id: char.resolved_current_location_id,
        resolved_current_location_name: lastLoc.name || char.resolved_current_location_name || 'Unknown',
        resolved_location_type: char.resolved_location_type || 'visit',
        resolved_presence_status: char.resolved_presence_status || 'visiting',
        resolved_source_reason: 'last_known_no_home',
      };
    }
  }

  // Final: no home, no last location — safe away state
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Away',
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'no_home_safe_away',
  };
}

// ── CONTRADICTION DETECTION ───────────────────────────────────────────────────
// Returns null if no contradiction, or { action, before, after, changedFields } if one is found.
function detectContradiction(char, resolverResult, locationMap) {
  const { resolved_current_location_id: truthId, resolved_current_location_name: truthName,
          resolved_presence_status: truthStatus, resolved_location_type: truthLocType,
          resolved_source_reason: truthReason } = resolverResult;

  // STALE POINTER FLAG: resolved ID set but not in locationMap
  if (char.resolved_current_location_id && !locationMap[char.resolved_current_location_id]) {
    // Check if resolver determined something valid despite the stale pointer
    const resolverFoundSomethingDifferent = truthId !== char.resolved_current_location_id;
    if (!resolverFoundSomethingDifferent) {
      // Resolver also couldn't find it — flag, do not write
      return {
        action: 'FLAGGED_STALE',
        flag: 'STALE_POINTER',
        detail: `resolved_current_location_id (${char.resolved_current_location_id}) not found in account locations`,
        before: null,
        after: null,
        changedFields: [],
      };
    }
    // Resolver found a valid location despite stale pointer — this is a correctable contradiction
  }

  // BROKEN HOME POINTER FLAG
  const homeId = char.current_home_location_id || char.home_location_id;
  if (homeId && !locationMap[homeId]) {
    return {
      action: 'FLAGGED_BROKEN_HOME',
      flag: 'BROKEN_HOME_POINTER',
      detail: `current_home_location_id (${homeId}) not found in account locations`,
      before: null,
      after: null,
      changedFields: [],
    };
  }

  // No resolver result with a location — skip if rabbit_hole or no_home_safe_away (valid states)
  if (!truthId && (truthStatus === 'rabbit_hole' || truthReason === 'no_home_safe_away')) {
    // Only flag if DB also says rabbit_hole — otherwise it IS a contradiction
    if (char.resolved_presence_status === 'rabbit_hole' || char.is_rabbit_hole === true) {
      return { action: 'NO_CHANGE', detail: 'Valid rabbit hole state', before: null, after: null, changedFields: [] };
    }
  }

  // Check for contradictions: compare current DB fields vs resolver output
  const idMatches     = char.resolved_current_location_id   === truthId;
  const nameMatches   = char.resolved_current_location_name === truthName;
  const statusMatches = char.resolved_presence_status       === truthStatus;

  // resolved_location_type: only check if resolver returned a type AND current DB has one OR status changed
  const typeMatches   = !truthLocType || char.resolved_location_type === truthLocType;

  if (idMatches && nameMatches && statusMatches && typeMatches) {
    return { action: 'NO_CHANGE', detail: 'All display fields match resolver', before: null, after: null, changedFields: [] };
  }

  // Build the before/after for exactly what changed
  const changedFields = [];
  const before = {};
  const after = {};

  if (!idMatches) {
    changedFields.push('resolved_current_location_id');
    before.resolved_current_location_id = char.resolved_current_location_id;
    after.resolved_current_location_id = truthId;
  }
  if (!nameMatches) {
    changedFields.push('resolved_current_location_name');
    before.resolved_current_location_name = char.resolved_current_location_name;
    after.resolved_current_location_name = truthName;
  }
  if (!statusMatches) {
    changedFields.push('resolved_presence_status');
    before.resolved_presence_status = char.resolved_presence_status;
    after.resolved_presence_status = truthStatus;
  }
  // Only include resolved_location_type in the write if status changed (not blanket)
  if (!typeMatches && !statusMatches && truthLocType) {
    changedFields.push('resolved_location_type');
    before.resolved_location_type = char.resolved_location_type;
    after.resolved_location_type = truthLocType;
  } else if (!statusMatches && truthLocType) {
    // Status changed — sync location_type too
    changedFields.push('resolved_location_type');
    before.resolved_location_type = char.resolved_location_type;
    after.resolved_location_type = truthLocType;
  }

  // Determine action label
  const isIdChange     = changedFields.includes('resolved_current_location_id');
  const isStatusChange = changedFields.includes('resolved_presence_status');
  const isNameChange   = changedFields.includes('resolved_current_location_name') && !isIdChange;
  const isTypeChange   = changedFields.includes('resolved_location_type') && !isStatusChange;

  let action = 'COMBINED_SYNC';
  if (changedFields.length === 1) {
    if (isNameChange) action = 'NAME_SYNC';
    else if (isStatusChange) action = 'STATUS_SYNC';
    else if (isTypeChange) action = 'LOCATION_TYPE_SYNC';
    else action = 'COMBINED_SYNC';
  }

  return {
    action,
    detail: truthReason,
    before,
    after,
    changedFields,
  };
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

    // ── STEP 1: Load all LocationReference records for this account ───────────
    const [allLocationsOwned, allLocationsCreated] = await Promise.all([
      base44.entities.LocationReference.filter({ owner_email: user.email }).catch(() => []),
      base44.entities.LocationReference.filter({ created_by: user.email }).catch(() => []),
    ]);
    const locSeen = new Set();
    const allLocations = [...allLocationsOwned, ...allLocationsCreated].filter(l => {
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

    // ── STEP 3: Collect all internal family IDs (family_members[] on parents) ─
    // These are entries in character.family_members[] that are NOT standalone Character records
    const standaloneCharIds = new Set(allCharacters.map(c => c.id));
    const internalFamilyFiles = [];
    for (const char of allCharacters) {
      for (const fm of (char.family_members || [])) {
        if (fm.name && !standaloneCharIds.has(fm.character_id)) {
          internalFamilyFiles.push({
            name: fm.name,
            parent_character_id: char.id,
            parent_character_name: char.name,
            action: 'INTERNAL_FAMILY_FILE_VISIBILITY_NOT_VERIFIED',
          });
        }
      }
    }

    // ── STEP 4: Run resolver and detect contradictions for each character ──────
    const results = [];

    for (const char of allCharacters) {
      const resolverResult = resolveCharacterLocationBackend(char, locationMap);
      const contradiction = detectContradiction(char, resolverResult, locationMap);

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

    // Categorize
    const toWrite    = results.filter(r => !['NO_CHANGE', 'FLAGGED_STALE', 'FLAGGED_BROKEN_HOME', 'INTERNAL_FAMILY_FILE_VISIBILITY_NOT_VERIFIED'].includes(r.action));
    const noChange   = results.filter(r => r.action === 'NO_CHANGE');
    const flagged    = results.filter(r => r.action === 'FLAGGED_STALE' || r.action === 'FLAGGED_BROKEN_HOME');

    // ── STEP 5: If DRY RUN — return preview only, no writes ──────────────────
    if (!confirmWrite) {
      console.log(`[FIX_LOCATIONS] DRY RUN complete | corrections=${toWrite.length} | noChange=${noChange.length} | flagged=${flagged.length} | internalFamily=${internalFamilyFiles.length}`);
      return Response.json({
        dry_run: true,
        preview: results,
        to_write_count: toWrite.length,
        no_change_count: noChange.length,
        flagged_count: flagged.length,
        internal_family_count: internalFamilyFiles.length,
        flagged_items: flagged,
        internal_family_items: internalFamilyFiles,
        corrections_preview: toWrite,
      });
    }

    // ── STEP 6: WRITE MODE — apply corrections ─────────────────────────────────
    const written = [];
    const writeErrors = [];

    for (const result of toWrite) {
      if (!result.after || Object.keys(result.after).length === 0) continue;

      const updatePayload = {
        ...result.after,
        resolved_source_reason: result.detail || 'fix_location_repair',
      };
      // CRITICAL: never write these fields
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

    console.log(`[FIX_LOCATIONS] WRITE complete | written=${written.length} | errors=${writeErrors.length} | flagged=${flagged.length}`);

    return Response.json({
      dry_run: false,
      corrected_count: written.length,
      corrections: written,
      flagged_count: flagged.length,
      flagged_items: flagged,
      internal_family_count: internalFamilyFiles.length,
      internal_family_items: internalFamilyFiles,
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