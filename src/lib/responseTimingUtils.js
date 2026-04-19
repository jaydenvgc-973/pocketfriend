import { isCharacterAsleep } from './sleepUtils';
import { isCharacterAtWork } from './workScheduleUtils';
import { isCharacterInPrayer } from './religionUtils';

/**
 * Derives the current status category for a character.
 * AUTHORITATIVE: Prefers resolved_presence_status (live truth) over current_activity string matching.
 * Enforces operating-hours invalidation — a character cannot be 'at_work' or 'bar' after shift/hours end.
 * Returns one of: 'asleep' | 'work' | 'school' | 'gym' | 'bar' | 'out' | 'available'
 */
export function getCharacterStatus(character) {
  if (!character) return 'available';

  if (isCharacterAsleep(character)) return 'asleep';

  // Prayer check
  const prayer = isCharacterInPrayer(character);
  if (prayer.active && prayer.blocks_response) return 'prayer';

  // ── AUTHORITATIVE: Use resolved_presence_status first ──────────────────────
  const presence = character.resolved_presence_status;
  if (presence === 'at_work')   return 'work';
  if (presence === 'at_school') return 'school';
  if (presence === 'traveling') return 'out';

  // ── SCHEDULE-BASED FALLBACK (only if resolved_presence_status is absent) ───
  // Guard: only trust isCharacterAtWork if we don't have an authoritative resolved status
  // that says otherwise (e.g. 'home' means they've already left work)
  if (!presence || presence === 'unknown') {
    if (isCharacterAtWork(character)) return 'work';
  }

  if (character.current_education_activity && character.current_education_activity !== 'none') return 'school';
  if (character.current_job_training_activity && character.current_job_training_activity !== 'none') return 'school';

  // ── ACTIVITY STRING FALLBACK — only for non-work statuses ──────────────────
  // Do NOT use activity string to infer 'work' — that's how stale "at bar" context lingers
  const activity = character.current_activity?.toLowerCase().trim() || '';
  if (activity.includes('gym') || activity.includes('workout') || activity.includes('exercis')) return 'gym';
  if (activity.includes('bar') || activity.includes('club') || activity.includes('nightclub')) {
    // Only trust bar/club context if character is NOT confirmed home/sleeping by resolved state
    const resolvedHome = presence === 'home' || presence === 'sleeping' || presence === 'napping';
    if (!resolvedHome) return 'bar';
  }
  if (activity.includes('out') || activity.includes('outside') || activity.includes('mall') || activity.includes('shopping')) return 'out';

  return 'available';
}

/**
 * Returns exact response delay in milliseconds for CHAT (direct) mode.
 * Chat: near-instant when available, short delays for busy statuses.
 */
