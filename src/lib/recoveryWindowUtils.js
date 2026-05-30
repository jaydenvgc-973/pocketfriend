/**
 * Recovery Window Utilities
 * 
 * Official recovery window: 3:00 AM - 5:00 AM EST (America/New_York timezone)
 * 
 * CRITICAL RULES:
 * - Do NOT start recovery processing before 3:00 AM (characters are still active)
 * - Do NOT extend recovery processing after 5:00 AM (morning schedules must start)
 * - Recover: maintenance, refresh, reconciliation, data integrity
 * - Protect: legitimate character behavior, sleep, schedules, work, commitments, travel
 * - Eliminate: duplicate processing, redundant processing, repair loops, validation loops
 */

const RECOVERY_WINDOW_START = 3; // 3:00 AM EST
const RECOVERY_WINDOW_END = 5;   // 5:00 AM EST
const RECOVERY_TIMEZONE = 'America/New_York';

/**
 * Check if current time is within the recovery window (3:00 AM - 5:00 AM EST)
 * @returns {boolean} true if within recovery window
 */
export function isInRecoveryWindow() {
  try {
    const now = new Date();
    // Convert to EST/EDT (America/New_York)
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: RECOVERY_TIMEZONE }));
    const hourEST = estTime.getHours();
    
    // Recovery window: 3:00 AM to 5:00 AM (hour 3 through 4)
    return hourEST >= RECOVERY_WINDOW_START && hourEST < RECOVERY_WINDOW_END;
  } catch {
    return false;
  }
}

/**
 * Get minutes remaining until recovery window ends (5:00 AM EST)
 * @returns {number} minutes remaining, or 0 if not in recovery window
 */
export function getMinutesUntilRecoveryWindowEnds() {
  try {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: RECOVERY_TIMEZONE }));
    
    if (!isInRecoveryWindow()) return 0;
    
    const minutesInHour = estTime.getMinutes();
    const secondsInMinute = estTime.getSeconds();
    const currentMinute = minutesInHour + (secondsInMinute > 0 ? 1 : 0);
    
    // Recovery ends at 5:00 AM = hour 5, minute 0
    const hoursUntilEnd = RECOVERY_WINDOW_END - estTime.getHours();
    const minutesUntilEnd = (hoursUntilEnd * 60) - currentMinute;
    
    return Math.max(0, minutesUntilEnd);
  } catch {
    return 0;
  }
}

/**
 * Get minutes since recovery window started (3:00 AM EST)
 * @returns {number} minutes since recovery started, or -1 if not in recovery window
 */
export function getMinutesSinceRecoveryWindowStart() {
  try {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: RECOVERY_TIMEZONE }));
    
    if (!isInRecoveryWindow()) return -1;
    
    const minutesInHour = estTime.getMinutes();
    const secondsInMinute = estTime.getSeconds();
    const currentMinute = minutesInHour + (secondsInMinute > 0 ? 1 : 0);
    
    // Recovery starts at 3:00 AM = hour 3, minute 0
    const hoursSinceStart = estTime.getHours() - RECOVERY_WINDOW_START;
    const minutesSinceStart = (hoursSinceStart * 60) + currentMinute;
    
    return Math.max(0, minutesSinceStart);
  } catch {
    return -1;
  }
}

/**
 * Check if recovery window ends soon (within N minutes)
 * Used to prevent starting long operations that won't complete in time
 * @param {number} minMinutesNeeded minimum minutes needed to complete an operation
 * @returns {boolean} true if recovery window ends within minMinutesNeeded
 */
export function doesRecoveryWindowEndSoon(minMinutesNeeded = 30) {
  const minutesRemaining = getMinutesUntilRecoveryWindowEnds();
  return minutesRemaining > 0 && minutesRemaining < minMinutesNeeded;
}

/**
 * CRITICAL: Validate that recovery processing did not start before 3:00 AM
 * This is a hard safety check that must never be violated
 * @returns {boolean} false if recovery processing started too early (ERROR)
 */
export function validateRecoveryStartTime() {
  try {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: RECOVERY_TIMEZONE }));
    const hourEST = estTime.getHours();
    
    // If current time is 2:00 AM-2:59 AM, recovery processing must NOT be running
    if (hourEST === 2) {
      console.error('[RECOVERY WINDOW VIOLATION] Recovery processing started before 3:00 AM EST. This is a critical failure.');
      return false;
    }
    
    return true;
  } catch {
    return true;
  }
}

/**
 * CRITICAL: Validate that recovery processing completes by 5:00 AM EST
 * Long operations must check this before starting
 * @param {number} estimatedDurationMinutes estimated time needed for operation
 * @returns {boolean} true if operation can complete before 5:00 AM, false if it will overrun
 */
export function validateRecoveryWindowCapacity(estimatedDurationMinutes = 0) {
  const minutesRemaining = getMinutesUntilRecoveryWindowEnds();
  
  if (minutesRemaining <= 0) {
    // Outside recovery window
    return false;
  }
  
  if (minutesRemaining < estimatedDurationMinutes + 5) {
    // Not enough time for operation + 5 min buffer before morning schedules
    console.warn(`[RECOVERY WINDOW] Operation would overrun recovery window. Remaining: ${minutesRemaining}min, Needed: ${estimatedDurationMinutes}min`);
    return false;
  }
  
  return true;
}

export const recoveryWindow = {
  WINDOW_START: RECOVERY_WINDOW_START,
  WINDOW_END: RECOVERY_WINDOW_END,
  TIMEZONE: RECOVERY_TIMEZONE,
  isActive: isInRecoveryWindow,
  getMinutesUntilEnd: getMinutesUntilRecoveryWindowEnds,
  getMinutesSinceStart: getMinutesSinceRecoveryWindowStart,
  endsSoon: doesRecoveryWindowEndSoon,
  validateStartTime: validateRecoveryStartTime,
  validateCapacity: validateRecoveryWindowCapacity,
};