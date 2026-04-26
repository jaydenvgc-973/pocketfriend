import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── RESPECT SEMANTIC MAP ────────────────────────────────────────────────────
// Words/phrases in memories or emotional state that strongly signal high respect.
// If these are present and the stored respect value is critically low (< 25),
// we recompute before generating the feelings text.
const HIGH_RESPECT_SIGNALS = [
  'respect', 'admire', 'admiration', 'look up to', 'value his', 'value her', 'value their',
  'trust his judgment', 'trust her judgment', 'trust their judgment',
  'take him seriously', 'take her seriously', 'take them seriously',
  'deeply respect', 'drawn to him', 'drawn to her', 'drawn to them',
  'he matters', 'she matters', 'they matter', 'integrity', 'inspires me',
  'genuine respect', 'deeply moved', 'meaningful to me', 'has my respect',
];

const LOW_RESPECT_SIGNALS = [
  'dismiss', 'contempt', 'belittle', 'mock', 'ridicule', 'disrespect',
  'do not take seriously', "don't take seriously", 'joke about them', 'laugh at them',
  'can\'t stand', 'worthless', 'pathetic', 'disgusting behavior',
];

function detectRespectSignalStrength(texts) {
  const combined = texts.join(' ').toLowerCase();
  const highCount = HIGH_RESPECT_SIGNALS.filter(s => combined.includes(s)).length;
  const lowCount = LOW_RESPECT_SIGNALS.filter(s => combined.includes(s)).length;
  if (highCount > lowCount && highCount >= 2) return 'high';
  if (lowCount > highCount && lowCount >= 2) return 'low';
  return 'neutral';
}

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

    // ACCOUNT-SCOPED: filter by created_by so we never read another user's settings
    const userSettingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const userDisplayName = userSettingsList?.[0]?.fictional_world_name || "you";
    const nickname = character.nickname_for_user || userDisplayName;

    let respect = character.user_respect_level ?? 50;
    const friendship = character.friendship_level ?? 75;
    const romantic = character.romantic_level ?? 0;
    const attraction = character.attraction_level ?? 0;
    const chosenFamily = character.chosen_family_level ?? 0;
    const trust = character.trust_level ?? 50;
    const relationalJealousy = character.relational_jealousy ?? 0;
    const envyJealousy = character.envy_jealousy ?? 0;
    const emotionalState = character.emotional_state || "calm";

    const recentMemories = await base44.entities.Memory.filter({ character_id: characterId }, "-timestamp", 8);
    const memoryTexts = recentMemories.map(m => `${m.title}: ${m.description}`);
    const memorySummary = memoryTexts.join("\n") || "None";

    // ── CONSISTENCY CHECK: detect respect mismatch ───────────────────────────
    // If stored respect is very low but memories and emotional state strongly
    // signal genuine respect/admiration, recompute from current evidence.
    const RESPECT_MISMATCH_THRESHOLD = 30; // below this, a mismatch is credible
    if (respect < RESPECT_MISMATCH_THRESHOLD) {
      const evidenceTexts = [
        ...memoryTexts,
        character.personality_summary || '',
        character.emotional_state || '',
        character.current_situation || '',
        character.loyalty_view || '',
      ];
      const signalStrength = detectRespectSignalStrength(evidenceTexts);

      if (signalStrength === 'high') {
        // Stale low value conflicts with current evidence — recompute
        console.log(`[RESPECT_SYNC] Stored respect=${respect} conflicts with high-respect evidence. Recomputing.`);
        const recomputeResult = await base44.integrations.Core.InvokeLLM({
          prompt: `You are a relationship analyst.

CHARACTER: ${character.name}
CHARACTER PERSONALITY: ${character.personality_summary || ''}
EMOTIONAL STATE: ${emotionalState}
STORED RESPECT VALUE: ${respect}/100 (may be stale)

RECENT MEMORIES (current evidence of how they feel):
${memorySummary}

EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none'}

TASK: The stored respect value appears to contradict the character's current memories and emotional state.
Based ONLY on the current evidence above, what is the TRUE respect level this character has for ${nickname} right now?

RESPECT SEMANTIC MAP:
HIGH respect (70-100): "I respect him deeply", "I admire him", "I trust his judgment", "I value who he is", "I take him seriously", "I'm drawn to him and respect him"
MEDIUM respect (40-69): Generally positive regard, no strong admiration but no contempt
LOW respect (0-39): dismissal, contempt, belittling, refusal to take seriously, mockery

Return ONLY a JSON object.`,
          response_json_schema: {
            type: "object",
            properties: {
              recomputed_respect: { type: "number", description: "True respect value 0-100 based on current evidence" },
              justification: { type: "string", description: "One sentence explaining why" }
            },
            required: ["recomputed_respect", "justification"]
          }
        });

        if (recomputeResult?.recomputed_respect !== undefined) {
          const newRespect = Math.min(100, Math.max(0, Math.round(recomputeResult.recomputed_respect)));
          if (newRespect !== respect) {
            console.log(`[RESPECT_SYNC] Correcting respect: ${respect} → ${newRespect}. Reason: ${recomputeResult.justification}`);
            respect = newRespect;
            // Persist the corrected canonical value so bars and text stay in sync
            base44.entities.Character.update(characterId, { user_respect_level: newRespect }).catch(() => {});
          }
        }
      }
    }

    // ── GENERATE FEELINGS FROM CANONICAL (NOW VALIDATED) VALUES ───────────────
    const prompt = `You are ${character.name} speaking directly in first person. Write 2-3 short, honest sentences about how YOU feel toward ${nickname} right now and exactly why.

CRITICAL RULES — violating any = wrong answer:
1. STRICT FIRST PERSON ONLY. Use "I", "me", "my". NEVER say "${character.name}" — you are the speaker, not the subject.
2. Address or reference the other person ONLY as "${nickname}". Never "the user".
3. Talk ONLY about your feelings toward ${nickname}. No other people, no life summary.
4. Sound like a real person thinking quietly — not performing, not explaining.
5. No bullet points. No headers. No labels. Just the raw feeling + the reason behind it.
6. YOUR TEXT MUST BE CONSISTENT WITH THE NUMERIC VALUES BELOW. If respect is high, do not express dismissal. If respect is low, do not claim deep admiration.
7. EMOTIONAL BALANCE RULE: Do not default to heavy, negative, or grief-saturated language unless the values clearly support it. Characters may feel warmth, curiosity, ease, comfort, appreciation, humor, or simple fondness. Reflect the FULL emotional range — including positive and neutral states when they are accurate.

WRONG (third person — forbidden):
"${character.name} feels deep admiration for ${nickname}. He is grappling with..."

RIGHT (first person — correct):
"I feel something I can't fully name with ${nickname}. There's a pull there I don't know what to do with yet, and that scares me a little."

YOUR PERSONALITY: ${character.personality_summary || ""}
YOUR EMOTIONAL STATE RIGHT NOW: ${emotionalState}
YOUR FEELINGS TOWARD ${nickname.toUpperCase()} (CANONICAL — your text MUST reflect these values):
- Respect: ${respect}/100 ${respect >= 70 ? '← HIGH — reflect genuine respect, admiration, regard' : respect <= 25 ? '← LOW — reflect dismissal, contempt, not taking seriously' : '← MODERATE'}
- Trust: ${trust}/100 ${trust >= 70 ? '← HIGH — reflect feeling safe, believing them, emotional security' : trust <= 25 ? '← LOW — reflect suspicion, guardedness, fear of betrayal' : '← MODERATE'}
- Friendship: ${friendship}/100
- Romantic: ${romantic}/100
- Social Pull: ${attraction}/100
- Chosen family: ${chosenFamily}/100
${relationalJealousy > 30 ? `- Relational Jealousy: ${relationalJealousy}/100 ← Notable — you fear losing their attention/closeness to someone else` : ''}
${envyJealousy > 30 ? `- Envy: ${envyJealousy}/100 ← Notable — you envy something about their life, status, or what they have` : ''}
RECENT MEMORIES: ${memorySummary}
EMOTIONAL BAGGAGE (only as it relates to ${nickname}): ${character.emotional_baggage || "none"}

Write it now. First person. No self-name. Direct.`;

    const result = await base44.integrations.Core.InvokeLLM({ prompt });
    return Response.json({ feelings: result.trim(), respect_used: respect });
  } catch (err) {
    console.error('[generateCharacterFeelings] error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});