/**
 * BIO UPDATE ENGINE
 * Analyzes recent LifeEvents to detect repeated behavior patterns and
 * significant events, then gradually updates the character's evolving
 * identity (bio) fields: personality_traits, personality_summary,
 * current_situation, habits, social_energy, etc.
 *
 * Rules:
 * - Small/single events → no bio change
 * - Repeated behavior (3+ same-type events) → gradual update
 * - Major events (severity=major) → strong update
 * - NEVER touches background-locked fields
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const BACKGROUND_LOCKED = [
  'background_story', 'backstory', 'family_history', 'background',
  'criminal_record', 'education', 'family_members', 'departed_characters',
  'birthday', 'birth_year',
];

// How many events of the same type trigger a bio update
const REPEAT_THRESHOLD = 3;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { characterId } = body;
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const character = (await base44.entities.Character.filter({ id: characterId }))[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    // Fetch last 60 life events
    const events = await base44.entities.LifeEvent.filter(
      { character_id: characterId }, '-timestamp', 60
    );

    if (events.length < REPEAT_THRESHOLD) {
      return Response.json({ updated: false, reason: 'Not enough events for bio update' });
    }

    // Count event types
    const typeCounts = {};
    const majorEvents = events.filter(e => e.severity === 'major' || e.severity === 'significant');
    events.forEach(e => {
      typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
    });

    const repeatedTypes = Object.entries(typeCounts)
      .filter(([, count]) => count >= REPEAT_THRESHOLD)
      .map(([type]) => type);

    if (repeatedTypes.length === 0 && majorEvents.length === 0) {
      return Response.json({ updated: false, reason: 'No significant patterns detected' });
    }

    // Build LLM prompt to generate bio updates
    const eventSummary = events.slice(0, 20).map(e =>
      `[${e.event_type}/${e.valence}/${e.severity || 'minor'}] ${e.title}: ${e.description?.substring(0, 100)}`
    ).join('\n');

    const prompt = `You are analyzing a character's recent life events to update their evolving identity (bio).

CHARACTER: ${character.name}
Current personality summary: ${character.personality_summary || 'Not set'}
Current traits: ${(character.personality_traits || []).join(', ') || 'None'}
Current situation: ${character.current_situation || 'Not set'}
Current social energy: ${character.social_energy || 'Not set'}

RECENT LIFE EVENTS (most recent 20):
${eventSummary}

REPEATED PATTERNS (3+ occurrences): ${repeatedTypes.join(', ') || 'None'}
MAJOR EVENTS: ${majorEvents.map(e => e.title).join(', ') || 'None'}

Based on this pattern of behavior, update this character's bio. Rules:
- ONLY update based on clear repeated behavior or major life events
- Small or single events do NOT change bio
- Keep changes gradual and realistic
- NEVER alter background, origin, childhood, or past history
- personality_traits: array of 3-6 short trait strings
- personality_summary: 1-2 sentences describing who they are NOW
- current_situation: 1 sentence on current life context

Return ONLY valid JSON:
{
  "personality_traits": ["trait1", "trait2"],
  "personality_summary": "...",
  "current_situation": "...",
  "social_energy": "introvert|mostly_introvert|ambivert|mostly_extrovert|extrovert",
  "bio_update_reason": "brief explanation of what drove this update"
}`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          personality_traits: { type: 'array', items: { type: 'string' } },
          personality_summary: { type: 'string' },
          current_situation: { type: 'string' },
          social_energy: { type: 'string' },
          bio_update_reason: { type: 'string' },
        },
      },
    });

    // Strip any accidentally locked fields
    const safeUpdate = { ...result };
    BACKGROUND_LOCKED.forEach(f => delete safeUpdate[f]);
    delete safeUpdate.bio_update_reason;

    await base44.entities.Character.update(characterId, safeUpdate);

    // Log a life event for the bio update itself
    await base44.entities.LifeEvent.create({
      character_id: characterId,
      character_name: character.name,
      event_type: 'growth_event',
      valence: 'positive',
      severity: 'minor',
      title: 'Identity Evolution',
      description: result.bio_update_reason || 'Bio updated based on repeated behavioral patterns.',
      triggered_by: 'life_simulation',
      systems_updated: ['bio'],
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      updated: true,
      changes: safeUpdate,
      reason: result.bio_update_reason,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});