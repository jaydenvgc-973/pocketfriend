import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200).catch(() => []);
    const nathan = allChars.find(c => (c.name || '').toLowerCase().includes('nathan'));
    if (!nathan) return Response.json({ error: 'Nathan not found', total_chars: allChars.length });

    const sessions = await base44.entities.TravelSession.filter({ owner_email: user.email }, '-created_at', 20).catch(() => []);
    const nathanSessions = sessions.filter(s => s.character_id === nathan.id);

    const commitments = await base44.entities.CharacterCommitment.filter({ owner_email: user.email }, '-created_at', 10).catch(() => []);
    const nathanCommitments = commitments.filter(c => c.character_id === nathan.id && c.status === 'active');

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const toMin = (t) => { if (!t) return null; const [h,m] = t.split(':').map(Number); return h*60+(m||0); };
    const cm = nowET.getHours()*60+nowET.getMinutes();

    let sleepWindow = null;
    if (nathan.sleep_start_time && nathan.wake_up_time) {
      sleepWindow = { sleepStart: toMin(nathan.sleep_start_time), wakeMin: toMin(nathan.wake_up_time), source: 'stored' };
    }
    let isSleeping = false;
    if (sleepWindow) {
      const { sleepStart, wakeMin } = sleepWindow;
      isSleeping = sleepStart > wakeMin ? (cm >= sleepStart || cm < wakeMin) : (cm >= sleepStart && cm < wakeMin);
    }

    return Response.json({
      id: nathan.id,
      name: nathan.name,
      owner_email: nathan.owner_email,
      character_type: nathan.character_type,
      status: nathan.status,
      db_resolved_current_location_id: nathan.resolved_current_location_id,
      db_resolved_current_location_name: nathan.resolved_current_location_name,
      db_resolved_presence_status: nathan.resolved_presence_status,
      db_resolved_source_reason: nathan.resolved_source_reason,
      db_resolved_location_type: nathan.resolved_location_type,
      current_home_location_id: nathan.current_home_location_id,
      occupation_location_id: nathan.occupation_location_id,
      work_start_time: nathan.work_start_time,
      work_end_time: nathan.work_end_time,
      work_days: nathan.work_days,
      sleep_start_time: nathan.sleep_start_time,
      wake_up_time: nathan.wake_up_time,
      sleep_debt_hours: nathan.sleep_debt_hours,
      travel_status: nathan.travel_status,
      travel_destination_location_id: nathan.travel_destination_location_id,
      is_jailed: nathan.is_jailed,
      house_arrest_active: nathan.house_arrest_active,
      sleep_window: sleepWindow,
      is_sleeping_now_canonical: isSleeping,
      et_time_now: `${nowET.getHours().toString().padStart(2,'0')}:${nowET.getMinutes().toString().padStart(2,'0')} ET`,
      active_travel_sessions: nathanSessions.map(s => ({
        session_id: s.id, route_status: s.route_status,
        destination: s.destination_location_name, origin: s.origin_location_name,
        eta: s.estimated_arrival_time, progress: s.progress_percent,
        travel_source: s.travel_source, interruption_allowed: s.interruption_allowed,
      })),
      active_commitments: nathanCommitments.map(c => ({
        id: c.id, type: c.commitment_type, destination: c.destination_location_name,
        status: c.status, text: c.commitment_text,
      })),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});