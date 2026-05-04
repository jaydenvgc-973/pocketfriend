/**
 * actionNarrationMode.js
 *
 * Builds the LLM prompt for Character-Led Progressive Action Narration.
 *
 * This is NOT preset action categories. This is:
 * "What the character would say about themselves, converted into third-person narrative form."
 *
 * Each call advances the moment — it does NOT restart the scene.
 * The previous narration output is passed back in as context so the LLM continues naturally.
 *
 * Rules:
 * - Third-person only
 * - No direct quoted dialogue
 * - Driven by personality, emotional state, location, time, relationship
 * - Respects sleep/work/travel/location truth — no teleporting
 * - One short paragraph per step
 */

/**
 * Builds the full LLM prompt for one narration step.
 *
 * Core rule: the narration MUST be a direct translation of the character's
 * reaction to the last user message — NOT a standalone scene description.
 *
 * @param {object} character - Full character record
 * @param {object[]} recentMessages - Last N messages from chat
 * @param {number} step - Current step number (0 = first, 1+ = continuation)
 * @param {string|null} lastNarrationText - Text from the previous narration step, or null
 * @param {object} userSettings - UserSettings record (for fictional_world_name)
 * @returns {string} - Full prompt string to pass to InvokeLLM
 */
export function buildActionNarrationPrompt(character, recentMessages = [], step = 0, lastNarrationText = null, userSettings = null) {
  const name = character.name || 'the character';
  const personality = character.personality_summary || character.archetype || 'a complex, real person';
  const emotionalState = character.emotional_state || 'calm';
  const location = character.resolved_current_location_name || character.occupation_location_name || 'their usual place';
  const presenceStatus = character.resolved_presence_status || character.location_status || null;
  const userName = userSettings?.fictional_world_name || 'the person they are talking to';

  // Relationship context
  const friendshipLevel = character.friendship_level ?? 75;
  const romanticLevel = character.romantic_level ?? 0;
  const isClose = friendshipLevel > 70 || romanticLevel > 30;

  // ── CONVERSATION ANCHOR ─────────────────────────────────────────────────────
  // Find the last real user message — this is the primary driver of the narration.
  const nonNarrativeMsgs = recentMessages.filter(m => m.content && !m.is_narrative);
  const lastUserMsg = [...nonNarrativeMsgs].reverse().find(m => m.sender_type === 'user');
  const lastCharMsg = [...nonNarrativeMsgs].reverse().find(m => m.sender_type === 'character');

  // Build a minimal exchange snippet for context
  const exchangeLines = [];
  // Include up to last 3 exchanges (user + char pairs)
  const recentPairs = nonNarrativeMsgs.slice(-6);
  for (const m of recentPairs) {
    const label = m.sender_type === 'user' ? (userName || 'User') : name;
    exchangeLines.push(`${label}: "${m.content.substring(0, 140)}"`);
  }
  const conversationSnippet = exchangeLines.join('\n');

  const lastUserText = lastUserMsg?.content?.substring(0, 200) || null;
  const lastCharText = lastCharMsg?.content?.substring(0, 200) || null;

  const continuationInstruction = lastNarrationText
    ? `PREVIOUS NARRATION (continue directly — do NOT restart, do NOT repeat):
"${lastNarrationText.substring(0, 280)}"

This is step ${step + 1}. A moment has passed. ${name}'s reaction to the conversation continues to play out physically.`
    : `This is the first narration step. Show ${name}'s immediate physical/emotional reaction to the last message they received.`;

  return `You are a literary narrator writing in close third-person.

Your ONLY job: translate ${name}'s reaction to the current conversation into a third-person action narration.

Do NOT write a scene.
Do NOT describe the room, lighting, or environment unless the character physically interacts with it.
Do NOT generate a new topic.
Do NOT drift from the conversation.

CHARACTER: ${name}
PERSONALITY: ${personality}
EMOTIONAL STATE: ${emotionalState}
CURRENT LOCATION: ${location}
RELATIONSHIP: Friendship ${friendshipLevel}/100, Romantic ${romanticLevel}/100. ${isClose ? `${name} is comfortable with ${userName}.` : `${name} keeps some distance.`}

RECENT CONVERSATION:
${conversationSnippet || '(No conversation yet)'}

${lastUserText ? `THE MESSAGE ${name} IS REACTING TO:\n"${lastUserText}"` : ''}
${lastCharText ? `\n${name}'S LAST REPLY WAS:\n"${lastCharText}"` : ''}

${continuationInstruction}

TASK:
Ask yourself: "If ${name} were to respond to this message in action rather than words, what would they physically do?"
Then write THAT. One short paragraph. 2-4 sentences.

RULES:
1. Third-person ONLY. Never "I", "me", "my".
2. NO quoted dialogue. If ${name} speaks, convert to action: "He mutters something under his breath" — NOT "He says, 'Whatever.'"
3. The narration MUST clearly connect to the last user message. If someone asks for a photo, show the character reaching for their phone. If someone says something funny, show a physical reaction. If someone pushes a boundary, show resistance or give-in.
4. Personality and emotional state drive every word choice.
5. ${presenceStatus === 'asleep' || presenceStatus === 'sleeping' ? `CRITICAL: ${name} is asleep. Narration must reflect that.` : ''}
6. Do NOT summarize the conversation. Show a reaction.
7. Do NOT end with a moral, reflection, or lesson.
8. Keep it grounded, specific, and real.

Write the narration now. Nothing else.`;
}