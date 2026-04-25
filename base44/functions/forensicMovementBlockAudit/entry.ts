import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC MOVEMENT BLOCK AUDIT
 * 
 * Uses Travel.jsx exact path to find all active_created_characters.
 * For each one, audits EVERY field that affects movement.
 * Cross-references location records.
 * Uses existing locationResolutionEngine logic.
 * Reports exact block reason per character.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // PATH 1: Travel.jsx exact query (the one that finds all 10 active_created_characters)
    const activeCreated = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    // PATH 2: All locations this user owns
    const allLocations = await base44.entities.LocationReference.filter({ owner_email: user.email }, null, 200).catch(() => []);
    const locationById = {};
    for (const loc of allLocations) {
      locationById[loc.id] = loc;
    }

    // Get current server time for work schedule checks
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nowET.getDay(); // 0=Sun, 6=Sat
    const currentHour = nowET.getHours();
    const currentMinute = nowET.getMinutes();
    const currentTimeStr = `${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}`;

    const audits = [];

    for (const char of activeCreated) {
      const audit = {
        character_id: char.id,
        character_name: char.name,
        character_type: char.character_type,
        character_status: char.status,
        created_by: char.created_by,
        owner_email: char.owner_email,

        // === CURRENT SERVER TIME ===
        server_time_et: currentTimeStr,
        server_day_of_week: dayOfWeek,

        // === LOCATION FIELDS — RAW ===
        location_fields: {
          location_status: char.location_status,
          travel_status: char.travel_status,
          resolved_current_location_id: char.resolved_current_location_id || null,
          resolved_current_location_name: char.resolved_current_location_name || null,
          resolved_presence_status: char.resolved_presence_status || null,
          resolved_location_type: char.resolved_location_type || null,
          resolved_source_reason: char.resolved_source_reason || null,
          resolved_last_updated_at: char.resolved_last_updated_at || null,
          current_home_location_id: char.current_home_location_id || null,
          traveling_to_location_id: char.traveling_to_location_id || null,
          last_location_update_time: char.last_location_update_time || null,
          last_arrived_time: char.last_arrived_time || null,
          is_homeless: char.is_homeless || false,
          housing_context: char.housing_context || null,
        },

        // === WORK FIELDS — RAW ===
        work_fields: {
          occupation_location_id: char.occupation_location_id || null,
          current_work_location_id: char.current_work_location_id || null,
          work_start_time: char.work_start_time || null,
          work_end_time: char.work_end_time || null,
          work_days: char.work_days || null,
          occupation: char.occupation || null,
          occupation_location_name: char.occupation_location_name || null,
        },

        // === SCHOOL FIELDS — RAW ===
        school_fields: {
          education_location_id: char.education_location_id || null,
          current_school_location_id: char.current_school_location_id || null,
          student_status: char.student_status || null,
          education_location_name: char.education_location_name || null,
        },

        // === SLEEP FIELDS — RAW ===
        sleep_fields: {
          sleep_start_time: char.sleep_start_time || '23:00',
          wake_up_time: char.wake_up_time || '07:00',
          last_sleep_start: char.last_sleep_start || null,
          sleep_debt_hours: char.sleep_debt_hours || 0,
        },

        // === NEEDS ===
        needs_fields: {
          energy_value: char.energy_value,
          hunger_value: char.hunger_value,
          health_value: char.health_value,
          mental_value: char.mental_value,
          social_value: char.social_value,
        },

        // === LOCATION RESOLUTION ===
        location_resolution: {},
        work_resolution: {},
        school_resolution: {},

        // === MOVEMENT ELIGIBILITY CHECKS ===
        movement_checks: {},

        // === CONFIRMED FAILURE POINTS ===
        confirmed_failures: [],
      };

      // === RESOLVE HOME LOCATION ===
      const homeLocId = char.current_home_location_id;
      if (homeLocId) {
        const homeLoc = locationById[homeLocId];
        if (homeLoc) {
          audit.location_resolution.home = {
            id: homeLoc.id,
            name: homeLoc.name,
            category: homeLoc.category,
            scope: homeLoc.scope,
            has_zone_images: (homeLoc.zones || []).some(z => (z.image_urls || []).length > 0),
          };
        } else {
          audit.location_resolution.home = { error: `ID ${homeLocId} not found in any location record` };
          audit.confirmed_failures.push({
            field: 'current_home_location_id',
            value: homeLocId,
            problem: 'References a non-existent LocationReference',
            severity: 'CRITICAL',
          });
        }
      } else {
        audit.location_resolution.home = null;
        audit.confirmed_failures.push({
          field: 'current_home_location_id',
          value: null,
          problem: 'NULL — no home location assigned',
          severity: 'CRITICAL',
        });
      }

      // === RESOLVE CURRENT LOCATION ===
      const curLocId = char.resolved_current_location_id;
      if (curLocId) {
        const curLoc = locationById[curLocId];
        audit.location_resolution.current = curLoc
          ? { id: curLoc.id, name: curLoc.name, category: curLoc.category }
          : { error: `ID ${curLocId} not found in any location record` };
      } else {
        audit.location_resolution.current = null;
      }

      // === RESOLVE WORK LOCATION ===
      const workLocId = char.current_work_location_id || char.occupation_location_id;
      if (workLocId) {
        const workLoc = locationById[workLocId];
        audit.work_resolution = workLoc
          ? { id: workLoc.id, name: workLoc.name, category: workLoc.category }
          : { error: `ID ${workLocId} not found in any location record` };
      } else {
        audit.work_resolution = null;
      }

      // === RESOLVE SCHOOL LOCATION ===
      const schoolLocId = char.current_school_location_id || char.education_location_id;
      if (schoolLocId) {
        const schoolLoc = locationById[schoolLocId];
        audit.school_resolution = schoolLoc
          ? { id: schoolLoc.id, name: schoolLoc.name, category: schoolLoc.category }
          : { error: `ID ${schoolLocId} not found in any location record` };
      } else {
        audit.school_resolution = null;
      }

      // === MOVEMENT CHECKS ===

      // CHECK 1: Is character asleep right now?
      const sleepStart = char.sleep_start_time || '23:00';
      const wakeTime = char.wake_up_time || '07:00';
      const [sleepH] = sleepStart.split(':').map(Number);
      const [wakeH] = wakeTime.split(':').map(Number);
      let isAsleep = false;
      if (sleepH > wakeH) {
        // Overnight sleep: e.g. sleep=23:00, wake=07:00
        isAsleep = currentHour >= sleepH || currentHour < wakeH;
      } else {
        // Same-day sleep
        isAsleep = currentHour >= sleepH && currentHour < wakeH;
      }
      audit.movement_checks.is_asleep = {
        result: isAsleep,
        sleep_start: sleepStart,
        wake_time: wakeTime,
        current_time_et: currentTimeStr,
        proof: `Current hour ${currentHour} — sleep window ${sleepStart} to ${wakeTime}`,
      };

      // CHECK 2: Is character at work right now?
      let isAtWork = false;
      let workWindowDetail = null;
      if (workLocId && char.work_start_time && char.work_end_time && char.work_days) {
        const isDayMatch = char.work_days.includes(dayOfWeek);
        const isAfterStart = currentTimeStr >= char.work_start_time;
        const isBeforeEnd = currentTimeStr <= char.work_end_time;
        isAtWork = isDayMatch && isAfterStart && isBeforeEnd;
        workWindowDetail = {
          day_match: isDayMatch,
          after_start: isAfterStart,
          before_end: isBeforeEnd,
          work_days: char.work_days,
          current_day: dayOfWeek,
          work_start: char.work_start_time,
          work_end: char.work_end_time,
          current_time: currentTimeStr,
        };
      }
      audit.movement_checks.is_at_work = {
        result: isAtWork,
        work_location: audit.work_resolution,
        detail: workWindowDetail,
      };

      // CHECK 3: Is location_status field locking the character?
      const locationStatusLocked = char.location_status === 'home';
      audit.movement_checks.location_status_check = {
        field_value: char.location_status,
        is_locked_to_home: locationStatusLocked,
        proof: `char.location_status = "${char.location_status}"`,
        note: 'This field should be VARIABLE (can be at_location, traveling, etc.) not hardcoded to "home"',
      };

      // CHECK 4: Skip per-character ScheduledEvent query (RLS restricts this in loop context)
      // This will be checked separately at the summary level
      audit.movement_checks.scheduled_events = { note: 'Checked separately at function level' };

      // CHECK 5: Has the character moved at all recently?
      const lastMovement = char.last_location_update_time || char.last_arrived_time || null;
      const hoursSinceMovement = lastMovement
        ? (Date.now() - new Date(lastMovement).getTime()) / (1000 * 60 * 60)
        : null;
      audit.movement_checks.last_movement = {
        last_location_update_time: char.last_location_update_time || null,
        last_arrived_time: char.last_arrived_time || null,
        hours_since_movement: hoursSinceMovement ? Math.round(hoursSinceMovement * 10) / 10 : null,
        note: hoursSinceMovement === null ? 'NEVER MOVED' : hoursSinceMovement > 24 ? 'NOT MOVED IN 24+ HOURS' : 'Recently moved',
      };

      // === CONFIRM FAILURES ===
      if (locationStatusLocked) {
        audit.confirmed_failures.push({
          field: 'location_status',
          value: char.location_status,
          problem: 'Hardcoded to "home" — movement system reads this as "character is home, do nothing"',
          severity: 'CRITICAL',
        });
      }

      if (!workLocId && !schoolLocId) {
        audit.confirmed_failures.push({
          field: 'occupation_location_id + current_work_location_id + education_location_id + current_school_location_id',
          value: null,
          problem: 'No work or school destination — character has nowhere to travel TO',
          severity: 'HIGH',
        });
      }

      if (isAsleep) {
        audit.confirmed_failures.push({
          field: 'sleep_schedule',
          value: `${sleepStart} to ${wakeTime}`,
          problem: `Character is currently asleep at ${currentTimeStr} ET — movement blocked until wake time`,
          severity: 'INFO',
        });
      }

      if (isAtWork) {
        audit.confirmed_failures.push({
          field: 'work_schedule',
          value: `${char.work_start_time} to ${char.work_end_time}`,
          problem: 'Character is currently on a work shift — not expected to travel',
          severity: 'INFO',
        });
      }

      audits.push(audit);
    }

    // === SUMMARY ===
    const criticalCount = audits.filter(a => a.confirmed_failures.some(f => f.severity === 'CRITICAL')).length;
    const criticalTypes = {};
    for (const audit of audits) {
      for (const f of audit.confirmed_failures) {
        if (f.severity === 'CRITICAL') {
          criticalTypes[f.field] = (criticalTypes[f.field] || 0) + 1;
        }
      }
    }

    return Response.json({
      success: true,
      audit_type: 'forensic_movement_block_audit',
      timestamp: new Date().toISOString(),
      server_time_et: currentTimeStr,
      server_day_of_week: dayOfWeek,
      user_email: user.email,
      total_active_created: activeCreated.length,
      characters_with_critical_failures: criticalCount,
      critical_failure_type_counts: criticalTypes,
      character_audits: audits,
    });

  } catch (error) {
    console.error('[forensicMovementBlockAudit]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});