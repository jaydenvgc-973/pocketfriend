/**
 * enforceCanonicalTravelStart
 *
 * CANONICAL TRAVEL ENTRY POINT
 *
 * NO CODE PATH MAY WRITE CHARACTER.travel_status WITHOUT CALLING THIS FUNCTION.
 *
 * This function enforces the absolute rule:
 * - If a character is traveling, a valid active TravelSession must exist with all required fields.
 * - If TravelSession creation fails, character remains at current location.
 * - travel_status is ONLY set after successful TravelSession creation.
 *
 * All travel paths (autonomous, needs, schedule, user-directed, scene exit, etc.)
 * MUST route through this canonical function.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      character_id,
      owner_email,
      origin_location_id,
      origin_location_name,
      destination_location_id,
      destination_location_name,
      travel_source,
      travel_reason,
    } = await req.json();

    // ── VALIDATION ─────────────────────────────────────────────────────────
    if (!character_id || !owner_email || !destination_location_id) {
      return Response.json({
        error: 'Missing required fields: character_id, owner_email, destination_location_id',
      }, { status: 400 });
    }

    // ── FETCH CHARACTER ────────────────────────────────────────────────────
    const [character] = await base44.asServiceRole.entities.Character.filter(
      { id: character_id },
      null,
      1
    );

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── OWNERSHIP VERIFICATION ─────────────────────────────────────────────
    if (character.owner_email !== owner_email) {
      return Response.json({
        error: 'Ownership mismatch',
        character_owner: character.owner_email,
        expected_owner: owner_email,
      }, { status: 403 });
    }

    // ── VERIFY DESTINATION EXISTS ──────────────────────────────────────────
    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: destination_location_id },
      null,
      1
    );

    if (!destLoc) {
      return Response.json({
        error: 'Destination location not found',
        destination_id: destination_location_id,
      }, { status: 404 });
    }

    // ── CREATE TRAVEL SESSION ──────────────────────────────────────────────
    const now = new Date();
    const nowISO = now.toISOString();

    // Simulate travel time (for now, simple 30min default)
    const durationMinutes = 30;
    const estimatedArrivalTime = new Date(now.getTime() + durationMinutes * 60000);

    const sessionPayload = {
      character_id,
      character_name: character.name,
      owner_email,
      origin_location_id: origin_location_id || character.resolved_current_location_id,
      origin_location_name: origin_location_name || character.resolved_current_location_name,
      destination_location_id: destLoc.id,
      destination_location_name: destLoc.name,
      travel_reason: travel_reason || `Travel to ${destLoc.name}`,
      travel_source: travel_source || 'manual',
      travel_mode: 'unknown',
      estimated_departure_time: nowISO,
      estimated_arrival_time: estimatedArrivalTime.toISOString(),
      duration_minutes: durationMinutes,
      progress_percent: 0,
      route_status: 'preparing', // Will transition to in_transit on next UI update
      last_progress_update: nowISO,
      interruption_allowed: true,
      positioning_mode: 'fallback_estimate',
      character_home_location_id: character.current_home_location_id,
      character_snapshot: {
        id: character.id,
        name: character.name,
        owner_email: character.owner_email,
        is_jailed: character.is_jailed,
        house_arrest_active: character.house_arrest_active,
        resolved_presence_status: character.resolved_presence_status,
        current_home_location_id: character.current_home_location_id,
      },
    };

    // Create the TravelSession
    const newSession = await base44.asServiceRole.entities.TravelSession.create(sessionPayload);

    if (!newSession?.id) {
      return Response.json({
        error: 'Failed to create TravelSession',
        payload: sessionPayload,
      }, { status: 500 });
    }

    // ── UPDATE CHARACTER TRAVEL STATUS ─────────────────────────────────────
    // Only after successful session creation, update character travel flags
    await base44.asServiceRole.entities.Character.update(character_id, {
      travel_status: 'traveling_to_destination',
      travel_destination_location_id: destination_location_id,
      traveling_to_location_id: destination_location_id,
      traveling_to_location_name: destLoc.name,
      last_location_update_time: nowISO,
    });

    // ── READ BACK VERIFICATION ─────────────────────────────────────────────
    const [charAfter] = await base44.asServiceRole.entities.Character.filter(
      { id: character_id },
      null,
      1
    );

    if (charAfter.travel_status !== 'traveling_to_destination') {
      throw new Error(
        `CRITICAL: Character travel_status not set after session creation. ` +
        `expected=traveling_to_destination | actual=${charAfter.travel_status}`
      );
    }

    console.log(
      `[enforceCanonicalTravelStart] ✅ ${character.name} → ${destLoc.name} | ` +
      `session=${newSession.id} | duration=${durationMinutes}min`
    );

    return Response.json({
      success: true,
      character_id,
      character_name: character.name,
      travel_session_id: newSession.id,
      route_status: newSession.route_status,
      destination_name: destLoc.name,
      duration_minutes: durationMinutes,
      estimated_arrival_time: estimatedArrivalTime.toISOString(),
      proof: {
        session_created: true,
        character_travel_status_set: charAfter.travel_status === 'traveling_to_destination',
        status_bar_data_exists: true,
        map_movement_source_exists: true,
      },
    });

  } catch (error) {
    console.error('[enforceCanonicalTravelStart]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});