/**
 * defaultCommunityEvents.js
 *
 * Single shared source of default community events used by:
 *   - components/home/CommunityEventsStrip.jsx
 *   - pages/Moments.jsx (passed to MomentsCalendar as communityEvents prop)
 *   - lib/promptContextBuilders.js (character awareness — upcoming slice only)
 *
 * Rules:
 *   - NO character presence, NO private homes, NO residential locations
 *   - Public / semi-public venues only (bars, parks, libraries, clinics, community centers, etc.)
 *   - Dates are always relative to "today" so they remain upcoming
 *   - Rotates by day-of-week so the ordering shifts naturally each day
 *   - Used as FALLBACK ONLY when the DB produces fewer than 4 real CommunityEvent records
 *
 * Real App Location Injection (1-in-10 rule):
 *   - buildDefaultCommunityEvents(appLocations) accepts an optional array of LocationReference records
 *   - Non-residential public locations are eligible for injection into system/default events
 *   - Target: at least 1 in every 10 displayed default events references a real app location
 *   - Private/residential locations are NEVER used for system events
 *   - buildDefaultCommunityEvents.lastProof contains diagnostic info about eligibility
 */

export const EVENT_TYPE_ICONS = {
  entertainment:    '🎤',
  fitness:          '🧘',
  educational:      '📚',
  cultural:         '🎨',
  health_awareness: '❤️',
  social:           '☕',
  support:          '🤝',
  celebration:      '✨',
  resource_fair:    '🏠',
  personal:         '📅',
  other:            '📌',
};

// ── RESIDENTIAL CATEGORY EXCLUSION LIST ────────────────────────────────────
// These location categories are considered private/residential and must NOT be
// used for system-generated community events.
const RESIDENTIAL_CATEGORIES = new Set([
  'residential', 'home', 'private_home', 'apartment', 'house', 'condo',
  'private', 'temporary_housing', 'shelter_private', 'halfway_house',
]);

/**
 * Returns true if a LocationReference record is eligible for system community events.
 * Excludes residential/private locations. No character presence check — data only.
 */
function isPublicEligible(loc) {
  if (!loc || !loc.id) return false;
  const cat = (loc.category || loc.location_type || loc.type || '').toLowerCase();
  if (RESIDENTIAL_CATEGORIES.has(cat)) return false;
  // Also exclude if name contains home/apartment/residence keywords
  const nameLower = (loc.name || '').toLowerCase();
  if (/\b(apartment|apt|residence|home|house|condo|suite \d|unit \d)\b/.test(nameLower)) return false;
  return true;
}

// ── STATIC TEMPLATE ─────────────────────────────────────────────────────────
// daysFromNow and hour/minute are resolved at call time by buildDefaultCommunityEvents().
const EVENT_TEMPLATES = [
  {
    id: 'def_openmic',
    name: 'Open Mic Night',
    event_type: 'entertainment',
    location_name: 'The Loft Bar & Lounge',
    offsetDays: 1, hour: 20, minute: 0,
    vibe: 'social',
    description: 'Local talent takes the stage — poetry, music, and comedy welcome.',
  },
  {
    id: 'def_yoga',
    name: 'Community Yoga in the Park',
    event_type: 'fitness',
    location_name: 'Riverside Park',
    offsetDays: 2, hour: 8, minute: 0,
    vibe: 'quiet',
    description: 'Free outdoor yoga session. All levels welcome. Bring a mat.',
  },
  {
    id: 'def_bookclub',
    name: 'Book Club Meetup',
    event_type: 'educational',
    location_name: 'Public Library — Meeting Room B',
    offsetDays: 3, hour: 18, minute: 30,
    vibe: 'quiet',
    description: 'Monthly discussion. New members welcome — no prep required.',
  },
  {
    id: 'def_karaoke',
    name: 'Karaoke Night',
    event_type: 'entertainment',
    location_name: 'Spectrum Lounge',
    offsetDays: 3, hour: 21, minute: 0,
    vibe: 'energetic',
    description: 'Weekly karaoke. No auditions. Just vibes.',
  },
  {
    id: 'def_healthfair',
    name: 'Community Health Fair',
    event_type: 'health_awareness',
    location_name: 'Community Center — Main Hall',
    offsetDays: 4, hour: 10, minute: 0,
    vibe: 'mixed',
    description: 'Free screenings, HIV/STI testing, mental health resources, and more.',
  },
  {
    id: 'def_artexhibit',
    name: 'Art Exhibit Opening',
    event_type: 'cultural',
    location_name: 'Gallery 47',
    offsetDays: 4, hour: 18, minute: 0,
    vibe: 'social',
    description: 'Opening reception for local emerging artists. Light refreshments.',
  },
  {
    id: 'def_coffeemeetup',
    name: 'Coffeehouse Meetup',
    event_type: 'social',
    location_name: 'Common Ground Coffee',
    offsetDays: 5, hour: 10, minute: 0,
    vibe: 'quiet',
    description: 'Casual weekend morning meetup. Good conversation, no agenda.',
  },
  {
    id: 'def_gamenight',
    name: 'Game Night',
    event_type: 'social',
    location_name: 'The Social — Bar & Games',
    offsetDays: 5, hour: 19, minute: 0,
    vibe: 'energetic',
    description: 'Board games, trivia, and prizes. Teams of 2–6.',
  },
  {
    id: 'def_foodpantry',
    name: 'Food Pantry & Resource Day',
    event_type: 'resource_fair',
    location_name: 'First Baptist Community Hall',
    offsetDays: 6, hour: 9, minute: 0,
    vibe: 'mixed',
    description: 'Free groceries, hygiene kits, and community resource referrals.',
  },
  {
    id: 'def_poetry',
    name: 'Poetry Reading',
    event_type: 'cultural',
    location_name: 'Ink & Pages Bookstore',
    offsetDays: 6, hour: 17, minute: 0,
    vibe: 'quiet',
    description: 'Featured readers and open floor. Bring a poem or just listen.',
  },
  {
    id: 'def_ballroom',
    name: 'Ballroom & Vogue Social',
    event_type: 'celebration',
    location_name: 'The Grand Ballroom',
    offsetDays: 7, hour: 21, minute: 0,
    vibe: 'energetic',
    description: 'Community ballroom social. All houses welcome.',
  },
  {
    id: 'def_supportgroup',
    name: 'Community Support Circle',
    event_type: 'support',
    location_name: 'Wellness Center — Room 3',
    offsetDays: 7, hour: 17, minute: 0,
    vibe: 'quiet',
    description: 'Peer support group. Safe, confidential, drop-in.',
  },
];

