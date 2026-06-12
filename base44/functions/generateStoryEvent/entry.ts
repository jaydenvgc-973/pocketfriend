import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const eventId = body.event_id || (body.data ? body.data.id : null);
    if (!eventId) {
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

    // ── Collect character avatar/reference images for identity-aware image generation ──
    const characterReferenceImages = [];
    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;
      if (c.avatar_url && typeof c.avatar_url === 'string') characterReferenceImages.push(c.avatar_url);
      if (c.image_avatar_url && typeof c.image_avatar_url === 'string') characterReferenceImages.push(c.image_avatar_url);
      if (c.reference_image_urls && Array.isArray(c.reference_image_urls)) {
        c.reference_image_urls.forEach(url => {
          if (url && typeof url === 'string') characterReferenceImages.push(url);
        });
      }
    }

    // Focus character reference images — prioritized for image generation
    const focusRefImages = [];
    for (const cid of focusIds) {
      const c = charById[cid];
      if (!c) continue;
      if (c.avatar_url && typeof c.avatar_url === 'string') focusRefImages.push(c.avatar_url);
      if (c.image_avatar_url && typeof c.image_avatar_url === 'string') focusRefImages.push(c.image_avatar_url);
      if (c.reference_image_urls && Array.isArray(c.reference_image_urls)) {
        c.reference_image_urls.forEach(url => {
          if (url && typeof url === 'string') focusRefImages.push(url);
        });
      }
    }

    // Build character context for the LLM — include appearance for image identity
    const characterContexts = allIds.map(cid => {
      const c = charById[cid];
      if (!c) return `- ${cid}: (character data unavailable)`;
      const isFocus = focusIds.includes(cid);
      const marker = isFocus ? '★ FOCUS' : '';
      const charType = c.character_type || '';
      const typeNote = charType === 'npc_family_member' ? ' [Family member]'
        : charType === 'npc_fictitious' ? ' [Fictional/NPC character]'
        : charType === 'npc_world_service' ? ' [World service character]'
        : '';
      // Build appearance description for image identity
      const appearanceParts = [];
      if (c.appearance_notes) appearanceParts.push(c.appearance_notes);
      if (c.avatar_description_text) appearanceParts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        const lockParts = [];
        if (al.skin_tone) lockParts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) lockParts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) lockParts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) lockParts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) lockParts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) lockParts.push(`aesthetic: ${al.overall_aesthetic}`);
        if (lockParts.length > 0) appearanceParts.push(lockParts.join(', '));
      }
      if (c.style_identity && !appearanceParts.some(p => p.includes(c.style_identity))) {
        appearanceParts.push(`style: ${c.style_identity}`);
      }
      const appearanceBlock = appearanceParts.length > 0
        ? `  APPEARANCE (USE THIS FOR IMAGE GENERATION — DO NOT INVENT GENERIC STRANGERS): ${appearanceParts.join(' | ')}`
        : '';
      return [
        `- ${c.name || cid} ${marker}${typeNote}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.occupation ? `  Occupation: ${c.occupation}` : '',
        c.age ? `  Age: ${c.age}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        appearanceBlock,
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

    // Build venue appearance context from LocationReference if available
    let venueContext = '';
    if (!isRabbitHole && event.venue_id) {
      try {
        const venueRecs = await base44.asServiceRole.entities.LocationReference.filter({ id: event.venue_id }, null, 1);
        const venue = venueRecs[0];
        if (venue) {
          venueContext = [
            `Venue: ${venue.name}`,
            venue.description ? `Description: ${venue.description}` : '',
            venue.category ? `Category: ${venue.category}` : '',
          ].filter(Boolean).join('\n');
        }
      } catch (_) {}
    }

    // ── STEP 1: GENERATE NARRATIVE ──────────────────────────────────────────
    const narrativePrompt = [
      `You are a narrative writer creating a meaningful story for a character-driven world.`,
      ``,
      `EVENT TITLE: ${title}`,
      `DATE: ${eventDate || 'a specific date'}`,
      `TIME: ${timeInfo}`,
      `VENUE: ${venueName}${isRabbitHole ? ' (custom venue)' : ''}`,
      ``,
      venueContext ? `VENUE DETAILS:` : '',
      venueContext ? venueContext : '',
      venueContext ? `` : '',
      `USER'S PLOT (THIS IS THE FOUNDATION — DO NOT REPLACE IT):`,
      `${plot}`,
      ``,
      additionalNotes ? `ADDITIONAL NOTES FROM USER:` : '',
      additionalNotes ? `${additionalNotes}` : '',
      additionalNotes ? `` : '',
      `FOCUS CHARACTERS (give these characters the most narrative attention):`,
      focusNames.length > 0 ? focusNames.join(', ') : 'None specified',
      ``,
      `PARTICIPATING CHARACTERS (ALL of these are present at the event):`,
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
      `2. Focus characters should receive greater narrative attention, more detailed emotional moments, and more internal perspective. Supporting participants (including family members, NPCs, and service characters) should still be included where appropriate.`,
      `3. Include light dialogue where it supports the event. Dialogue should enhance the story, not dominate it.`,
      `4. Family members should behave according to their family role. Service characters should behave professionally.`,
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
      `    { "character_id": "the_exact_id", "character_name": "Name", "memory_text": "What this character remembers about the event — personal, specific, from their perspective. Include: the event title, venue, who they saw there, what they did, interactions they had, and how they felt. A few sentences.", "memory_summary": "Short summary for retrieval (one sentence)", "importance_score": 1-10, "emotional_tone": "positive|negative|neutral|mixed" }`,
      `  ],`,
      `  "image_prompts": [`,
      `    { "moment": "opening", "prompt": "Image generation prompt for the opening moment at ${venueName}. CRITICAL: Describe each visible character using ONLY their APPEARANCE data from the character details above — skin tone, hair, hairstyle, facial hair, clothing style, overall aesthetic. DO NOT invent generic people. DO NOT describe strangers. Every person in this image must match their character's documented appearance. Include venue ambiance, lighting, and mood.", "description": "What the image shows." },`,
      `    { "moment": "key_moment", "prompt": "Image generation prompt for the peak moment. Focus characters must be prominent and described using their documented appearance. Supporting characters who appear must also use their documented appearance. DO NOT generate stand-ins.", "description": "What the image shows." },`,
      `    { "moment": "closing", "prompt": "Image generation prompt for the closing moment. Describe each visible character using their documented appearance. No generic faces.", "description": "What the image shows." }`,
      `  ]`,
      `}`,
      ``,
      `RULES:`,
      `- The narrative MUST follow the user's plot. Do not invent a different storyline.`,
      `- Emotional outcomes must be supported by what happens in the narrative. No random emotions.`,
      `- Relationship changes must have a meaningful reason in the narrative. No unsupported changes.`,
      `- Focus characters get richer memories with higher importance scores.`,
      `- EVERY participant (family members, NPCs, service characters, AND active characters) gets at least one memory. No character who attended is left without a memory.`,
      `- Image prompts must reference the venue: ${venueName}.`,
      `- IMAGE IDENTITY RULE (CRITICAL): For every character visible in an image, copy their APPEARANCE data verbatim from the character details above. Use their actual skin tone, hair, hairstyle, clothing, aesthetic. DO NOT describe generic strangers. DO NOT invent replacement faces. The people shown must match the selected characters.`,
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
      await base44.asServiceRole.entities.StoryEvent.update(eventId, {
        status: 'failed',
        generation_error: `LLM error: ${e.message}`,
      });
      return Response.json({ error: e.message }, { status: 500 });
    }

    // ── STEP 2: CREATE STORY EVENT MEMORIES ──────────────────────────────────
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

    // ── STEP 2b: WRITE TO CHARACTER.MEMORIES ARRAY (read by buildFullCanonicalPrompt) ─
    // This is the primary memory well read by the chat context builder.
    // CRITICAL: Fetch FRESH character state — the charById snapshot is stale.
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: mem.character_id }, null, 1);
        const freshChar = freshChars[0];
        if (!freshChar) continue;
        const existingMemories = freshChar.memories || [];
        const newMemoryEntry = {
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          date: eventDate,
          emotion_state: mem.emotional_tone || 'neutral',
          created_date: new Date().toISOString(),
        };
        await base44.asServiceRole.entities.Character.update(mem.character_id, {
          memories: [...existingMemories, newMemoryEntry],
        });
      } catch (_) {}
    }

    // ── STEP 2c: WRITE TO MEMORY ENTITY (primary semantic retrieval well) ─────
    // The Memory entity is what retrieveActiveMemory reads from for semantic search.
    // Field names: title, description, character_id, emotional_impact, source_context, timestamp
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const eventContext = `[Story Event: ${title} — ${eventDate} at ${venueName}]`;
        await base44.asServiceRole.entities.Memory.create({
          character_id: mem.character_id,
          title: `Attended: ${title}`,
          description: `${eventContext} ${mem.memory_text}`,
          emotional_impact: mem.emotional_tone || 'neutral',
          source_context: `story_event_${eventId}`,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}
    }

    // ── STEP 2d: CREATE CHARACTER MEMORY RECORDS (Life Journal block) ─────────
    // CharacterMemory feeds the Life Journal block in buildCanonicalCharacterContext.
    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: mem.character_id,
          memory_type: 'event',
          memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${mem.memory_text}`,
          memory_summary: mem.memory_summary || `Attended "${title}" at ${venueName} on ${eventDate}`,
          importance_score: mem.importance_score || 5,
          confidence_score: 0.95,
          permanence: (mem.importance_score || 5) >= 7 ? 'protected' : 'long_term',
          validation_status: 'confirmed',
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

    // ── STEP 5: GENERATE IMAGES WITH CHARACTER IDENTITY REFERENCES ───────────
    const imagePrompts = generated.image_prompts || [];
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };

    for (const img of imagePrompts) {
      if (!img.moment || !img.prompt) continue;
      try {
        // Use all character reference images, with focus character images prioritized first
        const refImages = [...focusRefImages, ...characterReferenceImages]
          .filter((url, i, arr) => arr.indexOf(url) === i) // deduplicate
          .slice(0, 10); // limit to avoid huge payloads

        const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: img.prompt,
          existing_image_urls: refImages.length > 0 ? refImages : undefined,
        });

        if (imageRes?.url) {
          // Create StoryEventImage — the canonical event-image link
          const storyImage = await base44.asServiceRole.entities.StoryEventImage.create({
            story_event_id: eventId,
            moment_type: img.moment,
            image_url: imageRes.url,
            description: img.description || '',
            prompt: img.prompt,
            order: momentOrder[img.moment] ?? 0,
          });

          // Create Message record for Media Gallery visibility
          // This is the critical fix: without a Message record, the image
          // cannot appear in Media Gallery or be sent/regenerated.
          const visibleCharIds = img.moment === 'opening' ? participantIds.slice(0, 3)
            : img.moment === 'key_moment' ? (focusIds.length > 0 ? focusIds : participantIds.slice(0, 2))
            : participantIds.slice(0, 2);

          const visibleCharNames = visibleCharIds.map(id => charById[id]?.name || id).filter(Boolean);

          await base44.asServiceRole.entities.Message.create({
            conversation_id: `story_event_${eventId}`,
            sender_type: 'user',
            content: '',
            image_url: imageRes.url,
            image_description: img.description || img.prompt,
            image_analysis_status: 'complete',
            generation_context: {
              source: 'story_event',
              story_event_id: eventId,
              story_event_image_id: storyImage?.id || null,
              event_title: title,
              event_date: eventDate,
              moment_type: img.moment,
              participant_character_ids: participantIds,
              focus_character_ids: focusIds,
              visible_character_ids: visibleCharIds,
              visible_character_names: visibleCharNames,
              venue_id: event.venue_id || null,
              venue_name: venueName,
              scene_prompt: img.prompt,
              character_reference_images: refImages.slice(0, 5),
              subjects: visibleCharIds.map(cid => ({
                subject_type: 'character',
                subject_id: cid,
                subject_name: charById[cid]?.name || cid,
              })),
            },
            timestamp: new Date().toISOString(),
            owner_email: ownerEmail,
          });
        }
      } catch (_) {}
    }

    // ── STEP 5b: CREATE LIFEEVENT RECORDS (DASHBOARD & LIFE JOURNAL) ────────
    // This is the critical fix: LifeJournal and CharacterDashboard read LifeEvent,
    // NOT StoryEventMemory/CharacterMemory. Without this, events are invisible.
    const milestoneEventTypes = ['life_milestone_event', 'celebration_event', 'bonding_event', 'growth_event', 'supportive_event'];
    const isMajorEvent = (generated.narrative || '').length > 600 || (focusIds.length >= 2);
    const defaultEventType = isMajorEvent ? 'life_milestone_event' : 'bonding_event';

    for (const mem of memories) {
      if (!mem.character_id || !mem.memory_text) continue;
      const tone = mem.emotional_tone || 'neutral';
      const valence = tone === 'positive' || tone === 'mixed' ? 'positive'
        : tone === 'negative' ? 'negative' : 'neutral';
      const eventTypeForChar = tone === 'positive'
        ? (isMajorEvent ? 'celebration_event' : 'bonding_event')
        : tone === 'negative'
        ? 'setback_event'
        : defaultEventType;

      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          event_type: eventTypeForChar,
          severity: isMajorEvent ? 'major' : 'significant',
          valence,
          emotional_impact: `${mem.emotional_tone || 'neutral'} — ${eventTypeForChar.replace(/_/g, ' ')}`,
          timestamp: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          triggered_by: 'story_event',
          systems_updated: ['memories', 'relationships', 'emotional_state'],
          context_tags: ['story_event', eventId, `participant_${mem.character_id}`],
        });
      } catch (_) {}
    }

    // ── STEP 5c: CREATE COMMUNITYEVENT (CALENDAR & HOMEPAGE STRIP) ──────────
    // Makes the story event visible on the Moments calendar and Homepage community strip
    try {
      await base44.asServiceRole.entities.CommunityEvent.create({
        name: title,
        event_type: 'celebration',
        source: 'user_calendar',
        show_on_community_strip: true,
        location_id: event.venue_id || null,
        location_name: venueName || null,
        start_date: `${eventDate || ''}T${startTime || '00:00'}:00.000`,
        end_date: endTime ? `${eventDate}T${endTime}:00.000` : null,
        is_active: true,
        owner_email: ownerEmail,
        description: generated.narrative_preview || '',
        vibe: 'social',
        participations_count: participantIds.length,
      });
    } catch (_) {}

    // ── STEP 5d: CREATE EVENTPARTICIPATION (DASHBOARD ATTENDANCE) ────────────
    for (const mem of memories) {
      if (!mem.character_id) continue;
      try {
        await base44.asServiceRole.entities.EventParticipation.create({
          event_id: eventId,
          event_name: title,
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          owner_email: ownerEmail,
          participation_type: focusIds.includes(mem.character_id) ? 'attended' : 'attended',
          emotional_tone: mem.emotional_tone || 'neutral',
          participation_date: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          memory_strength: (mem.importance_score || 5) >= 7 ? 'strong' : 'moderate',
          notes: mem.memory_summary || mem.memory_text?.substring(0, 120) || '',
          saw_character_ids: participantIds.filter(id => id !== mem.character_id),
        });
      } catch (_) {}
    }

    // ── STEP 6: PARTICIPANT COVERAGE GUARANTEE ────────────────────────────────
    // The LLM may not generate a memory for every participant despite instructions.
    // This pass ensures NO participant is left without records.
    const memoryCoveredIds = new Set(memories.map(m => m.character_id));
    const uncoveredIds = allIds.filter(id => !memoryCoveredIds.has(id));

    for (const cid of uncoveredIds) {
      const c = charById[cid];
      const cname = c?.name || c?.display_name || cid;
      const fallbackText = `${cname} attended the story event "${title}" on ${eventDate} at ${venueName}.`;
      const fallbackSummary = `Attended "${title}" at ${venueName} on ${eventDate}`;
      const fallbackTone = 'neutral';

      // StoryEventMemory
      try {
        await base44.asServiceRole.entities.StoryEventMemory.create({
          story_event_id: eventId, character_id: cid, character_name: cname,
          memory_text: fallbackText, memory_summary: fallbackSummary,
          memory_type: 'event', importance_score: 3, emotional_tone: fallbackTone,
          owner_email: ownerEmail,
        });
      } catch (_) {}

      // Character.memories
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        const freshChar = freshChars[0];
        if (freshChar) {
          await base44.asServiceRole.entities.Character.update(cid, {
            memories: [...(freshChar.memories || []), {
              title: `Story Event: ${title}`, description: fallbackText,
              date: eventDate, emotion_state: fallbackTone,
              created_date: new Date().toISOString(),
            }],
          });
        }
      } catch (_) {}

      // Memory entity
      try {
        await base44.asServiceRole.entities.Memory.create({
          character_id: cid, title: `Attended: ${title}`,
          description: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${fallbackText}`,
          emotional_impact: fallbackTone, source_context: `story_event_${eventId}`,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}

      // CharacterMemory
      try {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: cid, memory_type: 'event',
          memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${fallbackText}`,
          memory_summary: fallbackSummary, importance_score: 3,
          confidence_score: 0.8, permanence: 'long_term', validation_status: 'confirmed',
        });
      } catch (_) {}

      // LifeEvent
      try {
        await base44.asServiceRole.entities.LifeEvent.create({
          character_id: cid, character_name: cname,
          title: `Story Event: ${title}`, description: fallbackText,
          event_type: 'bonding_event', severity: 'significant', valence: 'neutral',
          emotional_impact: `neutral — bonding event`,
          timestamp: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          triggered_by: 'story_event',
          systems_updated: ['memories'],
          context_tags: ['story_event', eventId, `participant_${cid}`],
        });
      } catch (_) {}

      // EventParticipation
      try {
        await base44.asServiceRole.entities.EventParticipation.create({
          event_id: eventId, event_name: title,
          character_id: cid, character_name: cname,
          owner_email: ownerEmail, participation_type: 'attended',
          emotional_tone: fallbackTone,
          participation_date: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          memory_strength: 'moderate', notes: fallbackSummary,
          saw_character_ids: participantIds.filter(id => id !== cid),
        });
      } catch (_) {}
    }

    // ── STEP 7: UPDATE STORY EVENT STATUS WITH FULL DATA ────────────────────
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
      uncoveredFilled: uncoveredIds.length,
      totalParticipants: allIds.length,
      imagesGenerated: imagePrompts.length,
      relationshipChanges: relChanges.length,
      participantTypes: allIds.map(id => charById[id]?.character_type || 'unknown'),
    });
  } catch (error) {
    console.error('[generateStoryEvent]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});