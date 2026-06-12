import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventId = body.event_id || (body.data ? body.data.id : null);
    const eventData = body.data || {};

    if (!eventId) {
      // Try to get the event from the entity event payload
      return Response.json({ error: 'No story event id found' }, { status: 400 });
    }

    // Fetch the full StoryEvent record
    const records = await base44.asServiceRole.entities.StoryEvent.filter({ id: eventId }, null, 1);
    const event = records[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    if (event.status !== 'generating') {
      return Response.json({ success: true, skipped: true, reason: `status is ${event.status}` });
    }

    const ownerEmail = event.owner_email;
    const plot = event.plot || '';
    const additionalNotes = event.additional_notes || '';
    const title = event.title || 'Untitled Event';
    const eventDate = event.event_date;
    const venueName = event.venue_name || 'an undisclosed location';
    const isRabbitHole = event.is_rabbit_hole;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const focusNames = event.focus_character_names || [];
    const participantNames = event.participant_character_names || [];
    const allDay = event.all_day;
    const startTime = event.start_time;
    const endTime = event.end_time;

    // Load character data for all participants
    const allIds = [...new Set([...focusIds, ...participantIds])];
    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // Build character context for the LLM
    const characterContexts = allIds.map(cid => {
      const c = charById[cid];
      if (!c) return `- ${cid}: (character data unavailable)`;
      const isFocus = focusIds.includes(cid);
      const marker = isFocus ? '★ FOCUS' : '';
      return [
        `- ${c.name || cid} ${marker}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.occupation ? `  Occupation: ${c.occupation}` : '',
        c.age ? `  Age: ${c.age}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        c.communication_style ? `  Communication style: ${c.communication_style}` : '',
        c.current_situation ? `  Current situation: ${c.current_situation}` : '',
        c.profile_summary ? `  Summary: ${c.profile_summary}` : '',
        (c.memories || []).slice(0, 3).map((m, i) => `  Memory: ${m.title || ''}`).filter(Boolean).join('\n'),
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    // Resolve relationships between participants
    const relationshipContexts = [];
    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;
      const rels = (c.fictional_relationships || []).filter(r =>
        r.related_character_id && allIds.includes(r.related_character_id) && r.related_character_id !== cid
      );
      for (const r of rels) {
        const target = charById[r.related_character_id];
        if (!target) continue;
        relationshipContexts.push(
          `${c.name} → ${target.name}: ${r.relationship_type}` +
          (r.friendship_level != null ? ` (friendship ${r.friendship_level})` : '') +
          (r.trust_level != null ? ` (trust ${r.trust_level})` : '') +
          (r.description ? ` — ${r.description}` : '')
        );
      }
    }

    const timeInfo = allDay
      ? 'All-day event'
      : `${startTime || 'TBD'}${endTime ? ` to ${endTime}` : ''}`;

    // ── STEP 1: GENERATE NARRATIVE ──────────────────────────────────────────
    const narrativePrompt = [
      `You are a narrative writer creating a meaningful story for a character-driven world.`,
      ``,
      `EVENT TITLE: ${title}`,
      `DATE: ${eventDate || 'a specific date'}`,
      `TIME: ${timeInfo}`,
      `VENUE: ${venueName}${isRabbitHole ? ' (custom venue)' : ''}`,
      ``,
      `USER'S PLOT (THIS IS THE FOUNDATION — DO NOT REPLACE IT):`,
      `${plot}`,
      ``,
      additionalNotes ? `ADDITIONAL NOTES FROM USER:` : '',
      additionalNotes ? `${additionalNotes}` : '',
      additionalNotes ? `` : '',
      `FOCUS CHARACTERS (give these characters the most narrative attention):`,
      focusNames.length > 0 ? focusNames.join(', ') : 'None specified',
      ``,
      `PARTICIPATING CHARACTERS:`,
      participantNames.join(', '),
      ``,
      `CHARACTER DETAILS:`,
      characterContexts,
      ``,
      `RELATIONSHIPS BETWEEN PARTICIPANTS:`,
      relationshipContexts.length > 0 ? relationshipContexts.join('\n') : 'No known relationships',
      ``,
      `INSTRUCTIONS:`,
      `1. Write a narrative story about this event. The story MUST follow the user's plot above. Expand details, interactions, observations, and emotional moments — but DO NOT replace the user's intended event with a different storyline.`,
      `2. Focus characters should receive greater narrative attention, more detailed emotional moments, and more internal perspective. Supporting participants should still be included where appropriate.`,
      `3. Include light dialogue where it supports the event. Dialogue should enhance the story, not dominate it.`,
      ``,
      `OUTPUT FORMAT — Return a JSON object with these fields:`,
      `{`,
      `  "narrative": "The full narrative story text, well-written and immersive, approximately 400-800 words.",`,
      `  "narrative_preview": "A short 1-2 sentence preview/summary of the event.",`,
      `  "emotional_outcomes": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "emotion": "happy|proud|relieved|excited|comfortable|calm|trusting|anxious|sad|disappointed|frustrated|embarrassed|reflective|grateful|hopeful|tense|hurt|content", "intensity": "mild|moderate|strong", "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "relationship_changes": [`,
      `    { "source_character_id": "the_exact_id", "target_character_id": "the_exact_id", "source_name": "Name", "target_name": "Name", "dimension": "friendship|trust|familiarity|attraction|respect|tension", "change": "increased|decreased", "amount": 1-10, "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "memories": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "memory_text": "What this character remembers about the event — personal, specific, from their perspective. A few sentences.", "memory_summary": "Short summary for retrieval", "importance_score": 1-10, "emotional_tone": "positive|negative|neutral|mixed" }`,
      `  ],`,
      `  "image_prompts": [`,
      `    { "moment": "opening", "prompt": "Detailed image generation prompt for the opening moment. Include venue details, characters present, lighting, mood. The venue is: ${venueName}.", "description": "What the image shows." },`,
      `    { "moment": "key_moment", "prompt": "Detailed image generation prompt for the key/peak moment of the event.", "description": "What the image shows." },`,
      `    { "moment": "closing", "prompt": "Detailed image generation prompt for the closing/wrap-up moment.", "description": "What the image shows." }`,
      `  ]`,
      `}`,
      ``,
      `RULES:`,
      `- The narrative MUST follow the user's plot. Do not invent a different storyline.`,
      `- Emotional outcomes must be supported by what happens in the narrative. No random emotions.`,
      `- Relationship changes must have a meaningful reason in the narrative. No unsupported changes.`,
      `- Focus characters get richer memories with higher importance scores.`,
      `- Every participant gets at least one memory.`,
      `- Image prompts must reference the venue: ${venueName}.`,
      `- Only include relationship changes for character pairs that actually interact meaningfully.`,
    ].join('\n');

    let generated;
    try {
      const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: narrativePrompt,
        response_json_schema: {
          type: 'object',
          properties: {
            narrative: { type: 'string' },
            narrative_preview: { type: 'string' },
            emotional_outcomes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  character_id: { type: 'string' },
                  character_name: { type: 'string' },
                  emotion: { type: 'string' },
                  intensity: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
            },
            relationship_changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source_character_id: { type: 'string' },
                  target_character_id: { type: 'string' },
                  source_name: { type: 'string' },
                  target_name: { type: 'string' },
                  dimension: { type: 'string' },
                  change: { type: 'string' },
                  amount: { type: 'number' },
                  reason: { type: 'string' },
                },
              },
            },
            memories: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  character_id: { type: 'string' },
                  character_name: { type: 'string' },
                  memory_text: { type: 'string' },
                  memory_summary: { type: 'string' },
                  importance_score: { type: 'number' },
                  emotional_tone: { type: 'string' },
                },
              },
            },
            image_prompts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  moment: { type: 'string' },
                  prompt: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        model: 'gemini_3_1_pro',
      });
      generated = llmRes;
    } catch (e) {
      // Update status to failed
      await base44.asServiceRole.entities.StoryEvent.update(eventId, {
        status: 'failed',
        generation_error: `LLM error: ${e.message}`,
      });
      return Response.json({ error: e.message }, { status: 500 });
    }

    // ── STEP 2: CREATE MEMORIES ─────────────────────────────────────────────
    const memories = generated.memories || [];
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        await base44.asServiceRole.entities.StoryEventMemory.create({
          story_event_id: eventId,
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          memory_text: mem.memory_text,
          memory_summary: mem.memory_summary || mem.memory_text.substring(0, 80),
          memory_type: 'event',
          importance_score: mem.importance_score || 5,
          emotional_tone: mem.emotional_tone || 'neutral',
          owner_email: ownerEmail,
        });
      } catch (_) {}
    }

    // ── STEP 3: UPDATE RELATIONSHIP SCORES ──────────────────────────────────
    const relChanges = generated.relationship_changes || [];
    for (const rc of relChanges) {
      if (!rc.source_character_id || !rc.target_character_id || !rc.dimension) continue;
      const sourceChar = charById[rc.source_character_id];
      if (!sourceChar) continue;

      try {
        const existingRels = sourceChar.fictional_relationships || [];
        const relIdx = existingRels.findIndex(r => r.related_character_id === rc.target_character_id);
        const amount = Math.min(10, Math.max(1, rc.amount || 3));

        const dimensionFieldMap = {
          friendship: 'friendship_level',
          trust: 'trust_level',
          familiarity: 'familiarity_level',
          attraction: 'attraction_level',
          respect: 'user_respect_level',
          tension: 'tension_level',
        };

        const field = dimensionFieldMap[rc.dimension];
        if (!field) continue;

        if (relIdx >= 0) {
          const currentVal = existingRels[relIdx][field] ?? 50;
          const newVal = rc.change === 'increased'
            ? Math.min(100, currentVal + amount)
            : Math.max(0, currentVal - amount);
          existingRels[relIdx] = { ...existingRels[relIdx], [field]: newVal };
          await base44.asServiceRole.entities.Character.update(rc.source_character_id, {
            fictional_relationships: existingRels,
          });
        }
      } catch (_) {}
    }

    // ── STEP 4: UPDATE EMOTIONAL STATES ─────────────────────────────────────
    const emotionalOutcomes = generated.emotional_outcomes || [];
    for (const eo of emotionalOutcomes) {
      if (!eo.character_id || !eo.emotion) continue;
      try {
        await base44.asServiceRole.entities.Character.update(eo.character_id, {
          emotional_state: eo.emotion,
        });
      } catch (_) {}
    }

    // ── STEP 5: GENERATE IMAGES ─────────────────────────────────────────────
    const imagePrompts = generated.image_prompts || [];
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };

    for (const img of imagePrompts) {
      if (!img.moment || !img.prompt) continue;
      try {
        const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: img.prompt,
        });

        if (imageRes?.url) {
          await base44.asServiceRole.entities.StoryEventImage.create({
            story_event_id: eventId,
            moment_type: img.moment,
            image_url: imageRes.url,
            description: img.description || '',
            prompt: img.prompt,
            order: momentOrder[img.moment] ?? 0,
          });
        }
      } catch (_) {}
    }

    // ── STEP 6: UPDATE STORY EVENT STATUS ───────────────────────────────────
    await base44.asServiceRole.entities.StoryEvent.update(eventId, {
      status: 'complete',
      generated_narrative: generated.narrative || '',
      narrative_preview: generated.narrative_preview || (generated.narrative || '').substring(0, 150),
      emotional_outcomes: emotionalOutcomes,
      relationship_changes: relChanges,
    });

    return Response.json({
      success: true,
      eventId,
      memoriesCreated: memories.length,
      imagesGenerated: imagePrompts.length,
      relationshipChanges: relChanges.length,
    });
  } catch (error) {
    console.error('[generateStoryEvent]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});