/**
 * weatherSystem.js
 *
 * Global weather system: reads cached weather from UserSettings.daily_weather_cache
 * and determines travel blocks + character mood modifiers.
 *
 * Source of truth: UserSettings.daily_weather_cache.conditions (string)
 * All logic is read-only — this file never writes to any entity.
 *
 * Outdoor location categories blocked during severe weather:
 *   park, outdoor, generic (if outdoors), athletic_field, trail
 *
 * Mood modifiers are returned for use in character prompt context.
 */

// ── Weather condition classification ───────────────────────────────────────

const SEVERE_WEATHER_KEYWORDS = [
  'storm', 'thunderstorm', 'hurricane', 'tornado', 'blizzard',
  'heavy rain', 'heavy snow', 'freezing rain', 'ice storm',
  'severe', 'dangerous', 'extreme', 'flood', 'hail',
];

const MILD_BAD_WEATHER_KEYWORDS = [
  'rain', 'drizzle', 'shower', 'snow', 'sleet', 'fog', 'foggy',
  'overcast', 'cloudy', 'windy', 'cold',
];

const NICE_WEATHER_KEYWORDS = [
  'sunny', 'clear', 'partly cloudy', 'warm', 'pleasant', 'beautiful',
  'mild', 'fair', 'breezy', 'perfect',
];

// Location categories considered "outdoors" for weather blocking
const OUTDOOR_CATEGORIES = ['park', 'outdoor', 'athletic_field', 'trail', 'beach', 'garden'];

/**
 * Classify weather conditions string into a severity level.
 * @param {string} conditions - from UserSettings.daily_weather_cache.conditions
 * @returns {'severe' | 'mild_bad' | 'nice' | 'unknown'}
 */
export function classifyWeather(conditions) {
  if (!conditions) return 'unknown';
  const lower = conditions.toLowerCase();

  if (SEVERE_WEATHER_KEYWORDS.some(k => lower.includes(k))) return 'severe';
  if (MILD_BAD_WEATHER_KEYWORDS.some(k => lower.includes(k))) return 'mild_bad';
  if (NICE_WEATHER_KEYWORDS.some(k => lower.includes(k))) return 'nice';
  return 'unknown';
}

/**
 * Check if a location is considered outdoors for weather-blocking purposes.
 * @param {Object} location - LocationReference record
 * @returns {boolean}
 */
export function isOutdoorLocation(location) {
  if (!location) return false;
  const cat = (location.category || '').toLowerCase();
  if (OUTDOOR_CATEGORIES.includes(cat)) return true;
  // Also check if the location name or description contains outdoor keywords
  const name = (location.name || '').toLowerCase();
  if (name.includes('park') || name.includes('trail') || name.includes('field') ||
      name.includes('beach') || name.includes('garden') || name.includes('outdoor')) {
    return true;
  }
  return false;
}

/**
 * Determine if travel to a specific location should be blocked by current weather.
 *
 * Returns:
 *   { blocked: false } — travel is fine
 *   { blocked: true, reason: string, severity: 'severe'|'mild_bad' } — travel blocked
 *
 * @param {Object} location - LocationReference record
 * @param {Object|null} weatherCache - UserSettings.daily_weather_cache
 */
export function checkWeatherTravelBlock(location, weatherCache) {
  if (!weatherCache?.conditions) return { blocked: false };

  const conditions = weatherCache.conditions;
  const severity = classifyWeather(conditions);

  // Only outdoor locations are affected
  if (!isOutdoorLocation(location)) return { blocked: false };

  if (severity === 'severe') {
    return {
      blocked: true,
      severity: 'severe',
      reason: `${location.name} is inaccessible due to ${conditions.toLowerCase()}. It's not safe to be outdoors right now.`,
      shortReason: `Blocked by ${conditions}`,
    };
  }

  if (severity === 'mild_bad') {
    // Mild bad weather: warn but don't block
    return {
      blocked: false,
      warning: true,
      severity: 'mild_bad',
      reason: `It's ${conditions.toLowerCase()} today. ${location.name} may be unpleasant.`,
    };
  }

  return { blocked: false };
}

/**
 * Get mood modifier text for characters caught in bad weather.
 * Used in chat/narrative context prompts to influence character behavior.
 *
 * Returns null if weather is fine or unknown.
 *
 * @param {Object|null} weatherCache - UserSettings.daily_weather_cache
 * @param {Object} character - Character record (for personality-based reactions)
 * @returns {string|null}
 */
export function getWeatherMoodModifier(weatherCache, character = null) {
  if (!weatherCache?.conditions) return null;

  const conditions = weatherCache.conditions;
  const severity = classifyWeather(conditions);
  const high = weatherCache.high;
  const low = weatherCache.low;
  const name = character?.name || 'The character';

  if (severity === 'severe') {
    return `WEATHER CONTEXT: Severe weather today — ${conditions}. ${name} is affected by this: they are likely anxious, cancelled plans, staying indoors, and may feel restless or irritable due to being cooped up. They might reference the weather in conversation.`;
  }

  if (severity === 'mild_bad') {
    // Personality-aware: introverts may love rainy days, extroverts may be frustrated
    const socialEnergy = character?.social_energy || 'ambivert';
    const isIntrovert = socialEnergy === 'introvert' || socialEnergy === 'mostly_introvert';

    if (isIntrovert) {
      return `WEATHER CONTEXT: ${conditions} today. ${name} is an introvert and is actually enjoying the cozy, stay-in-weather. They feel calm and content. Low-energy, comfortable, maybe tea or hot drinks.`;
    }
    return `WEATHER CONTEXT: ${conditions} today. ${name} is mildly affected — a bit sluggish, may prefer staying in, and could be slightly moody or low-energy compared to a sunny day.`;
  }

  if (severity === 'nice') {
    return `WEATHER CONTEXT: Beautiful weather today — ${conditions}${high ? `, high of ${high}°F` : ''}. ${name} is in a good mood from the nice weather. They might suggest outdoor plans or seem more energetic and upbeat than usual.`;
  }

  return null;
}

/**
 * Get a short human-readable weather status line for display in UI.
 * @param {Object|null} weatherCache
 * @returns {string|null}
 */
export function getWeatherStatusLine(weatherCache) {
  if (!weatherCache?.conditions) return null;
  const { conditions, high, low } = weatherCache;
  const parts = [conditions];
  if (high != null && low != null) parts.push(`${low}°–${high}°F`);
  else if (high != null) parts.push(`High ${high}°F`);
  return parts.join(' · ');
}

/**
 * Get weather icon emoji for current conditions.
 * @param {Object|null} weatherCache
 * @returns {string}
 */
export function getWeatherEmoji(weatherCache) {
  if (!weatherCache?.conditions) return '🌤️';
  const severity = classifyWeather(weatherCache.conditions);
  const lower = (weatherCache.conditions || '').toLowerCase();

  if (lower.includes('thunder') || lower.includes('lightning')) return '⛈️';
  if (lower.includes('storm') || lower.includes('hurricane') || lower.includes('tornado')) return '🌪️';
  if (lower.includes('snow') || lower.includes('blizzard')) return '❄️';
  if (lower.includes('hail')) return '🌨️';
  if (lower.includes('fog')) return '🌫️';
  if (lower.includes('rain') || lower.includes('drizzle') || lower.includes('shower')) return '🌧️';
  if (lower.includes('cloudy') || lower.includes('overcast')) return '☁️';
  if (lower.includes('partly cloudy')) return '⛅';
  if (lower.includes('sunny') || lower.includes('clear')) return '☀️';
  if (lower.includes('windy')) return '💨';
  return '🌤️';
}