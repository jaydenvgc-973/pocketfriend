import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixCharacterLocationDisplay — Authoritative Location Contradiction Repair
 *
 * ARCHITECTURE:
 *   - Covers: active_created_character, npc_fictitious, npc_family_member
 *   - Skips: internal family files (family_members[] without standalone Character record)
 *   - Inline resolver derived from locationResolutionEngine.js (faithful port)
 *   - Runs in DRY-RUN mode by default (no writes)
 *   - Writes only when { confirm: true } is passed in request body
 *
 * FIELDS THAT CAN BE WRITTEN:
 *   resolved_current_location_id, resolved_current_location_name,
 *   resolved_presence_status, resolved_location_type, resolved_source_reason
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
 *   If travel_status is active and destination is valid → SKIP without modification
 *   If travel destination is missing/invalid → FLAG without correction
 *   No time-based travel expiration logic
 *   No home fallback from travel state
 */

// ── EASTERN TIME HELPER ────────────────────────────────────────────────────────
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// ── SHIFT CHECK ────────────────────────────────────────────────────────────────
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

// ── WORK SCHEDULE CHECK ────────────────────────────────────────────────────────
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

// ── SLEEP CHECK ────────────────────────────────────────────────────────────────
function isCharacterSleeping(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const nowET = getNowET();
  const hour = nowET.getHours();
  const sleepStart = parseInt(char.sleep_start_time.split(':')[0]);
  const wakeUp = parseInt(char.wake_up_time.split(':')[0]);
  if (sleepStart > wakeUp) return hour >= sleepStart || hour < wakeUp;
  return hour >= sleepStart && hour < wakeUp;
}

