/**
 * deepTravelDiagnosticAllJobs
 *
 * Full diagnostic for 5 characters:
 * - ALL job sources (occupation fields, current_work, work_schedule arrays, education)
 * - ALL travel flags (travel_status, traveling_to, travel_destination)
 * - Current schedule activation (which job is active RIGHT NOW)
 * - Travel source and session state
 * - Why character is still marked traveling
 *
 * No changes. Proof only.
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
    const nowETStr = nowET.toTimeString().slice(0, 5);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const targetNames = ['Andre Rivera', 'Melody Jackson Perry', 'Nathan Parker', 'Matt Lopez', 'Ava Dei Park'];

    const [allChars, allSessions, allLocs] = await Promise.all([
      base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200),
      base44.asServiceRole.entities.TravelSession.filter({ owner_email: user.email }, '-created_at', 200),
      base44.asServiceRole.entities.LocationReference.filter({}, null, 500),
    ]);

    const locMap = Object.fromEntries(allLocs.map(l => [l.id, l]));
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    const results = [];

    for (const name of targetNames) {
      const char = allChars.find(c => c.name === name || c.display_name === name);
      if (!char) { results.push({ name, error: 'NOT_FOUND' }); continue; }

      // ── ALL JOB SOURCES ──
      const allJobs = [];

      // Source 1: occupation / occupation_location_id
      if (char.occupation && char.occupation_location_id) {
        allJobs.push({
          source: 'occupation_field',
          job_title: char.occupation,
          location_id: char.occupation_location_id,
          location_name: locMap[char.occupation_location_id]?.name || char.occupation_location_name || char.occupation_location_id,
          shift_start: char.work_start_time || null,
          shift_end: char.work_end_time || null,
          days: char.work_days || [],
        });
      }

      // Source 2: current_work_location_id
      if (char.current_work_location_id && char.current_work_location_id !== char.occupation_location_id) {
        allJobs.push({
          source: 'current_work_location_id',
          job_title: '(unnamed)',
          location_id: char.current_work_location_id,
          location_name: locMap[char.current_work_location_id]?.name || char.current_work_location_id,
          shift_start: char.work_start_time || null,
          shift_end: char.work_end_time || null,
          days: char.work_days || [],
        });
      }

      // Source 3: work schedule array (array of {location_id, job_title, start, end, days})
      if (Array.isArray(char.work_schedule) && char.work_schedule.length > 0) {
        char.work_schedule.forEach((sched, idx) => {
          allJobs.push({
            source: `work_schedule[${idx}]`,
            job_title: sched.job_title || sched.title || '(unnamed)',
            location_id: sched.location_id,
            location_name: locMap[sched.location_id]?.name || sched.location_name || sched.location_id,
            shift_start: sched.start || sched.start_time || null,
            shift_end: sched.end || sched.end_time || null,
            days: sched.days || sched.work_days || [],
          });
        });
      }

      // Source 4: additional_occupation_locations
      if (Array.isArray(char.additional_occupation_locations) && char.additional_occupation_locations.length > 0) {
        char.additional_occupation_locations.forEach((job, idx) => {
          allJobs.push({
            source: `additional_occupation_locations[${idx}]`,
            job_title: job.job_title || job.title || '(unnamed)',
            location_id: job.location_id,
            location_name: locMap[job.location_id]?.name || job.location_name || job.location_id,
            shift_start: job.start || job.start_time || null,
            shift_end: job.end || job.end_time || null,
            days: job.days || job.work_days || [],
          });
        });
      }

      // ── DEDUPLICATE ──
      const seenLocIds = new Set();
      const uniqueJobs = allJobs.filter(job => {
        if (seenLocIds.has(job.location_id)) return false;
        seenLocIds.add(job.location_id);
        return true;
      });

      // ── DETERMINE ACTIVE JOB NOW ──
      let activeJobNow = null;
      for (const job of uniqueJobs) {
        const isWorkDay = job.days.includes(dayOfWeekET);
        if (!isWorkDay) continue;
        const startMin = job.shift_start ? parseInt(job.shift_start.split(':')[0]) * 60 + parseInt(job.shift_start.split(':')[1]) : 0;
        const endMin = job.shift_end ? parseInt(job.shift_end.split(':')[0]) * 60 + parseInt(job.shift_end.split(':')[1]) : 23 * 60 + 59;
        const isWorkHours = nowMinutesET >= startMin && nowMinutesET <= endMin;
        if (isWorkHours) {
          activeJobNow = job;
          break; // Take first match
        }
      }

      // ── ALL TRAVEL FLAGS ──
      const travelFlags = {
        travel_status: char.travel_status || 'not_traveling',
        traveling_to_location_id: char.traveling_to_location_id || null,
        traveling_to_location_name: char.traveling_to_location_name || null,
        travel_destination_location_id: char.travel_destination_location_id || null,
        resolved_source_reason: char.resolved_source_reason || null,
      };

      // ── TRAVEL SESSION STATE ──
      const session = allSessions
        .filter(s => s.character_id === char.id)
        .filter(s => ['in_transit','preparing','delayed','arrival_failed','error'].includes(s.route_status) ||
          (s.route_status === 'arrived' && s.actual_arrival_time && new Date(s.actual_arrival_time) > fourHoursAgo))
        .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))[0] || null;

      // ── CHARACTER LOCATION STATE ──
      const charLocId = char.resolved_current_location_id;
      const charLocName = char.resolved_current_location_name;
      const charPresence = char.resolved_presence_status;

      // ── FAILURE ANALYSIS ──
      const failures = [];

      // Failure 1: Arrival persistence
      if (session?.route_status === 'arrived' && charLocId === session.origin_location_id) {
        failures.push({
          type: 'ARRIVAL_PERSIST_FAILED',
          detail: `TravelSession=${session.id} marked arrived at ${session.destination_location_name}, but Character still at origin (${charLocName}). updateCharacterArrivalState failed.`,
        });
      }

      // Failure 2: Character location overwritten after arrival
      if (session?.route_status === 'arrived' && charLocId !== session.destination_location_id && charLocId !== session.origin_location_id) {
        failures.push({
          type: 'ARRIVAL_OVERWRITTEN',
          detail: `TravelSession=${session.id} arrived at ${session.destination_location_name}, but Character rewritten to ${charLocName} (${charLocId}). Another system (work schedule? manual location?) rewrote location after arrival.`,
        });
      }

      // Failure 3: Stale travel flags
      if ((char.travel_status && char.travel_status !== 'not_traveling') && (!session || session.route_status === 'arrived')) {
        failures.push({
          type: 'STALE_TRAVEL_FLAGS',
          detail: `travel_status=${char.travel_status}, but no active in_transit session (session status=${session?.route_status || 'none'}). Flags were not cleared after travel completed.`,
        });
      }

      // Failure 4: Work schedule conflict
      if (activeJobNow && charLocId !== activeJobNow.location_id) {
        failures.push({
          type: 'MISSED_WORK',
          detail: `Should be at work: ${activeJobNow.job_title} at ${activeJobNow.location_name} (${activeJobNow.shift_start}–${activeJobNow.shift_end} ${dayNames[dayOfWeekET]}). Currently at ${charLocName}. Session status: ${session?.route_status || 'none'}.`,
        });
      }

      results.push({
        name,
        id: char.id,
        now_et: `${nowETStr} ${dayNames[dayOfWeekET]}`,

        // All jobs found
        all_jobs: uniqueJobs.length > 0 ? uniqueJobs : 'NO JOBS FOUND',
        active_job_now: activeJobNow || 'NO ACTIVE JOB (not work hours or not work day)',

        // All travel flags
        travel_flags: travelFlags,

        // Travel session state
        session: session ? {
          id: session.id,
          status: session.route_status,
          travel_source: session.travel_source || 'unknown',
          origin_location: session.origin_location_name,
          destination: session.destination_location_name,
          destination_id: session.destination_location_id,
          eta: session.estimated_arrival_time,
          actual_arrival: session.actual_arrival_time,
          progress_percent: session.progress_percent,
        } : 'NO ACTIVE SESSION',

        // Character location
        character_location: {
          resolved_id: charLocId,
          resolved_name: charLocName,
          presence_status: charPresence,
          source_reason: travelFlags.resolved_source_reason,
        },

        // Consistency failures
        failures: failures.length > 0 ? failures : ['CONSISTENT — no failures detected'],
      });
    }

    return Response.json({
      timestamp: now.toISOString(),
      now_et: `${nowETStr} ${dayNames[dayOfWeekET]}`,
      results,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});