import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── UTILITY: Build ISO datetime from date + optional time ──────────────────
function buildTimestamp(dateStr, timeStr, fallbackTime) {
  if (!dateStr) return null;
  const t = timeStr || fallbackTime || '12:00';
  return `${dateStr}T${t}:00.000`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventId = body.event_id;
    const titleFilter = body.title_contains;

    if (!eventId && !titleFilter) {
      return Response.json({ error: 'event_id or title_contains required' }, { status: 400 });
    }

    // ── FIND THE STORY EVENT ───────────────────────────────────────────────
    let event = null;
    if (eventId) {
      const records = await base44.asServiceRole.entities.StoryEvent.filter({ id: eventId }, null, 1);
      event = records[0];
    } else if (titleFilter) {
      const allEvents = await base44.asServiceRole.entities.StoryEvent.filter(
        { status: 'complete' }, '-created_date', 200
      );
      event = allEvents.find(e => {
        const t = (e.title || '').toLowerCase();
        return t.includes(titleFilter.toLowerCase());
      }) || null;
    }

    if (!event) {
      return Response.json({ error: 'StoryEvent not found' }, { status: 404 });
    }

    const title = event.title || 'Untitled';
    const eventDate = event.event_date;
    const startTime = event.start_time || '12:00';
    const endTime = event.end_time;
    const venueId = event.venue_id;
    const venueName = event.venue_name || 'Unknown venue';
    const ownerEmail = event.owner_email;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const focusNames = event.focus_character_names || [];
    const participantNames = event.participant_character_names || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];

    // Build name map from event data
    const nameById = {};
    for (let i = 0; i < allIds.length; i++) {
      const id = allIds[i];
      const focusIdx = focusIds.indexOf(id);
      if (focusIdx >= 0 && focusNames[focusIdx]) {
        nameById[id] = focusNames[focusIdx];
      } else {
        const partIdx = participantIds.indexOf(id);
        if (partIdx >= 0 && participantNames[partIdx]) {
          nameById[id] = participantNames[partIdx];
        }
      }
    }

    const arrivalTime = buildTimestamp(eventDate, startTime, '12:00');
    const departureTime = endTime
      ? buildTimestamp(eventDate, endTime, '14:00')
      : buildTimestamp(eventDate, '14:00', '14:00');

    let durationMinutes = null;
    if (arrivalTime && departureTime) {
      const arr = new Date(arrivalTime);
      const dep = new Date(departureTime);
      durationMinutes = Math.round((dep.getTime() - arr.getTime()) / 60000);
      if (durationMinutes < 0) durationMinutes = 120;
    }

    // ── LOAD EXISTING LOCATION HISTORY ─────────────────────────────────────
    const windowStart = arrivalTime ? new Date(arrivalTime).getTime() - 2 * 3600000 : null;
    const windowEnd = departureTime ? new Date(departureTime).getTime() + 2 * 3600000 : null;

    const locationHistoryByChar = {};
    try {
      const allOwnerLH = await base44.asServiceRole.entities.LocationHistory.filter(
        { owner_email: ownerEmail }, '-arrival_time', 500
      );
      for (const cid of allIds) {
        locationHistoryByChar[cid] = allOwnerLH.filter(lh => {
          if (lh.character_id !== cid) return false;
          if (!lh.arrival_time) return false;
          const arr = new Date(lh.arrival_time).getTime();
          const dep = lh.departure_time ? new Date(lh.departure_time).getTime() : arr + 2 * 3600000;
          if (windowStart && windowEnd) {
            return arr < windowEnd && dep > windowStart;
          }
          const arrDate = lh.arrival_time.split('T')[0];
          return arrDate === eventDate;
        });
      }
    } catch (_) {
      for (const cid of allIds) {
        locationHistoryByChar[cid] = [];
      }
    }

    // ── PER-PARTICIPANT ANALYSIS ───────────────────────────────────────────
    const results = [];
    const createdRecords = { location_history: [] };
    const conflictsFound = [];
    let totalExistingLH = 0;
    let totalCreatedLH = 0;

    for (const cid of allIds) {
      const cname = nameById[cid] || cid;
      const isFocus = focusIds.includes(cid);
      const lhRecords = locationHistoryByChar[cid] || [];

      const result = {
        character_id: cid,
        character_name: cname,
        is_focus: isFocus,
        // Individual system checks
        story_event_memory: { status: 'pending' },
        life_event: { status: 'pending' },
        memory: { status: 'pending' },
        character_memory: { status: 'pending' },
        char_memories_array: { status: 'pending' },
        event_participation: { status: 'pending' },
        location_history: { status: 'pending', existed_before: false, created_now: false },
        overall: 'pending',
      };

      // ── CHECK: Venue LocationHistory ────────────────────────────────────
      const venueLH = lhRecords.filter(lh => {
        const locMatch = venueId
          ? (lh.location_id === venueId)
          : (lh.location_name && lh.location_name.toLowerCase() === venueName.toLowerCase());
        return locMatch;
      });

      if (venueLH.length > 0) {
        result.location_history = { status: 'verified', existed_before: true, created_now: false, record_id: venueLH[0].id };
        totalExistingLH++;
      }

      // ── CHECK: Conflicting LocationHistory ──────────────────────────────
      const conflicts = lhRecords.filter(lh => {
        const locMatch = venueId
          ? (lh.location_id === venueId)
          : (lh.location_name && lh.location_name.toLowerCase() === venueName.toLowerCase());
        return !locMatch;
      });

      if (conflicts.length > 0 && venueLH.length === 0) {
        conflictsFound.push({
          character_name: cname,
          character_id: cid,
          conflicts: conflicts.map(lh => ({
            id: lh.id,
            location_name: lh.location_name || 'unknown',
            event_type: lh.event_type,
          })),
        });
      }

      // ── CREATE MISSING VENUE LOCATION HISTORY ──────────────────────────
      if (venueLH.length === 0) {
        try {
          const lhRecord = await base44.asServiceRole.entities.LocationHistory.create({
            character_id: cid,
            character_name: cname,
            owner_email: ownerEmail,
            location_id: venueId || null,
            location_name: venueName,
            location_category: 'social',
            event_type: 'social_visit',
            arrival_time: arrivalTime,
            departure_time: departureTime,
            duration_minutes: durationMinutes,
            travel_source: 'event',
            travel_reason: `Story Event: ${title}`,
            is_current: false,
            notes: `Attended "${title}" Story Event. Created by timeline repair.`,
          });
          result.location_history = { status: 'created', existed_before: false, created_now: true, record_id: lhRecord.id };
          createdRecords.location_history.push(lhRecord.id);
          totalCreatedLH++;
        } catch (e) {
          result.location_history = { status: 'failed', error: e.message };
        }
      }

      // ── CHECK OTHER CONNECTED SYSTEMS ──────────────────────────────────

      // StoryEventMemory
      try {
        const sems = await base44.asServiceRole.entities.StoryEventMemory.filter(
          { story_event_id: event.id, character_id: cid }, null, 5
        );
        result.story_event_memory = { status: sems.length > 0 ? 'verified' : 'missing' };
      } catch (e) {
        result.story_event_memory = { status: 'query_failed', error: e.message };
      }

      // LifeEvent
      try {
        const les = await base44.asServiceRole.entities.LifeEvent.filter(
          { character_id: cid, title: `Story Event: ${title}` }, null, 5
        );
        result.life_event = { status: les.length > 0 ? 'verified' : 'missing' };
      } catch (e) {
        result.life_event = { status: 'query_failed', error: e.message };
      }

      // Memory (chat retrieval)
      try {
        const mems = await base44.asServiceRole.entities.Memory.filter(
          { character_id: cid, source_context: `story_event_${event.id}` }, null, 5
        );
        result.memory = { status: mems.length > 0 ? 'verified' : 'missing' };
      } catch (e) {
        result.memory = { status: 'query_failed', error: e.message };
      }

      // CharacterMemory — fetch all for character, filter locally (avoids $contains query issue)
      try {
        const allCms = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: cid }, null, 50
        );
        const matching = allCms.filter(cm =>
          (cm.memory_text || '').includes(`Story Event: ${title}`)
        );
        result.character_memory = { status: matching.length > 0 ? 'verified' : 'missing' };
      } catch (e) {
        result.character_memory = { status: 'query_failed', error: e.message };
      }

      // Character.memories array — attempt direct Character entity query
      // Report honestly: inference is NOT proof
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        const fresh = freshChars[0];
        if (fresh) {
          const existing = (fresh.memories || []);
          const already = existing.find(m => m.title === `Story Event: ${title}`);
          result.char_memories_array = { status: already ? 'verified' : 'missing' };
        } else {
          result.char_memories_array = { status: 'query_failed', error: 'Character filter returned empty' };
        }
      } catch (e) {
        result.char_memories_array = { status: 'query_failed', error: e.message };
      }

      // EventParticipation
      try {
        const eps = await base44.asServiceRole.entities.EventParticipation.filter(
          { character_id: cid, event_id: event.id }, null, 5
        );
        result.event_participation = { status: eps.length > 0 ? 'verified' : 'missing' };
      } catch (e) {
        result.event_participation = { status: 'query_failed', error: e.message };
      }

      // ── DETERMINE OVERALL STATUS ─────────────────────────────────────────
      // Clear status definitions:
      //   coherent: ALL required systems verified (including character_memory + char_memories_array)
      //   repaired_partial: LocationHistory created now, but some systems unverified/missing/query_failed
      //   partial: LocationHistory existed before, but some systems unverified/missing/query_failed
      //   missing_timeline: LocationHistory missing (no venue record exists)
      //   conflict: Memory says attended but timeline says otherwise
      //   blocked: Character state prevented attendance

      const hasLocationHistory = result.location_history.status === 'verified' || result.location_history.status === 'created';
      const locationHistoryCreated = result.location_history.status === 'created';

      // ALL seven systems must be verified for coherent status
      const allVerified = hasLocationHistory &&
        result.story_event_memory.status === 'verified' &&
        result.life_event.status === 'verified' &&
        result.memory.status === 'verified' &&
        result.character_memory.status === 'verified' &&
        result.char_memories_array.status === 'verified' &&
        result.event_participation.status === 'verified';

      if (!hasLocationHistory) {
        result.overall = 'missing_timeline';
      } else if (allVerified) {
        result.overall = 'coherent';
      } else if (locationHistoryCreated) {
        result.overall = 'repaired_partial';
      } else {
        result.overall = 'partial';
      }

      results.push(result);
    }

    // ── EVENT-LEVEL SUMMARY ──────────────────────────────────────────────────
    const statusCounts = {
      coherent: 0, repaired_partial: 0, partial: 0,
      missing_timeline: 0, conflict: 0, blocked: 0,
    };
    for (const r of results) {
      if (statusCounts[r.overall] != null) statusCounts[r.overall]++;
    }

    const allCoherent = statusCounts.coherent === results.length;
    const anyCoherent = statusCounts.coherent > 0;
    const anyUnverified = statusCounts.repaired_partial > 0 || statusCounts.partial > 0 || statusCounts.missing_timeline > 0;
    const allRepaired = statusCounts.repaired_partial > 0 && statusCounts.missing_timeline === 0;

    let eventOverall;
    if (allCoherent) {
      eventOverall = 'coherent';
    } else if (allRepaired) {
      eventOverall = 'repaired_partial';
    } else if (statusCounts.coherent > 0) {
      eventOverall = 'partial';
    } else if (statusCounts.repaired_partial > 0) {
      eventOverall = 'repaired_partial';
    } else {
      eventOverall = 'missing_timeline';
    }

    // Identify which systems are unverified across participants
    const unverifiedSystems = [];
    const systemNames = ['story_event_memory', 'life_event', 'memory', 'character_memory', 'char_memories_array', 'event_participation'];
    for (const sys of systemNames) {
      const anyUnverified = results.some(r => r[sys]?.status !== 'verified');
      if (anyUnverified) {
        const statuses = [...new Set(results.map(r => r[sys]?.status || 'unknown'))];
        unverifiedSystems.push({ system: sys, statuses });
      }
    }

    return Response.json({
      success: true,
      event_id: event.id,
      event_title: title,
      event_date: eventDate,
      start_time: startTime,
      end_time: endTime,
      venue_name: venueName,
      venue_id: venueId,
      participant_count: allIds.length,
      event_overall: eventOverall,
      summary: statusCounts,
      unverified_systems: unverifiedSystems,
      location_history: {
        created: totalCreatedLH,
        existing_before: totalExistingLH,
        total_missing: allIds.length - totalExistingLH - totalCreatedLH,
      },
      conflicts: conflictsFound,
      created_records: createdRecords,
      participants: results,
    });
  } catch (error) {
    console.error('[verifyAndRepairStoryEventTimeline]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});