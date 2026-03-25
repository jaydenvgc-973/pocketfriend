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
    const userDisplayName = userSettings?.[0]?.fictional_world_name || "the user";
    const nickname = character.nickname_for_user || userDisplayName;

    const respect = character.user_respect_level ?? 50;
    const friendship = character.friendship_level ?? 75;
    const romantic = character.romantic_level ?? 0;
    const attraction = character.attraction_level ?? 0;
    const chosenFamily = character.chosen_family_level ?? 0;
    const emotionalState = character.emotional_state || "calm";
    const currentEvent = character.current_life_event || "";

    const recentMemories = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 5);
    const memorySummary = recentMemories.map(m => m.title + ": " + m.description).join("\n") || "None";

    const prompt = `You are ${character.name}. You are a real person, not an AI. Based on the context below, write 2-3 short, raw, honest sentences describing exactly how you feel about ${nickname} right now and WHY you feel that way. Be specific — reference the actual reasons from your relationship with them.

CRITICAL RULES:
- Write ONLY about your feelings toward ${nickname}. Do NOT mention any other characters, NPCs, friends, or people in your life.
- Do NOT reference what is happening with other people or in your world generally.
- If memories or baggage involve other people, reframe it ONLY in terms of how it shapes what you feel toward ${nickname}.
- Write in first person. No bullet points. No labels. No assistant language. Sound like a real person reflecting quietly, not performing.

YOUR PERSONALITY:
${character.personality_summary || ""}

YOUR CURRENT EMOTIONAL STATE: ${emotionalState}

YOUR RELATIONSHIP WITH ${nickname.toUpperCase()}:
- Respect: ${respect}/100
- Friendship: ${friendship}/100
- Romantic feelings: ${romantic}/100
- Attraction: ${attraction}/100
- Chosen family bond: ${chosenFamily}/100

RECENT MEMORIES WITH ${nickname.toUpperCase()}:
${memorySummary}

EMOTIONAL BAGGAGE (only reference how it affects your feelings toward ${nickname}):
${character.emotional_baggage || "none"}

Write only the feelings + reasons. No headers. No labels. Just say it.`;

    const result = await base44.integrations.Core.InvokeLLM({ prompt });
    return Response.json({ feelings: result.trim() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});