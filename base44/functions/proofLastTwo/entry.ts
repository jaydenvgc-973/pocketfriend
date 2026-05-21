import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeekET = nowET.getDay();
    const nowMinutesET = nowET.getHours() * 60 + nowET.getMinutes();
    const targetNames = ['Nathan Parker', 'Matt Lopez', 'Ava Dei Park'];
    const [allChars, allSessions, allLocs] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200),
      base44.asServiceRole.entities.TravelSession.filter({ owner_email: user.email }, '-created_at', 200),
      base44.asServiceRole.entities.LocationReference.filter({}, null, 500),
    ]);
    const locMap = Object.fromEntries(allLocs.map(l => [l.id, l]));
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const out = [];
    for (const name of targetNames) {
      const char = allChars.find(c => c.name === name || c.display_name === name);
      if (!char) { out.push({ name, error: 'NOT FOUND' }); continue; }
      const session = allSessions
        .filter(s => s.character_id === char.id)
        .filter(s => ['in_transit','preparing','delayed','arrival_failed','error'].includes(s.route_status) ||
          (s.route_status === 'arrived' && s.actual_arrival_time && new Date(s.actual_arrival_time) > fourHoursAgo))
        .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0] || null;
      const homeLocId = char.current_home_location_id || null;
      const curLocId = char.resolved_current_location_id;
      let resolverTier;
      if (curLocId && locMap[curLocId]) resolverTier = 'TIER1_RESOLVED';
      else if (homeLocId && locMap[homeLocId]) resolverTier = 'TIER2_HOME_FALLBACK';
      else resolverTier = 'TIER3_AWAY';
      const workLocId = char.current_work_location_id || char.occupation_location_id || null;
      let workMissed = false, workInfo = null;
      if (char.work_start_time && workLocId) {
        const [wh, wm] = char.work_start_time.split(':').map(Number);
        const [eh, em] = (char.work_end_time || '17:00').split(':').map(Number);
        const isWorkDay = (char.work_days || []).includes(dayOfWeekET);
        const isWorkHours = nowMinutesET >= wh*60+wm && nowMinutesET <= eh*60+em;
        workMissed = isWorkDay && isWorkHours && curLocId !== workLocId;
        workInfo = { work_loc: locMap[workLocId]?.name || workLocId, shift: `${char.work_start_time}–${char.work_end_time}`, days: char.work_days, is_work_day: isWorkDay, should_be_at_work: isWorkDay && isWorkHours, is_at_work: curLocId === workLocId, missed: workMissed };
      }
      const failures = [];
      if (session?.route_status === 'arrived' && curLocId === session.origin_location_id) failures.push('ARRIVAL_PERSIST_FAILED: session=arrived, char still at origin');
      if (session?.route_status === 'arrived' && curLocId !== session.destination_location_id && curLocId !== session.origin_location_id) failures.push(`OVERWRITTEN: arrived to ${session.destination_location_name} but char now at ${char.resolved_current_location_name} — another system rewrote`);
      if (char.travel_status && char.travel_status !== 'not_traveling' && session?.route_status === 'arrived') failures.push('STALE_FLAGS');
      if (workMissed) failures.push(`MISSED_WORK: should be at ${workInfo?.work_loc}`);
      out.push({ name, db_location: char.resolved_current_location_name, db_location_id: curLocId, db_presence_status: char.resolved_presence_status, db_source_reason: char.resolved_source_reason, db_travel_status: char.travel_status, db_traveling_to: char.traveling_to_location_name, session_status: session?.route_status || 'none', session_dest: session?.destination_location_name, session_dest_id: session?.destination_location_id, session_actual_arrival: session?.actual_arrival_time, resolver_tier: resolverTier, home_card_shows: resolverTier === 'TIER1_RESOLVED' ? `${char.resolved_current_location_name} (${char.resolved_presence_status})` : `${locMap[homeLocId]?.name} [FALLBACK]`, travel_selector_shows: (char.travel_status && char.travel_status !== 'not_traveling') ? `Busy: in transit to ${char.traveling_to_location_name}` : 'Available', map_marker_at: resolverTier === 'TIER1_RESOLVED' ? char.resolved_current_location_name : `${locMap[homeLocId]?.name} [fallback]`, work: workInfo, session_arrived_char_at_origin: session?.route_status === 'arrived' && curLocId === session?.origin_location_id, session_arrived_char_at_dest: session?.route_status === 'arrived' && curLocId === session?.destination_location_id, session_arrived_char_elsewhere: session?.route_status === 'arrived' && curLocId !== session?.destination_location_id && curLocId !== session?.origin_location_id, failures: failures.length ? failures : ['CONSISTENT'] });
    }
    return Response.json({ now_et: nowET.toTimeString().slice(0,5), day_et: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeekET], results: out });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
});