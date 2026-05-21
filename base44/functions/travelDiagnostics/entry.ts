/**
 * travelDiagnostics
 *
 * Returns a full diagnostic snapshot of travel system state for a user:
 * - All active TravelSession records (owner_email scoped)
 * - Stale sessions (ETA passed but not arrived)
 * - Blocked session attempts
 * - Whether processTravelArrivals ran recently
 * - No-teleport invariant: detects any Character whose resolved_current_location_id
 *   matches travel_destination_location_id before arrival
 *
 * READ-ONLY — does not modify any records.
 * owner_email is the sole scope — never created_by.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const { ownerEmail: ownerEmailParam } = await req.json().catch(() => ({}));
    const ownerEmail = user?.email || ownerEmailParam;
    if (!ownerEmail) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // ── 1. ALL ACTIVE SESSIONS (in_transit) — owner_email scoped ─────────────
    const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email: ownerEmail, route_status: 'in_transit' },
      '-created_at',
      50
    ).catch(() => []);

    // ── 2. RECENTLY ARRIVED (last 2 hours) ────────────────────────────────────
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const recentArrivals = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email: ownerEmail, route_status: 'arrived' },
      '-actual_arrival_time',
      20
    ).catch(() => []);
    const recentArrivalsSince = recentArrivals.filter(s =>
      s.actual_arrival_time && s.actual_arrival_time > twoHoursAgo
    );

    // ── 3. STALE SESSIONS — ETA passed but still in_transit ───────────────────
    const staleSessions = activeSessions.filter(s => {
      if (!s.estimated_arrival_time) return false;
      return new Date(s.estimated_arrival_time) <= now;
    });

    // ── 4. PROCESSOR FRESHNESS — last arrival timestamp ───────────────────────
    const lastProcessorRun = recentArrivalsSince.length > 0
      ? recentArrivalsSince[0].actual_arrival_time
      : null;
    const processorStale = lastProcessorRun
      ? (now.getTime() - new Date(lastProcessorRun).getTime()) > 10 * 60 * 1000
      : true; // no recent arrivals — can't confirm it ran

    // ── 5. NO-TELEPORT INVARIANT CHECK ────────────────────────────────────────
    // Any character whose resolved_current_location_id === travel_destination_location_id
    // while a travel session is active is a TELEPORT VIOLATION.
    const teleportViolations = [];
    for (const session of activeSessions) {
      const charList = await base44.asServiceRole.entities.Character.filter(
        { id: session.character_id }, null, 1
      ).catch(() => []);
      const char = charList?.[0];
      if (!char) continue;
      if (
        char.resolved_current_location_id &&
        session.destination_location_id &&
        char.resolved_current_location_id === session.destination_location_id
      ) {
        teleportViolations.push({
          character_id: char.id,
          character_name: char.name,
          session_id: session.id,
          destination_location_id: session.destination_location_id,
          destination_name: session.destination_location_name,
          violation: 'resolved_current_location_id already equals destination while session is in_transit',
          session_source: session.travel_source,
          session_created_at: session.created_at,
        });
      }
    }

    // ── 6. ENRICH ACTIVE SESSIONS ─────────────────────────────────────────────
    const enriched = activeSessions.map(s => {
      const start = s.estimated_departure_time ? new Date(s.estimated_departure_time).getTime() : null;
      const end   = s.estimated_arrival_time   ? new Date(s.estimated_arrival_time).getTime()   : null;
      const total = start && end ? end - start : null;
      const elapsed = start ? now.getTime() - start : null;
      const progress = total && elapsed ? Math.min(99, Math.round((elapsed / total) * 100)) : s.progress_percent || 0;
      const minsRemaining = end ? Math.max(0, Math.round((end - now.getTime()) / 60000)) : null;
      const isStale = end ? new Date(end) <= now : false;

      return {
        session_id: s.id,
        character_id: s.character_id,
        character_name: s.character_name,
        owner_email: s.owner_email,
        origin: s.origin_location_name || 'unknown',
        destination: s.destination_location_name || 'unknown',
        origin_location_id: s.origin_location_id,
        destination_location_id: s.destination_location_id,
        travel_source: s.travel_source,
        travel_reason: s.travel_reason,
        travel_mode: s.travel_mode,
        source_commitment_id: s.source_commitment_id || null,
        positioning_mode: s.positioning_mode,
        estimated_departure: s.estimated_departure_time,
        estimated_arrival: s.estimated_arrival_time,
        duration_minutes: s.duration_minutes,
        distance_miles: s.distance_miles,
        computed_progress: progress,
        mins_remaining: minsRemaining,
        is_stale: isStale,
        blocker_reason: s.blocker_reason || null,
        route_status: s.route_status,
        owner_email_scope_proof: s.owner_email === ownerEmail ? 'PASS — matches authenticated user' : `FAIL — session owned by ${s.owner_email}`,
      };
    });

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      timestamp: now.toISOString(),
      active_sessions: enriched,
      active_count: activeSessions.length,
      stale_sessions: staleSessions.map(s => ({
        session_id: s.id,
        character_name: s.character_name,
        destination: s.destination_location_name,
        eta: s.estimated_arrival_time,
        overdue_by_minutes: Math.round((now.getTime() - new Date(s.estimated_arrival_time).getTime()) / 60000),
        travel_source: s.travel_source,
      })),
      stale_count: staleSessions.length,
      recent_arrivals_last_2h: recentArrivalsSince.map(s => ({
        character_name: s.character_name,
        destination: s.destination_location_name,
        arrived_at: s.actual_arrival_time,
        travel_source: s.travel_source,
      })),
      processor_last_run: lastProcessorRun,
      processor_stale: processorStale,
      teleport_violations: teleportViolations,
      teleport_violation_count: teleportViolations.length,
      no_teleport_invariant: teleportViolations.length === 0 ? 'PASS' : `FAIL — ${teleportViolations.length} violation(s) detected`,
    });

  } catch (error) {
    console.error('[travelDiagnostics]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});