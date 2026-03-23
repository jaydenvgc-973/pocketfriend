import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, userMessage, characterReply, recentMessages } = await req.json();
    if (!characterId || !userMessage) return Response.json({ error: 'Missing required fields' }, { status: 400 });

    const character = await base44.asServiceRole.entities.Character.get(characterId);
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const current = {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
    };

    const conversationSummary = (recentMessages || [])
      .slice(-10)
      .map(m => `${m.sender_type === 'user' ? 'User' : character.name}: ${m.content}`)
      .join('\n');

    const prompt = `You are a relationship dynamics analyzer. Analyze this conversation and update the relationship levels between the character and the user.

CHARACTER: ${character.name}
CHARACTER PERSONALITY: ${character.personality_summary || ''}

CURRENT RELATIONSHIP LEVELS (0-100):
- Respect: ${current.user_respect_level}
- Friendship: ${current.friendship_level}
- Romantic: ${current.romantic_level}
- Attraction: ${current.attraction_level}
- Chosen Family: ${current.chosen_family_level}

RECENT CONVERSATION CONTEXT:
${conversationSummary || 'No prior context.'}

LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"

RELATIONSHIP RULES — apply these carefully:
1. FRIENDSHIP drops slowly and only when RESPECT is also low. If respect >= 50, friendship is resistant to drops.
2. RESPECT drops if the user is consistently dismissive, rude, or disrespectful. A single rude comment is a small drop, not a collapse.
3. ROMANTIC level rises more easily if the character is flirtatious by nature AND chosen_family_level < 30. If chosen_family_level >= 60, romantic stays stable/lower.
4. CHOSEN FAMILY rises slowly over time when the user shows consistent loyalty, dependability, or genuine care.
5. GOOD ADVICE given by the user raises respect +2 to +5 and friendship +1 to +3.
6. TALKING ABOUT THEIR DAY (casual sharing) raises friendship +1 to +3.
7. LETTING THE CHARACTER VENT (user listens, validates, doesn't redirect) raises respect +3 to +6 and chosen_family +1 to +2.
8. DISRESPECT (dismissive, rude, mocking tone) lowers respect -3 to -8, and can lower friendship if sustained.
9. Changes should be small and realistic — max ±10 per message unless something dramatically significant happened.
10. Levels are clamped between 0 and 100.

Respond with ONLY a valid JSON object in this exact format:
{
  "user_respect_level": <number>,
  "friendship_level": <number>,
  "romantic_level": <number>,
  "attraction_level": <number>,
  "chosen_family_level": <number>,
  "reason": "<one concise sentence explaining what changed and why>"
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          user_respect_level: { type: "number" },
          friendship_level: { type: "number" },
          romantic_level: { type: "number" },
          attraction_level: { type: "number" },
          chosen_family_level: { type: "number" },
          reason: { type: "string" }
        },
        required: ["user_respect_level", "friendship_level", "romantic_level", "attraction_level", "chosen_family_level", "reason"]
      }
    });

    // Clamp all values 0-100
    const updated = {
      user_respect_level: Math.min(100, Math.max(0, Math.round(result.user_respect_level))),
      friendship_level: Math.min(100, Math.max(0, Math.round(result.friendship_level))),
      romantic_level: Math.min(100, Math.max(0, Math.round(result.romantic_level))),
      attraction_level: Math.min(100, Math.max(0, Math.round(result.attraction_level))),
      chosen_family_level: Math.min(100, Math.max(0, Math.round(result.chosen_family_level))),
    };

    await base44.asServiceRole.entities.Character.update(characterId, updated);

    return Response.json({ ...updated, reason: result.reason });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});