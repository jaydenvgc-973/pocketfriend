/**
 * forensicCharacterReadOnly — READ-ONLY audit function
 * NEVER writes, NEVER updates, NEVER mutates any record.
 * Only reads current state of the listed character IDs.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const AFFECTED_IDS = [
  "6a0299e0dd588e28cb48df8a", // Khalil Carter
  "69cd1c421ecd8b69850b3a6a", // Andre Rivera
  "69cb6a64a823aa902e589f99", // Brian Anderson
  "6a23580f06f68528940c6ddd", // Vick Servicio
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { owner_email } = body;

    if (!owner_email) {
      return Response.json({ error: 'owner_email required' }, { status: 400 });
    }

    const allChars = await base44.entities.Character.filter(
      { owner_email },
      'created_date',
      200
    ).catch(() => []);

    if (allChars.length === 0) {
      return Response.json({ error: 'No characters found', owner_email });
    }

    // Read recent LocationHistory for this owner (via asServiceRole)
    const recentHistory = await base44.asServiceRole.entities.LocationHistory.filter(
      { owner_email },
      '-arrival_time',
      50
    ).catch(() => []);

    // Read recent TravelSessions
    const recentSessions = await base44.asServiceRole.entities.TravelSession.filter(
      { owner_email },
      '-updated_date',
      100
    ).catch(() => []);

    // Build per-character report
    const report = allChars.map(char => {
      const charSessions = recentSessions.filter(s => s.character_id === char.id);
      const charHistory = recentHistory.filter(h => h.character_id === char.id);

      return {
        name: char.name,
        id: char.id,
        owner_email: char.owner_email,
        character_type: char.character_type,
        current_location: {
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_presence_status: char.resolved_presence_status,
          resolved_location_type: char.resolved_location_type,
          resolved_source_reason: char.resolved_source_reason,
          resolved_last_updated_at: char.resolved_last_updated_at,
        },
        travel_state: {
          travel_status: char.travel_status,
          location_status: char.location_status,
          travel_destination_location_id: char.travel_destination_location_id,
          traveling_to_location_id: char.traveling_to_location_id,
          traveling_to_location_name: char.traveling_to_location_name,
          last_arrived_time: char.last_arrived_time,
        },
        needs: {
          energy: char.energy_value,
          hunger: char.hunger_value,
          social: char.social_value,
          health: char.health_value,
          mental: char.mental_value,
          financial: char.financial_need_value,
          hygiene: char.hygiene_value,
          comfort: char.comfort_value,
        },
        emotional_state: char.emotional_state,
        session_count: charSessions.length,
        sessions: charSessions.map(s => ({
          id: s.id,
          route_status: s.route_status,
          destination: s.destination_location_name,
          origin: s.origin_location_name,
          actual_arrival_time: s.actual_arrival_time,
          estimated_arrival_time: s.estimated_arrival_time,
          created_at: s.created_at,
          updated_date: s.updated_date,
          travel_source: s.travel_source,
          travel_reason: s.travel_reason,
        })),
        location_history_count: charHistory.length,
        recent_history: charHistory.slice(0, 5).map(h => ({
          location_name: h.location_name,
          event_type: h.event_type,
          arrival_time: h.arrival_time,
          travel_source: h.travel_source,
        })),
      };
    });

    return Response.json({
      owner_email,
      total_characters: report.length,
      characters: report,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});