/**
 * timeFormat.js
 *
 * Global 12-hour time formatting utilities.
 * ALL user-facing time must go through these functions.
 * Internal logic may use 24h "HH:MM" strings — display always converts to AM/PM.
 */

/**
 * Convert a "HH:MM" string to "h:MM AM/PM".
 * e.g. "14:30" → "2:30 PM", "09:00" → "9:00 AM", "00:00" → "12:00 AM"
 */
export function formatTime24to12(timeStr) {
  if (!timeStr) return '';
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0];
  const minutes = parts[1] ?? 0;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = String(minutes).padStart(2, '0');
  return `${h}:${m} ${suffix}`;
}

/**
 * Format a Date object or timestamp to "h:MM AM/PM".
 */
export function formatDateTo12h(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Get current time as "h:MM AM/PM" string.
 */
export function getCurrentTime12h() {
  return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Convert any time string to 12h — handles both "HH:MM" (24h) and already-formatted strings.
 * Safe to call on unknown inputs.
 */
export function toDisplay12h(timeStr) {
  if (!timeStr) return '';
  // Already formatted with AM/PM — return as-is
  if (/[AaPp][Mm]/.test(timeStr)) return timeStr;
  // "HH:MM" pattern
  if (/^\d{1,2}:\d{2}$/.test(timeStr.trim())) return formatTime24to12(timeStr.trim());
  return timeStr;
}