// ── LOCATION OPEN CHECK ────────────────────────────────────────────────────────
function isLocationOpen(location, nowET) {
  const hours = location?.operating_hours;
  if (!hours || hours.length === 0) return null;
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

// ── LOCATION RESOLVER (inline port from locationResolutionEngine.js) ──────────
function resolveCharacterLocation(char, locationMap) {
  const nowET = getNowET();

  // HOME CONTRADICTION GUARD
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

  // LAYER 1: Check ALL work locations
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

  // LAYER 2: Check school schedule
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

  // LAYER 2.5: Rabbit hole
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

  // LAYER 3: Check active travel state
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

  // LAYER 3.5: Social visit
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

  // LAYER 5: Check sleep/nap state
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

  // LAYER 7: Home fallback
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

  // LAYER 7.5: Resident scan
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

  // LAYER 8: No home — keep last known
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

  // Final safe away state
  return {
    resolved_current_location_id: null,
    resolved_current_location_name: 'Away',
    resolved_location_type: 'rabbit_hole',
    resolved_presence_status: 'rabbit_hole',
    resolved_source_reason: 'no_home_safe_away',
  };
}

// ── CONTRADICTION DETECTION ────────────────────────────────────────────────────
function detectContradiction(char, resolverResult, locationMap) {
  // TRAVEL PROTECTION: if active travel with valid destination, skip entirely
  if (char.travel_status && char.travel_status !== 'not_traveling' && char.travel_destination_location_id) {
    const destLoc = locationMap[char.travel_destination_location_id];
    const isShared = destLoc?.scope === 'shared' || destLoc?.location_type === 'shared';
    const isOwned = destLoc?.created_by === char.created_by || destLoc?.owner_email === char.owner_email;
    if (destLoc && (isOwned || isShared)) {
      // Valid travel state — SKIP
      return {
        action: 'SKIP_TRAVEL',
        detail: 'Character in valid active travel — protected',
        before: null,
        after: null,
        changedFields: [],
      };
    } else {
      // Invalid/stale travel destination — FLAG ONLY
      return {
        action: 'FLAG_TRAVEL_DESTINATION',
        detail: `travel_destination_location_id (${char.travel_destination_location_id}) invalid or cross-account`,
        before: null,
        after: null,
        changedFields: [],
      };
    }
  }

  // Compare resolver output vs stored fields
  const truthId     = resolverResult.resolved_current_location_id;
  const truthName   = resolverResult.resolved_current_location_name;
  const truthStatus = resolverResult.resolved_presence_status;
  const truthType   = resolverResult.resolved_location_type;
  const truthReason = resolverResult.resolved_source_reason;

  const idMatches     = char.resolved_current_location_id   === truthId;
  const nameMatches   = char.resolved_current_location_name === truthName;
  const statusMatches = char.resolved_presence_status       === truthStatus;
  const typeMatches   = !truthType || char.resolved_location_type === truthType;

  if (idMatches && nameMatches && statusMatches && typeMatches) {
    return { action: 'NO_CHANGE', detail: 'All fields match', before: null, after: null, changedFields: [] };
  }

  // Build correction
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
  }
  if (!typeMatches && truthType && !statusMatches) {
    changedFields.push('resolved_location_type');
    before.resolved_location_type = char.resolved_location_type;
    after.resolved_location_type  = truthType;
  } else if (!statusMatches && truthType) {
    changedFields.push('resolved_location_type');
    before.resolved_location_type = char.resolved_location_type;
    after.resolved_location_type  = truthType;
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
    const page = body?.page || 1;
    const pageSize = body?.pageSize || 5;

    console.log(`[FIX_LOCATIONS] Starting | user=${user.email} | confirmWrite=${confirmWrite} | page=${page} | pageSize=${pageSize}`);

    // Load all LocationReference records
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

    // Load all three character types
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

    // Identify internal family files
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

    // Run resolver and detect contradictions
    const results = [];
    let travel_protected_count = 0;
    let travel_flagged_count = 0;

    for (const char of allCharacters) {
      const resolverResult = resolveCharacterLocation(char, locationMap);
      const contradiction = detectContradiction(char, resolverResult, locationMap);

      if (contradiction.action === 'SKIP_TRAVEL') travel_protected_count++;
      else if (contradiction.action === 'FLAG_TRAVEL_DESTINATION') travel_flagged_count++;

      results.push({
        character_id:   char.id,
        character_name: char.name,
        character_type: char.character_type,
        action:         contradiction.action,
        detail:         contradiction.detail,
        before:         contradiction.before,
        after:          contradiction.after,
        changedFields:  contradiction.changedFields || [],
      });
    }

    // Categorize
    const toWrite   = results.filter(r => !['NO_CHANGE', 'SKIP_TRAVEL', 'FLAG_TRAVEL_DESTINATION'].includes(r.action));
    const noChange  = results.filter(r => r.action === 'NO_CHANGE');
    const flagged   = results.filter(r => r.action === 'FLAG_TRAVEL_DESTINATION');

    // DRY RUN: return preview only (paginated)
    if (!confirmWrite) {
      console.log(`[FIX_LOCATIONS] DRY RUN | to_write=${toWrite.length} | no_change=${noChange.length} | travel_protected=${travel_protected_count} | travel_flagged=${travel_flagged_count}`);
      
      const totalPages = Math.ceil(toWrite.length / pageSize);
      const startIdx = (page - 1) * pageSize;
      const endIdx = Math.min(startIdx + pageSize, toWrite.length);
      const pageCorrections = toWrite.slice(startIdx, endIdx);
      
      return Response.json({
        dry_run: true,
        pagination: {
          page,
          page_size: pageSize,
          total_pages: totalPages,
          total_corrections: toWrite.length,
        },
        summary: {
          to_write_count: toWrite.length,
          no_change_count: noChange.length,
          flagged_count: flagged.length,
          travel_protected_count,
          travel_flagged_count,
          internal_family_count: internalFamilyFiles.length,
        },
        flagged_items: flagged,
        corrections_preview: pageCorrections,
      });
    }

    // WRITE MODE: apply corrections
    const written = [];
    const writeErrors = [];

    for (const result of toWrite) {
      if (!result.after || Object.keys(result.after).length === 0) continue;

      const updatePayload = { ...result.after };
      updatePayload.resolved_source_reason = result.detail || 'fix_location_repair';

      // Never write these fields
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

    console.log(`[FIX_LOCATIONS] WRITE complete | written=${written.length}`);

    return Response.json({
      dry_run: false,
      corrected_count: written.length,
      corrections: written,
      flagged_count: flagged.length,
      flagged_items: flagged,
      travel_protected_count,
      travel_flagged_count,
      internal_family_count: internalFamilyFiles.length,
      no_change_count: noChange.length,
      write_errors: writeErrors,
      summary: written.length === 0 && flagged.length === 0
        ? 'Location check complete. No contradictions found.'
        : `${written.length} contradiction${written.length !== 1 ? 's' : ''} repaired.${flagged.length > 0 ? ` ${flagged.length} travel issue${flagged.length !== 1 ? 's' : ''} flagged.` : ''}`,
    });

  } catch (error) {
    console.error('[FIX_LOCATIONS] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});