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
    const { characterId, characterName, locationId, locationName, presenceStatus, locationType, sourceReason } = body;

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

    const resolvedStatus = presenceStatus || 'visiting';
    const resolvedType = locationType || 'visit';

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
      recent_location_history: updatedHistory,
      // Clear all stale travel fields
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      traveling_to_location_id: null,
      traveling_to_location_name: null,
      presence_stay_lock: false,
    });

    // STEP 6: Read back to verify the write persisted
    const verifyList = await base44.entities.Character.list(null, 500);
    const verified = verifyList.find(c => c.id === matched.id);

    const writeConfirmed = verified?.resolved_current_location_id === matchedLoc.id;

    if (!writeConfirmed) {
      return Response.json({
        success: false,
        write_confirmed: false,
        error: 'Write was not verified — read-back shows different location',
        matched_character_name: matched.name,
        matched_character_id: matched.id,
        expected_location_id: matchedLoc.id,
        actual_location_id_after_write: verified?.resolved_current_location_id || null,
      }, { status: 500 });
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

      base44.functions.invoke('recordLocationHistoryEvent', {
        characterId: matched.id,
        characterName: matched.name,
        ownerEmail: matched.owner_email,
        locationId: matchedLoc.id,
        locationName: matchedLoc.name,
        locationCategory: locCategory,
        eventType,
        travelSource: travelSrc,
        travelReason: sourceReason || null,
        arrivalTime: now,
        previousLocationId: previousLocationId || null,
      }).catch(() => {}); // non-blocking
    }

    return Response.json({
      success: true,
      write_confirmed: true,
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