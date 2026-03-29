/**
 * Religion & Belief System Utilities
 *
 * Belief level influence percentages (FIXED — do not change):
 *   in_name_only = 0%   → no behavioral influence
 *   moderate     = 20%  → occasional influence
 *   devout       = 50%  → strong, schedule-driven influence
 */

// Prayer/service schedules by religion (devout = full schedule, moderate = partial)
const PRAYER_SCHEDULES = {
  Islam: {
    devout: [
      { name: "Fajr (Dawn Prayer)", time: "05:00", duration_min: 15, blocks_response: true },
      { name: "Dhuhr (Midday Prayer)", time: "12:30", duration_min: 15, blocks_response: false },
      { name: "Asr (Afternoon Prayer)", time: "15:30", duration_min: 15, blocks_response: false },
      { name: "Maghrib (Sunset Prayer)", time: "18:30", duration_min: 20, blocks_response: true },
      { name: "Isha (Night Prayer)", time: "20:00", duration_min: 20, blocks_response: false },
    ],
    moderate: [
      { name: "Dhuhr (Midday Prayer)", time: "12:30", duration_min: 15, blocks_response: false },
      { name: "Maghrib (Sunset Prayer)", time: "18:30", duration_min: 20, blocks_response: false },
    ],
  },
  Judaism: {
    devout: [
      { name: "Shacharit (Morning Prayer)", time: "07:30", duration_min: 30, blocks_response: true },
      { name: "Mincha (Afternoon Prayer)", time: "15:00", duration_min: 15, blocks_response: false },
      { name: "Maariv (Evening Prayer)", time: "20:00", duration_min: 15, blocks_response: false },
    ],
    moderate: [
      { name: "Shacharit (Morning Prayer)", time: "08:00", duration_min: 20, blocks_response: false },
    ],
  },
  Christianity: {
    devout: [
      { name: "Morning devotional", time: "07:00", duration_min: 20, blocks_response: true },
      { name: "Evening prayer", time: "21:00", duration_min: 15, blocks_response: false },
    ],
    moderate: [
      { name: "Morning prayer", time: "07:30", duration_min: 10, blocks_response: false },
    ],
  },
  Hinduism: {
    devout: [
      { name: "Brahma Muhurta prayer", time: "05:00", duration_min: 30, blocks_response: true },
      { name: "Evening puja", time: "18:00", duration_min: 20, blocks_response: false },
    ],
    moderate: [
      { name: "Morning puja", time: "07:00", duration_min: 15, blocks_response: false },
    ],
  },
  Buddhism: {
    devout: [
      { name: "Morning meditation", time: "06:00", duration_min: 30, blocks_response: true },
      { name: "Evening meditation", time: "20:00", duration_min: 30, blocks_response: false },
    ],
    moderate: [
      { name: "Meditation", time: "07:00", duration_min: 15, blocks_response: false },
    ],
  },
  Sikhism: {
    devout: [
      { name: "Nitnem (Amrit Vela)", time: "04:30", duration_min: 45, blocks_response: true },
      { name: "Rehras Sahib (Evening prayer)", time: "18:30", duration_min: 20, blocks_response: false },
    ],
    moderate: [
      { name: "Morning ardas", time: "07:00", duration_min: 15, blocks_response: false },
    ],
  },
};

// Weekly service days by religion
const SERVICE_DAYS = {
  Christianity: { devout: [0], moderate: [0] }, // Sunday
  Judaism: { devout: [6], moderate: [6] },       // Saturday (Shabbat)
  Islam: { devout: [5], moderate: [5] },          // Friday (Jumu'ah)
  Buddhism: { devout: [0], moderate: [] },
  Hinduism: { devout: [0], moderate: [] },
  Sikhism: { devout: [0], moderate: [] },
};

/**
 * Get the belief influence multiplier (0, 0.2, or 0.5)
 */
export function getBeliefInfluence(character) {
  if (!character?.religion || character.religion === "None") return 0;
  switch (character.belief_level) {
    case "devout": return 0.5;
    case "moderate": return 0.2;
    case "in_name_only":
    default: return 0;
  }
}

/**
 * Get the display name for the character's religion.
 */
export function getReligionLabel(character) {
  if (!character?.religion || character.religion === "None") return null;
  if (character.religion === "Other") return character.religion_custom || "Other";
  return character.religion;
}

