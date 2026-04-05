/**
 * Holiday Calendar System
 * Defines all U.S. holidays, observances, dates, closure rules, and behavioral impacts
 */

const holidays = [
  {
    id: 'new_years_day',
    name: "New Year's Day",
    month: 1,
    day: 1,
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park', 'pharmacy'],
    emotionalThemes: ['reflection', 'hope', 'renewal', 'resolve'],
    eventTypes: ['gathering', 'celebration', 'party', 'reflection'],
    likelihood: { family: 0.4, celebration: 0.5, isolation: 0.2 },
  },
  {
    id: 'mlk_day',
    name: 'MLK Jr. Birthday',
    month: 1,
    week: 3,
    day: 1, // Monday
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['reflection', 'pride', 'justice', 'community'],
    eventTypes: ['volunteer', 'gathering', 'education', 'ceremony'],
    likelihood: { community: 0.4, volunteer: 0.3, reflection: 0.5 },
  },
  {
    id: 'presidents_day',
    name: "Presidents' Day",
    month: 2,
    week: 3,
    day: 1, // Monday
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['reflection', 'history'],
    eventTypes: ['gathering', 'travel', 'rest'],
    likelihood: { family: 0.3, travel: 0.4 },
  },
  {
    id: 'easter',
    name: 'Easter',
    recurring: true,
    type: 'religious',
    closures: ['school'], // some offices close, varies
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['faith', 'family', 'joy', 'renewal'],
    eventTypes: ['family_gathering', 'worship', 'celebration', 'egg_hunt'],
    likelihood: { family: 0.6, worship: 0.5, celebration: 0.4 },
    requiresCalendarCalculation: true, // Easter is variable
  },
  {
    id: 'memorial_day',
    name: 'Memorial Day',
    month: 5,
    week: -1, // last Monday
    day: 1,
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['remembrance', 'honor', 'reflection', 'gratitude'],
    eventTypes: ['gathering', 'remembrance', 'family', 'barbecue', 'park'],
    likelihood: { family: 0.5, gathering: 0.6, reflection: 0.4 },
  },
  {
    id: 'juneteenth',
    name: 'Juneteenth',
    month: 6,
    day: 19,
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['freedom', 'celebration', 'pride', 'community', 'joy'],
    eventTypes: ['festival', 'gathering', 'celebration', 'community_event', 'parade'],
    likelihood: { celebration: 0.6, community: 0.5, gathering: 0.5 },
  },
  {
    id: 'independence_day',
    name: 'Independence Day',
    month: 7,
    day: 4,
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['patriotism', 'celebration', 'freedom', 'community'],
    eventTypes: ['gathering', 'fireworks', 'barbecue', 'party', 'park'],
    likelihood: { family: 0.5, celebration: 0.7, gathering: 0.6 },
  },
  {
    id: 'labor_day',
    name: 'Labor Day',
    month: 9,
    week: 1,
    day: 1, // Monday
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'park'],
    emotionalThemes: ['rest', 'work_appreciation', 'community'],
    eventTypes: ['gathering', 'barbecue', 'family', 'rest'],
    likelihood: { family: 0.4, gathering: 0.4, rest: 0.5 },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    month: 10,
    day: 31,
    recurring: true,
    type: 'cultural',
    closures: [],
    staysOpen: ['hospital', 'grocery', 'park', 'office', 'bar', 'club'],
    emotionalThemes: ['fun', 'creativity', 'celebration', 'excitement'],
    eventTypes: ['trick_or_treat', 'party', 'costume', 'gathering'],
    likelihood: { celebration: 0.6, party: 0.5, isolation: 0.2 },
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    month: 11,
    week: 4,
    day: 4, // Thursday
    recurring: true,
    type: 'federal',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'pharmacy'],
    emotionalThemes: ['gratitude', 'family', 'connection', 'reflection'],
    eventTypes: ['family_gathering', 'dinner', 'travel'],
    likelihood: { family: 0.7, gathering: 0.65, travel: 0.5, isolation: 0.15 },
  },
  {
    id: 'christmas',
    name: 'Christmas',
    month: 12,
    day: 25,
    recurring: true,
    type: 'religious',
    closures: ['office', 'school', 'government'],
    staysOpen: ['hospital', 'grocery', 'pharmacy'],
    emotionalThemes: ['family', 'joy', 'celebration', 'giving', 'tradition'],
    eventTypes: ['family_gathering', 'celebration', 'worship', 'gifting'],
    likelihood: { family: 0.75, celebration: 0.7, worship: 0.4, isolation: 0.1 },
  },
  {
    id: 'christmas_eve',
    name: 'Christmas Eve',
    month: 12,
    day: 24,
    recurring: true,
    type: 'religious',
    closures: [],
    staysOpen: ['hospital', 'grocery', 'pharmacy', 'office', 'bar'],
    emotionalThemes: ['anticipation', 'family', 'joy'],
    eventTypes: ['family_gathering', 'worship', 'celebration'],
    likelihood: { family: 0.6, celebration: 0.5, worship: 0.3 },
  },
  {
    id: 'pride_month',
    name: 'Pride Month',
    month: 6,
    week: 'full',
    recurring: true,
    type: 'cultural',
    closures: [],
    staysOpen: ['hospital', 'grocery', 'office', 'school'],
    emotionalThemes: ['pride', 'celebration', 'community', 'visibility'],
    eventTypes: ['parade', 'festival', 'gathering', 'community'],
    likelihood: { celebration: 0.6, community: 0.5, gathering: 0.4 },
  },
  {
    id: 'hiv_awareness_day',
    name: 'National HIV Testing Day',
    month: 6,
    day: 27,
    recurring: true,
    type: 'awareness',
    closures: [],
    staysOpen: ['hospital', 'clinic', 'grocery', 'office', 'school'],
    emotionalThemes: ['health', 'awareness', 'community', 'support'],
    eventTypes: ['health_event', 'community', 'testing', 'awareness'],
    likelihood: { health: 0.3, community: 0.2 },
  },
  {
    id: 'jewish_passover',
    name: 'Passover',
    recurring: true,
    type: 'religious',
    closures: ['school'], // some offices
    staysOpen: ['hospital', 'grocery', 'pharmacy'],
    emotionalThemes: ['family', 'tradition', 'spirituality', 'reflection'],
    eventTypes: ['family_gathering', 'seder', 'worship'],
    likelihood: { family: 0.8, worship: 0.6, isolation: 0.1 },
    requiresCalendarCalculation: true,
  },
  {
    id: 'jewish_rosh_hashanah',
    name: 'Rosh Hashanah',
    recurring: true,
    type: 'religious',
    closures: ['school'], // some offices
    staysOpen: ['hospital', 'grocery', 'pharmacy'],
    emotionalThemes: ['reflection', 'renewal', 'spirituality', 'family'],
    eventTypes: ['family_gathering', 'worship', 'celebration'],
    likelihood: { family: 0.7, worship: 0.7 },
    requiresCalendarCalculation: true,
  },
  {
    id: 'jewish_yom_kippur',
    name: 'Yom Kippur',
    recurring: true,
    type: 'religious',
    closures: ['school'], // some offices
    staysOpen: ['hospital', 'grocery', 'pharmacy'],
    emotionalThemes: ['reflection', 'spirituality', 'atonement'],
    eventTypes: ['worship', 'reflection', 'fasting'],
    likelihood: { worship: 0.8, reflection: 0.7 },
    requiresCalendarCalculation: true,
  },
  {
    id: 'ramadan',
    name: 'Ramadan',
    recurring: true,
    type: 'religious',
    closures: [],
    staysOpen: ['hospital', 'grocery', 'office', 'school'],
    emotionalThemes: ['spirituality', 'discipline', 'community', 'reflection'],
    eventTypes: ['worship', 'family_gathering', 'community', 'fasting'],
    likelihood: { worship: 0.8, family: 0.6, community: 0.4 },
    requiresCalendarCalculation: true,
    monthLong: true,
  },
  {
    id: 'eid_al_fitr',
    name: 'Eid al-Fitr',
    recurring: true,
    type: 'religious',
    closures: [],
    staysOpen: ['hospital', 'grocery', 'office', 'school'],
    emotionalThemes: ['joy', 'celebration', 'gratitude', 'community'],
    eventTypes: ['family_gathering', 'celebration', 'worship', 'charity'],
    likelihood: { family: 0.8, celebration: 0.7, community: 0.5 },
    requiresCalendarCalculation: true,
  },
];