/**
 * Build resolved default events with real ISO start_date values.
 * Rotates by day of week so order feels fresh each day.
 *
 * @param {Array} appLocations – optional array of LocationReference records from the app DB
 * @returns {Array} Array of event objects compatible with both CommunityEventsStrip and MomentsCalendar
 */
export function buildDefaultCommunityEvents(appLocations = []) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = now.getDate();

  // ── REAL APP LOCATION INJECTION (1-in-10 rule) ──────────────────────────
  const totalLocations = appLocations.length;
  const residentialCount = appLocations.filter(l => !isPublicEligible(l)).length;
  const eligibleLocations = appLocations.filter(isPublicEligible);

  // Rotate eligible locations so different ones get picked each day
  const rotatedEligible = eligibleLocations.length > 0
    ? [...eligibleLocations.slice(dayOfWeek % eligibleLocations.length), ...eligibleLocations.slice(0, dayOfWeek % eligibleLocations.length)]
    : [];

  // Build events array first (unrotated) so we can inject at index 0 (every 10th slot)
  const events = EVENT_TEMPLATES.map((tmpl, idx) => {
    const dt = new Date(thisYear, thisMonth, today + tmpl.offsetDays, tmpl.hour, tmpl.minute, 0);
    const base = {
      id: tmpl.id,
      name: tmpl.name,
      event_type: tmpl.event_type,
      location_name: tmpl.location_name,
      location_id: null,
      start_date: dt.toISOString(),
      vibe: tmpl.vibe,
      description: tmpl.description,
      is_active: true,
      source: 'system',
      _isDefault: true,
      _icon: EVENT_TYPE_ICONS[tmpl.event_type] || '📌',
    };

    // Inject a real app location at every 10th position (index 0, 10, 20, ...)
    // Uses modulo so even with 12 templates we inject at index 0 and index 10 if eligible
    if (rotatedEligible.length > 0 && idx % 10 === 0) {
      const pick = rotatedEligible[Math.floor(idx / 10) % rotatedEligible.length];
      return {
        ...base,
        location_id: pick.id,
        location_name: pick.name,
        _realLocationInjected: true,
        _realLocationCategory: pick.category || pick.location_type || null,
      };
    }

    return base;
  });

  // Proof object attached to function (diagnostic use)
  buildDefaultCommunityEvents._lastProof = {
    totalLocationsLoaded: totalLocations,
    residentialExcluded: residentialCount,
    eligiblePublicLocations: eligibleLocations.map(l => ({ id: l.id, name: l.name, category: l.category || l.location_type })),
    injectedEvents: events.filter(e => e._realLocationInjected).map(e => ({ id: e.id, name: e.name, location_name: e.location_name, location_id: e.location_id })),
  };

  // Rotate by day-of-week so it feels fresh
  const offset = dayOfWeek % events.length;
  return [...events.slice(offset), ...events.slice(0, offset)];
}