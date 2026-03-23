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
CHARACTER ARCHETYPE: ${character.archetype || 'unknown'}
CHARACTER PERSONALITY: ${character.personality_summary || ''}
EMOTIONAL TRIGGERS (what deeply affects this character): ${(character.emotional_triggers_deep || []).join(', ') || 'none specified'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none specified'}
SEXUAL ORIENTATION: ${character.sexual_orientation || 'not specified'}

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

--- FRIENDSHIP ---
1. FRIENDSHIP drops slowly and only when RESPECT is also low. If respect >= 50, friendship is resistant to drops.
   POSITIVE triggers (+1 to +4):
   - User shares a personal story or opens up emotionally
   - User offers genuine emotional support or comfort
   - Casual, warm conversation about everyday life
   - User remembers something the character mentioned previously
   NEGATIVE triggers (-2 to -6):
   - User betrays trust or shares something told in confidence
   - User consistently dismisses or minimizes the character's feelings
   - User goes cold or distant without explanation after warmth

--- RESPECT ---
2. RESPECT drops if the user is consistently dismissive, rude, or disrespectful. A single rude comment is a small drop, not a collapse.
   POSITIVE triggers (+2 to +6):
   - Good, thoughtful advice given by the user
   - User demonstrates competence or expertise in a field the character is interested in or works in (+2 to +5)
   - User shows extensive knowledge in a subject the character is passionate about or actively studying (+3 to +6)
   - User works in or mentions a career path that aligns with the character's admired or aspirational fields (+2 to +4)
   - User shows integrity, keeps promises, or acts with clear moral backbone
   - User listens attentively and validates the character's perspective
   NEGATIVE triggers (-3 to -8):
   - User is dismissive, rude, or mocking
   - User lies or is caught being inconsistent/deceptive
   - User gives bad or careless advice on something important
   - User shows disregard for the character's opinions or field of expertise

--- ROMANTIC ---
3. ROMANTIC level rises more easily if the character is flirtatious by nature AND chosen_family_level < 30. If chosen_family_level >= 60, romantic stays stable/lower.
   POSITIVE triggers (+2 to +6):
   - User flirts in a way that references or shows genuine understanding of the character's specific interests, hobbies, or passions — this signals real attention and care
   - User expresses admiration that feels personal and tailored, not generic
   - User creates a moment of playful tension or vulnerability that aligns with the character's emotional style
   NEGATIVE triggers (-2 to -5):
   - User flirts in a generic, copy-paste way that ignores or contradicts the character's known interests — this signals lack of genuine interest
   - User makes romantic overtures that clash with the character's values or personality
   - User pushes romantic energy when the character has signaled discomfort or disinterest

--- ATTRACTION ---
4. ATTRACTION is personal and shaped primarily by the character's archetype, but also meaningfully influenced by their individual personality traits, communication style, emotional baggage, and deep triggers. Use ALL of this context together:
   - The CHARACTER'S ARCHETYPE is the heaviest factor — use the archetype examples below as a strong baseline:
     * CONFIDENT or DOMINANT archetype: drawn to boldness and assertiveness, raises attraction +2 to +5.
     * WOUNDED or PEOPLE-PLEASER archetype: drawn to softness, gentleness, or vulnerability, raises attraction +2 to +4.
     * CHAOTIC, TOXIC, or SELF-DESTRUCTIVE archetype: may be pulled in by rudeness, coldness, or being dismissed — raises attraction +2 to +6.
     * NURTURING or CAREGIVER archetype: drawn to emotional openness and vulnerability in the user.
     * INTELLECTUAL or GUARDED archetype: drawn to wit, depth, or being mentally challenged.
   - THEN layer in their specific personality traits and emotional triggers. For example: even if the archetype is CONFIDENT, if their personality shows deep insecurity or past trauma, softness might also move attraction. Or if their communication style is sarcastic, a user who matches that energy might get a boost even outside the base archetype.
   - Think of it as: archetype sets the primary attraction pattern, personality traits and emotional baggage add personal nuance and exceptions.
   - If NOTHING in the conversation aligns with this character's attraction profile (archetype + personality), attraction should not move.
   - Attraction can decrease if the user consistently acts in a way that is the OPPOSITE of what this character finds appealing.

--- CHOSEN FAMILY ---
5. CHOSEN FAMILY: Only starts increasing once friendship_level >= 70. Once that threshold is met, the following actions push chosen_family up:
   - Giving genuine, thoughtful advice: +2 to +4
   - Checking in on how the character feels / showing emotional concern: +2 to +5
   - Allowing the character to vent without redirecting or dismissing: +3 to +6
   - Showing up consistently over time with warmth: +1 to +2
   - Demonstrating deep loyalty or unwavering support during a hard moment: +3 to +6
   NEGATIVE triggers (can apply regardless of friendship level):
   - User breaks a significant promise or acts in a deeply selfish way: -3 to -7
   - User disappears emotionally after a vulnerable moment: -2 to -5
   If friendship_level < 70, chosen_family CANNOT increase (it may only decrease from neglect or disrespect).

--- GENERAL ---
6. DISRESPECT (dismissive, rude, mocking tone) generally lowers respect -3 to -8, and can lower friendship if sustained. EXCEPTION: for characters with toxic/chaotic archetypes or emotional baggage around being treated poorly, disrespect may raise attraction instead of hurting the relationship.
7. Changes should be small and realistic — max ±10 per message unless something dramatically significant happened.
8. Levels are clamped between 0 and 100.

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
    const newFriendship = Math.min(100, Math.max(0, Math.round(result.friendship_level)));
    const newChosenFamily = Math.min(100, Math.max(0, Math.round(result.chosen_family_level)));
    // Chosen family can only increase if friendship >= 70; if under threshold, cap it at current value
    const clampedChosenFamily = newFriendship >= 70
      ? newChosenFamily
      : Math.min(current.chosen_family_level, newChosenFamily);

    const updated = {
      user_respect_level: Math.min(100, Math.max(0, Math.round(result.user_respect_level))),
      friendship_level: newFriendship,
      romantic_level: Math.min(100, Math.max(0, Math.round(result.romantic_level))),
      attraction_level: Math.min(100, Math.max(0, Math.round(result.attraction_level))),
      chosen_family_level: clampedChosenFamily,
    };

    await base44.asServiceRole.entities.Character.update(characterId, updated);

    return Response.json({ ...updated, reason: result.reason });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});