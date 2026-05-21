/**
 * deepTravelDiagnosticCompact — all 5 chars, minimal output
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

    const [allChars, allSessions, allLocs] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200),
      base44.asServiceRole.entities.TravelSession.filter({ owner_email: user.email }, '-created_at', 200),
      base44.asServiceRole.entities.LocationReference.filter({}, null, 500),
    ]);

    const locMap = Object.fromEntries(allLocs.map(l => [l.id, l]));
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    const results = [];

    for (const name of ['Andre Rivera', 'Melody Jackson Perry', 'Nathan Parker', 'Matt Lopez', 'Ava Dei Park']) {
      const char = allChars.find(c => c.name === name || c.display_name === name);
      if (!char) continue;

      // All job sources
      const jobs = [];
      if (char.occupation && char.occupation_location_id) jobs.push({ src: 'occ', title: char.occupation, loc: locMap[char.occupation_location_id]?.name, start: char.work_start_time, end: char.work_end_time, days: char.work_days });
      if (Array.isArray(char.work_schedule)) char.work_schedule.forEach((s, i) => jobs.push({ src: `ws[${i}]`, title: s.job_title || s.title, loc: locMap[s.location_id]?.name, start: s.start || s.start_time, end: s.end || s.end_time, days: s.days || s.work_days }));
      if (Array.isArray(char.additional_occupation_locations)) char.additional_occupation_locations.forEach((j, i) => jobs.push({ src: `aol[${i}]`, title: j.job_title || j.title, loc: locMap[j.location_id]?.name, start: j.start || j.start_time, end: j.end || j.end_time, days: j.days || j.work_days }));

      // Active job now
      let activeJob = null;
      for (const j of jobs) {
        if (!j.days || !j.days.includes(dayOfWeekET)) continue;
        const [sh, sm] = (j.start || '00:00').split(':').map(Number);
        const [eh, em] = (j.end || '23:59').split(':').map(Number);
        if (nowMinutesET >= sh*60+sm && nowMinutesET <= eh*60+em) { activeJob = j; break; }
      }

      // Session
      const session = allSessions.filter(s => s.character_id === char.id).filter(s => ['in_transit','preparing','delayed','arrival_failed','error'].includes(s.route_status) || (s.route_status === 'arrived' && s.actual_arrival_time && new Date(s.actual_arrival_time) > fourHoursAgo)).sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0] || null;

      // Failures
      const errs = [];
      if (session?.route_status === 'arrived' && char.resolved_current_location_id === session.origin_location_id) errs.push('ARRIVAL_PERSIST_FAILED: session=arrived but char at origin');
      if (session?.route_status === 'arrived' && char.resolved_current_location_id !== session.destination_location_id && char.resolved_current_location_id !== session.origin_location_id) errs.push(`ARRIVAL_OVERWRITTEN: arrived to ${session.destination_location_name} but char rewrote to ${char.resolved_current_location_name}`);
      if (char.travel_status && char.travel_status !== 'not_traveling' && (!session || session.route_status === 'arrived')) errs.push('STALE_TRAVEL_FLAGS: not cleared after arrival');
      if (activeJob && char.resolved_current_location_id !== activeJob.loc_id) errs.push(`MISSED_WORK: should be ${activeJob.title} at ${activeJob.loc}`);

      results.push({
        name,
        jobs_count: jobs.length,
        jobs: jobs.map(j => `${j.src}: ${j.title} @ ${j.loc} ${j.start}-${j.end} ${j.days}`),
        active_job: activeJob ? `${activeJob.title} @ ${activeJob.loc}` : 'none',
        travel_status: char.travel_status,
        traveling_to: char.traveling_to_location_name,
        session_status: session?.route_status || 'none',
        session_dest: session?.destination_location_name,
        char_location: char.resolved_current_location_name,
        char_presence: char.resolved_presence_status,
        errors: errs.length ? errs : ['OK'],
      });
    }

    return Response.json({ now_et: nowET.toTimeString().slice(0, 5), results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});