/**
 * Determines if a character is currently at work based on their work schedule.
 * Falls back to default schedule (9 AM - 5 PM, Monday-Friday) if none is set.
 */
export function isCharacterAtWork(character) {
  const workStart = character?.work_start_time || "09:00";
  const workEnd = character?.work_end_time || "17:00";
  const workDays = character?.work_days || [1, 2, 3, 4, 5]; // Default: Monday-Friday

  const now = new Date();
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if today is a work day
  if (!workDays.includes(currentDay)) {
    return false;
  }

  const [workH, workM] = workStart.split(":").map(Number);
  const [endH, endM] = workEnd.split(":").map(Number);

  const startMinutes = workH * 60 + workM;
  const endMinutes = endH * 60 + endM;

  // Check if current time is within work hours
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}