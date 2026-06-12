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
    const venueName = event.venue_name || 'unknown venue';
    const ownerEmail = event.owner_email;
    const narrative = event.generated_narrative || '';
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];
    const isMajorEvent = narrative.length > 600 || focusIds.length >= 2;

    // ── LOAD CHARACTER DATA ───────────────────────────────────────────────
    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // ── LOAD STORY EVENT MEMORIES (existing) ──────────────────────────────
    let storyMemories = [];
    try {
      storyMemories = await base44.asServiceRole.entities.StoryEventMemory.filter(
        { story_event_id: eventId }, null, 200
      );
    } catch (_) {}

    // ── LOAD STORY EVENT IMAGES ───────────────────────────────────────────
    let storyImages = [];
    try {
      storyImages = await base44.asServiceRole.entities.StoryEventImage.filter(
        { story_event_id: eventId }, null, 10
      );
    } catch (_) {}

    // ── CHECK EXISTING RECORDS PER PARTICIPANT ────────────────────────────
    const participants = allIds.map(cid => {
      const c = charById[cid];
      const mem = storyMemories.find(m => m.character_id === cid);
      return {
        character_id: cid,
        character_name: c?.name || c?.display_name || cid,
        character_type: c?.character_type || 'unknown',
        has_story_memory: !!mem,
        memory_text: mem?.memory_text || null,
        memory_summary: mem?.memory_summary || null,
        importance_score: mem?.importance_score || 5,
        emotional_tone: mem?.emotional_tone || 'neutral',
        is_focus: focusIds.includes(cid),
      };
    });

    // ── VERIFY & BACKFILL EACH RECORD TYPE ────────────────────────────────
    const results = [];
    const createdRecords = {
      life_events: [],
      memories: [],
      character_memories: [],
      character_memories_array: [],
      event_participations: [],
    };

    for (const p of participants) {
      const cid = p.character_id;
      const cname = p.character_name;
      const memText = p.memory_text ||
        `${cname} attended the story event "${title}" on ${eventDate} at ${venueName}.`;
      const memSummary = p.memory_summary ||
        `Attended "${title}" at ${venueName} on ${eventDate}`;
      const emotionalTone = p.emotional_tone || 'neutral';
      const valence = emotionalTone === 'positive' || emotionalTone === 'mixed' ? 'positive'
        : emotionalTone === 'negative' ? 'negative' : 'neutral';
      const eventTypeForChar = valence === 'positive'
        ? (isMajorEvent ? 'celebration_event' : 'bonding_event')
        : valence === 'negative' ? 'setback_event' : 'bonding_event';
      const importance = p.importance_score || 5;

      const result = {
        character_name: cname,
        character_type: p.character_type,
        character_id: cid,
        is_focus: p.is_focus,
        life_journal: { exists: false, created: false, record_id: null },
        chat_memory: { exists: false, created: false, record_id: null },
        character_memory: { exists: false, created: false, record_id: null },
        dashboard_impact: { exists: false, created: false, record_id: null },
        event_participation: { exists: false, created: false, record_id: null },
        memory_text_preview: memText.substring(0, 100),
      };

      // ── CHECK 1: LIFEEVENT ─────────────────────────────────────────────
      try {
        const lifeEvents = await base44.asServiceRole.entities.LifeEvent.filter(
          { character_id: cid, title: `Story Event: ${title}` }, null, 5
        );
        if (lifeEvents.length > 0) {
          result.life_journal = { exists: true, created: false, record_id: lifeEvents[0].id };
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
            timestamp: `${eventDate}T${startTime}:00.000`,
            triggered_by: 'story_event',
            systems_updated: ['memories', 'relationships', 'emotional_state'],
            context_tags: ['story_event', eventId, `participant_${cid}`],
          });
          result.life_journal = { exists: true, created: true, record_id: le.id };
          createdRecords.life_events.push(le.id);
        }
      } catch (e) {
        result.life_journal.error = e.message;
      }

      // ── CHECK 2: MEMORY ENTITY (semantic retrieval well) ───────────────
      try {
        const memories = await base44.asServiceRole.entities.Memory.filter(
          { character_id: cid, source_context: `story_event_${eventId}` }, null, 5
        );
        if (memories.length > 0) {
          result.chat_memory = { exists: true, created: false, record_id: memories[0].id };
        } else {
          const m = await base44.asServiceRole.entities.Memory.create({
            character_id: cid,
            title: `Attended: ${title}`,
            description: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${memText}`,
            emotional_impact: emotionalTone,
            source_context: `story_event_${eventId}`,
            timestamp: new Date().toISOString(),
          });
          result.chat_memory = { exists: true, created: true, record_id: m.id };
          createdRecords.memories.push(m.id);
        }
      } catch (e) {
        result.chat_memory.error = e.message;
      }

      // ── CHECK 3: CHARACTERMEMORY (Life Journal block) ──────────────────
      try {
        const charMems = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: cid, memory_text: { $contains: `Story Event: ${title}` } }, null, 5
        );
        if (charMems.length > 0) {
          result.character_memory = { exists: true, created: false, record_id: charMems[0].id };
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
          result.character_memory = { exists: true, created: true, record_id: cm.id };
          createdRecords.character_memories.push(cm.id);
        }
      } catch (e) {
        result.character_memory.error = e.message;
      }

      // ── CHECK 4: CHARACTER.MEMORIES ARRAY (chat context builder) ───────
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        const freshChar = freshChars[0];
        if (freshChar) {
          const existing = (freshChar.memories || []);
          const already = existing.find(m => m.title === `Story Event: ${title}`);
          if (already) {
            result.dashboard_impact = { exists: true, created: false, record_id: null };
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
            result.dashboard_impact = { exists: true, created: true, record_id: null };
            createdRecords.character_memories_array.push(cid);
          }
        } else {
          result.dashboard_impact = { exists: false, created: false, record_id: null, error: 'Character not found' };
        }
      } catch (e) {
        result.dashboard_impact.error = e.message;
      }

      // ── CHECK 5: EVENTPARTICIPATION ────────────────────────────────────
      try {
        const parts = await base44.asServiceRole.entities.EventParticipation.filter(
          { character_id: cid, event_id: eventId }, null, 5
        );
        if (parts.length > 0) {
          result.event_participation = { exists: true, created: false, record_id: parts[0].id };
        } else {
          const ep = await base44.asServiceRole.entities.EventParticipation.create({
            event_id: eventId,
            event_name: title,
            character_id: cid,
            character_name: cname,
            owner_email: ownerEmail,
            participation_type: 'attended',
            emotional_tone: emotionalTone,
            participation_date: `${eventDate}T${startTime}:00.000`,
            memory_strength: importance >= 7 ? 'strong' : 'moderate',
            notes: memSummary,
            saw_character_ids: participantIds.filter(id => id !== cid),
          });
          result.event_participation = { exists: true, created: true, record_id: ep.id };
          createdRecords.event_participations.push(ep.id);
        }
      } catch (e) {
        result.event_participation.error = e.message;
      }

      results.push(result);
    }

    // ── COUNT EXISTING IMAGE/MESSAGE RECORDS ─────────────────────────────
    let mediaGalleryImages = 0;
    try {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: `story_event_${eventId}` }, null, 50
      );
      mediaGalleryImages = msgs.filter(m => m.image_url).length;
    } catch (_) {}

    return Response.json({
      success: true,
      event_id: eventId,
      event_title: title,
      participant_count: participants.length,
      story_event_images: storyImages.length,
      media_gallery_images: mediaGalleryImages,
      story_event_memories: storyMemories.length,
      relationship_changes: (event.relationship_changes || []).length,
      emotional_outcomes: (event.emotional_outcomes || []).length,
      created_records: createdRecords,
      participants: results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});