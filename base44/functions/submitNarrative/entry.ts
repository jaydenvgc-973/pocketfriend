import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, conversationId, narrativeContent } = await req.json();

    if (!characterId || !conversationId || !narrativeContent) {
      return Response.json({ error: 'characterId, conversationId, and narrativeContent are required' }, { status: 400 });
    }

    // Use service role for the character lookup so NPCs (which are owned by the user
    // but may only be readable via the NPC fetch path) are always found.
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: user.email });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found or not owned by this user' }, { status: 404 });
    }

    const nowISO = new Date().toISOString();
    const nowDisplay = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });

    // Save narrative as a system message in the conversation
    const narrativeMessage = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: character[0].name,
      content: narrativeContent,
      timestamp: nowISO,
      is_narrative: true
    });

    // Update character's current_life_event to reflect this narrative.
    // Use service role so the update succeeds regardless of whether the character
    // is an NPC or active character — ownership was already verified via auth.me() above.
    const updatedCharacter = await base44.asServiceRole.entities.Character.update(characterId, {
      current_life_event: narrativeContent.substring(0, 150),
      life_last_updated: nowISO
    });

    // Use LLM to detect any scheduled future events in the narrative
    let scheduledEvents = [];
    const timePatterns = /\b(\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)|tonight|tomorrow|next\s+\w+|\d{1,2}\s*(o'clock))\b/i;
    if (timePatterns.test(narrativeContent)) {
      const extractionResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Current date and time: ${nowDisplay} (${nowISO})

A narrator has written this event into a character's story:
"${narrativeContent}"

Identify any future scheduled events with specific times mentioned. For each, resolve the time reference to an exact ISO 8601 UTC datetime based on the current time above.

Return JSON:
{
  "events": [
    {
      "description": "What will happen (natural language)",
      "trigger_time": "<ISO 8601 UTC>",
      "has_time": true
    }
  ]
}

If no specific future time is referenced, return { "events": [] }.`,
        response_json_schema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  trigger_time: { type: 'string' },
                  has_time: { type: 'boolean' }
                }
              }
            }
          }
        }
      });

      if (extractionResult?.events?.length > 0) {
        for (const ev of extractionResult.events) {
          if (!ev.trigger_time || !ev.has_time) continue;
          const record = await base44.entities.ScheduledEvent.create({
            character_ids: [characterId],
            character_names: [character[0].name],
            description: ev.description,
            trigger_time: ev.trigger_time,
            status: 'pending',
            type: 'narrative',
            source: 'narrator',
            conversation_id: conversationId,
            primary_character_id: characterId
          });
          scheduledEvents.push(record);
        }
      }
    }

    return Response.json({ 
      success: true, 
      message: narrativeMessage,
      character: updatedCharacter,
      scheduled_events: scheduledEvents
    });

  } catch (error) {
    console.error('Error submitting narrative:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});