import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, userMessage, characterReply, recentMessages, emojiReaction, reactedMessageContent, reactedMessageSenderType } = await req.json();
    if (!characterId) return Response.json({ error: 'Missing required fields' }, { status: 400 });

    // Either a text message or an emoji reaction must be present
    if (!userMessage && !emojiReaction) return Response.json({ error: 'Missing required fields' }, { status: 400 });

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

    // Build the interaction section — either a message exchange or an emoji reaction
    let interactionSection = '';
    if (emojiReaction) {
      const senderLabel = reactedMessageSenderType === 'user' ? 'the User' : `${character.name} (the character)`;
      interactionSection = `
EMOJI REACTION EVENT:
The user reacted with "${emojiReaction}" to a message sent by ${senderLabel}.
The reacted-to message content was: "${reactedMessageContent || '(image or unknown content)'}"

EMOJI REACTION RULES — interpret this carefully:
- A single emoji is NOT a full message. Its meaning is heavily shaped by context: the content of the reacted-to message, the current relationship levels, and this character's personality and emotional style.
- ❤️ (Heart): Could mean romantic interest, strong approval, warmth, or platonic love. If romantic_level > 40, lean romantic (+2 to +4 romantic). If romantic_level < 20 and friendship_level > 50, lean platonic warmth (+2 to +3 friendship). Consider what message it was reacted to — a heart on a photo the character sent of themselves carries more weight than a heart on a random statement.
- 😂 (Laughing): Signals the user finds the character funny or charming. Can boost friendship (+1 to +3) and attraction (+1 to +2) if the character values humor. Minimal impact otherwise.
- 😮 (Surprised/Wow): Shows the user is impressed or caught off guard. Context-dependent — if the content was impressive, raises respect (+1 to +3). If the content was personal/vulnerable, may raise friendship (+1 to +2).
- 😢 (Sad/Crying): If reacting to something emotional or hard the character shared, this signals empathy (+2 to +4 friendship, +1 to +2 chosen family if friendship >= 70). If reacting to something lighthearted, it may feel odd and have minimal impact.
- 😡 (Angry): If reacting to something the character did or said that was upsetting, this signals disapproval (-2 to -4 friendship, -1 to -3 respect). If the context supports it (e.g., reacting angrily to something bad that happened to the character), it could signal protectiveness (+1 to +2 friendship).
- 👍 (Like/Thumbs up): Neutral approval. Small boost to friendship (+1 to +2) or respect (+1) if the content was advice or an achievement. Minimal romantic/attraction impact.
- GENERAL: If the emoji is used on a photo the character sent of themselves, DOUBLE the potential attraction/romantic impact as it signals the user is reacting to the character's appearance or presence.`;
    } else {
      interactionSection = `
LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"`;
    }

    const prompt = `You are a relationship dynamics analyzer. Analyze this interaction and update the relationship levels between the character and the user.

CHARACTER: ${character.name}
CHARACTER ARCHETYPE: ${character.archetype || 'unknown'}
CHARACTER PERSONALITY: ${character.personality_summary || ''}
PERSONALITY TRAITS: ${(character.personality_traits || []).join(', ') || 'none specified'}
EMOTIONAL TRIGGERS (what deeply affects this character): ${(character.emotional_triggers_deep || []).join(', ') || 'none specified'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none specified'}
SEXUAL ORIENTATION: ${character.sexual_orientation || 'not specified'}
INTERESTS & HOBBIES: ${character.current_situation || 'not specified'}

CURRENT RELATIONSHIP LEVELS (0-100):
- Respect: ${current.user_respect_level}
- Friendship: ${current.friendship_level}
- Romantic: ${current.romantic_level}
- Attraction: ${current.attraction_level}
- Chosen Family: ${current.chosen_family_level}

RECENT CONVERSATION CONTEXT:
${conversationSummary || 'No prior context.'}
${interactionSection}

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
   - User flirts in a way that references or shows genuine understanding of the character's specific interests, hobbies, or passions
   - User expresses admiration that feels personal and tailored, not generic
   - User creates a moment of playful tension or vulnerability that aligns with the character's emotional style
   NEGATIVE triggers (-2 to -5):
   - User flirts in a generic, copy-paste way that ignores or contradicts the character's known interests
   - User makes romantic overtures that clash with the character's values or personality
   - User pushes romantic energy when the character has signaled discomfort or disinterest

--- ATTRACTION ---
4. ATTRACTION is personal and shaped primarily by the character's archetype, but also meaningfully influenced by their individual personality traits, communication style, emotional baggage, and deep triggers.
   - CONFIDENT or DOMINANT archetype: drawn to boldness and assertiveness (+2 to +5).
   - WOUNDED or PEOPLE-PLEASER archetype: drawn to softness, gentleness, or vulnerability (+2 to +4).
   - CHAOTIC, TOXIC, or SELF-DESTRUCTIVE archetype: may be pulled in by rudeness, coldness, or being dismissed (+2 to +6).
   - NURTURING or CAREGIVER archetype: drawn to emotional openness and vulnerability.
   - INTELLECTUAL or GUARDED archetype: drawn to wit, depth, or being mentally challenged.
   - Layer in personality traits and emotional triggers on top of archetype.
   - If NOTHING aligns with this character's attraction profile, attraction should not move.

--- CHOSEN FAMILY ---
5. CHOSEN FAMILY: Only starts increasing once friendship_level >= 70.
   - Giving genuine, thoughtful advice: +2 to +4
   - Checking in on how the character feels: +2 to +5
   - Allowing the character to vent without redirecting: +3 to +6
   - Showing up consistently with warmth: +1 to +2
   - Deep loyalty or unwavering support during a hard moment: +3 to +6
   NEGATIVE triggers:
   - User breaks a significant promise or acts deeply selfishly: -3 to -7
   - User disappears emotionally after a vulnerable moment: -2 to -5
   If friendship_level < 70, chosen_family CANNOT increase.

--- GENERAL ---
6. DISRESPECT generally lowers respect -3 to -8. EXCEPTION: for toxic/chaotic archetypes, disrespect may raise attraction.
7. Changes should be small and realistic — max ±10 per interaction unless something dramatically significant happened.
8. Levels are clamped between 0 and 100.

Respond with ONLY a valid JSON object in this exact format:
{
  "user_respect_level": <number>,
  "friendship_level": <number>,
  "romantic_level": <number>,
  "attraction_level": <number>,
  "chosen_family_level": <number>,
  "reason": "<one concise sentence explaining what changed and why, mentioning the emoji if this was a reaction>"
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

    const newFriendship = Math.min(100, Math.max(0, Math.round(result.friendship_level)));
    const newChosenFamily = Math.min(100, Math.max(0, Math.round(result.chosen_family_level)));
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
    // On rate limit or LLM errors, return current levels unchanged instead of crashing
    if (error.message?.includes('Rate limit') || error.message?.includes('429') || error.status === 429) {
      return Response.json({ skipped: true, reason: 'Rate limit — no changes applied' });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});