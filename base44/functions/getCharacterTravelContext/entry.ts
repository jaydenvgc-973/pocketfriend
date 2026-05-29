/**
 * getCharacterTravelContext
 *
 * Returns a compact last-24-hour travel/location summary for a character.
 * Used by buildCanonicalCharacterContext to inject "what did you do today" awareness.
 *
 * SOURCE PRIORITY ORDER:
 * 1. LocationHistory entity (most authoritative — explicit arrival/departure events)
 * 2. TravelSession (route_status=arrived, arrival within 24h)
 * 3. AutomaticNarrative (travel/work/school event types within 24h)
 * 4. Character schedule fields (work_start_time + work_days) — derives what SHOULD have happened today
 * 5. Character presence + resolved location — current state only
 *
 * Payload:
 *   characterId   string — Character ID (required)
 *   ownerEmail    string — Owner email for scoping (required)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime(isoOrDate) {
  if (!isoOrDate) return null;
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
}

function isWithin24h(isoStr) {
  if (!isoStr) return false;
  const ts = new Date(isoStr).getTime();
  return ts >= Date.now() - 24 * 60 * 60 * 1000 && ts <= Date.now() + 5 * 60 * 1000;
}

function getEventLabel(eventType) {
  const labels = {
    arrival: 'Arrived at',
    departure: 'Left',
    return_home: 'Returned home',
    work_start: 'Started work at',
    work_end: 'Left work at',
    school_start: 'Started school at',
    school_end: 'Left school at',
    religious_service: 'Attended service at',
    food_need: 'Ate at',
    social_visit: 'Visited',
    gym_visit: 'Went to the gym at',
    transit: 'In transit through',
    stay: 'Stayed at',
    other: 'Visited',
  };
  return labels[eventType] || 'Visited';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Must be called with an authenticated user — character context always has one.
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, ownerEmail } = await req.json();

    if (!characterId || !ownerEmail) {
      return Response.json({ error: 'characterId and ownerEmail required' }, { status: 400 });
    }

    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const todayDay = now.getDay(); // 0=Sun, 6=Sat
    const todayStr = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York'
    });

    // Fetch all sources in parallel — user-scoped (RLS-respecting)
    const [locationHistory, travelSessions, narratives, characterArr] = await Promise.all([
      // LocationHistory: user-scoped read (RLS = owner_email match)
      base44.entities.LocationHistory.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-arrival_time', 30
      ).catch(() => []),

      // TravelSession: user-scoped
      base44.entities.TravelSession.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-created_at', 20
      ).catch(() => []),

      // AutomaticNarrative: user-scoped
      base44.entities.AutomaticNarrative.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-timestamp', 20
      ).catch(() => []),

      // Character: user-scoped for full field access
      base44.entities.Character.filter({ id: characterId }).catch(() => []),
    ]);

    const character = characterArr[0] || null;
    const summaryLines = [];
    let sourceUsed = 'none';

    // ── SOURCE 1: LocationHistory ─────────────────────────────────────────────
    const recentHistory = locationHistory.filter(h => isWithin24h(h.arrival_time));
    if (recentHistory.length > 0) {
      sourceUsed = 'LocationHistory';
      for (const h of recentHistory) {
        const arrTime = formatTime(h.arrival_time);
        const depTime = h.departure_time ? formatTime(h.departure_time) : null;
        const timeStr = depTime
          ? `${arrTime}–${depTime}`
          : (h.is_current ? `${arrTime} (still there)` : arrTime);
        const label = getEventLabel(h.event_type);
        const reason = h.travel_reason ? ` [${h.travel_reason}]` : (h.travel_source ? ` [${h.travel_source}]` : '');
        summaryLines.push(`- ${label} ${h.location_name} at ${timeStr}${reason}`);
      }
    }

    // ── SOURCE 2: TravelSession ────────────────────────────────────────────────
    if (summaryLines.length === 0) {
      const recentSessions = travelSessions.filter(s => {
        const arrTime = s.actual_arrival_time || s.estimated_arrival_time;
        return arrTime && isWithin24h(arrTime) && s.route_status === 'arrived';
      });

      if (recentSessions.length > 0) {
        sourceUsed = 'TravelSession';
        for (const s of recentSessions) {
          const arrTime = formatTime(s.actual_arrival_time || s.estimated_arrival_time);
          const depTime = s.estimated_departure_time ? formatTime(s.estimated_departure_time) : null;
          const reason = s.travel_reason || s.travel_source || '';
          const reasonStr = reason ? ` [${reason}]` : '';
          const timeStr = depTime ? `${depTime}→arrived ${arrTime}` : `arrived ${arrTime}`;
          summaryLines.push(`- Traveled to ${s.destination_location_name} (${timeStr}${reasonStr})`);
        }
      }
    }

    // ── SOURCE 3: AutomaticNarrative ──────────────────────────────────────────
    if (summaryLines.length === 0) {
      const travelNarrTypes = new Set([
        'travel_arrival', 'travel_departure', 'work_start', 'work_end',
        'school_start', 'school_end', 'location_change'
      ]);
      const recentNarrs = narratives.filter(n =>
        isWithin24h(n.timestamp) && travelNarrTypes.has(n.event_type)
      );

      if (recentNarrs.length > 0) {
        sourceUsed = 'AutomaticNarrative';
        for (const n of recentNarrs) {
          const ts = formatTime(n.timestamp);
          const loc = n.location_name || 'a location';
          const typeLabel = n.event_type.replace(/_/g, ' ');
          summaryLines.push(`- ${typeLabel} at ${loc} (${ts})`);
        }
      }
    }

    // ── SOURCE 4: Schedule + presence inference ────────────────────────────────
    // Derive from character's known schedule when no movement records exist.
    // This is the critical fix for "I slept all day" false answers.
    if (character && summaryLines.length === 0) {
      const workDays = Array.isArray(character.work_days) ? character.work_days : [];
      const workStartTime = character.work_start_time || null;
      const workEndTime = character.work_end_time || null;
      const workLocationName = character.occupation_location_name
        || character.work_details?.location_name
        || character.occupation_location_id
        || null;
      const schoolLocationName = character.education_location_name || null;
      const presenceStatus = character.resolved_presence_status || '';
      const currentLocationName = character.resolved_current_location_name || '';
      const hasWorkToday = workDays.includes(todayDay);

      // Current ET hour
      const etHourStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric', hour12: false, timeZone: 'America/New_York'
      });
      const etHour = parseInt(etHourStr, 10);

      const inferred = [];

      if (hasWorkToday && workStartTime && workLocationName) {
        const [wStartH, wStartM = 0] = workStartTime.split(':').map(Number);
        const workStartedAlready = etHour > wStartH || (etHour === wStartH && now.getMinutes() >= wStartM);

        if (workStartedAlready) {
          if (workEndTime) {
            const [wEndH] = workEndTime.split(':').map(Number);
            const workEnded = etHour >= wEndH;
            if (workEnded) {
              inferred.push(`- Completed work shift at ${workLocationName} today (${workStartTime}–${workEndTime})`);
              inferred.push(`  (returned home or moved elsewhere after ${workEndTime})`);
            } else {
              inferred.push(`- Currently at work: ${workLocationName} (started ${workStartTime}, shift ends ${workEndTime})`);
            }
          } else {
            inferred.push(`- At work today: ${workLocationName} (started around ${workStartTime})`);
          }
        }
      }

      if (schoolLocationName && character.student_status === 'enrolled') {
        if (!inferred.some(l => l.includes(schoolLocationName))) {
          inferred.push(`- Enrolled at ${schoolLocationName} — likely attended classes today`);
        }
      }

      if (presenceStatus === 'at_work' && currentLocationName) {
        if (!inferred.some(l => l.includes(currentLocationName))) {
          inferred.push(`- Currently at work: ${currentLocationName}`);
        }
      } else if (presenceStatus === 'at_school' && currentLocationName) {
        if (!inferred.some(l => l.includes(currentLocationName))) {
          inferred.push(`- Currently at school: ${currentLocationName}`);
        }
      } else if ((presenceStatus === 'sleeping' || presenceStatus === 'napping') && character.last_sleep_start) {
        const sleepTime = formatTime(character.last_sleep_start);
        inferred.push(`- Currently sleeping (started ${sleepTime})`);
      } else if (currentLocationName && presenceStatus !== 'home') {
        inferred.push(`- Currently at: ${currentLocationName}`);
      }

      if (inferred.length > 0) {
        sourceUsed = 'schedule_inference';
        summaryLines.push(...inferred);
      }
    }

    // ── BUILD CONTEXT BLOCK ────────────────────────────────────────────────────
    const wasHomeAllDay = summaryLines.length === 0;
    const charName = character?.name || 'This character';

    let contextBlock = '';
    if (wasHomeAllDay) {
      const isSleeping = ['sleeping', 'napping'].includes(character?.resolved_presence_status || '');
      if (isSleeping && character?.last_sleep_start) {
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No travel recorded. ${charName} is currently sleeping (started ${formatTime(character.last_sleep_start)}). No movement records exist for today — do not claim activity that cannot be confirmed.`;
      } else {
        const workHint = character?.work_start_time && character?.occupation_location_name
          ? ` (schedule suggests work at ${character.occupation_location_name} starting ${character.work_start_time} on work days)`
          : '';
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No movement records found for ${charName} on ${todayStr}.${workHint}\n\nIMPORTANT: Do NOT say you slept all day if no sleep records confirm it. If asked what you did today, say you were around or reference your schedule — do not fabricate details.`;
      }
    } else {
      const prefix = sourceUsed === 'schedule_inference'
        ? `LOCATION CONTEXT (inferred from character schedule — no movement records yet for today):`
        : `LOCATION HISTORY (Last 24 Hours — source: ${sourceUsed}):`;

      contextBlock = `${prefix}\n${summaryLines.join('\n')}\n\nIMPORTANT: Use this when answering "what did you do today?", "where were you earlier?", "were you home all day?". Do NOT say you slept all day if work, school, or travel appears above.`;
    }

    return Response.json({
      success: true,
      characterId,
      characterName: character?.name || null,
      source_used: sourceUsed,
      has_history: !wasHomeAllDay,
      history_count: recentHistory.length,
      session_count: travelSessions.filter(s => isWithin24h(s.actual_arrival_time || s.estimated_arrival_time)).length,
      summary_lines: summaryLines,
      context_block: contextBlock,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});