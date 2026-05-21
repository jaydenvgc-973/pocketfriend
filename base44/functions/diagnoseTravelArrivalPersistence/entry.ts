/**
 * diagnoseTravelArrivalPersistence
 *
 * Deep diagnostic to prove whether travel completion actually persisted to the database.
 *
 * Shows for EACH character:
 * 1. TravelSession state (completed or still in_transit)
 * 2. Character canonical location fields
 * 3. Which field the map/presence resolver should be reading
 * 4. Whether those fields match (destination) or mismatch (origin)
 * 5. Proof of the actual avatar position the map will render
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const diagnostics = [];
    const errors = [];

    // Load ALL characters for this user (not just travelers)
    let allChars = [];
    try {
      allChars = await base44.entities.Character.filter(
        { owner_email: user.email },
        '-updated_date',
        200
      );
    } catch (e) {
      return Response.json({ error: `Failed to load characters: ${e.message}` }, { status: 500 });
    }

    console.log(`[diagnoseTravelArrivalPersistence] Found ${allChars.length} characters for ${user.email}`);

    // For each character, show their complete location state
    for (const char of allChars) {
      const diagnostic = {
        character_id: char.id,
        character_name: char.name || char.display_name,
        owner_email: char.owner_email,
        server_time: now.toISOString(),
      };

      // ── TRAVEL SESSION STATE ──
      let activeSessions = [];
      try {
        activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
          { character_id: char.id, owner_email: char.owner_email },
          '-created_at',
          10
        ).catch(() => []);
      } catch (e) {
        diagnostic.travel_session_error = e.message;
      }

      // Show most recent session (active or recently completed)
      if (activeSessions.length > 0) {
        const session = activeSessions[0];
        diagnostic.travel_session = {
          id: session.id,
          route_status: session.route_status,
          origin_location_id: session.origin_location_id,
          origin_location_name: session.origin_location_name,
          destination_location_id: session.destination_location_id,
          destination_location_name: session.destination_location_name,
          estimated_arrival_time: session.estimated_arrival_time,
          actual_arrival_time: session.actual_arrival_time,
          progress_percent: session.progress_percent,
          duration_minutes: session.duration_minutes,
        };
      } else {
        diagnostic.travel_session = null;
      }

      // ── CHARACTER CANONICAL LOCATION STATE ──
      diagnostic.character_location_state = {
        // These are the canonical fields
        resolved_current_location_id: char.resolved_current_location_id,
        resolved_current_location_name: char.resolved_current_location_name,
        resolved_presence_status: char.resolved_presence_status,
        resolved_location_type: char.resolved_location_type,
        resolved_source_reason: char.resolved_source_reason,
        // Travel state flags
        travel_status: char.travel_status,
        traveling_to_location_id: char.traveling_to_location_id,
        traveling_to_location_name: char.traveling_to_location_name,
        travel_destination_location_id: char.travel_destination_location_id,
        // Legacy fields (if used)
        current_home_location_id: char.current_home_location_id,
        location_status: char.location_status,
      };

      // ── PRESENCE RESOLVER SIMULATION ──
      // This simulates what the presence resolver (used by map, scenes, selectors) sees
      diagnostic.presence_resolver_result = {
        // The resolver should use resolved_current_location_id as source of truth
        canonical_location_id: char.resolved_current_location_id,
        canonical_location_name: char.resolved_current_location_name,
        presence_status: char.resolved_presence_status,
        source_field: 'resolved_current_location_id',
      };

      // ── CONSISTENCY CHECK ──
      const hasActiveSession = diagnostic.travel_session && 
        ['in_transit', 'preparing', 'delayed'].includes(diagnostic.travel_session.route_status);
      
      const characterStillAtOrigin = 
        diagnostic.travel_session &&
        char.resolved_current_location_id === diagnostic.travel_session.origin_location_id;
      
      const characterAtDestination = 
        diagnostic.travel_session &&
        char.resolved_current_location_id === diagnostic.travel_session.destination_location_id;

      diagnostic.consistency_check = {
        has_active_session: !!diagnostic.travel_session,
        session_status: diagnostic.travel_session?.route_status || 'none',
        is_still_at_origin: characterStillAtOrigin,
        is_at_destination: characterAtDestination,
        travel_flags_cleared: 
          !char.travel_status || 
          !char.traveling_to_location_id,
      };

      // ── LIMBO DETECTION ──
      // Limbo = session completed but character still at origin
      const isInLimbo = 
        diagnostic.travel_session &&
        diagnostic.travel_session.route_status === 'arrived' &&
        characterStillAtOrigin;

      diagnostic.is_in_limbo = isInLimbo;

      if (isInLimbo) {
        diagnostic.limbo_detail = {
          message: 'Character arrived but location was not updated to destination',
          session_completed: diagnostic.travel_session.actual_arrival_time || 'unknown',
          origin_location_id: diagnostic.travel_session.origin_location_id,
          destination_location_id: diagnostic.travel_session.destination_location_id,
          current_location_id: char.resolved_current_location_id,
          issue: 'updateCharacterArrivalState likely failed to persist, or character was resolved back to origin',
        };
      }

      diagnostics.push(diagnostic);
    }

    // ── SUMMARY ──
    const inLimbo = diagnostics.filter(d => d.is_in_limbo);
    const stillTraveling = diagnostics.filter(d => d.consistency_check.has_active_session && d.consistency_check.session_status === 'in_transit');
    const properlyArrived = diagnostics.filter(d => d.consistency_check.is_at_destination);

    return Response.json({
      diagnostics,
      summary: {
        total_characters: diagnostics.length,
        in_limbo_count: inLimbo.length,
        in_limbo_characters: inLimbo.map(d => ({ id: d.character_id, name: d.character_name })),
        still_traveling_count: stillTraveling.length,
        properly_arrived_count: properlyArrived.length,
      },
      server_time: now.toISOString(),
    });

  } catch (error) {
    console.error('[diagnoseTravelArrivalPersistence]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});