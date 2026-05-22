/**
 * auditTravelSessionAuthority
 *
 * Finds all characters where TravelSession is overriding current_location_id.
 * Maps every instance of travel-dominance so it can be patched.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null,
      500
    );

    const allSessions = await base44.entities.TravelSession.filter(
      { owner_email: user.email },
      null,
      500
    );

    const findings = {
      total_characters: allChars.length,
      total_active_sessions: allSessions.length,
      characters_with_active_travel: [],
      characters_stuck_traveling: [],
      characters_multi_location: [],
      sessions_should_clear: []
    };

    // Find characters with active travel that might be overriding location
    for (const session of allSessions) {
      if (!['preparing', 'in_transit', 'arrival_due'].includes(session.route_status)) {
        continue; // Only active sessions matter
      }

      const char = allChars.find(c => c.id === session.character_id);
      if (!char) continue;

      // Check if travel is dominating
      const travelingAsPresence = ['traveling', 'in_transit'].includes(char.resolved_presence_status);
      const hasActiveTravelRecord = !!char.travel_status || travelingAsPresence;

      if (hasActiveTravelRecord && char.resolved_current_location_id !== session.destination_location_id) {
        findings.characters_with_active_travel.push({
          character_id: char.id,
          character_name: char.name,
          current_location_id: char.resolved_current_location_id,
          current_location_name: char.resolved_current_location_name,
          travel_destination_id: session.destination_location_id,
          travel_destination_name: session.destination_location_name,
          travel_status: char.travel_status || char.resolved_presence_status,
          session_status: session.route_status,
          session_eta: session.estimated_arrival_time,
          issue: 'Travel state differs from canonical location'
        });
      }

      // Detect stuck traveling
      if (travelingAsPresence && session.route_status === 'in_transit') {
        const etaTime = new Date(session.estimated_arrival_time);
        const now = new Date();
        if (etaTime < now) {
          findings.characters_stuck_traveling.push({
            character_id: char.id,
            character_name: char.name,
            eta_was: session.estimated_arrival_time,
            minutes_overdue: Math.round((now - etaTime) / 60000),
            reason: 'ETA passed but still marked traveling'
          });
        }
      }

      // Detect multi-location presence
      const homeId = char.current_home_location_id;
      const workId = char.current_work_location_id;
      const schoolId = char.current_school_location_id;
      const tempHousingId = char.temporary_housing_location_id;

      const activeLocations = [
        homeId ? 'home' : null,
        workId ? 'work' : null,
        schoolId ? 'school' : null,
        tempHousingId ? 'temp_housing' : null,
        char.resolved_current_location_id ? 'resolved' : null
      ].filter(Boolean);

      if (activeLocations.length > 2) {
        findings.characters_multi_location.push({
          character_id: char.id,
          character_name: char.name,
          locations: activeLocations,
          issue: 'Character assigned to multiple active locations'
        });
      }

      findings.sessions_should_clear.push({
        session_id: session.id,
        character_name: char.name,
        reason: 'TravelSession no longer authoritative',
        action: 'Archive and clear travel_status on character'
      });
    }

    return Response.json({
      success: true,
      ...findings,
      summary: `${findings.characters_with_active_travel.length} characters with active travel overriding location, ${findings.characters_stuck_traveling.length} stuck, ${findings.characters_multi_location.length} in multiple places`
    });

  } catch (error) {
    console.error('[auditTravelSessionAuthority]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});