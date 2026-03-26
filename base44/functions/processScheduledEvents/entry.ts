import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // Fetch all pending events
    const pendingEvents = await base44.asServiceRole.entities.ScheduledEvent.filter({ status: 'pending' });

    // Filter events whose trigger_time has passed
    const dueEvents = pendingEvents.filter(e => e.trigger_time && e.trigger_time <= now);

    if (dueEvents.length === 0) {
      return Response.json({ success: true, processed: 0 });
    }

    const results = [];

    for (const event of dueEvents) {
      try {
        // Mark as completed first to avoid double-processing
        await base44.asServiceRole.entities.ScheduledEvent.update(event.id, { status: 'completed' });

        // Update each involved character's current life event
        if (event.character_ids?.length > 0) {
          for (const charId of event.character_ids) {
            await base44.asServiceRole.entities.Character.update(charId, {
              current_life_event: event.description,
              life_last_updated: new Date().toISOString()
            });

            // Store in character memory
            await base44.asServiceRole.entities.Memory.create({
              character_id: charId,
              title: `Scheduled event: ${event.description.substring(0, 60)}`,
              description: event.description,
              emotional_impact: 'neutral',
              timestamp: new Date().toISOString(),
              source_context: `scheduled_event:${event.id}`
            });
          }
        }

        // If narrative type and a conversation is linked, post it in chat
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
              timestamp: new Date().toISOString()
            });

            // Update conversation's last message
            await base44.asServiceRole.entities.Conversation.update(event.conversation_id, {
              last_message_preview: event.description.substring(0, 100),
              last_message_date: new Date().toISOString()
            });
          }
        }

        results.push({ event_id: event.id, status: 'processed' });
      } catch (err) {
        console.error(`Failed to process event ${event.id}:`, err.message);
        results.push({ event_id: event.id, status: 'error', error: err.message });
      }
    }

    return Response.json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('processScheduledEvents error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});