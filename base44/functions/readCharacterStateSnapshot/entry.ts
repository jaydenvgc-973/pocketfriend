import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId } = await req.json();

    if (!characterId) {
      return new Response(JSON.stringify({ error: 'characterId is required' }), { status: 400 });
    }

    const [character] = await base44.entities.Character.filter({ id: characterId });
    if (!character) {
      return new Response(JSON.stringify({ error: 'Character not found' }), { status: 404 });
    }

    const allLocations = await base44.entities.LocationReference.list(null, 500);
    const locationMap = allLocations.reduce((acc, loc) => {
      acc[loc.id] = loc;
      return acc;
    }, {});

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // 1. Database State
    const dbState = {
      presence_status: character.resolved_presence_status || null,
      resolved_current_location_id: character.resolved_current_location_id || null,
      current_location_name: character.resolved_current_location_name || null,
      sleep_state: character.sleep_lock || null,
      work_state: null, // Cannot be determined from character entity alone
      school_state: character.student_status || null,
      travel_state: character.travel_status || null,
    };

    // 2. Visible UI State (Simplified)
    const homeCardStatus = character.resolved_presence_status || 'unknown';
    const homeCardLocation = character.resolved_current_location_name || 'Unknown';

    const isAsleep = homeCardStatus === 'sleeping' || homeCardStatus === 'napping';
    const travelAvailable = !isAsleep && !character.is_jailed;

    const uiState = {
      home_card: {
        displayed_status: homeCardStatus,
        displayed_location: homeCardLocation,
        displayed_availability: isAsleep ? 'asleep' : 'awake',
        last_rendered_or_checked_at: nowET.toISOString(),
      },
      travel_page: {
        listed_in_whos_coming: true,
        available_for_travel: travelAvailable,
        unavailable_reason: !travelAvailable ? (isAsleep ? 'Asleep' : 'Jailed') : null,
        displayed_status: travelAvailable ? 'available' : 'unavailable',
        displayed_location: homeCardLocation,
      },
       map_page: {
        displayed_location: homeCardLocation,
        marker_visible: !!character.resolved_current_location_id,
        marker_status: homeCardStatus,
      },
      locations_page: {
        shown_at_location: homeCardLocation,
        displayed_occupancy_status: homeCardStatus,
      },
      profile_page: {
        displayed_status: homeCardStatus,
        displayed_location: homeCardLocation,
      },
    };

    // 3. Contradictions
    const contradictions = [];

    const snapshot = {
      character_id: character.id,
      character_name: character.name,
      checked_at_app_time_et: nowET.toISOString(),
      checked_at_system_time: new Date().toISOString(),
      database_state: dbState,
      visible_ui_state: uiState,
      contradictions,
    };

    return new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});