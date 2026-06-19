/**
 * recoveryAuditActiveCreated — READ-ONLY audit of active_created_characters
 * Focuses on characters with active TravelSessions or travel flags.
 * NEVER writes. Only reads current state.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { owner_email } = body;  // optional — used in report only

    // owner_email is optional — used only for scoping if provided

    // List ALL characters — filter in JS (character_type may not be filterable via asServiceRole)
    const allChars = await base44.asServiceRole.entities.Character.list('name', 200);
    const chars = allChars.filter(c =>
      c.character_type === 'active_created_character' &&
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'moved_away'
    );

    // Load TravelSessions
    const sessions = await base44.asServiceRole.entities.TravelSession.list('-created_at', 200);

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Active travel states that indicate potential stuck
    const travelingFlags = ['traveling_to_work', 'traveling_to_school', 'traveling_to_destination'];

    const report = chars.map(c => {
      const charSessions = (sessions || []).filter(s => s.character_id === c.id);

      // Active in_transit or arrival_due sessions
      const activeSession = charSessions.find(s => s.route_status === 'in_transit' || s.route_status === 'arrival_due');

      // Recently arrived (arrived status, within last 24h)
      const recentArrived = charSessions.filter(s => {
        if (s.route_status !== 'arrived') return false;
        if (!s.actual_arrival_time) return false;
        return (nowET - new Date(s.actual_arrival_time)) < 24 * 60 * 60 * 1000;
      });

      const lastArrived = c.last_arrived_time ? new Date(c.last_arrived_time) : null;
      const minsAtLocation = lastArrived ? Math.round((nowET - lastArrived) / 60000) : null;

      // Stuck detection
      const hasTravelFlag = travelingFlags.includes(c.travel_status);
      const orphanTravel = hasTravelFlag && !activeSession;
      const activeSessionPastETA = activeSession?.estimated_arrival_time &&
        new Date(activeSession.estimated_arrival_time) < new Date(nowET - 5 * 60000);

      // Dwell check: more than 3 hours at same location without being at_work or sleeping
      const excessiveDwell = minsAtLocation && minsAtLocation > 180 &&
        c.resolved_presence_status !== 'at_work' &&
        c.resolved_presence_status !== 'sleeping' &&
        c.resolved_presence_status !== 'napping';

      // Activity check
      const stuckActivity = c.current_activity &&
        (c.current_activity.toLowerCase().includes('looking for food') ||
         c.current_activity.toLowerCase().includes('seeking') ||
         c.current_activity.toLowerCase().includes('searching')) &&
        minsAtLocation && minsAtLocation > 60;

      const isStuck = orphanTravel || activeSessionPastETA || excessiveDwell || stuckActivity;

      return {
        name: c.name,
        id: c.id,
        current_location: c.resolved_current_location_name,
        presence_status: c.resolved_presence_status,
        location_type: c.resolved_location_type,
        source_reason: c.resolved_source_reason,
        travel_status: c.travel_status,
        travel_dest: c.traveling_to_location_name,
        current_activity: c.current_activity,
        mins_at_location: minsAtLocation,
        last_arrived_et: lastArrived ? new Date(new Date(lastArrived).toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString() : null,
        needs: {
          hunger: Math.round(c.hunger_value ?? 0),
          energy: Math.round(c.energy_value ?? 0),
          social: Math.round(c.social_value ?? 0),
          health: Math.round(c.health_value ?? 0),
          hygiene: Math.round(c.hygiene_value ?? 0),
          comfort: Math.round(c.comfort_value ?? 0),
          mental: Math.round(c.mental_value ?? 0),
        },
        home_loc_id: c.current_home_location_id,
        work_loc_id: c.occupation_location_id,
        active_session: activeSession ? {
          id: activeSession.id,
          status: activeSession.route_status,
          dest: activeSession.destination_location_name,
          eta: activeSession.estimated_arrival_time,
          source: activeSession.travel_source,
        } : null,
        recent_arrived_count: recentArrived.length,
        recent_arrived: recentArrived.slice(0, 3).map(s => ({
          dest: s.destination_location_name,
          arrived: s.actual_arrival_time,
          source: s.travel_source,
          reason: s.travel_reason,
        })),
        orphan_travel: orphanTravel,
        session_past_eta: activeSessionPastETA,
        excessive_dwell: excessiveDwell,
        stuck_activity: stuckActivity,
        is_stuck: isStuck,
        is_test: c.is_test_character || false,
      };
    });

    const stuck = report.filter(r => r.is_stuck);
    const traveling = report.filter(r => r.travel_status !== 'not_traveling');
    const withSessions = report.filter(r => r.active_session || r.recent_arrived_count > 0);
    const excessiveDwellers = report.filter(r => r.excessive_dwell);

    return Response.json({
      owner_email,
      total: report.length,
      stuck_count: stuck.length,
      traveling_count: traveling.length,
      with_sessions_count: withSessions.length,
      excessive_dwell_count: excessiveDwellers.length,
      stuck,
      traveling,
      with_sessions: withSessions,
      excessive_dwell: excessiveDwellers,
      now_et: nowET.toISOString(),
      now_et_display: new Date(nowET).toLocaleString('en-US', { timeZone: 'America/New_York' }),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});