import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork } from './workScheduleUtils';
import { isCharacterInPrayer } from './religionUtils';

/**
 * Derives the current status category for a character.
 * Returns one of: 'asleep' | 'work' | 'school' | 'gym' | 'bar' | 'out' | 'available'
 */
export function getCharacterStatus(character) {
  if (!character) return 'available';

  if (isCharacterAsleep(character)) return 'asleep';

  // Prayer check: devout/moderate characters may be in a blocking prayer window
  const prayer = isCharacterInPrayer(character);
  if (prayer.active && prayer.blocks_response) return 'prayer';

  const activity = character.current_activity?.toLowerCase().trim() || '';

  if (activity.includes('hospital') || activity.includes('sick') || activity.includes('patient')) return 'available';
  if (isCharacterAtWork(character)) return 'work';
  if (character.current_education_activity && character.current_education_activity !== 'none') return 'school';
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') return 'school';
  if (activity.includes('gym') || activity.includes('workout') || activity.includes('exercis')) return 'gym';
  if (activity.includes('bar') || activity.includes('club') || activity.includes('nightclub')) return 'bar';
  if (activity.includes('out') || activity.includes('outside') || activity.includes('mall') || activity.includes('shopping')) return 'out';

  return 'available';
}

/**
 * Returns exact response delay in milliseconds for CHAT (direct) mode.
 * Chat always responds 0–60 seconds when awake, regardless of status.
 * Sleep may still respond (0–60s) or not at all — caller decides.
 */
export function getChatDelayMs(character) {
  // Chat: always 0–60 seconds when awake (strict)
  const delaySeconds = Math.random() * 60;
  console.log(`[TIMING] CHAT | status=${getCharacterStatus(character)} | delay=${Math.round(delaySeconds)}s`);
  return delaySeconds * 1000;
}

/**
 * Returns exact response delay in milliseconds for TEXT (phone) mode.
 * Returns null if no response should be sent (asleep).
 */
export function getTextDelayMs(character) {
  const status = getCharacterStatus(character);

  let delaySeconds = null;

  switch (status) {
    case 'asleep':
      delaySeconds = null; // blocked — no response
      break;
    case 'prayer':
      delaySeconds = null; // blocked — devout character is praying
      break;
    case 'work':
      delaySeconds = 120; // exact: 120 seconds
      break;
    case 'school':
      delaySeconds = 120 + Math.random() * 60; // exact: 120–180 seconds
      break;
    case 'gym':
      delaySeconds = Math.random() * 60; // 0–60 seconds
      break;
    case 'bar':
      delaySeconds = Math.random() * 60; // 0–60 seconds
      break;
    case 'out':
      delaySeconds = Math.random() * 60; // 0–60 seconds
      break;
    case 'available':
    default:
      delaySeconds = Math.random() * 60; // 0–60 seconds
      break;
  }

  console.log(`[TIMING] TEXT | status=${status} | delay=${delaySeconds !== null ? Math.round(delaySeconds) + 's' : 'BLOCKED (asleep)'}`);
  return delaySeconds !== null ? delaySeconds * 1000 : null;
}

/**
 * Returns the system message text to display for phone/text mode.
 * Returns null if no system message needed.
 */
export function getTextSystemMessage(character) {
  const status = getCharacterStatus(character);
  const name = character.name;

  switch (status) {
    case 'asleep': {
      const wakeTime = character.wake_up_time || '07:00';
      return `${name} is asleep and plans to wake up at ${wakeTime}`;
    }
    case 'prayer': {
      const prayer = isCharacterInPrayer(character);
      return `${name} is currently praying${prayer.name ? ` (${prayer.name})` : ''}`;
    }
    case 'work':
      return `${name} is at work`;
    case 'school':
      return `${name} is at school`;
    case 'gym':
      return `${name} is at the gym`;
    case 'bar':
      return `${name} is at the bar`;
    case 'out':
      return `${name} is out`;
    default:
      return null; // available — no system message needed
  }
}

/**
 * Builds the status-aware context string to inject into the LLM prompt.
 * Allows natural (non-forced, non-repetitive) status mentions in chat.
 */
export function buildStatusPromptContext(character, isPhone, recentMessages = []) {
  const status = getCharacterStatus(character);

  // Count how many recent character messages already mentioned status
  const recentCharMsgs = recentMessages.filter(m => m.sender_type === 'character').slice(-5);
  const statusMentionCount = recentCharMsgs.filter(m => {
    const c = m.content?.toLowerCase() || '';
    return c.includes('at work') || c.includes('at the gym') || c.includes('was asleep') ||
      c.includes('sleeping') || c.includes('at school') || c.includes('at the bar') ||
      c.includes("i'm out") || c.includes('just got off');
  }).length;

  const shouldMentionStatus = statusMentionCount === 0 && Math.random() < 0.3;

  if (status === 'available' || isPhone) return '';

  const statusHints = {
    work: shouldMentionStatus ? "You can occasionally mention you're at work if it fits naturally." : "Do NOT mention your work status — you already brought it up recently.",
    school: shouldMentionStatus ? "You can occasionally mention you're at school if it fits naturally." : "Do NOT mention your school status — you already brought it up recently.",
    gym: shouldMentionStatus ? "You can occasionally mention you're at the gym if it fits naturally." : "Do NOT mention your gym status — you already mentioned it recently.",
    bar: shouldMentionStatus ? "You can occasionally mention you're at the bar if it fits naturally." : "Do NOT mention your bar status — you already mentioned it recently.",
    out: shouldMentionStatus ? "You can occasionally mention you're out if it fits naturally." : "Do NOT mention being out — you already mentioned it recently.",
  };

  return statusHints[status] ? `\n\nSTATUS AWARENESS: ${statusHints[status]} Never be robotic or repetitive about it.` : '';
}

/**
 * Builds the sleep-interruption context for when a sleeping character responds to a chat message.
 */
export function buildSleepInterruptionContext(character) {
  const personality = character.personality_summary || '';
  const mood = character.emotional_state || 'calm';
  const friendship = character.friendship_level ?? 75;
  const isIrritable = ['irritated', 'frustrated', 'defensive'].includes(mood);
  const isClose = friendship >= 70;

  return `\n\nSLEEP INTERRUPTION: You were just woken up by this message. Your response must reflect being woken up — vary your tone based on personality, mood, and relationship.
- If irritable or low friendship: be cranky, short, maybe annoyed ("ugh", "why are you texting me rn", "it's late")
- If close relationship and normally easygoing: confused but not hostile ("wait what time is it", "I was literally asleep lol")
- If very close: brief and warm ("I was sleeping 😅 what's up")
- Do NOT be identical to other characters. Your personality shapes your reaction.
- Keep it SHORT — you just woke up.
- Current mood: ${mood} | Friendship: ${friendship}/100 | Personality: ${personality.substring(0, 100)}
${isIrritable ? "You are already irritable — being woken up makes you more so." : ""}
${isClose ? "You are close with the user — you're not too upset, just groggy." : ""}`;
}