/**
 * Get holiday for a given date
 * @param {Date} date
 * @returns {Object|null}
 */
export function getHolidayForDate(date) {
  const month = date.getMonth() + 1;
  const dayOfMonth = date.getDate();
  const dayOfWeek = date.getDay();

  for (const holiday of holidays) {
    if (holiday.requiresCalendarCalculation) {
      // Skip for now—Easter, Passover, Ramadan, etc. need special calculation
      continue;
    }

    if (holiday.month !== month) continue;

    // Fixed date holiday
    if (holiday.day && !holiday.week) {
      if (holiday.day === dayOfMonth) return holiday;
    }

    // Week-based holiday (e.g., 3rd Monday)
    if (holiday.week) {
      const firstDay = new Date(date.getFullYear(), month - 1, 1);
      const firstDayOfWeek = firstDay.getDay();
      
      let targetDate;
      if (holiday.week === -1) {
        // Last occurrence
        const lastDay = new Date(date.getFullYear(), month, 0);
        const lastDayOfWeek = lastDay.getDate();
        const daysBack = (lastDay.getDay() - holiday.day + 7) % 7;
        targetDate = lastDayOfWeek - daysBack;
      } else {
        // Nth occurrence
        const daysFromFirst = (holiday.day - firstDayOfWeek + 7) % 7;
        targetDate = 1 + daysFromFirst + (holiday.week - 1) * 7;
      }

      if (targetDate === dayOfMonth) return holiday;
    }
  }

  return null;
}

/**
 * Get all holidays for a given year
 * @param {Number} year
 * @returns {Array}
 */
export function getHolidaysForYear(year) {
  const result = [];
  
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= 31; day++) {
      try {
        const date = new Date(year, month - 1, day);
        if (date.getMonth() + 1 !== month) break; // End of month
        const holiday = getHolidayForDate(date);
        if (holiday && !result.find(h => h.id === holiday.id && h.month === month)) {
          result.push({ ...holiday, year, date });
        }
      } catch (e) {
        break;
      }
    }
  }
  
  return result;
}

/**
 * Check if a location should be closed on a given holiday
 * @param {String} locationType - 'office', 'school', 'hospital', 'grocery', etc.
 * @param {Object} holiday
 * @returns {Boolean}
 */
export function isLocationClosedForHoliday(locationType, holiday) {
  return holiday.closures.includes(locationType);
}

/**
 * Get emotional themes for a holiday
 * @param {Object} holiday
 * @returns {Array}
 */
export function getHolidayEmotionalThemes(holiday) {
  return holiday.emotionalThemes || [];
}

export const HOLIDAY_OBSERVATION_ENABLED = 'holiday_observation_enabled';