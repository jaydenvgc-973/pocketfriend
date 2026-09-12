/**
 * instantImagePrompt.js
 *
 * Builds the LLM prompt that produces a visual scene description (image prompt)
 * for "Instant Image" — a one-tap image of the current scene without manual prompt entry.
 *
 * This does NOT create a new image generator. The output of InvokeLLM here is a
 * plain image-prompt string that feeds directly into the existing createImageMessage
 * → dispatchImageGeneration → generateImageAsync pipeline. Identity, wardrobe,
 * location, and subject resolution all remain in the existing pipeline.
 *
 * The LLM's ONLY job: read the established conversation + scene context and describe
 * what the camera would see right now. It must not invent future actions, pull in
 * absent people, or progress the scene beyond what the conversation supports.
 */

/**
 * @param {object} character - Full character record
 * @param {object[]} recentMessages - Recent messages from the active conversation
 * @param {object} userSettings - UserSettings record
 * @returns {string} - Prompt string for InvokeLLM
 */
export function buildInstantImagePrompt(character, recentMessages = [], userSettings = null) {
  const name = character.name || 'the character';
  const personality = character.personality_summary || character.archetype || '';
  const emotionalState = character.emotional_state || 'calm';
  const location = character.resolved_current_location_name || character.occupation_location_name || 'their usual place';
  const presenceStatus = character.resolved_presence_status || character.location_status || null;
  const currentActivity = character.current_activity || null;
  const userName = userSettings?.fictional_world_name || 'the person they are talking to';

  // Build a minimal exchange snippet for context (last 6 non-narrative messages)
  const nonNarrativeMsgs = (recentMessages || []).filter(m => m.content && !m.is_narrative);
  const exchangeLines = [];
  for (const m of nonNarrativeMsgs.slice(-6)) {
    const label = m.sender_type === 'user' ? (userName || 'User') : name;
    exchangeLines.push(`${label}: "${(m.content || '').substring(0, 140)}"`);
  }
  const conversationSnippet = exchangeLines.join('\n');

  return `You are a visual scene director for a photorealistic image generator.

Your ONLY job: describe what a camera would see RIGHT NOW in the current scene, based on the established conversation and character state.

CHARACTER: ${name}
PERSONALITY: ${personality}
EMOTIONAL STATE: ${emotionalState}
CURRENT LOCATION: ${location}
${currentActivity ? `CURRENT ACTIVITY: ${currentActivity}` : ''}
${presenceStatus ? `PRESENCE STATUS: ${presenceStatus}` : ''}

RECENT CONVERSATION:
${conversationSnippet || '(No conversation yet — describe the character in their current setting)'}

TASK:
Produce a single concise image prompt (2-4 sentences) describing the live scene as a cohesive photorealistic photograph. Describe:
- What ${name} is physically doing right now based on the conversation
- The visible environment / setting at ${location}
- Body language, posture, and expression matching the emotional state
- Lighting and atmosphere appropriate to the time and mood

STRICT RULES:
1. Describe ONLY what is happening NOW. Do NOT invent future actions or progress the scene.
2. Include ONLY ${name} as the visible person, unless the conversation explicitly establishes someone else is physically present right now.
3. Do NOT pull in family members, coworkers, or contacts who are not in the active scene.
4. Do NOT describe clothing — the system resolves wardrobe separately.
5. Do NOT describe facial features or identity — the system uses reference photos for that.
6. Write in second person to the image generator: "A photo of ${name} [doing X] at [location]..."
7. Keep it grounded and specific. No artistic flourishes, no "cinematic", no "8k".
8. Output ONLY the image prompt text. No labels, no JSON, no explanation.

Write the image prompt now:`;
}