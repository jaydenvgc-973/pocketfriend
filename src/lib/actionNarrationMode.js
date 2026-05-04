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
  const currentActivity = character.current_activity || null;
  const occupation = character.occupation || null;
  const sleepStatus = character.sleep_start_time ? `Sleep schedule: sleeps around ${character.sleep_start_time}, wakes around ${character.wake_up_time || '7:00'}` : '';
  const workStatus = presenceStatus === 'at_work' ? `${name} is currently at work.` : presenceStatus === 'traveling' ? `${name} is currently traveling.` : '';
  const userName = userSettings?.fictional_world_name || null;

  // Relationship context
  const friendshipLevel = character.friendship_level ?? 75;
  const romanticLevel = character.romantic_level ?? 0;
  const trustLevel = character.trust_level ?? 50;
  const isClose = friendshipLevel > 70 || romanticLevel > 30;

  // Recent conversation snippet (last 4 messages, character side only)
  const recentCharMsgs = recentMessages
    .filter(m => m.sender_type === 'character' && m.content && !m.is_narrative)
    .slice(-4)
    .map(m => m.content.substring(0, 120))
    .join(' | ');

  const continuationInstruction = lastNarrationText
    ? `PREVIOUS NARRATION (continue directly from this — do NOT restart, do NOT repeat):
"${lastNarrationText.substring(0, 300)}"

This is step ${step + 1}. Advance the moment slightly. A few seconds or a minute have passed. ${name} moves, reacts, shifts, or continues what they were doing.`
    : `This is the first narration step. Set the scene — what ${name} is doing right now, in this exact moment.`;

  return `You are a literary narrator writing in close third-person.

CHARACTER: ${name}
PERSONALITY: ${personality}
EMOTIONAL STATE RIGHT NOW: ${emotionalState}
CURRENT LOCATION: ${location}
${workStatus}
${currentActivity ? `CURRENT ACTIVITY: ${currentActivity}` : ''}
${occupation ? `OCCUPATION: ${occupation}` : ''}
${sleepStatus}
RELATIONSHIP WITH ${userName ? userName.toUpperCase() : 'THE USER'}: Friendship ${friendshipLevel}/100, Romantic ${romanticLevel}/100, Trust ${trustLevel}/100. ${isClose ? `${name} is comfortable with this person.` : `${name} keeps a certain distance.`}
RECENT CONVERSATION TONE: ${recentCharMsgs || 'No recent messages.'}

${continuationInstruction}

RULES — read carefully before writing:
1. Third-person ONLY. Never use first-person ("I", "me", "my").
2. NO quoted dialogue. No speech marks. If ${name} speaks, convert it to action: "She mutters something about being tired" — NOT "She says, 'I'm tired.'"
3. This must feel like the character, not a generic narrator. The personality, mood, and emotional state must drive every word choice.
4. Respect location truth: ${name} is at ${location}. They cannot be somewhere else.
5. ${presenceStatus === 'asleep' || presenceStatus === 'sleeping' ? `CRITICAL: ${name} is asleep. The narration must reflect sleep state — no awake activities.` : `${name} is awake and present.`}
6. One paragraph only. 2-4 sentences. Natural, unpolished, specific.
7. Do NOT start with the character's name if possible — vary the opening.
8. Do NOT end with a lesson, reflection, or summary.
9. Do NOT include anything about what the user should do or say next.

Write the narration now. Nothing else — just the paragraph.`;
}