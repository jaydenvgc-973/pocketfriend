import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const pendingEvents = await base44.asServiceRole.entities.ScheduledEvent.filter({ status: 'pending' });
    const dueEvents = pendingEvents.filter(e => e.trigger_time && e.trigger_time <= now);

    if (dueEvents.length === 0) {
      return Response.json({ success: true, processed: 0 });
    }

    const results = [];

    for (const event of dueEvents) {
      try {
        await base44.asServiceRole.entities.ScheduledEvent.update(event.id, { status: 'completed' });

        for (const charId of (event.character_ids || [])) {
          // Update character state
          await base44.asServiceRole.entities.Character.update(charId, {
            current_life_event: event.description,
            life_last_updated: new Date().toISOString(),
          });

          // Log to life event system — classify the event type from description
          const eventTypeClassification = classifyEventFromDescription(event.description);
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: charId,
            character_name: (event.character_names || [])[event.character_ids?.indexOf(charId)] || '',
            event_type: eventTypeClassification.event_type,
            valence: eventTypeClassification.valence,
            severity: 'significant',
            title: event.description.substring(0, 60),
            description: event.description,
            emotional_impact: 'This scheduled event has come to pass and affects the character.',
            triggered_by: 'scheduled_event',
            conversation_id: event.conversation_id || null,
            context_tags: ['scheduled', event.source || 'unknown'],
            systems_updated: ['mood', 'memory'],
            timestamp: new Date().toISOString(),
          });

          // Memory — always
          await base44.asServiceRole.entities.Memory.create({
            character_id: charId,
            title: `Event: ${event.description.substring(0, 60)}`,
            description: event.description,
            emotional_impact: `This was a ${eventTypeClassification.valence} moment that was anticipated and has now occurred.`,
            timestamp: new Date().toISOString(),
            source_context: `scheduled_event:${event.id}`,
          });

          // Mood — update based on event valence
          if (eventTypeClassification.valence === 'positive') {
            await base44.asServiceRole.entities.Character.update(charId, { emotional_state: 'excited' });
          } else if (eventTypeClassification.valence === 'negative') {
            await base44.asServiceRole.entities.Character.update(charId, { emotional_state: 'anxious' });
          }
        }

        // If narrative type, post in chat
        if (event.type !== 'internal' && event.conversation_id && event.primary_character_id) {
          const chars = await base44.asServiceRole.entities.Character.filter({ id: event.primary_character_id });
          const character = chars[0];

          if (character) {
            await base44.asServiceRole.entities.Message.create({
              conversation_id: event.conversation_id,
              sender_type: 'character',
              character_id: event.primary_character_id,
              character_name: character.name,
              content: event.description,
              is_narrative: true,
              timestamp: new Date().toISOString(),
            });

            await base44.asServiceRole.entities.Conversation.update(event.conversation_id, {
              last_message_preview: event.description.substring(0, 100),
              last_message_date: new Date().toISOString(),
            });
          }
        }

        results.push({ event_id: event.id, status: 'processed' });
      } catch (err) {
        console.error(`[processScheduledEvents] Failed for event ${event.id}:`, err.message);
        results.push({ event_id: event.id, status: 'error', error: err.message });
      }
    }

    return Response.json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('[processScheduledEvents] ERROR:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Heuristic classifier for scheduled event descriptions
function classifyEventFromDescription(description) {
  const text = (description || '').toLowerCase();

  if (/accident|crash|injury|hospital|hurt|emergency|ambulance|911/.test(text)) {
    return { event_type: 'accident_event', valence: 'negative' };
  }
  if (/drunk|drinking|bar|party|high|substances/.test(text)) {
    return { event_type: 'substance_use_event', valence: 'negative' };
  }
  if (/fight|argument|confrontation|yell|scream|blow up/.test(text)) {
    return { event_type: 'fight_event', valence: 'negative' };
  }
  if (/arrested|police|legal|court|fine|charged/.test(text)) {
    return { event_type: 'legal_or_social_consequence_event', valence: 'negative' };
  }
  if (/died|death|funeral|passed away|grief|loss|mourning/.test(text)) {
    return { event_type: 'grief_event', valence: 'negative' };
  }
  if (/breakup|broke up|separated|divorce|ended/.test(text)) {
    return { event_type: 'setback_event', valence: 'negative' };
  }
  if (/promotion|hired|got the job|new job|raise/.test(text)) {
    return { event_type: 'life_milestone_event', valence: 'positive' };
  }
  if (/baby|born|birth|pregnant|graduation|engaged|married|wedding/.test(text)) {
    return { event_type: 'life_milestone_event', valence: 'positive' };
  }
  if (/reconcil|made up|forgave|forgiven|apologized/.test(text)) {
    return { event_type: 'reconciliation_event', valence: 'positive' };
  }
  if (/celebrat|party|win|won|achievement|accomplished/.test(text)) {
    return { event_type: 'celebration_event', valence: 'positive' };
  }
  if (/sick|ill|diagnosis|doctor|hospital|health/.test(text)) {
    return { event_type: 'medical_event', valence: 'negative' };
  }

  // Default
  return { event_type: 'routine_positive_event', valence: 'neutral' };
}