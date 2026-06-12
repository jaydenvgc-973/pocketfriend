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

    // Build a name map from event data (Character entity is unreliable for lookup)
    const nameById = {};
    for (let i = 0; i < allIds.length; i++) {
      const id = allIds[i];
      const allNames = [...focusNames, ...participantNames];
      // Map by position — focus names first, then participant names
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

    // Calculate duration in minutes
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
    let totalExisting = 0;
    let totalCreated = 0;

    for (const cid of allIds) {
      const cname = nameById[cid] || cid;
      const isFocus = focusIds.includes(cid);
      const lhRecords = locationHistoryByChar[cid] || [];

      const result = {
        character_id: cid,
        character_name: cname,
        is_focus: isFocus,
        venue_lh_records: [],
        conflicting_lh_records: [],
        location_history: { exists: false, created: false, record_id: null },
        life_event: { exists: false },
        memory: { exists: false },
        character_memory: { exists: false },
        char_memories_array: { exists: false },
        event_participation: { exists: false },
        status: 'unknown',
      };

      // ── CHECK: Venue LocationHistory ────────────────────────────────────
      const venueLH = lhRecords.filter(lh => {
        const locMatch = venueId
          ? (lh.location_id === venueId)
          : (lh.location_name && lh.location_name.toLowerCase() === venueName.toLowerCase());
        return locMatch;
      });
      result.venue_lh_records = venueLH.map(lh => ({
        id: lh.id,
        event_type: lh.event_type,
        arrival_time: lh.arrival_time,
        departure_time: lh.departure_time,
      }));

      if (venueLH.length > 0) {
        result.location_history = { exists: true, created: false, record_id: venueLH[0].id };
        totalExisting++;
      }

      // ── CHECK: Conflicting LocationHistory ──────────────────────────────
      const conflicts = lhRecords.filter(lh => {
        const locMatch = venueId
          ? (lh.location_id === venueId)
          : (lh.location_name && lh.location_name.toLowerCase() === venueName.toLowerCase());
        return !locMatch;
      });
      result.conflicting_lh_records = conflicts.map(lh => ({
        id: lh.id,
        location_name: lh.location_name || 'unknown',
        event_type: lh.event_type,
        arrival_time: lh.arrival_time,
        departure_time: lh.departure_time,
        is_story_event_generated: (lh.travel_source === 'event' && (lh.travel_reason || '').includes('Story Event')),
      }));

      if (conflicts.length > 0 && venueLH.length === 0) {
        conflictsFound.push({
          character_name: cname,
          character_id: cid,
          conflicts: result.conflicting_lh_records,
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
          result.location_history = { exists: true, created: true, record_id: lhRecord.id };
          createdRecords.location_history.push(lhRecord.id);
          totalCreated++;
        } catch (e) {
          result.location_history = { exists: false, created: false, error: e.message };
        }
      }

      // ── CHECK OTHER CONNECTED SYSTEMS ──────────────────────────────────
      // LifeEvent
      try {
        const les = await base44.asServiceRole.entities.LifeEvent.filter(
          { character_id: cid, title: `Story Event: ${title}` }, null, 5
        );
        result.life_event = { exists: les.length > 0, count: les.length };
      } catch (_) {}

      // Memory
      try {
        const mems = await base44.asServiceRole.entities.Memory.filter(
          { character_id: cid, source_context: `story_event_${event.id}` }, null, 5
        );
        result.memory = { exists: mems.length > 0, count: mems.length };
      } catch (_) {}

      // CharacterMemory — fetch all for character and check locally
      try {
        const allCms = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: cid }, null, 50
        );
        const matching = allCms.filter(cm =>
          (cm.memory_text || '').includes(`Story Event: ${title}`)
        );
        result.character_memory = { exists: matching.length > 0, count: matching.length };
      } catch (_) {}

      // Character.memories array — check from LifeEvent and EventParticipation existence
      // (Character entity unreliable for lookup; infer from connected records)
      result.char_memories_array = { exists: result.memory.exists || result.life_event.exists };

      // EventParticipation
      try {
        const eps = await base44.asServiceRole.entities.EventParticipation.filter(
          { character_id: cid, event_id: event.id }, null, 5
        );
        result.event_participation = { exists: eps.length > 0, count: eps.length };
      } catch (_) {}

      // ── DETERMINE STATUS ────────────────────────────────────────────────
      const allSystemsOk = result.location_history.exists &&
        result.life_event.exists &&
        result.memory.exists &&
        result.character_memory.exists &&
        result.event_participation.exists;

      if (allSystemsOk) {
        result.status = 'coherent';
      } else if (result.location_history.exists) {
        result.status = 'partial';
      } else {
        result.status = 'missing_timeline';
      }

      results.push(result);
    }

    // ── SUMMARY ────────────────────────────────────────────────────────────
    const coherentCount = results.filter(r => r.status === 'coherent').length;
    const partialCount = results.filter(r => r.status === 'partial').length;
    const missingCount = results.filter(r => r.status === 'missing_timeline').length;

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
      summary: {
        coherent: coherentCount,
        partial: partialCount,
        missing_timeline: missingCount,
        location_history_created: createdRecords.location_history.length,
        location_history_existing: totalExisting,
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