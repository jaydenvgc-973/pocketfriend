import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── SCHOOL SCHEDULE RESOLUTION (mirrors src/lib/schoolScheduleResolver.js) ──
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function resolveSchoolSchedule(character, dayOfWeek, schoolLoc) {
  if (!character || character.student_status !== 'enrolled') {
    return { startMin: null, endMin: null, source: 'not_enrolled' };
  }

  // PRIORITY 1: Enrollment override times on character
  if (Array.isArray(character.education_enrollments) && character.education_enrollments.length > 0) {
    const active = character.education_enrollments.find(e => e.status === 'active' && e.start_time);
    if (active && active.start_time && active.end_time) {
      const s = toMinutes(active.start_time);
      const e = toMinutes(active.end_time);
      if (s !== null && e !== null) {
        return { startMin: s, endMin: e, source: 'enrollment_override' };
      }
    }
  }

  // PRIORITY 2: School location operating hours
  if (schoolLoc && schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours) && schoolLoc.operating_hours.length > 0) {
    const todayEntries = schoolLoc.operating_hours.filter(h => h.day_of_week != null && h.day_of_week === dayOfWeek);
    const dayAgnosticEntries = schoolLoc.operating_hours.filter(h => h.day_of_week == null);

    if (todayEntries.length > 0) {
      const entry = todayEntries[0];
      const s = toMinutes(entry.open_time);
      const e = toMinutes(entry.close_time);
      if (s !== null && e !== null) {
        return { startMin: s, endMin: e, source: 'school_location_hours' };
      }
    }

    if (dayAgnosticEntries.length > 0) {
      const entry = dayAgnosticEntries[0];
      const s = toMinutes(entry.open_time);
      const e = toMinutes(entry.close_time);
      if (s !== null && e !== null) {
        return { startMin: s, endMin: e, source: 'school_location_hours_day_agnostic' };
      }
    }
  }

  return { startMin: null, endMin: null, source: 'school_schedule_unresolved' };
}