/**
 * Check if character is currently in a prayer/practice window.
 * Returns { active: boolean, name: string|null }
 */
export function isCharacterInPrayer(character) {
  const influence = getBeliefInfluence(character);
  if (influence === 0) return { active: false, name: null };

  const schedule = PRAYER_SCHEDULES[character.religion];
  if (!schedule) return { active: false, name: null };

  const levelSchedule =
    character.belief_level === "devout" ? schedule.devout : schedule.moderate;
  if (!levelSchedule?.length) return { active: false, name: null };

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const p of levelSchedule) {
    const [h, m] = p.time.split(":").map(Number);
    const start = h * 60 + m;
    const end = start + p.duration_min;
    if (currentMinutes >= start && currentMinutes < end) {
      return { active: true, name: p.name, blocks_response: p.blocks_response };
    }
  }

  return { active: false, name: null };
}

/**
 * Check if today is a religious service day for a devout/moderate character.
 */
export function isReligiousServiceDay(character) {
  const influence = getBeliefInfluence(character);
  if (influence === 0) return false;

  const serviceDays = SERVICE_DAYS[character.religion];
  if (!serviceDays) return false;

  const level = character.belief_level === "devout" ? "devout" : "moderate";
  const days = serviceDays[level] || [];
  const todayUTC = new Date().getUTCDay(); // 0=Sunday
  return days.includes(todayUTC);
}

/**
 * Returns early-morning prayer time for devout characters (if before sleep wake-up).
 * Used by sleep system to determine interrupted sleep.
 */
export function getEarlyPrayerWakeTime(character) {
  const influence = getBeliefInfluence(character);
  if (influence < 0.5) return null; // only devout wake early

  const schedule = PRAYER_SCHEDULES[character.religion]?.devout;
  if (!schedule?.length) return null;

  // Find earliest prayer that starts before 6:00
  const early = schedule.filter((p) => {
    const [h] = p.time.split(":").map(Number);
    return h < 6;
  });
  if (!early.length) return null;

  // Return the earliest one
  return early.reduce((a, b) => (a.time < b.time ? a : b));
}

/**
 * Build the religion context block for the LLM system prompt.
 */
export function buildReligionPromptContext(character) {
  const influence = getBeliefInfluence(character);
  if (influence === 0) return "";

  const religion = getReligionLabel(character);
  const level = character.belief_level;

  const levelDescriptions = {
    devout: `You are deeply devout in your ${religion} faith. Prayer, rituals, and religious observance are real, consistent parts of your daily life — not just occasional. Your faith genuinely shapes how you make decisions, what you're willing to do, how you speak about life and ethics, and how you respond emotionally. You may reference religious practices, holidays, or values naturally in conversation — the way any religious person would. You do not preach, but your faith is part of who you are.`,
    moderate: `You practice ${religion} at a moderate level. You observe some religious holidays and occasionally attend services or pray, but you don't structure your entire life around faith. You might mention faith occasionally — a holiday, a prayer, something your family does — but it's not the dominant lens through which you see everything.`,
  };

  const prayerWindows = PRAYER_SCHEDULES[character.religion];
  const scheduleNote =
    prayerWindows && level !== "in_name_only"
      ? `\nRELIGIOUS SCHEDULE: You have prayer times or practices during the day. These are real commitments — if you're in the middle of one, acknowledge it naturally if it comes up (e.g. "just finished praying", "heading to pray rn", "can't talk, it's Shabbat").`
      : "";

  const serviceNote = isReligiousServiceDay(character)
    ? `\nToday is a significant religious day for you (${religion} service/observance day). This may affect your availability and mood.`
    : "";

  return `\nRELIGION & FAITH (${religion} — ${level.replace("_", " ")}):
${levelDescriptions[level] || ""}${scheduleNote}${serviceNote}
CRITICAL: Faith influence is ${Math.round(influence * 100)}%. This is NOT performance — it is part of who you are at this level. Do not over-explain or preach unless directly asked about your faith. Let it show naturally.`;
}

/**
 * Get the text status message for prayer time.
 */
export function getPrayerStatusMessage(character) {
  const prayer = isCharacterInPrayer(character);
  if (!prayer.active) return null;
  return `${character.name} is currently praying (${prayer.name})`;
}