import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * regenerateStoryEvent — Cleans up old generated content and resets the event
 * so generateStoryEvent can re-run from scratch with the current (possibly edited)
 * event data.
 *
 * This function:
 *   1. Deletes old StoryEventMemory, StoryEventImage, EventParticipation,
 *      LifeEvent, and gallery Message/Conversation records for this event.
 *   2. Resets the StoryEvent status to 'generating' and clears all generated fields
 *      (narrative, emotional_outcomes, relationship_changes, generation_error).
 *
 * After this function returns success, the frontend should invoke generateStoryEvent
 * to re-trigger the actual narrative + image generation.
 *
 * Ownership is verified via owner_email before any changes.
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
      return Response.json({ error: 'Not authorized to regenerate this event' }, { status: 403 });
    }

    const results = { cleaned: {}, errors: [] };

    // 1. Delete old StoryEventMemory records
    try {
      await base44.asServiceRole.entities.StoryEventMemory.deleteMany({ story_event_id: event_id });
      results.cleaned.story_event_memories = true;
    } catch (e) { results.errors.push(`StoryEventMemory: ${e.message}`); }

    // 2. Delete old StoryEventImage records
    try {
      await base44.asServiceRole.entities.StoryEventImage.deleteMany({ story_event_id: event_id });
      results.cleaned.story_event_images = true;
    } catch (e) { results.errors.push(`StoryEventImage: ${e.message}`); }

    // 3. Delete old EventParticipation records
    try {
      await base44.asServiceRole.entities.EventParticipation.deleteMany({ event_id });
      results.cleaned.event_participations = true;
    } catch (e) { results.errors.push(`EventParticipation: ${e.message}`); }

    // 4. Delete old LifeEvent records for this event
    try {
      await base44.asServiceRole.entities.LifeEvent.deleteMany({ context_tags: event_id });
      results.cleaned.life_events = true;
    } catch (e) { results.errors.push(`LifeEvent: ${e.message}`); }

    // 5. Delete old gallery Messages + story_event Conversation
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
      results.cleaned.gallery_messages_and_conversations = true;
    } catch (e) { results.errors.push(`Gallery cleanup: ${e.message}`); }

    // 6. Reset the StoryEvent: status → generating, clear all generated content
    await base44.asServiceRole.entities.StoryEvent.update(event_id, {
      status: 'generating',
      generated_narrative: null,
      narrative_preview: null,
      emotional_outcomes: null,
      relationship_changes: null,
      generation_error: null,
    });

    results.cleaned.story_event_reset = true;

    return Response.json({ success: true, event_id, results });
  } catch (error) {
    console.error('[regenerateStoryEvent]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});