export function getChatDelayMs(character) {
  const status = getCharacterStatus(character);
  // Chat mode: fast responses. Available = 0–4s, busy statuses = slightly longer.
  let delaySeconds;
  switch (status) {
    case 'work':
    case 'school':
      delaySeconds = 5 + Math.random() * 10; // 5–15s
      break;
    case 'gym':
    case 'bar':
    case 'out':
      delaySeconds = 2 + Math.random() * 8; // 2–10s
      break;
    case 'available':
    default:
      delaySeconds = Math.random() * 4; // 0–4s
      break;
  }
  console.log(`[TIMING] CHAT | status=${status} | delay=${Math.round(delaySeconds)}s`);
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
      delaySeconds = 30 + Math.random() * 30; // 30–60s (was 120s)
      break;
    case 'school':
      delaySeconds = 30 + Math.random() * 30; // 30–60s (was 120–180s)
      break;
    case 'gym':
      delaySeconds = 5 + Math.random() * 15; // 5–20s
      break;
    case 'bar':
      delaySeconds = 3 + Math.random() * 12; // 3–15s
      break;
    case 'out':
      delaySeconds = 3 + Math.random() * 12; // 3–15s
      break;
    case 'available':
    default:
      delaySeconds = Math.random() * 8; // 0–8s
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
 * CRITICAL: Uses live resolved_presence_status as the authoritative source.
 * Prevents stale work/bar context from leaking into chat after hours or after home arrival.
 */
export function buildStatusPromptContext(character, isPhone, recentMessages = []) {
  const status = getCharacterStatus(character);

  // ── STALE CONTEXT GUARD ────────────────────────────────────────────────────
  // If resolved presence says the character is home or sleeping, forcefully clear
  // any status that would imply they are still at work/bar — this is the Ethan bug.
  const resolvedPresence = character.resolved_presence_status;
  const resolvedLocName = character.resolved_current_location_name;
  const isConfirmedHome = resolvedPresence === 'home' || resolvedPresence === 'sleeping' || resolvedPresence === 'napping';

  if (isConfirmedHome && (status === 'work' || status === 'bar' || status === 'out')) {
    // Character is home but stale activity string implies they're still out.
    // Inject a hard correction to prevent narrative drift.
    console.warn(`[LOCATION_DESYNC] Character ${character.name} has status="${status}" but resolved_presence_status="${resolvedPresence}". Injecting home correction.`);
    return `\n\nLOCATION TRUTH (AUTHORITATIVE — DO NOT OVERRIDE): You are currently AT HOME${resolvedLocName ? ` (${resolvedLocName})` : ''}. You are NOT at work, a bar, club, or any other venue right now. Any earlier references to being at a venue were in the past — you have since returned home. Do NOT describe yourself as physically present in a venue. You may speak about work/night out in past tense only ("I just got home", "it was crazy tonight", "my ears are still ringing").`;
  }

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

  // Use resolved location name for work/school hints when available
  const workLocName = resolvedLocName || 'work';
  const statusHints = {
    work: shouldMentionStatus ? `You can occasionally mention you're at ${workLocName} if it fits naturally.` : "Do NOT mention your work status — you already brought it up recently.",
    school: shouldMentionStatus ? "You can occasionally mention you're at school if it fits naturally." : "Do NOT mention your school status — you already brought it up recently.",
    gym: shouldMentionStatus ? "You can occasionally mention you're at the gym if it fits naturally." : "Do NOT mention your gym status — you already mentioned it recently.",
    bar: shouldMentionStatus ? `You can occasionally mention you're at ${workLocName || 'the bar'} if it fits naturally.` : "Do NOT mention your bar status — you already mentioned it recently.",
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

  // Derive the real current hour so the character references the correct time of day
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const hourET = nowET.getHours();
  const minET = nowET.getMinutes();
  const timeStr = `${hourET % 12 || 12}:${String(minET).padStart(2, '0')} ${hourET >= 12 ? 'PM' : 'AM'}`;
  let daypartHint = '';
  if (hourET < 4)       daypartHint = 'This is deep night (past midnight). Being woken up now is genuinely disruptive.';
  else if (hourET < 6)  daypartHint = 'This is pre-dawn — still very dark and very early. Being woken up now is unusual.';
  else if (hourET < 8)  daypartHint = 'This is early morning — barely light outside. They may or may not have been planning to wake soon.';
  else if (hourET < 10) daypartHint = 'Morning. If their alarm was soon anyway, the reaction is milder.';
  else                  daypartHint = 'It is now morning or later — the wakeup is less disruptive.';

  return `\n\nSLEEP INTERRUPTION: You were just woken up by this message. The actual time is ${timeStr}.
${daypartHint}
Your response must reflect being woken up — vary your tone based on personality, mood, and relationship.
- If irritable or low friendship: be cranky, short, maybe annoyed ("ugh", "why are you texting me rn", "it's ${hourET < 6 ? 'like 4am' : 'still early'}")
- If close relationship and normally easygoing: confused but not hostile ("wait what time is it", "I was literally asleep lol")
- If very close: brief and warm ("I was sleeping 😅 what's up")
- Reference the REAL time if it fits naturally (e.g. "it's ${timeStr}??")
- Do NOT say "it's late at night" if the real time is morning.
- Keep it SHORT — you just woke up.
- Current mood: ${mood} | Friendship: ${friendship}/100 | Personality: ${personality.substring(0, 100)}
${isIrritable ? "You are already irritable — being woken up makes you more so." : ""}
${isClose ? "You are close with the user — you're not too upset, just groggy." : ""}`;
}