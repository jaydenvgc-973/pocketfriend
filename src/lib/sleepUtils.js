/**
 * Determines if a character is currently asleep based on their personal sleep schedule.
 * Falls back to a default schedule (23:00 - 07:00) if none is set.
 */
export function isCharacterAsleep(character) {
  const sleepStart = character?.sleep_start_time || "23:00";
  const wakeUp = character?.wake_up_time || "07:00";

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [sleepH, sleepM] = sleepStart.split(":").map(Number);
  const [wakeH, wakeM] = wakeUp.split(":").map(Number);

  const sleepMinutes = sleepH * 60 + sleepM;
  const wakeMinutes = wakeH * 60 + wakeM;

  // Sleep window crosses midnight (e.g. 23:00 - 07:00)
  if (sleepMinutes > wakeMinutes) {
    return currentMinutes >= sleepMinutes || currentMinutes < wakeMinutes;
  }

  // Sleep window within same day (e.g. 14:00 - 22:00 for a very early sleeper)
  return currentMinutes >= sleepMinutes && currentMinutes < wakeMinutes;
}