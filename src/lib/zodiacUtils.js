const ZODIAC_DATE_RANGES = {
  "aries": { start: [3, 21], end: [4, 19] },
  "taurus": { start: [4, 20], end: [5, 20] },
  "gemini": { start: [5, 21], end: [6, 20] },
  "cancer": { start: [6, 21], end: [7, 22] },
  "leo": { start: [7, 23], end: [8, 22] },
  "virgo": { start: [8, 23], end: [9, 22] },
  "libra": { start: [9, 23], end: [10, 22] },
  "scorpio": { start: [10, 23], end: [11, 21] },
  "sagittarius": { start: [11, 22], end: [12, 21] },
  "capricorn": { start: [12, 22], end: [1, 19] },
  "aquarius": { start: [1, 20], end: [2, 18] },
  "pisces": { start: [2, 19], end: [3, 20] }
};

const AGE_RANGE_TO_AGE = {
  "Early 20s": 22,
  "Mid 20s": 25,
  "Late 20s": 28,
  "Early 30s": 32,
  "Mid 30s": 35,
  "Late 30s": 38,
  "40s+": 45
};

export function calculateBirthdateFromZodiac(zodiacSign, ageRange) {
  if (!zodiacSign || !ageRange) return null;
  
  const range = ZODIAC_DATE_RANGES[zodiacSign.toLowerCase()];
  if (!range) return null;
  
  const age = AGE_RANGE_TO_AGE[ageRange];
  if (age === undefined) return null;
  
  const currentDate = new Date();
  const birthYear = currentDate.getFullYear() - age;
  
  // Use middle of the zodiac date range
  const [startMonth, startDay] = range.start;
  const [endMonth, endDay] = range.end;
  
  let midMonth = startMonth;
  let midDay = Math.round((startDay + endDay) / 2);
  
  if (startMonth !== endMonth) {
    midMonth = startMonth;
    midDay = 15;
  }
  
  const dateString = `${birthYear}-${String(midMonth).padStart(2, '0')}-${String(midDay).padStart(2, '0')}`;
  return dateString;
}