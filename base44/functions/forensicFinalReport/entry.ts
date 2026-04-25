import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC FINAL REPORT — Compact output per character
 * Full field state. Exact failure points. No truncation.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const activeCreated = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    const allLocations = await base44.entities.LocationReference.filter({ owner_email: user.email }, null, 200).catch(() => []);
    const locationById = {};
    for (const loc of allLocations) {
      locationById[loc.id] = loc;
    }

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nowET.getDay();
    const currentHour = nowET.getHours();
    const currentTimeStr = `${String(currentHour).padStart(2,'0')}:${String(nowET.getMinutes()).padStart(2,'0')}`;

    const reports = [];

    for (const char of activeCreated) {
      const homeLocId = char.current_home_location_id;
      const homeLoc = homeLocId ? locationById[homeLocId] : null;
      const workLocId = char.current_work_location_id || char.occupation_location_id;
      const workLoc = workLocId ? locationById[workLocId] : null;
      const schoolLocId = char.current_school_location_id || char.education_location_id;
      const schoolLoc = schoolLocId ? locationById[schoolLocId] : null;
      const curLoc = char.resolved_current_location_id ? locationById[char.resolved_current_location_id] : null;

      // Sleep check
      const sleepStart = char.sleep_start_time || '23:00';
      const wakeTime = char.wake_up_time || '07:00';
      const [sleepH] = sleepStart.split(':').map(Number);
      const [wakeH] = wakeTime.split(':').map(Number);
      let isAsleep = sleepH > wakeH
        ? (currentHour >= sleepH || currentHour < wakeH)
        : (currentHour >= sleepH && currentHour < wakeH);

      // Work check
      let isAtWork = false;
      if (workLocId && char.work_start_time && char.work_end_time && char.work_days) {
        isAtWork = char.work_days.includes(dayOfWeek) &&
          currentTimeStr >= char.work_start_time &&
          currentTimeStr <= char.work_end_time;
      }

      const failures = [];

      if (!homeLocId) failures.push({ severity: 'CRITICAL', field: 'current_home_location_id', val: null, reason: 'NULL — no home assigned, character cannot be tracked to any location' });
      if (homeLocId && !homeLoc) failures.push({ severity: 'CRITICAL', field: 'current_home_location_id', val: homeLocId, reason: 'ID exists but LocationReference record NOT FOUND' });
      if (char.location_status === 'home') failures.push({ severity: 'CRITICAL', field: 'location_status', val: 'home', reason: 'Hardcoded to "home" — scheduler treats this as "at rest, skip"' });
      if (!workLocId && !schoolLocId) failures.push({ severity: 'HIGH', field: 'work+school', val: null, reason: 'No destinations — no work or school location configured' });
      if (workLocId && !workLoc) failures.push({ severity: 'HIGH', field: 'occupation_location_id', val: workLocId, reason: 'Work location ID does not exist in LocationReference' });
      if (schoolLocId && !schoolLoc) failures.push({ severity: 'HIGH', field: 'education_location_id', val: schoolLocId, reason: 'School location ID does not exist in LocationReference' });
      if (isAsleep) failures.push({ severity: 'INFO', field: 'sleep', val: sleepStart, reason: `Currently asleep at ${currentTimeStr} ET` });
      if (isAtWork) failures.push({ severity: 'INFO', field: 'work_schedule', val: char.work_start_time, reason: `Currently on work shift at ${currentTimeStr} ET` });

      reports.push({
        name: char.name,
        id: char.id,
        location_status_field: char.location_status,
        current_home_location_id: homeLocId || null,
        home_resolved: homeLoc ? homeLoc.name : (homeLocId ? 'ID_NOT_FOUND' : 'NO_HOME'),
        resolved_current_location_id: char.resolved_current_location_id || null,
        resolved_current_location_name: char.resolved_current_location_name || null,
        current_location_resolved: curLoc ? curLoc.name : (char.resolved_current_location_id ? 'ID_NOT_FOUND' : 'NONE'),
        work_location_id: workLocId || null,
        work_location_resolved: workLoc ? workLoc.name : (workLocId ? 'ID_NOT_FOUND' : 'NO_WORK'),
        work_schedule: char.work_start_time ? `${char.work_start_time}–${char.work_end_time} days=${(char.work_days||[]).join(',')}` : null,
        school_location_id: schoolLocId || null,
        school_location_resolved: schoolLoc ? schoolLoc.name : (schoolLocId ? 'ID_NOT_FOUND' : 'NO_SCHOOL'),
        sleep_schedule: `${sleepStart}–${wakeTime}`,
        is_asleep_now: isAsleep,
        is_at_work_now: isAtWork,
        travel_status: char.travel_status,
        last_location_update: char.last_location_update_time || 'NEVER',
        confirmed_failures: failures,
        failure_count: failures.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
      });
    }

    const criticalFailureMap = {};
    for (const r of reports) {
      for (const f of r.confirmed_failures) {
        if (f.severity === 'CRITICAL') {
          if (!criticalFailureMap[f.field]) criticalFailureMap[f.field] = [];
          criticalFailureMap[f.field].push(r.name);
        }
      }
    }

    return Response.json({
      success: true,
      report_type: 'forensic_final_report',
      timestamp: new Date().toISOString(),
      server_time_et: currentTimeStr,
      server_day_of_week: dayOfWeek,
      user_email: user.email,
      total_active_created: reports.length,
      characters_with_critical_failures: reports.filter(r => r.confirmed_failures.some(f => f.severity === 'CRITICAL')).length,
      critical_failures_by_field: criticalFailureMap,
      per_character_reports: reports,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});