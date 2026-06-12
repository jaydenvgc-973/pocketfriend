import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventId = body.event_id;
    if (!eventId) return Response.json({ error: 'event_id required' }, { status: 400 });

    // ── LOAD STORY EVENT ──────────────────────────────────────────────────
    const records = await base44.asServiceRole.entities.StoryEvent.filter({ id: eventId }, null, 1);
    const event = records[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    const title = event.title || 'Untitled Event';
    const eventDate = event.event_date || '';
    const startTime = event.start_time || '12:00';
    const endTime = event.end_time || '14:00';
    const venueName = event.venue_name || 'unknown venue';
    const venueId = event.venue_id || null;
    const ownerEmail = event.owner_email;
    const narrative = event.generated_narrative || '';
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const focusNames = event.focus_character_names || [];
    const participantNames = event.participant_character_names || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];
    const isMajorEvent = narrative.length > 600 || focusIds.length >= 2;

    // Build name map from event data (Character entity queries are unreliable)
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

    const arrivalTime = `${eventDate}T${startTime}:00.000`;
    const departureTime = endTime
      ? `${eventDate}T${endTime}:00.000`
      : `${eventDate}T14:00:00.000`;

    // Calculate duration
    let durationMinutes = 120;
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      durationMinutes = (eh * 60 + em) - (sh * 60 + sm);
      if (durationMinutes <= 0) durationMinutes = 120;
    }

    // ── LOAD EXISTING RECORDS ──────────────────────────────────────────────
    // StoryEventMemory
    let storyMemories = [];
    let storyMemoriesByChar = {};
    try {
      storyMemories = await base44.asServiceRole.entities.StoryEventMemory.filter(
        { story_event_id: eventId }, null, 200
      );
      for (const sm of storyMemories) {
        storyMemoriesByChar[sm.character_id] = sm;
      }
    } catch (_) {}

    // StoryEventImages
    let storyImages = [];
    try {
      storyImages = await base44.asServiceRole.entities.StoryEventImage.filter(
        { story_event_id: eventId }, null, 10
      );
    } catch (_) {}

    // Media Gallery Messages
    let mediaGalleryImages = 0;
    try {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: `story_event_${eventId}` }, null, 50
      );
      mediaGalleryImages = msgs.filter(m => m.image_url).length;
    } catch (_) {}

    // ── VERIFY & BACKFILL EACH PARTICIPANT ──────────────────────────────────
    const results = [];
    const createdRecords = {
      life_events: [],
      memories: [],
      character_memories: [],
      character_memories_array: [],
      event_participations: [],
      location_history: [],
    };

    for (const cid of allIds) {
      const cname = nameById[cid] || cid;
      const isFocus = focusIds.includes(cid);

      const sm = storyMemoriesByChar[cid];
      const memText = sm?.memory_text ||
        `${cname} attended the story event "${title}" on ${eventDate} at ${venueName}.`;
      const memSummary = sm?.memory_summary ||
        `Attended "${title}" at ${venueName} on ${eventDate}`;
      const emotionalTone = sm?.emotional_tone || 'neutral';
      const valence = emotionalTone === 'positive' || emotionalTone === 'mixed' ? 'positive'
        : emotionalTone === 'negative' ? 'negative' : 'neutral';
      const eventTypeForChar = valence === 'positive'
        ? (isMajorEvent ? 'celebration_event' : 'bonding_event')
        : valence === 'negative' ? 'setback_event' : 'bonding_event';
      const importance = sm?.importance_score || 5;

      const result = {
        character_id: cid,
        character_name: cname,
        is_focus: isFocus,
        story_event_memory: { status: sm ? 'verified' : 'missing' },
        life_event: { status: 'pending' },
        memory: { status: 'pending' },
        character_memory: { status: 'pending' },
        char_memories_array: { status: 'pending' },
        event_participation: { status: 'pending' },
        location_history: { status: 'pending' },
        memory_text_preview: memText.substring(0, 100),
        overall: 'pending',
      };

      // ── CHECK/CREATE: LIFEEVENT ─────────────────────────────────────────
      try {
        const les = await base44.asServiceRole.entities.LifeEvent.filter(
          { character_id: cid, title: `Story Event: ${title}` }, null, 5
        );
        if (les.length > 0) {
          result.life_event = { status: 'verified', record_id: les[0].id };
        } else {
          const le = await base44.asServiceRole.entities.LifeEvent.create({
            character_id: cid,
            character_name: cname,
            title: `Story Event: ${title}`,
            description: memText,
            event_type: eventTypeForChar,
            severity: isMajorEvent ? 'major' : 'significant',
            valence,
            emotional_impact: `${emotionalTone} — ${eventTypeForChar.replace(/_/g, ' ')}`,
            timestamp: arrivalTime,
            triggered_by: 'story_event',
            systems_updated: ['memories', 'relationships', 'emotional_state'],
            context_tags: ['story_event', eventId, `participant_${cid}`],
          });
          result.life_event = { status: 'created', record_id: le.id };
          createdRecords.life_events.push(le.id);
        }
      } catch (e) {
        result.life_event = { status: 'query_failed', error: e.message };
      }

      // ── CHECK/CREATE: MEMORY ENTITY ─────────────────────────────────────
      try {
        const mems = await base44.asServiceRole.entities.Memory.filter(
          { character_id: cid, source_context: `story_event_${eventId}` }, null, 5
        );
        if (mems.length > 0) {
          result.memory = { status: 'verified', record_id: mems[0].id };
        } else {
          const m = await base44.asServiceRole.entities.Memory.create({
            character_id: cid,
            title: `Attended: ${title}`,
            description: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${memText}`,
            emotional_impact: emotionalTone,
            source_context: `story_event_${eventId}`,
            timestamp: new Date().toISOString(),
          });
          result.memory = { status: 'created', record_id: m.id };
          createdRecords.memories.push(m.id);
        }
      } catch (e) {
        result.memory = { status: 'query_failed', error: e.message };
      }

      // ── CHECK/CREATE: CHARACTERMEMORY ───────────────────────────────────
      // Fetch all CharacterMemories for this character first, then filter locally.
      // Direct $contains queries on memory_text may produce "Invalid query" errors.
      try {
        const allCms = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: cid }, null, 50
        );
        const matching = allCms.filter(cm =>
          (cm.memory_text || '').includes(`Story Event: ${title}`)
        );
        if (matching.length > 0) {
          result.character_memory = { status: 'verified', record_id: matching[0].id };
        } else {
          const cm = await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: cid,
            memory_type: 'event',
            memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${memText}`,
            memory_summary: memSummary,
            importance_score: importance,
            confidence_score: 0.95,
            permanence: importance >= 7 ? 'protected' : 'long_term',
            validation_status: 'confirmed',
          });
          result.character_memory = { status: 'created', record_id: cm.id };
          createdRecords.character_memories.push(cm.id);
        }
      } catch (e) {
        result.character_memory = { status: 'query_failed', error: e.message };
      }

      // ── CHECK/CREATE: CHARACTER.MEMORIES ARRAY ──────────────────────────
      // Character entity queries are unreliable. Attempt via service role
      // but report honestly if it fails.
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        const fresh = freshChars[0];
        if (fresh) {
          const existing = (fresh.memories || []);
          const already = existing.find(m => m.title === `Story Event: ${title}`);
          if (already) {
            result.char_memories_array = { status: 'verified' };
          } else {
            await base44.asServiceRole.entities.Character.update(cid, {
              memories: [...existing, {
                title: `Story Event: ${title}`,
                description: memText,
                date: eventDate,
                emotion_state: emotionalTone,
                created_date: new Date().toISOString(),
              }],
            });
            result.char_memories_array = { status: 'created' };
            createdRecords.character_memories_array.push(cid);
          }
        } else {
          result.char_memories_array = { status: 'query_failed', error: 'Character filter returned empty' };
        }
      } catch (e) {
        result.char_memories_array = { status: 'query_failed', error: e.message };
      }

      // ── CHECK/CREATE: EVENTPARTICIPATION ────────────────────────────────
      try {
        const eps = await base44.asServiceRole.entities.EventParticipation.filter(
          { character_id: cid, event_id: eventId }, null, 5
        );
        if (eps.length > 0) {
          result.event_participation = { status: 'verified', record_id: eps[0].id };
        } else {
          const ep = await base44.asServiceRole.entities.EventParticipation.create({
            event_id: eventId,
            event_name: title,
            character_id: cid,
            character_name: cname,
            owner_email: ownerEmail,
            participation_type: 'attended',
            emotional_tone: emotionalTone,
            participation_date: arrivalTime,
            memory_strength: importance >= 7 ? 'strong' : 'moderate',
            notes: memSummary,
            saw_character_ids: participantIds.filter(id => id !== cid),
          });
          result.event_participation = { status: 'created', record_id: ep.id };
          createdRecords.event_participations.push(ep.id);
        }
      } catch (e) {
        result.event_participation = { status: 'query_failed', error: e.message };
      }

      // ── CHECK/CREATE: LOCATIONHISTORY (full timeline transition) ─────────
      // A coherent event requires: departure from previous → arrival at venue → departure from venue → return.
      try {
        // Resolve prior location — NOT blindly home
        let priorLocId = venueId || `story_event_venue_${eventId}`;
        let priorLocName = 'previous location';
        let priorCat = 'home';

        try {
          const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
          const fresh = freshChars[0];
          if (fresh) {
            const resolvedType = fresh.resolved_location_type || 'home';
            const presenceStatus = fresh.resolved_presence_status || 'home';
            const isConfined = presenceStatus === 'incarcerated' || presenceStatus === 'house_arrest' || presenceStatus === 'confined';

            if (isConfined) {
              result.location_history = { status: 'blocked', reason: `Character is ${presenceStatus}` };
              result.overall = 'blocked';
              results.push(result);
              continue;
            }

            if (resolvedType === 'work' && fresh.current_work_location_id) {
              priorLocId = fresh.current_work_location_id;
              priorLocName = fresh.resolved_current_location_name || 'work';
              priorCat = 'workplace';
            } else if (resolvedType === 'school' && fresh.current_school_location_id) {
              priorLocId = fresh.current_school_location_id;
              priorLocName = fresh.resolved_current_location_name || 'school';
              priorCat = 'education';
            } else if (resolvedType === 'temporary_housing' && fresh.temporary_housing_location_id) {
              priorLocId = fresh.temporary_housing_location_id;
              priorLocName = fresh.resolved_current_location_name || 'temporary housing';
              priorCat = 'home';
            } else if (fresh.resolved_current_location_id) {
              priorLocId = fresh.resolved_current_location_id;
              priorLocName = fresh.resolved_current_location_name || 'previous location';
              priorCat = resolvedType === 'work' ? 'workplace' : resolvedType === 'school' ? 'education' : 'home';
            } else if (fresh.current_home_location_id) {
              priorLocId = fresh.current_home_location_id;
              priorLocName = fresh.resolved_current_location_name || 'home';
              priorCat = 'home';
            }
          }
        } catch (_) {}

        // Check venue LocationHistory
        const venueLH = await base44.asServiceRole.entities.LocationHistory.filter(
          { character_id: cid, owner_email: ownerEmail, location_id: venueId }, '-arrival_time', 50
        );
        const matching = venueLH.filter(lh => {
          if (!lh.arrival_time) return false;
          const arrDate = lh.arrival_time.split('T')[0];
          if (arrDate !== eventDate) return false;
          const arr = new Date(lh.arrival_time).getTime();
          const evArr = new Date(arrivalTime).getTime();
          return Math.abs(arr - evArr) < 6 * 3600000;
        });

        if (matching.length > 0) {
          result.location_history = { status: 'verified', record_id: matching[0].id };
        } else {
          // 1. Departure from previous location
          await base44.asServiceRole.entities.LocationHistory.create({
            character_id: cid, character_name: cname, owner_email: ownerEmail,
            location_id: priorLocId, location_name: priorLocName,
            location_category: priorCat,
            event_type: 'departure',
            arrival_time: `${eventDate}T00:00:00.000`,
            departure_time: arrivalTime,
            travel_source: 'event',
            travel_reason: `Left to attend "${title}" Story Event`,
            is_current: false,
            notes: `Departed from ${priorLocName} for Story Event: ${title}. Backfilled by impact repair.`,
          });

          // 2. Arrival at event venue
          const lh = await base44.asServiceRole.entities.LocationHistory.create({
            character_id: cid, character_name: cname, owner_email: ownerEmail,
            location_id: venueId || `story_event_venue_${eventId}`,
            location_name: venueName, location_category: 'social',
            event_type: 'social_visit',
            arrival_time: arrivalTime, departure_time: departureTime,
            duration_minutes: durationMinutes, travel_source: 'event',
            travel_reason: `Story Event: ${title}`,
            is_current: false,
            notes: `Attended "${title}" Story Event at ${venueName}. Backfilled by impact repair.`,
          });
          result.location_history = { status: 'created', record_id: lh.id };
          createdRecords.location_history.push(lh.id);

          // 3. Departure from event venue
          await base44.asServiceRole.entities.LocationHistory.create({
            character_id: cid, character_name: cname, owner_email: ownerEmail,
            location_id: venueId || `story_event_venue_${eventId}`,
            location_name: venueName, location_category: 'social',
            event_type: 'departure',
            arrival_time: arrivalTime, departure_time: departureTime,
            travel_source: 'event',
            travel_reason: `Left "${title}" Story Event`,
            is_current: false,
            notes: `Departed from Story Event: ${title}. Backfilled by impact repair.`,
          });

          // 4. Return to next location (not blindly home)
          await base44.asServiceRole.entities.LocationHistory.create({
            character_id: cid, character_name: cname, owner_email: ownerEmail,
            location_id: priorLocId, location_name: priorLocName,
            location_category: priorCat,
            event_type: 'return_home',
            arrival_time: departureTime, departure_time: null,
            travel_source: 'event',
            travel_reason: `Returned after "${title}" Story Event`,
            is_current: false,
            notes: `Returned to ${priorLocName} after Story Event: ${title}. Backfilled by impact repair.`,
          });
        }
      } catch (e) {
        result.location_history = { status: 'query_failed', error: e.message };
      }

      // ── DETERMINE OVERALL STATUS ──────────────────────────────────────────
      const allVerified = result.story_event_memory.status === 'verified' &&
        (result.life_event.status === 'verified' || result.life_event.status === 'created') &&
        (result.memory.status === 'verified' || result.memory.status === 'created') &&
        (result.character_memory.status === 'verified' || result.character_memory.status === 'created') &&
        (result.char_memories_array.status === 'verified' || result.char_memories_array.status === 'created') &&
        (result.event_participation.status === 'verified' || result.event_participation.status === 'created') &&
        (result.location_history.status === 'verified' || result.location_history.status === 'created');

      const anyUnverified = result.life_event.status === 'query_failed' ||
        result.memory.status === 'query_failed' ||
        result.character_memory.status === 'query_failed' ||
        result.char_memories_array.status === 'query_failed' ||
        result.event_participation.status === 'query_failed' ||
        result.location_history.status === 'query_failed' ||
        result.story_event_memory.status === 'missing' ||
        result.life_event.status === 'missing' ||
        result.memory.status === 'missing' ||
        result.character_memory.status === 'missing' ||
        result.char_memories_array.status === 'missing' ||
        result.event_participation.status === 'missing' ||
        result.location_history.status === 'missing';

      if (allVerified) {
        result.overall = 'coherent';
      } else if (anyUnverified) {
        // Something was created or existed, but some systems are unreadable
        const hasCreates = result.life_event.status === 'created' ||
          result.memory.status === 'created' ||
          result.character_memory.status === 'created' ||
          result.char_memories_array.status === 'created' ||
          result.event_participation.status === 'created' ||
          result.location_history.status === 'created';
        result.overall = hasCreates ? 'repaired_partial' : 'partial';
      } else {
        result.overall = 'partial';
      }

      results.push(result);
    }

    // ── EVENT-LEVEL STATUS ──────────────────────────────────────────────────
    const statusCounts = {
      coherent: 0, repaired_partial: 0, partial: 0, missing_timeline: 0, conflict: 0, blocked: 0,
    };
    for (const r of results) {
      statusCounts[r.overall] = (statusCounts[r.overall] || 0) + 1;
    }

    let eventOverall;
    if (statusCounts.coherent === results.length) {
      eventOverall = 'coherent';
    } else if (statusCounts.coherent > 0) {
      eventOverall = 'partial';
    } else if (statusCounts.repaired_partial > 0) {
      eventOverall = 'repaired_partial';
    } else if (statusCounts.partial > 0) {
      eventOverall = 'partial';
    } else {
      eventOverall = 'missing_timeline';
    }

    // Identify unverified systems
    const unverifiedSystems = [];
    const sysNames = ['story_event_memory', 'life_event', 'memory', 'character_memory', 'char_memories_array', 'event_participation', 'location_history'];
    for (const sys of sysNames) {
      const any = results.some(r => r[sys]?.status === 'query_failed' || r[sys]?.status === 'missing');
      if (any) {
        const statuses = [...new Set(results.map(r => r[sys]?.status || 'unknown'))];
        unverifiedSystems.push({ system: sys, statuses });
      }
    }

    return Response.json({
      success: true,
      event_id: eventId,
      event_title: title,
      event_overall: eventOverall,
      participant_count: allIds.length,
      summary: statusCounts,
      unverified_systems: unverifiedSystems,
      story_event_images: storyImages.length,
      media_gallery_images: mediaGalleryImages,
      story_event_memories: storyMemories.length,
      relationship_changes: (event.relationship_changes || []).length,
      emotional_outcomes: (event.emotional_outcomes || []).length,
      created_records: createdRecords,
      participants: results,
    });
  } catch (error) {
    console.error('[backfillStoryEventImpact]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});