import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * deleteStoryEvent — Cascading delete for a StoryEvent and ALL associated records.
 *
 * Deletes:
 *   - StoryEventMemory (by story_event_id)
 *   - StoryEventImage (by story_event_id)
 *   - EventParticipation (by event_id)
 *   - LifeEvent (by context_tags containing eventId)
 *   - Message records in the story_event gallery Conversation
 *   - The story_event Conversation itself
 *   - The StoryEvent record
 *
 * Ownership is verified via owner_email before any deletion.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { event_id } = body;
    if (!event_id) return Response.json({ error: 'event_id is required' }, { status: 400 });

    // Fetch the StoryEvent
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Verify ownership
    if (event.owner_email !== user.email) {
      return Response.json({ error: 'Not authorized to delete this event' }, { status: 403 });
    }

    const results = { deleted: {}, errors: [] };

    // 1. Delete StoryEventMemory records
    try {
      await base44.asServiceRole.entities.StoryEventMemory.deleteMany({ story_event_id: event_id });
      results.deleted.story_event_memories = true;
    } catch (e) { results.errors.push(`StoryEventMemory: ${e.message}`); }

    // 2. Delete StoryEventImage records
    try {
      await base44.asServiceRole.entities.StoryEventImage.deleteMany({ story_event_id: event_id });
      results.deleted.story_event_images = true;
    } catch (e) { results.errors.push(`StoryEventImage: ${e.message}`); }

    // 3. Delete EventParticipation records
    try {
      await base44.asServiceRole.entities.EventParticipation.deleteMany({ event_id });
      results.deleted.event_participations = true;
    } catch (e) { results.errors.push(`EventParticipation: ${e.message}`); }

    // 4. Delete LifeEvent records (context_tags contains eventId)
    try {
      await base44.asServiceRole.entities.LifeEvent.deleteMany({ context_tags: event_id });
      results.deleted.life_events = true;
    } catch (e) { results.errors.push(`LifeEvent: ${e.message}`); }

    // 5. Delete gallery Messages + story_event Conversation
    try {
      const convos = await base44.asServiceRole.entities.Conversation.filter(
        { title: `story_event::${event_id}`, channel: 'story_event' }, null, 10
      ).catch(() => []);

      for (const convo of (convos || [])) {
        try {
          await base44.asServiceRole.entities.Message.deleteMany({ conversation_id: convo.id });
        } catch (_) {}
        try {
          await base44.asServiceRole.entities.Conversation.delete(convo.id);
        } catch (_) {}
      }
      results.deleted.gallery_messages_and_conversations = true;
    } catch (e) { results.errors.push(`Gallery cleanup: ${e.message}`); }

    // 6. Delete the StoryEvent itself
    try {
      await base44.asServiceRole.entities.StoryEvent.delete(event_id);
      results.deleted.story_event = true;
    } catch (e) { results.errors.push(`StoryEvent: ${e.message}`); }

    return Response.json({ success: true, event_id, results });
  } catch (error) {
    console.error('[deleteStoryEvent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});