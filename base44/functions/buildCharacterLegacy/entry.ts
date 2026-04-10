/**
 * LEGACY SYSTEM
 * Generates a "legacy summary" — how a character will be remembered
 * based on their life events, relationships, achievements, and bio.
 *
 * This is a read-only summary that accumulates over time.
 * It does NOT modify background-locked fields.
 *
 * Stored in: character.profile_summary (a rolling narrative identity summary)
 * Also logged as a LifeEvent for historical reference.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

    // Gather all data that forms legacy
    const [lifeEvents, memories, achievements] = await Promise.all([
      base44.entities.LifeEvent.filter({ character_id: characterId }, '-timestamp', 100),
      base44.entities.Memory.filter({ character_id: characterId }, '-timestamp', 30),
      base44.entities.UserAchievement.filter({ character_id: characterId }, '-unlocked_at', 20),
    ]);

    const majorEvents = lifeEvents.filter(e => e.severity === 'major' || e.severity === 'significant');
    const positiveEvents = lifeEvents.filter(e => e.valence === 'positive').length;
    const negativeEvents = lifeEvents.filter(e => e.valence === 'negative').length;

    const eventHighlights = majorEvents.slice(0, 10).map(e => `- ${e.title}: ${e.description?.substring(0, 80)}`).join('\n');
    const memoryHighlights = memories.slice(0, 10).map(m => `- ${m.title}: ${m.description?.substring(0, 80)}`).join('\n');
    const achievementList = achievements.map(a => a.achievement_id).join(', ');

    const prompt = `You are writing the LEGACY SUMMARY for a character — how they will be remembered.

CHARACTER: ${character.name}
Age: ${character.age || 'unknown'}
Occupation: ${character.occupation || 'unknown'}
Personality: ${character.personality_summary || 'Not set'}
Current situation: ${character.current_situation || 'Not set'}
Traits: ${(character.personality_traits || []).join(', ')}
Emotional baggage: ${character.emotional_baggage || 'none noted'}

LIFE EVENTS TOTAL: ${lifeEvents.length} (${positiveEvents} positive, ${negativeEvents} negative)

MAJOR MOMENTS:
${eventHighlights || 'No major events recorded yet.'}

KEY MEMORIES:
${memoryHighlights || 'No memories recorded yet.'}

ACHIEVEMENTS: ${achievementList || 'None yet'}

Write a legacy summary — how this person will be remembered, what they stood for, what they went through, and how they changed over time. This should read like a character study, not a list. 2-4 paragraphs. Focus on the arc of their life, not just facts.

Return ONLY valid JSON:
{
  "legacy_summary": "...",
  "defining_trait": "<single most defining characteristic>",
  "life_arc": "<one sentence: the story of their life so far>",
  "remembered_for": "<what people would most remember about them>"
}`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          legacy_summary: { type: 'string' },
          defining_trait: { type: 'string' },
          life_arc: { type: 'string' },
          remembered_for: { type: 'string' },
        },
      },
    });

    // Update profile_summary with the legacy narrative (safe — not a background field)
    await base44.entities.Character.update(characterId, {
      profile_summary: result.legacy_summary,
    });

    // Log as a significant life event
    await base44.entities.LifeEvent.create({
      character_id: characterId,
      character_name: character.name,
      event_type: 'life_milestone_event',
      valence: 'positive',
      severity: 'significant',
      title: 'Legacy Recorded',
      description: result.life_arc,
      triggered_by: 'life_simulation',
      systems_updated: ['bio', 'memory'],
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      legacy_summary: result.legacy_summary,
      defining_trait: result.defining_trait,
      life_arc: result.life_arc,
      remembered_for: result.remembered_for,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});