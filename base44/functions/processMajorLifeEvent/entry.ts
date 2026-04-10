/**
 * MAJOR LIFE EVENT ENGINE
 * Handles promotions, losses, turning points, accidents, and other
 * significant events that cause strong bio updates, emotional shifts,
 * and relationship/reputation impacts.
 *
 * Called when severity = "major" or "significant" is detected.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const BACKGROUND_LOCKED = [
  'background_story', 'backstory', 'family_history', 'background',
  'criminal_record', 'education', 'family_members', 'departed_characters',
  'birthday', 'birth_year',
];

const MAJOR_EVENT_TYPES = {
  // Career
  promotion: { valence: 'positive', bio_impact: 'high', emotional_impact: 'excitement' },
  job_loss: { valence: 'negative', bio_impact: 'high', emotional_impact: 'grief' },
  career_change: { valence: 'mixed', bio_impact: 'medium', emotional_impact: 'anxiety' },
  // Relationships
  breakup: { valence: 'negative', bio_impact: 'medium', emotional_impact: 'grief' },
  reconciliation: { valence: 'positive', bio_impact: 'medium', emotional_impact: 'relief' },
  bereavement: { valence: 'negative', bio_impact: 'high', emotional_impact: 'grief' },
  // Health
  accident: { valence: 'negative', bio_impact: 'high', emotional_impact: 'fear' },
  recovery: { valence: 'positive', bio_impact: 'medium', emotional_impact: 'relief' },
  // Personal
  relocation: { valence: 'mixed', bio_impact: 'medium', emotional_impact: 'anticipation' },
  milestone_achievement: { valence: 'positive', bio_impact: 'high', emotional_impact: 'elation' },
  legal_trouble: { valence: 'negative', bio_impact: 'high', emotional_impact: 'fear' },
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId, eventType, description, context } = body;

    if (!characterId || !eventType) {
      return Response.json({ error: 'characterId and eventType required' }, { status: 400 });
    }

    const character = (await base44.entities.Character.filter({ id: characterId }))[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const eventMeta = MAJOR_EVENT_TYPES[eventType] || {
      valence: 'mixed', bio_impact: 'medium', emotional_impact: 'anticipation'
    };

    // Generate major event impact via LLM
    const prompt = `A major life event has occurred for ${character.name}.

CHARACTER CONTEXT:
- Personality: ${character.personality_summary || 'Not set'}
- Current situation: ${character.current_situation || 'Not set'}
- Current emotional state: ${character.emotional_state || 'calm'}
- Traits: ${(character.personality_traits || []).join(', ')}

MAJOR EVENT:
- Type: ${eventType}
- Description: ${description || 'A significant life change occurred.'}
- Context: ${context || 'No additional context.'}
- Valence: ${eventMeta.valence}
- Expected emotional impact: ${eventMeta.emotional_impact}

Generate realistic impacts of this event. Return ONLY valid JSON:
{
  "emotional_state": "<one of the valid emotional states>",
  "current_situation": "<updated 1-sentence current situation, reflecting this event>",
  "personality_summary": "<updated 1-2 sentence personality summary if this event changes who they are>",
  "daily_micro_narration": "<1 sentence describing what they're doing/feeling today after this event>",
  "current_life_event": "<short label for this event, e.g. 'Just got promoted' or 'Dealing with a breakup'>",
  "life_impact_summary": "<2-3 sentence narrative about how this event has changed or is changing their life>"
}`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          emotional_state: { type: 'string' },
          current_situation: { type: 'string' },
          personality_summary: { type: 'string' },
          daily_micro_narration: { type: 'string' },
          current_life_event: { type: 'string' },
          life_impact_summary: { type: 'string' },
        },
      },
    });

    // Strip any locked background fields
    const safeUpdate = { ...result };
    BACKGROUND_LOCKED.forEach(f => delete safeUpdate[f]);
    const lifeSummary = safeUpdate.life_impact_summary;
    delete safeUpdate.life_impact_summary;

    await base44.entities.Character.update(characterId, safeUpdate);

    // Log a LifeEvent record
    await base44.entities.LifeEvent.create({
      character_id: characterId,
      character_name: character.name,
      event_type: 'life_milestone_event',
      valence: eventMeta.valence,
      severity: 'major',
      title: `Major Event: ${eventType.replace(/_/g, ' ')}`,
      description: description || lifeSummary,
      emotional_impact: result.emotional_state,
      triggered_by: 'life_simulation',
      systems_updated: ['bio', 'mood', 'situation'],
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      event_type: eventType,
      updates_applied: safeUpdate,
      life_impact: lifeSummary,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});