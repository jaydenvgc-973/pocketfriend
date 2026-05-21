/**
 * proofTravelStateCompact — ultra-minimal output for all 5 affected characters
 */
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

    const targetNames = ['Andre Rivera', 'Melody Jackson Perry', 'Nathan Parker', 'Matt Lopez', 'Ava Dei Park'];

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
      let workMissed = false;
      if (char.work_start_time && workLocId) {
        const [wh, wm] = char.work_start_time.split(':').map(Number);
        const workStartMin = wh * 60 + wm;
        const [eh, em] = (char.work_end_time || '17:00').split(':').map(Number);
        const workEndMin = eh * 60 + em;
        const isWorkDay = (char.work_days || []).includes(dayOfWeekET);
        const isWorkHours = nowMinutesET >= workStartMin && nowMinutesET <= workEndMin;
        workMissed = isWorkDay && isWorkHours && curLocId !== workLocId;
      }

      const failures = [];
      if (session?.route_status === 'arrived' && curLocId === session.origin_location_id)
        failures.push('ARRIVAL_PERSIST_FAILED: session=arrived, char still at origin');
      if (session?.route_status === 'arrived' && curLocId !== session.destination_location_id && curLocId !== session.origin_location_id)
        failures.push(`OVERWRITTEN: session=arrived to ${session.destination_location_name}, but char now at ${char.resolved_current_location_name} — another system rewrote location`);
      if (char.travel_status && char.travel_status !== 'not_traveling' && session?.route_status === 'arrived')
        failures.push('STALE_FLAGS: travel_status not cleared after arrival');
      if (resolverTier === 'TIER2_HOME_FALLBACK')
        failures.push('RESOLVER_HOME_FALLBACK: masking real state with home');
      if (workMissed)
        failures.push(`MISSED_WORK: should be at ${locMap[workLocId]?.name || workLocId}, is at ${char.resolved_current_location_name}`);

      out.push({
        name,
        id: char.id,
        // DB truth
        db_location: char.resolved_current_location_name,
        db_location_id: curLocId,
        db_presence_status: char.resolved_presence_status,
        db_source_reason: char.resolved_source_reason,
        db_travel_status: char.travel_status,
        db_traveling_to: char.traveling_to_location_name,
        // Session truth
        session_status: session?.route_status || 'none',
        session_id: session?.id || null,
        session_origin: session?.origin_name || null,
        session_dest: session?.destination_name || null,
        session_dest_id: session?.destination_location_id || null,
        session_eta: session?.eta || null,
        session_actual_arrival: session?.actual_arrival_time || null,
        session_progress: session?.progress || null,
        // Resolver tier
        resolver_tier: resolverTier,
        resolver_shows: resolverTier === 'TIER1_RESOLVED' ? char.resolved_current_location_name
          : resolverTier === 'TIER2_HOME_FALLBACK' ? locMap[homeLocId]?.name
          : 'Away',
        // UI summary
        home_card_shows: resolverTier === 'TIER1_RESOLVED' ? `${char.resolved_current_location_name} (${char.resolved_presence_status})`
          : resolverTier === 'TIER2_HOME_FALLBACK' ? `${locMap[homeLocId]?.name} [HOME FALLBACK]`
          : 'Away',
        travel_selector_shows: (char.travel_status && char.travel_status !== 'not_traveling') ? `Busy: in transit to ${char.traveling_to_location_name}` : 'Available',
        map_marker_at: resolverTier === 'TIER1_RESOLVED' ? char.resolved_current_location_name : resolverTier === 'TIER2_HOME_FALLBACK' ? `${locMap[homeLocId]?.name} [fallback]` : 'Hidden',
        // Work
        work_location: workLocId ? locMap[workLocId]?.name : null,
        work_shift: char.work_start_time ? `${char.work_start_time}–${char.work_end_time} days:${JSON.stringify(char.work_days)}` : null,
        work_missed: workMissed,
        // Consistency
        session_arrived_char_at_origin: session?.route_status === 'arrived' && curLocId === session?.origin_location_id,
        session_arrived_char_at_dest: session?.route_status === 'arrived' && curLocId === session?.destination_location_id,
        session_arrived_char_elsewhere: session?.route_status === 'arrived' && curLocId !== session?.destination_location_id && curLocId !== session?.origin_location_id,
        failures,
      });
    }

    return Response.json({ timestamp: now.toISOString(), now_et: nowET.toTimeString().slice(0,5), day_et: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeekET], results: out });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});