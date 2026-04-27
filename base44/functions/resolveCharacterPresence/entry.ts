import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * RESOLVE CHARACTER PRESENCE — Backend Resolver Service
 *
 * Authoritative single-character resolver.
 * Evaluates current state only.
 * Returns resolved presence truth without modifying data.
 * Account-scoped.
 *
 * RULES:
 * - If travel_status is active and destination is valid → is_in_valid_travel=true
 * - If travel_status is active but destination is missing/invalid → flag as stale_travel_destination
 * - No future/scheduled travel logic
 * - No time-based expiration logic
 * - No home fallback logic
 * - Read-only (never writes)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character_id, characterObject, locationMap: providedLocationMap } = await req.json();

    if (!character_id) {
      return Response.json({ error: 'Missing character_id' }, { status: 400 });
    }

    // Load character if not provided
    let character = characterObject;
    if (!character) {
      const chars = await base44.entities.Character.filter({ id: character_id }, null, 1);
      character = chars?.[0] || null;
    }

    if (!character) {
      return Response.json(
        { success: false, error: `Character ${character_id} not found or access denied` },
        { status: 404 }
      );
    }

    // Verify ownership
    const isOwned = character.created_by === user.email || character.owner_email === user.email;
    if (!isOwned) {
      return Response.json(
        { success: false, error: 'Character does not belong to this user' },
        { status: 403 }
      );
    }

    // Load locations if not provided
    let locationMap = providedLocationMap;
    if (!locationMap) {
      const locations = await base44.entities.LocationReference.filter(
        { $or: [{ created_by: user.email }, { owner_email: user.email }, { scope: 'shared' }] },
        null,
        500
      );
      locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    }

    const result = {
      success: true,
      character_id: character.id,
      character_name: character.name,
      resolved_presence: {
        resolved_current_location_id: null,
        resolved_current_location_name: null,
        resolved_location_type: null,
        resolved_presence_status: null,
        resolved_source_reason: null,
      },
      validation_issues: [],
      is_in_valid_travel: false,
      reason_codes: [],
    };

    // ── TRAVEL CHECK (CURRENT STATE ONLY) ──
    const isActiveTravelStatus = character.travel_status && character.travel_status !== 'not_traveling';

    if (isActiveTravelStatus) {
      if (!character.travel_destination_location_id) {
        // Missing destination → flag
        result.validation_issues.push({
          type: 'stale_travel_destination',
          detail: 'travel_status is active but travel_destination_location_id is missing',
          severity: 'flag',
        });
      } else {
        const destLoc = locationMap[character.travel_destination_location_id];
        const isShared = destLoc?.scope === 'shared' || destLoc?.location_type === 'shared';
        const isOwned = destLoc?.created_by === user.email || destLoc?.owner_email === user.email;

        if (!destLoc || (!isOwned && !isShared)) {
          // Invalid or cross-account destination → flag
          result.validation_issues.push({
            type: 'stale_travel_destination',
            detail: `travel_destination_location_id (${character.travel_destination_location_id}) not found in user's locations or not shared`,
            severity: 'flag',
          });
        } else {
          // Valid travel destination → protect
          result.is_in_valid_travel = true;
          result.reason_codes.push('travel_valid');
          return Response.json(result);
        }
      }
    }

    // ── PRESENCE RESOLUTION (if not in valid travel) ──
    // For now, return the current resolved fields without re-deriving
    // This is a read-only check of what's stored
    result.resolved_presence.resolved_current_location_id = character.resolved_current_location_id || null;
    result.resolved_presence.resolved_current_location_name = character.resolved_current_location_name || null;
    result.resolved_presence.resolved_location_type = character.resolved_location_type || null;
    result.resolved_presence.resolved_presence_status = character.resolved_presence_status || 'home';
    result.resolved_presence.resolved_source_reason = character.resolved_source_reason || null;

    // Check for home contradiction (resolved as home but location is not actually home)
    const homeId = character.current_home_location_id || character.home_location_id;
    if (
      character.resolved_presence_status === 'home' &&
      character.resolved_current_location_id &&
      homeId &&
      character.resolved_current_location_id !== homeId
    ) {
      // Contradiction: marked home but resolved location is not home
      result.validation_issues.push({
        type: 'home_contradiction',
        detail: `resolved_presence_status is 'home' but resolved_current_location_id does not match current_home_location_id`,
        severity: 'correct',
      });
      // Correct it
      result.resolved_presence.resolved_current_location_id = homeId;
      result.resolved_presence.resolved_current_location_name =
        locationMap[homeId]?.name || 'Home';
      result.resolved_presence.resolved_location_type = 'home';
      result.resolved_presence.resolved_source_reason = 'home_contradiction_corrected';
    }

    // Check for stale location pointer
    if (
      character.resolved_current_location_id &&
      !locationMap[character.resolved_current_location_id]
    ) {
      result.validation_issues.push({
        type: 'stale_pointer',
        detail: `resolved_current_location_id (${character.resolved_current_location_id}) not found in account locations`,
        severity: 'flag',
      });
    }

    if (result.reason_codes.length === 0) {
      result.reason_codes.push('resolved_state_read');
    }

    return Response.json(result);
  } catch (error) {
    console.error('[resolveCharacterPresence] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});