/**
 * messageDateGrouping.js
 * 
 * Shared utility for grouping chat messages by calendar day.
 * Day boundary: 12:00 AM local time (America/New_York).
 * Date format: "Monday, April 21, 2026" (includes year).
 */

const THREAD_TIMEZONE = 'America/New_York';

/**
 * Get the local calendar date string (YYYY-MM-DD) for a message timestamp.
 * Day boundary is 12:00 AM in THREAD_TIMEZONE.
 */
export function getLocalDateKey(timestamp) {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    // Format as YYYY-MM-DD in the thread timezone
    return date.toLocaleDateString('en-CA', { timeZone: THREAD_TIMEZONE }); // en-CA gives YYYY-MM-DD
  } catch {
    return null;
  }
}

/**
 * Format a date key (YYYY-MM-DD) into the full human-readable label.
 * Example: "Monday, April 21, 2026"
 */
export function formatDateLabel(dateKey) {
  if (!dateKey) return '';
  try {
    // Parse YYYY-MM-DD as local date (avoid UTC offset shifting)
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateKey;
  }
}

/**
 * Given a flat array of messages (in chronological order),
 * returns an interleaved array with DATE_SEPARATOR objects inserted
 * once per calendar day.
 *
 * Each DATE_SEPARATOR object:
 * {
 *   _isDateSeparator: true,
 *   dateKey: 'YYYY-MM-DD',
 *   label: 'Monday, April 21, 2026',
 *   id: 'date-sep-YYYY-MM-DD'
 * }
 */
export function injectDateSeparators(messages) {
  if (!messages || messages.length === 0) return [];

  const result = [];
  let lastDateKey = null;

  for (const msg of messages) {
    // Use timestamp field first, fall back to created_date
    const ts = msg.timestamp || msg.created_date;
    const dateKey = getLocalDateKey(ts);

    if (dateKey && dateKey !== lastDateKey) {
      result.push({
        _isDateSeparator: true,
        dateKey,
        label: formatDateLabel(dateKey),
        id: `date-sep-${dateKey}`,
      });
      lastDateKey = dateKey;
    }

    result.push(msg);
  }

  return result;
}