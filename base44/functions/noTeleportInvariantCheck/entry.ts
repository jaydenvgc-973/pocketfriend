/**
 * noTeleportInvariantCheck
 *
 * READ-ONLY diagnostic. Verifies the no-teleport invariant across all characters:
 *
 * INVARIANT: A character's resolved_current_location_id must NEVER equal their
 *   traveling_to_location_id / travel_destination_location_id while an active
 *   TravelSession (route_status: in_transit) exists for them.
 *
 * A violation means a teleport occurred — the destination was written to
 * resolved_current_location_id before the ETA elapsed and processTravelArrivals
 * committed the arrival.
 *
 * Returns:
 *   - invariant_holds: true/false
 *   - violations: array of offending characters with details
 *   - in_transit_sessions: summary of all active sessions
 *   - orphaned_sessions: sessions with no matching character in-transit state
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Load all active in_transit sessions (owner_email scoped)
    const sessions = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email: user.email, route_status: 'in_transit' }, '-created_at', 100
    ).catch(() => []);

    const violations = [];
    const orphanedSessions = [];
    const sessionSummaries = [];

    for (const session of sessions) {
      const etaPassed = session.estimated_arrival_time
        ? new Date(session.estimated_arrival_time) <= now
        : false;

      sessionSummaries.push({
        session_id:        session.id,
        character_name:    session.character_name,
        character_id:      session.character_id,
        origin:            session.origin_location_name,
        destination:       session.destination_location_name,
        progress:          session.progress_percent,
        eta:               session.estimated_arrival_time,
        eta_passed:        etaPassed,
        duration_min:      session.duration_minutes,
        positioning_mode:  session.positioning_mode,
        travel_source:     session.travel_source,
      });

      // Character lookup: asServiceRole.filter({id:...}) broken — use owner_email filter + JS find
      const ownerCharsForSession = await base44.asServiceRole.entities.Character.filter(
        { owner_email: session.owner_email }, null, 200
      ).catch(() => []);
      const char = ownerCharsForSession?.find(c => c.id === session.character_id) || null;

      if (!char) {
        orphanedSessions.push({
          session_id:     session.id,
          character_id:   session.character_id,
          character_name: session.character_name,
          reason:         'Character record not found',
        });
        continue;
      }

      const destId     = session.destination_location_id;
      const currentId  = char.resolved_current_location_id;
      const travelDest = char.traveling_to_location_id || char.travel_destination_location_id;

      // INVARIANT CHECK: current location must NOT equal destination while session is active
      if (currentId && destId && currentId === destId) {
        violations.push({
          character_name:               char.name,
          character_id:                 char.id,
          session_id:                   session.id,
          resolved_current_location_id: currentId,
          destination_location_id:      destId,
          destination_name:             session.destination_location_name,
          resolved_presence_status:     char.resolved_presence_status,
          travel_status:                char.travel_status,
          eta:                          session.estimated_arrival_time,
          eta_passed:                   etaPassed,
          violation_type:               etaPassed ? 'stale_session_not_closed' : 'premature_teleport',
          description:                  etaPassed
            ? `Session ETA passed but session was never closed — character correctly at destination but session is stale (processTravelArrivals may have failed).`
            : `⛔ TELEPORT VIOLATION: character is already at destination before ETA elapsed. resolved_current_location_id was mutated outside processTravelArrivals.`,
        });
        continue;
      }

      // ORPHAN CHECK: character presence_status says "traveling" but session dest doesn't match character's travel dest
      if (char.resolved_presence_status === 'traveling' && travelDest && travelDest !== destId) {
        orphanedSessions.push({
          session_id:                 session.id,
          character_id:               char.id,
          character_name:             char.name,
          reason:                     'Character travel_destination does not match session destination',
          char_travel_dest:           travelDest,
          session_dest:               destId,
          session_destination_name:   session.destination_location_name,
        });
      }
    }

    // Check for characters marked "traveling" with NO active session
    const travelingChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, resolved_presence_status: 'traveling' }, null, 50
    ).catch(() => []);

    const activeSessionCharIds = new Set(sessions.map(s => s.character_id));
    const travelingWithNoSession = travelingChars.filter(c => !activeSessionCharIds.has(c.id));

    const invariantHolds = violations.filter(v => v.violation_type === 'premature_teleport').length === 0;

    return Response.json({
      invariant_holds:         invariantHolds,
      verdict:                 invariantHolds
        ? '✅ NO-TELEPORT INVARIANT HOLDS — all in-transit characters are correctly at origin'
        : `⛔ INVARIANT VIOLATED — ${violations.filter(v => v.violation_type === 'premature_teleport').length} premature teleport(s) detected`,
      timestamp:               now.toISOString(),
      user_email:              user.email,
      totals: {
        active_in_transit_sessions:   sessions.length,
        violations:                   violations.length,
        premature_teleports:          violations.filter(v => v.violation_type === 'premature_teleport').length,
        stale_sessions:               violations.filter(v => v.violation_type === 'stale_session_not_closed').length,
        orphaned_sessions:            orphanedSessions.length,
        traveling_chars_no_session:   travelingWithNoSession.length,
      },
      violations,
      orphaned_sessions:       orphanedSessions,
      traveling_with_no_session: travelingWithNoSession.map(c => ({
        name: c.name, id: c.id,
        resolved_presence_status:  c.resolved_presence_status,
        travel_destination_location_id: c.travel_destination_location_id,
        traveling_to_location_name: c.traveling_to_location_name,
        resolved_source_reason:    c.resolved_source_reason,
      })),
      active_sessions:         sessionSummaries,
    });

  } catch (error) {
    console.error('[noTeleportInvariantCheck]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});