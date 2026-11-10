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

      // ── RECURRING BOUNDARY RECORD ──────────────────────────────────────────
      // This record carries the schedule's own next established boundary. A run that
      // wakes on a boundary recomputes the following one and writes it here, which
      // hands that boundary to the next durable run. The schedule therefore carries
      // its own recurrence: nothing is polled, and no unrelated event is required.
      const _leaseRows = await base44.asServiceRole.entities.ScheduleLoopLease
        .filter({ character_id: targetCharId, schedule_kind: 'school' }, '-created_date', 1)
        .catch(() => []);
      let _lease = _leaseRows?.[0] || null;
      if (!_lease) {
        _lease = await base44.asServiceRole.entities.ScheduleLoopLease.create({
          character_id: targetCharId,
          schedule_kind: 'school',
          owner_email: char.owner_email || null,
        }).catch(() => null);
      }
      // Boundary times are normalized to the minute so the same boundary is never
      // written twice, while a genuinely different one always advances the chain.
      const _boundaryKey = (iso) => {
        if (!iso) return null;
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        d.setSeconds(0, 0);
        return d.toISOString();
      };
      const _armNextBoundary = async (nextIso) => {
        const _next = _boundaryKey(nextIso);
        if (!_lease?.id || _lease.next_boundary_at === _next) return;
        await base44.asServiceRole.entities.ScheduleLoopLease
          .update(_lease.id, { next_boundary_at: _next })
          .catch(() => {});
        _lease.next_boundary_at = _next;
      };

      // ONE OCCURRENCE, ONE NARRATIVE — keyed to the completed occurrence itself
      // (its own Eastern day and end time), never to a span of clock time. A repeat
      // delivery of that same occurrence is skipped; a different occurrence is
      // always delivered.
      const _etDay = (d) => new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(d);
      const _minToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const _deliverSchoolCompletion = async (occurrenceKey, eventType) => {
        if (_lease?.last_completion_occurrence === occurrenceKey) {
          return { success: false, skipped: true, reason: 'occurrence_already_delivered', occurrence: occurrenceKey };
        }
        let res = null;
        try {
          const r = await base44.asServiceRole.functions.invoke('generateAutomaticNarrative', {
            characterId: targetCharId,
            forceGenerate: true,
            narrative_trigger: eventType,
            completion_event: eventType,
          });
          res = r?.data || r || null;
        } catch (e) {
          res = { success: false, error: e.message };
        }
        if (res?.success === true && _lease?.id) {
          await base44.asServiceRole.entities.ScheduleLoopLease
            .update(_lease.id, { last_completion_occurrence: occurrenceKey })
            .catch(() => {});
          _lease.last_completion_occurrence = occurrenceKey;
        }
        return res;
      };

      // Vacation Mode — temporary exemption from school attendance. Existing
      // school schedule and enrollment records remain intact; only enforcement
      // is skipped. The character remains free to travel and participate
      // normally. Switching Vacation Mode OFF resumes normal enforcement.
      if (char.vacation_mode === true) {
        return Response.json({ updated: false, reason: 'vacation_mode_active', next_execution_time: null });
      }

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
      await _armNextBoundary(nextExecutionTime);

      // ── STALE-OCCURRENCE VALIDATION ──────────────────────────────────────
      // When a Workflow instance supplies an expected_occurrence_time, verify it is
      // still valid under the current authoritative school schedule BEFORE committing
      // any transition. This prevents stale Workflow instances from executing after a
      // schedule change. The validation converts the expected occurrence to Eastern
      // Time and checks whether the current school schedule has a boundary (start or
      // end) at that exact ET time on that day.
      let _isEndBoundary = false;
      let _boundaryOccurrenceKey = null;
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
        // This run IS the school day's established end boundary, resolved from the
        // same enrollment/operating-hours schedule used for every school transition.
        _isEndBoundary = _expSchedule.endMin === _expMin;
        if (_isEndBoundary) {
          _boundaryOccurrenceKey = `school_end:${_expParsed[4]}-${_expParsed[2]}-${_expParsed[3]}:${_minToHHMM(_expSchedule.endMin)}`;
        }
      } else if (schedule.endMin !== null && isValidDay) {
        // ── THE BOUNDARY RUN IS THE COMPLETION EVENT ──────────────────────────
        // The durable schedule run lands exactly on the school day's established
        // end time. No expected occurrence was echoed back, so the completed school
        // day is read from the same authoritative schedule every school transition
        // uses: the end time is this minute (within scheduler-drift tolerance).
        // Location type is never a condition — the boundary is the trigger. A
        // repeated run in the same minute cannot double-write: the narrative
        // generator refuses a second narrative for the same completed occurrence.
        const SCHOOL_DRIFT_TOLERANCE_MIN = 2;
        let _endDrift = nowMin - schedule.endMin;
        if (_endDrift < 0) _endDrift += 1440;
        _isEndBoundary = _endDrift <= SCHOOL_DRIFT_TOLERANCE_MIN;
        if (_isEndBoundary) {
          _boundaryOccurrenceKey = `school_end:${_etDay(now)}:${_minToHHMM(schedule.endMin)}`;
        }
      }

      let updated = false;
      let routeResult = null;
      let _authorityError = null;
      let _committedHome = false;

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
          _authorityError = invokeErr.message;
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
            const _committedId = routeResult?.committed_result?.resolved_current_location_id || null;
            _committedHome = updated && !!_committedId && _committedId === homeLocId;
          } catch (invokeErr) {
            _authorityError = invokeErr.message;
          }
        }
      }

      // ── THE COMPLETED SCHOOL BOUNDARY IS THE TRIGGER ──────────────────────
      // The existing schedule mechanism has just established that this run IS the
      // school day's established end. That occurrence directly initiates the
      // existing automatic-narrative pathway — once. Nothing is polled, and no
      // location type gates it: a rabbit-hole destination, a workplace, a
      // residence, or any other location is equally valid. When this same
      // occurrence committed an actual home arrival, the narrative describes
      // that committed transition instead of a bare "classes ended".
      let _schoolEndNarrative = null;
      if (_isEndBoundary) {
        const _eventType = schedule.source === 'enrollment_override' ? 'class_end' : 'school_end';
        _schoolEndNarrative = await _deliverSchoolCompletion(_boundaryOccurrenceKey, _eventType);
        if (_schoolEndNarrative?.success !== true) {
          console.error(`[enforceCharacterSchoolSchedule] ${char.name}: school-end narrative FAILED at ${expected_occurrence_time} — ${_schoolEndNarrative?.error || _schoolEndNarrative?.reason || 'unknown'}`);
        } else {
          console.log(`[enforceCharacterSchoolSchedule] ${char.name}: school-end narrative generated (trigger=${_eventType}, id=${_schoolEndNarrative.narrativeId})`);
        }
      }

      if (_authorityError) {
        return Response.json({ updated: false, reason: 'authority_invoke_failed', error: _authorityError, school_end_narrative: _schoolEndNarrative, next_execution_time: null });
      }

      return Response.json({
        updated,
        reason: updated
          ? (isSchoolInSession ? 'Routed to school (via authority)' : 'Routed home from school (via authority)')
          : (isSchoolInSession ? 'School in session' : 'School not in session'),
        schedule_source: schedule.source,
        disposition: routeResult?.disposition || null,
        school_end_narrative: _schoolEndNarrative,
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
      // Vacation Mode — skip school enforcement for this character. Existing
      // enrollment and schedule remain intact; only enforcement is skipped.
      if (char.vacation_mode === true) continue;
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