import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const chars = await base44.entities.Character.filter({ id: characterId });
    const character = chars[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const userSettings = await base44.entities.UserSettings.list();
    const userDisplayName = userSettings?.[0]?.fictional_world_name || "you";
    const nickname = character.nickname_for_user || userDisplayName;

    const respect = character.user_respect_level ?? 50;
    const friendship = character.friendship_level ?? 75;
    const romantic = character.romantic_level ?? 0;
    const attraction = character.attraction_level ?? 0;
    const chosenFamily = character.chosen_family_level ?? 0;
    const emotionalState = character.emotional_state || "calm";

    const recentMemories = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 5);
    const memorySummary = recentMemories.map(m => m.title + ": " + m.description).join("\n") || "None";

    const prompt = `You are ${character.name} speaking directly in first person. Write 2-3 short, honest sentences about how YOU feel toward ${nickname} right now and exactly why.

CRITICAL RULES — violating any = wrong answer:
1. STRICT FIRST PERSON ONLY. Use "I", "me", "my". NEVER say "${character.name}" — you are the speaker, not the subject.
2. Address or reference the other person ONLY as "${nickname}". Never "the user".
3. Talk ONLY about your feelings toward ${nickname}. No other people, no life summary.
4. Sound like a real person thinking quietly — not performing, not explaining.
5. No bullet points. No headers. No labels. Just the raw feeling + the reason behind it.

WRONG (third person — forbidden):
"${character.name} feels deep admiration for ${nickname}. He is grappling with..."

RIGHT (first person — correct):
"I feel something I can't fully name with ${nickname}. There's a pull there I don't know what to do with yet, and that scares me a little."

YOUR PERSONALITY: ${character.personality_summary || ""}
YOUR EMOTIONAL STATE RIGHT NOW: ${emotionalState}
YOUR FEELINGS TOWARD ${nickname.toUpperCase()}:
- Respect: ${respect}/100
- Friendship: ${friendship}/100
- Romantic: ${romantic}/100
- Attraction: ${attraction}/100
- Chosen family: ${chosenFamily}/100
RECENT MEMORIES: ${memorySummary}
EMOTIONAL BAGGAGE (only as it relates to ${nickname}): ${character.emotional_baggage || "none"}

Write it now. First person. No self-name. Direct.`;

    const result = await base44.integrations.Core.InvokeLLM({ prompt });
    return Response.json({ feelings: result.trim() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});