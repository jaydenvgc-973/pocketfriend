/**
 * Holiday State Management
 * Tracks holiday popup acknowledgments and system state
 */

/**
 * Get holiday popup acknowledgment key
 * @param {String} holidayId
 * @param {Number} year
 * @returns {String}
 */
export function getHolidayAckKey(holidayId, year) {
  return `holiday_ack_${holidayId}_${year}`;
}

/**
 * Get all acknowledged holidays
 * @param {Object} localStorage - browser localStorage or mock
 * @returns {Array} - array of { holidayId, year, acknowledgedAt }
 */
export function getAcknowledgedHolidays(localStorage) {
  if (!localStorage) return [];
  
  const acked = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('holiday_ack_')) {
      const parts = key.replace('holiday_ack_', '').split('_');
      const year = parseInt(parts[parts.length - 1]);
      const holidayId = parts.slice(0, -1).join('_');
      acked.push({
        holidayId,
        year,
        acknowledgedAt: localStorage.getItem(key),
      });
    }
  }
  return acked;
}

/**
 * Mark holiday as acknowledged
 * @param {String} holidayId
 * @param {Number} year
 * @param {Object} localStorage
 */
export function acknowledgeHoliday(holidayId, year, localStorage) {
  if (!localStorage) return;
  const key = getHolidayAckKey(holidayId, year);
  localStorage.setItem(key, new Date().toISOString());
}

/**
 * Check if holiday has been acknowledged
 * @param {String} holidayId
 * @param {Number} year
 * @param {Object} localStorage
 * @returns {Boolean}
 */
export function hasAcknowledgedHoliday(holidayId, year, localStorage) {
  if (!localStorage) return false;
  const key = getHolidayAckKey(holidayId, year);
  return !!localStorage.getItem(key);
}

/**
 * Clear all holiday acknowledgments
 * @param {Object} localStorage
 */
export function clearHolidayAcknowledgments(localStorage) {
  if (!localStorage) return;
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('holiday_ack_')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}