function getMinutesUntilNextSchoolStart(startMin, nowMin, dayOfWeek, schoolLoc) {
  if (startMin === null) return null;

  let validDays = null;
  if (schoolLoc && schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours)) {
    const daySpecific = schoolLoc.operating_hours.filter(h => h.day_of_week != null);
    if (daySpecific.length > 0) {
      validDays = daySpecific.map(h => h.day_of_week);
    }
  }

  for (let offset = 0; offset < 8; offset++) {
    const checkDay = (dayOfWeek + offset) % 7;
    if (validDays && !validDays.includes(checkDay)) continue;

    if (offset === 0) {
      if (startMin <= nowMin) continue;
      return startMin - nowMin;
    } else {
      return (1440 - nowMin) + ((offset - 1) * 1440) + startMin;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { characterId, character_id, expected_occurrence_time, event } = body;
    const targetCharId = characterId || character_id || event?.entity_id;

    // Eastern Time
    const now = new Date();
    const etStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
    });
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const etParsed = etStr.match(/(\w+),\s*(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
    const nowMin = (parseInt(etParsed[5]) % 24) * 60 + parseInt(etParsed[6]);
    const dayOfWeek = wdMap[etParsed[1]];

    // ── SINGLE-CHARACTER MODE ──
    if (targetCharId) {
      const chars = await base44.asServiceRole.entities.Character.filter({ id: targetCharId }, null, 1);
      const char = chars?.[0];
      if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

      if (char.student_status !== 'enrolled') {
        return Response.json({ updated: false, reason: 'not_enrolled', next_execution_time: null });
      }

      const schoolLocId = char.education_location_id || char.current_school_location_id;
      let schoolLoc = null;
      if (schoolLocId) {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: schoolLocId }, null, 1);
        schoolLoc = locs?.[0] || null;
      }

      const schedule = resolveSchoolSchedule(char, dayOfWeek, schoolLoc);
      if (schedule.startMin === null) {
        return Response.json({ updated: false, reason: 'school_schedule_unresolved', next_execution_time: null });
      }

      // Check day-of-week validity from operating hours
      let isValidDay = true;
      if (schoolLoc && schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours)) {
        const daySpecific = schoolLoc.operating_hours.filter(h => h.day_of_week != null);
        if (daySpecific.length > 0) {
          isValidDay = daySpecific.some(h => h.day_of_week === dayOfWeek);
        }
      }

      const isSchoolInSession = isValidDay && nowMin >= schedule.startMin && nowMin < schedule.endMin;
      const isAtSchool = char.resolved_presence_status === 'at_school';

      // Compute next execution time BEFORE transition (for stale-occurrence validation)
      let nextExecutionTime = null;
      if (isSchoolInSession && schedule.endMin !== null) {
        let minsToEnd = schedule.endMin - nowMin;
        if (minsToEnd <= 0) minsToEnd += 1440;
        nextExecutionTime = new Date(now.getTime() + minsToEnd * 60 * 1000).toISOString();
      } else if (schedule.startMin !== null) {
        const minsToStart = getMinutesUntilNextSchoolStart(schedule.startMin, nowMin, dayOfWeek, schoolLoc);
        if (minsToStart !== null) {
          nextExecutionTime = new Date(now.getTime() + minsToStart * 60 * 1000).toISOString();
        }
      }

      // ── STALE-OCCURRENCE VALIDATION ──────────────────────────────────────
      // When a Workflow instance supplies an expected_occurrence_time, verify it is
      // still valid under the current authoritative school schedule BEFORE committing
      // any transition. This prevents stale Workflow instances from executing after a
      // schedule change. The validation converts the expected occurrence to Eastern
      // Time and checks whether the current school schedule has a boundary (start or
      // end) at that exact ET time on that day.
      if (expected_occurrence_time) {
        const _expectedDate = new Date(expected_occurrence_time);
        const _expEtStr = _expectedDate.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false
        });
        const _expWdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const _expParsed = _expEtStr.match(/(\w+),\s*(\d+)\/(\d+)\/(\d+),?\s*(\d+):(\d+)/);
        const _expMin = (parseInt(_expParsed[5]) % 24) * 60 + parseInt(_expParsed[6]);
        const _expDay = _expWdMap[_expParsed[1]];
        const _expSchedule = resolveSchoolSchedule(char, _expDay, schoolLoc);
        if (_expSchedule.startMin === null) {
          return Response.json({ updated: false, reason: 'stale_occurrence_superseded', expected_occurrence_time, next_execution_time: null });
        }
        let _expIsValidDay = true;
        if (schoolLoc && schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours)) {
          const _daySpecific = schoolLoc.operating_hours.filter(h => h.day_of_week != null);
          if (_daySpecific.length > 0) {
            _expIsValidDay = _daySpecific.some(h => h.day_of_week === _expDay);
          }
        }
        if (!((_expSchedule.startMin === _expMin || _expSchedule.endMin === _expMin) && _expIsValidDay)) {
          return Response.json({ updated: false, reason: 'stale_occurrence_superseded', expected_occurrence_time, next_execution_time: null });
        }
      }

      let updated = false;
      let routeResult = null;

      if (isSchoolInSession && !isAtSchool) {
        // Route to school through the canonical writer
        try {
          const invokeRes = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
            character_id: targetCharId,
            owner_email: char.owner_email,
            requested_presence_status: 'at_school',
            requested_location_id: schoolLocId,
            requested_source_reason: 'school_schedule',
            requested_authority: 'enforceCharacterSchoolSchedule',
            requested_timestamp: now.toISOString(),
          });
          routeResult = invokeRes?.data || invokeRes;
          updated = routeResult?.disposition === 'accepted' || routeResult?.disposition === 'redirected' || routeResult?.disposition === 'modified';
        } catch (invokeErr) {
          return Response.json({ updated: false, reason: 'authority_invoke_failed', error: invokeErr.message, next_execution_time: null });
        }
      } else if (!isSchoolInSession && isAtSchool) {
        // School ended — route home through the canonical writer
        const homeLocId = char.current_home_location_id;
        if (homeLocId) {
          try {
            const invokeRes = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
              character_id: targetCharId,
              owner_email: char.owner_email,
              requested_presence_status: 'home',
              requested_location_id: homeLocId,
              requested_source_reason: 'school_end',
              requested_authority: 'enforceCharacterSchoolSchedule',
              requested_timestamp: now.toISOString(),
            });
            routeResult = invokeRes?.data || invokeRes;
            updated = routeResult?.disposition === 'accepted' || routeResult?.disposition === 'redirected';
          } catch (invokeErr) {
            return Response.json({ updated: false, reason: 'authority_invoke_failed', error: invokeErr.message, next_execution_time: null });
          }
        }
      }

      return Response.json({
        updated,
        reason: updated
          ? (isSchoolInSession ? 'Routed to school (via authority)' : 'Routed home from school (via authority)')
          : (isSchoolInSession ? 'School in session' : 'School not in session'),
        schedule_source: schedule.source,
        disposition: routeResult?.disposition || null,
        next_execution_time: nextExecutionTime,
      });
    }

    // ── GLOBAL MODE (batch) ──
    const allChars = await base44.asServiceRole.entities.Character.filter({
      character_type: 'active_created_character',
      status: 'active',
      student_status: 'enrolled'
    });

    const results = [];
    for (const char of allChars) {
      const schoolLocId = char.education_location_id || char.current_school_location_id;
      let schoolLoc = null;
      if (schoolLocId) {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: schoolLocId }, null, 1);
        schoolLoc = locs?.[0] || null;
      }

      const schedule = resolveSchoolSchedule(char, dayOfWeek, schoolLoc);
      if (schedule.startMin === null) continue;

      let isValidDay = true;
      if (schoolLoc && schoolLoc.operating_hours && Array.isArray(schoolLoc.operating_hours)) {
        const daySpecific = schoolLoc.operating_hours.filter(h => h.day_of_week != null);
        if (daySpecific.length > 0) {
          isValidDay = daySpecific.some(h => h.day_of_week === dayOfWeek);
        }
      }

      const isSchoolInSession = isValidDay && nowMin >= schedule.startMin && nowMin < schedule.endMin;

      let nextExecutionTime = null;
      if (isSchoolInSession && schedule.endMin !== null) {
        let minsToEnd = schedule.endMin - nowMin;
        if (minsToEnd <= 0) minsToEnd += 1440;
        nextExecutionTime = new Date(now.getTime() + minsToEnd * 60 * 1000).toISOString();
      } else if (schedule.startMin !== null) {
        const minsToStart = getMinutesUntilNextSchoolStart(schedule.startMin, nowMin, dayOfWeek, schoolLoc);
        if (minsToStart !== null) {
          nextExecutionTime = new Date(now.getTime() + minsToStart * 60 * 1000).toISOString();
        }
      }

      results.push({
        character_id: char.id,
        character_name: char.name,
        at_school: isSchoolInSession,
        schedule_source: schedule.source,
        next_execution_time: nextExecutionTime,
      });
    }

    return Response.json({
      summary: `Processed ${results.length} enrolled students`,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});