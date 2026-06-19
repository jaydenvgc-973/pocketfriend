import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TEST_WINDOW_START_UTC = '2026-06-19T16:50:00.000Z';
const TEST_WINDOW_END_UTC = '2026-06-19T17:25:00.000Z';

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { owner_email } = body;
    console.log(`[AUDIT START] Received request for owner: ${owner_email}`);

    if (!owner_email) {
      return Response.json({ error: 'owner_email is required' }, { status: 400 });
    }

    const characters = await base44.asServiceRole.entities.Character.filter({ owner_email, status: 'active' });
    const allSessions = await base44.asServiceRole.entities.TravelSession.filter({ owner_email });
    const allHistory = await base44.asServiceRole.entities.LocationHistory.filter({ owner_email });
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email });
    console.log(`[AUDIT DATA] Fetched ${characters.length} characters, ${allSessions.length} sessions, ${allHistory.length} history records, ${allLocations.length} locations.`);

    const report = [];

    for (const char of characters) {
      if (char.is_test_character) {
          console.log(`[AUDIT SKIP] Skipping test character: ${char.name}`);
          continue;
      }

      const charData = {
        character_name: char.name,
        character_id: char.id,
        owner_email: char.owner_email,
        current_state: {
          resolved_current_location_id: char.resolved_current_location_id,
          resolved_current_location_name: char.resolved_current_location_name,
          resolved_presence_status: char.resolved_presence_status,
          resolved_location_type: char.resolved_location_type,
          resolved_source_reason: char.resolved_source_reason,
          resolved_last_updated_at: char.resolved_last_updated_at,
          last_arrived_time: char.last_arrived_time,
          travel_status: char.travel_status,
          location_status: char.location_status,
          travel_destination_location_id: char.travel_destination_location_id,
          traveling_to_location_id: char.traveling_to_location_id,
          traveling_to_location_name: char.traveling_to_location_name,
        },
        schedule_info: {
            work_location: null,
            school_location: null,
            home_location: null,
        },
        pre_test_state: {
          location_id: null,
          location_name: null,
          timestamp: null,
        },
        test_window_activity: {
          travel_sessions_created: [],
          location_history_created: [],
        },
        contamination_status: 'SAFE / NO TEST DESTINATION DETECTED',
      };
      
      // Get work/school/home locations
      if (char.occupation_location_id) {
          const workLoc = allLocations.find(l => l.id === char.occupation_location_id);
          if (workLoc) charData.schedule_info.work_location = {id: workLoc.id, name: workLoc.name};
      }
      if (char.education_location_id) {
          const schoolLoc = allLocations.find(l => l.id === char.education_location_id);
          if(schoolLoc) charData.schedule_info.school_location = {id: schoolLoc.id, name: schoolLoc.name};
      }
       if (char.current_home_location_id) {
          const homeLoc = allLocations.find(l => l.id === char.current_home_location_id);
          if(homeLoc) charData.schedule_info.home_location = {id: homeLoc.id, name: homeLoc.name};
      }

      // Find last location before the test window
      const preTestHistory = allHistory
        .filter(h => h.character_id === char.id && new Date(h.arrival_time) < new Date(TEST_WINDOW_START_UTC))
        .sort((a, b) => new Date(b.arrival_time) - new Date(a.arrival_time));

      console.log(`[AUDIT PRE-TEST] Found ${preTestHistory.length} pre-test history records for ${char.name}.`);
      if (preTestHistory.length > 0) {
        charData.pre_test_state.location_id = preTestHistory[0].location_id;
        charData.pre_test_state.location_name = preTestHistory[0].location_name;
        charData.pre_test_state.timestamp = preTestHistory[0].arrival_time;
      }

      // Find sessions and history created during the test window
      charData.test_window_activity.travel_sessions_created = allSessions.filter(
        s => s.character_id === char.id && new Date(s.created_at) >= new Date(TEST_WINDOW_START_UTC) && new Date(s.created_at) <= new Date(TEST_WINDOW_END_UTC)
      ).map(s => ({id: s.id, destination: s.destination_location_name, created_at: s.created_at, route_status: s.route_status}));

      charData.test_window_activity.location_history_created = allHistory.filter(
        h => h.character_id === char.id && new Date(h.arrival_time) >= new Date(TEST_WINDOW_START_UTC) && new Date(h.arrival_time) <= new Date(TEST_WINDOW_END_UTC)
      ).map(h => ({id: h.id, location_name: h.location_name, arrival_time: h.arrival_time, travel_source: h.travel_source}));

      // Determine contamination status
      console.log(`[AUDIT CONTAMINATION CHECK] For ${char.name}: last_arrived_time=${char.last_arrived_time}, last_updated_at=${char.resolved_last_updated_at}, source_reason='${char.resolved_source_reason}'`);
      const lastArrival = char.last_arrived_time;
      if (lastArrival && lastArrival >= TEST_WINDOW_START_UTC && lastArrival <= TEST_WINDOW_END_UTC) {
         console.log(`[AUDIT CONTAMINATION] ${char.name} last_arrived_time is within test window.`);
         if (char.resolved_source_reason && char.resolved_source_reason.startsWith('verified_arrival')) {
             console.log(`[AUDIT CONTAMINATION] ${char.name} source reason is 'verified_arrival'.`);
             charData.contamination_status = 'CONTAMINATED LOCATION';
         }
      }
      
      const lastUpdate = char.resolved_last_updated_at;
      if(lastUpdate && lastUpdate >= TEST_WINDOW_START_UTC && lastUpdate <= TEST_WINDOW_END_UTC && charData.contamination_status !== 'CONTAMINATED LOCATION') {
          console.log(`[AUDIT CONTAMINATION] ${char.name} last_updated_at is within test window.`);
          if(char.resolved_source_reason && char.resolved_source_reason.includes('arrival')) {
            console.log(`[AUDIT CONTAMINATION] ${char.name} source reason includes 'arrival'.`);
            charData.contamination_status = 'CONTAMINATED LOCATION';
          }
      }

      if(charData.contamination_status === 'CONTAMINATED LOCATION') {
           const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
           const dowNow = nowET.getDay();
           const nowMin = nowET.getHours() * 60 + nowET.getMinutes();

           const isWorkDay = Array.isArray(char.work_days) && char.work_days.includes(dowNow);
           console.log(`[AUDIT SCHEDULE CHECK] For ${char.name}: isWorkDay=${isWorkDay}`);
           if (isWorkDay && char.work_start_time && char.work_end_time) {
               const shiftStart = toMinutes(char.work_start_time);
               const shiftEnd = toMinutes(char.work_end_time);
               const shiftActiveNow = shiftEnd < shiftStart
                   ? (nowMin >= shiftStart || nowMin < shiftEnd)
                   : (nowMin >= shiftStart && nowMin < shiftEnd);

               if (shiftActiveNow && char.resolved_current_location_id !== char.occupation_location_id) {
                   console.log(`[AUDIT SCHEDULE CONFLICT] ${char.name} has active shift but is at ${char.resolved_current_location_name} instead of work.`);
                   charData.contamination_status = 'SCHEDULE CONFLICT';
               }
           }
      } else {
          if(char.travel_status !== 'not_traveling' || char.location_status === 'traveling') {
              console.log(`[AUDIT STUCK] ${char.name} has travel_status='${char.travel_status}' or location_status='${char.location_status}'.`);
              charData.contamination_status = 'STUCK AT TEST DESTINATION';
          }
      }


      report.push(charData);
    }

    console.log(`[AUDIT COMPLETE] Processed ${report.length} characters.`);
    return Response.json(report);
  } catch (error) {
    console.error('Forensic audit failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});