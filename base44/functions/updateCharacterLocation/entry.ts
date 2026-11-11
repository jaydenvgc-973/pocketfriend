import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * updateCharacterLocation
 *
 * AUTHORITATIVE PRESENCE WRITER — Single source of truth for character location.
 *
 * OWNERSHIP RULE: Always resolves character via user-scoped roster (owner_email path).
 * NEVER uses created_by. NEVER uses hardcoded IDs. NEVER uses service-role Character queries.
 *
 * Lookup chain:
 *   1. Load full roster via base44.entities.Character.list() [user-scoped — the only working path]
 *   2. Match character by ID (if characterId provided) OR normalized name (if characterName provided)
 *   3. Verify match before writing
 *   4. Load location via base44.entities.LocationReference.list() 
 *   5. Match location by ID (if locationId provided) OR normalized name (if locationName provided)
 *   6. Write to matched character's real ID
 *   7. Read back to verify
 *   8. Return proof: matched name, matched ID, previous location, new location, write_confirmed
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, characterName, locationId, locationName, presenceStatus, locationType, sourceReason, rabbitHole } = body;

    // NO MOVEMENT IS EVER REVERTED. A committed location write is the authority.
    // A failed history record is reported as evidence and never undoes a movement.

    if (!characterId && !characterName) {
      return Response.json({ error: 'Must provide characterId or characterName' }, { status: 400 });
    }
    if (!locationId && !locationName) {
      return Response.json({ error: 'Must provide locationId or locationName' }, { status: 400 });
    }

    // STEP 1: Load full roster via user-scoped path (ONLY working path — service-role returns 0)
    const allChars = await base44.entities.Character.list(null, 500);
    if (!allChars || allChars.length === 0) {
      return Response.json({ error: 'Roster returned empty — cannot safely update', roster_count: 0 }, { status: 500 });
    }

    // STEP 2: Match character
    let matched = null;
    if (characterId) {
      matched = allChars.find(c => c.id === characterId);
    } else {
      const normalizedTarget = characterName.trim().toLowerCase();
      matched = allChars.find(c => c.name && c.name.trim().toLowerCase() === normalizedTarget);
    }

    if (!matched) {
      return Response.json({
        error: 'Character not found in user-scoped roster',
        searched_by: characterId ? `id=${characterId}` : `name=${characterName}`,
        roster_count: allChars.length,
        roster_names: allChars.map(c => c.name)
      }, { status: 404 });
    }

    // DECEASED — a dead character is not moved or placed anywhere.
    if (matched.life_status === 'deceased' || matched.status === 'deceased') {
      return Response.json({
        success: false,
        error: `${matched.name} is deceased and cannot be moved.`,
        reason: 'deceased',
      }, { status: 409 });
    }

    // RABBIT HOLE MODE: custom off-screen destination — skip LocationReference lookup entirely.
    // The character is placed at a named but non-persisted destination (resolved_presence_status: 'rabbit_hole').
    // No LocationHistory proof is written (requires a real location_id).
    if (rabbitHole === true) {
      const customName = (locationName || '').trim();
      if (!customName) {
        return Response.json({ error: 'Rabbit hole requires a locationName (custom name)' }, { status: 400 });
      }
      const previousLocationId = matched.resolved_current_location_id || null;
      const previousLocationName = matched.resolved_current_location_name || null;
      const now = new Date().toISOString();

      // Preserve the applicable presence semantics — do NOT overwrite with
      // 'rabbit_hole'. The ID is the container; the presence is the truth.
      // If the caller provided an explicit presenceStatus, use it. Otherwise
      // preserve the character's existing presence, or default to 'visiting'.
      const rabbitHolePresence = presenceStatus || matched.resolved_presence_status || 'visiting';
      const rabbitHoleType = locationType || 'rabbit_hole';
      await base44.entities.Character.update(matched.id, {
        resolved_current_location_id: 'rabbit_hole',
        resolved_current_location_name: customName,
        resolved_location_type: rabbitHoleType,
        resolved_presence_status: rabbitHolePresence,
        resolved_source_reason: sourceReason || 'user_teleport_rabbit_hole',
        resolved_last_updated_at: now,
        // An executed movement supersedes any pending scheduled relocation —
        // leaving it registered would move the character again later and undo this move.
        pending_scheduled_relocation_at: null,
        next_location_id: null,
        next_location_name: null,
        pending_relocation_from: null,
        pending_relocation_from_name: null,
        travel_status: 'not_traveling',
        travel_destination_location_id: null,
        traveling_to_location_id: null,
        traveling_to_location_name: null,
        presence_stay_lock: false,
      });

      // Read the written record directly. A list query can be served from a stale
      // snapshot immediately after a write, which made a completed move report failure.
      let verified = null;
      let writeConfirmed = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          verified = await base44.entities.Character.get(matched.id);
        } catch {
          // A read that cannot complete is not evidence of a failed write.
          verified = null;
        }
        writeConfirmed = verified?.resolved_current_location_id === 'rabbit_hole'
          && verified?.resolved_current_location_name === customName;
        if (writeConfirmed || !verified) break;
        await new Promise(r => setTimeout(r, 600));
      }

      return Response.json({
        success: true,
        write_confirmed: writeConfirmed,
        matched_character_name: matched.name,
        matched_character_id: matched.id,
        previous_location_id: previousLocationId,
        previous_location_name: previousLocationName,
        new_location_id: 'rabbit_hole',
        new_location_name: customName,
        new_presence_status: rabbitHolePresence,
        new_location_type: rabbitHoleType,
        rabbit_hole: true,
        updated_at: now,
      });
    }

    // STEP 3: Load locations via user-scoped path
    const allLocs = await base44.entities.LocationReference.list(null, 500);

    // STEP 4: Match location
    let matchedLoc = null;
    if (locationId) {
      matchedLoc = allLocs.find(l => l.id === locationId);
    } else {
      const normalizedLocTarget = locationName.trim().toLowerCase();
      matchedLoc = allLocs.find(l => l.name && l.name.trim().toLowerCase() === normalizedLocTarget);
    }

    if (!matchedLoc) {
      return Response.json({
        error: 'Location not found',
        searched_by: locationId ? `id=${locationId}` : `name=${locationName}`,
        available_locations: allLocs.map(l => l.name)
      }, { status: 404 });
    }

    const previousLocationId = matched.resolved_current_location_id || null;
    const previousLocationName = matched.resolved_current_location_name || null;
    const now = new Date().toISOString();

    // HOME PRESENCE: arriving at the character's own assigned home through any
    // user-initiated move is HOME, not a visit. Uses the existing authoritative
    // home fields only — no residential reassignment, no new classification rules.
    const authoritativeHomeId = (matched.vacation_mode === true && matched.vacation_home_location_id)
      ? matched.vacation_home_location_id
      : (matched.is_temporarily_housed === true && matched.temporary_housing_location_id)
        ? matched.temporary_housing_location_id
        : (matched.current_home_location_id || matched.home_location_id || null);
    const isHomeDestination = !!authoritativeHomeId && authoritativeHomeId === matchedLoc.id;
    const resolvedStatus = isHomeDestination && (!presenceStatus || presenceStatus === 'visiting')
      ? 'home'
      : (presenceStatus || 'visiting');
    const resolvedType = isHomeDestination && (!locationType || locationType === 'visit')
      ? 'home'
      : (locationType || 'visit');

    // STEP 5: Write using the verified matched character's real ID
    // Also append a lightweight daily location history entry so characters can reference
    // where they've been today in chat context. Kept to last 20 entries, pruned to 7 days.
    const existingHistory = matched.recent_location_history || [];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    // Close out the previous location entry if still open
    const closedHistory = existingHistory.map(h => {
      if (!h.left_at && h.location_id !== matchedLoc.id) {
        return { ...h, left_at: now };
      }
      return h;
    }).filter(h => h.arrived_at > sevenDaysAgo);

    // Only add a new entry if arriving at a different location
    const isNewLocation = matched.resolved_current_location_id !== matchedLoc.id;
    const updatedHistory = isNewLocation
      ? [...closedHistory, {
          location_id: matchedLoc.id,
          location_name: matchedLoc.name,
          location_type: resolvedType,
          arrived_at: now,
          left_at: null,
          reason: sourceReason || 'manual_update',
        }].slice(-20) // keep latest 20 entries
      : closedHistory;

    await base44.entities.Character.update(matched.id, {
      resolved_current_location_id: matchedLoc.id,
      resolved_current_location_name: matchedLoc.name,
      resolved_location_type: resolvedType,
      resolved_presence_status: resolvedStatus,
      resolved_source_reason: sourceReason || 'manual_update',
      resolved_last_updated_at: now,
      // An executed movement supersedes any pending scheduled relocation —
      // leaving it registered would move the character again later and undo this move.
      pending_scheduled_relocation_at: null,
      next_location_id: null,
      next_location_name: null,
      pending_relocation_from: null,
      pending_relocation_from_name: null,
      recent_location_history: updatedHistory,
      // Clear all stale travel fields
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
      presence_stay_lock: false,
    });

    // STEP 6: Read back to verify the write persisted.
    // The read-back is a DIRECT read of the record that was just written. A list
    // query can return a snapshot taken before the write, which made a move that
    // actually succeeded report "not verified" — the user then saw "Not moved"
    // and the character appeared to stay put even though the write had landed.
    let verified = null;
    let writeConfirmed = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        verified = await base44.entities.Character.get(matched.id);
      } catch {
        // A read that cannot complete is not evidence of a failed write.
        verified = null;
      }
      writeConfirmed = verified?.resolved_current_location_id === matchedLoc.id;
      if (writeConfirmed || !verified) break;
      await new Promise(r => setTimeout(r, 600));
    }

    if (!writeConfirmed) {
      // The write is committed. A read-back that still shows the previous value is
      // reported as evidence, never converted into a cancelled move.
      console.warn(`[updateCharacterLocation] read-back lag: expected ${matchedLoc.id}, saw ${verified?.resolved_current_location_id || 'null'}`);
    }

    // STEP 7: Write LocationHistory event (non-blocking, fire-and-forget)
    // Only write if this is a genuine location change
    if (isNewLocation && matched.owner_email) {
      // Derive event type from sourceReason + resolvedStatus
      let eventType = 'arrival';
      if (sourceReason === 'return_home' || resolvedStatus === 'home') eventType = 'return_home';
      else if (sourceReason === 'work_schedule' || resolvedStatus === 'at_work') eventType = 'work_start';
      else if (sourceReason === 'school_schedule' || resolvedStatus === 'at_school') eventType = 'school_start';
      else if (resolvedType === 'gym') eventType = 'gym_visit';
      else if (resolvedType === 'religion') eventType = 'religious_service';
      else if (resolvedType === 'food_drink') eventType = 'food_need';

      const locCategory = matchedLoc.category || 'other';
      let travelSrc = 'system';
      if (sourceReason) {
        if (sourceReason.includes('schedule')) travelSrc = 'schedule';
        else if (sourceReason.includes('autonomous')) travelSrc = 'autonomous';
        else if (sourceReason.includes('promise') || sourceReason.includes('commitment')) travelSrc = 'promise';
        else if (sourceReason === 'manual_update') travelSrc = 'manual';
      }

      // ── CHECKED PROOF — no fire-and-forget. If this fails, revert the Character write.
      // COMPENSATING ROLLBACK (not atomic): see concurrency note in writeVerifiedLocationHistory.
      try {
        const proofResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
          character_id: matched.id,
          owner_email: matched.owner_email,
          location_id: matchedLoc.id,
          event_type: eventType,
          travel_source: travelSrc,
          travel_reason: sourceReason || null,
        });
        if (!proofResult?.data?.success) {
          // THE MOVEMENT STANDS — ALWAYS.
          // The character write above is already committed and is the authority.
          // A history-record gap is reported as evidence. It is never used to cancel
          // the movement and never restores a previous location.
          return Response.json({
            success: true,
            write_confirmed: writeConfirmed,
            matched_character_name: matched.name,
            matched_character_id: matched.id,
            previous_location_id: previousLocationId,
            previous_location_name: previousLocationName,
            new_location_id: matchedLoc.id,
            new_location_name: matchedLoc.name,
            new_presence_status: resolvedStatus,
            new_location_type: resolvedType,
            history_proof_failed: true,
            proof_error: proofResult?.data?.error || 'unknown',
            updated_at: now,
          });
        }
      } catch (proofError) {
        // THE MOVEMENT STANDS — ALWAYS.
        // The proof call itself failing (error, timeout, rate limit) never cancels a
        // movement that is already committed, and never restores a previous location.
        return Response.json({
          success: true,
          write_confirmed: writeConfirmed,
          matched_character_name: matched.name,
          matched_character_id: matched.id,
          previous_location_id: previousLocationId,
          previous_location_name: previousLocationName,
          new_location_id: matchedLoc.id,
          new_location_name: matchedLoc.name,
          new_presence_status: resolvedStatus,
          new_location_type: resolvedType,
          history_proof_failed: true,
          proof_error: proofError.message,
          updated_at: now,
        });
      }
    }

    return Response.json({
      success: true,
      write_confirmed: writeConfirmed,
      matched_character_name: matched.name,
      matched_character_id: matched.id,
      previous_location_id: previousLocationId,
      previous_location_name: previousLocationName,
      new_location_id: matchedLoc.id,
      new_location_name: matchedLoc.name,
      new_presence_status: resolvedStatus,
      new_location_type: resolvedType,
      updated_at: now,
    });

  } catch (error) {
    console.error('[updateCharacterLocation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});