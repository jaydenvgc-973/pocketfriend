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
 *   - Public / semi-public venues only for SYSTEM events
 *   - User-created events can use ANY location (including residential)
 *   - Dates are always relative to "today" so they remain upcoming
 *   - Rotates by day-of-week so the ordering shifts naturally each day
 *   - Used as FALLBACK ONLY when the DB produces fewer than 4 real CommunityEvent records
 *
 * Real app location injection:
 *   - buildDefaultCommunityEvents(appLocations?) accepts an optional LocationReference array
 *   - At least 1 of every 10 default events will use a real public/semi-public app location
 *   - Residential categories are excluded from system event injection
 *   - Returns proof via buildDefaultCommunityEventsWithProof(appLocations)
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

// ── RESIDENTIAL CATEGORIES (excluded from system/default event injection) ──────
const RESIDENTIAL_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'jail', 'prison',
  'detention_center', 'correctional_facility', 'juvenile_detention',
  'halfway_house', 'holding_cell',
]);

// Public/semi-public categories eligible for system event injection
const PUBLIC_CATEGORIES = new Set([
  'social', 'outdoor', 'food_drink', 'medical', 'education',
  'grocery', 'religion', 'government', 'public', 'business',
  'school', 'community', 'gym', 'workplace', 'generic',
]);

// ── STATIC TEMPLATE ─────────────────────────────────────────────────────────
// daysFromNow and hour/minute are resolved at call time.
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
 * Extract eligible public/semi-public locations from an app LocationReference array.
 * Excludes residential, confinement, and private categories.
 * Does NOT query character presence or homes.
 *
 * @param {Array} appLocations - LocationReference records
 * @returns {{ eligible: Array, totalLoaded: number, residentialExcluded: number }}
 */
function extractPublicLocations(appLocations = []) {
  const totalLoaded = appLocations.length;
  let residentialExcluded = 0;
  const eligible = [];

  for (const loc of appLocations) {
    if (!loc.name) continue;
    const cat = loc.category || 'generic';
    if (RESIDENTIAL_CATEGORIES.has(cat) || loc.is_confinement_facility) {
      residentialExcluded++;
      continue;
    }
    // Also exclude locations whose names suggest they are personal homes
    const nameLower = (loc.name || '').toLowerCase();
    const isPersonalHome = /\b(apartment|apt|house|home|condo|townhouse|unit|suite|residence|flat)\b/.test(nameLower) &&
      /\b(s|'s)\b/.test(nameLower); // e.g. "Jayden's Apartment"
    if (isPersonalHome) {
      residentialExcluded++;
      continue;
    }
    if (PUBLIC_CATEGORIES.has(cat)) {
      eligible.push(loc);
    }
  }

  return { eligible, totalLoaded, residentialExcluded };
}

/**
 * Build resolved default events with real ISO start_date values.
 * Optionally injects real app locations — at least 1 per 10 events.
 * Rotates by day of week so order feels fresh each day.
 *
 * @param {Array} appLocations - Optional LocationReference array from the app
 * @returns {Array} Event objects compatible with CommunityEventsStrip and MomentsCalendar
 */
export function buildDefaultCommunityEvents(appLocations = []) {
  return buildDefaultCommunityEventsWithProof(appLocations).events;
}

/**
 * Build default events AND return proof of real location injection.
 *
 * @param {Array} appLocations - Optional LocationReference array
 * @returns {{ events: Array, proof: Object }}
 */
export function buildDefaultCommunityEventsWithProof(appLocations = []) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = now.getDate();

  // Extract eligible public locations from real app data
  const { eligible, totalLoaded, residentialExcluded } = extractPublicLocations(appLocations);

  // Rotate templates by day-of-week
  const offset = dayOfWeek % EVENT_TEMPLATES.length;
  const rotated = [...EVENT_TEMPLATES.slice(offset), ...EVENT_TEMPLATES.slice(0, offset)];

  // Determine injection slots: at least 1 per 10 events
  // e.g. 12 events → inject at index 0 and 10
  const injectionSlots = new Set();
  if (eligible.length > 0) {
    for (let i = 0; i < rotated.length; i += 10) {
      injectionSlots.add(i);
    }
  }

  const injectedAt = []; // proof tracking
  let eligibleIndex = 0;

  const events = rotated.map((tmpl, idx) => {
    const dt = new Date(thisYear, thisMonth, today + tmpl.offsetDays, tmpl.hour, tmpl.minute, 0);

    let locationName = tmpl.location_name;
    let locationId = null;
    let locationCategory = null;
    let usedRealLocation = false;

    if (injectionSlots.has(idx) && eligible.length > 0) {
      const realLoc = eligible[eligibleIndex % eligible.length];
      eligibleIndex++;
      locationName = realLoc.name;
      locationId = realLoc.id;
      locationCategory = realLoc.category || null;
      usedRealLocation = true;
      injectedAt.push({
        eventIndex: idx,
        eventName: tmpl.name,
        locationId: realLoc.id,
        locationName: realLoc.name,
        locationCategory: realLoc.category,
      });
    }

    return {
      id: tmpl.id,
      name: tmpl.name,
      event_type: tmpl.event_type,
      location_name: locationName,
      location_id: locationId || undefined,
      location_category: locationCategory || undefined,
      start_date: dt.toISOString(),
      vibe: tmpl.vibe,
      description: tmpl.description,
      is_active: true,
      source: 'system',
      _isDefault: true,
      _usedRealLocation: usedRealLocation,
      _icon: EVENT_TYPE_ICONS[tmpl.event_type] || '📌',
    };
  });

  const proof = {
    totalAppLocationsLoaded: totalLoaded,
    residentialExcluded,
    eligiblePublicLocations: eligible.map(l => ({ id: l.id, name: l.name, category: l.category })),
    eligibleCount: eligible.length,
    totalDefaultEvents: events.length,
    injectionSlots: [...injectionSlots],
    realLocationsInjectedCount: injectedAt.length,
    injectedAt,
    summary: eligible.length > 0
      ? `${injectedAt.length} of ${events.length} default events use a real app location (eligible: ${eligible.length} public locations from ${totalLoaded} total, ${residentialExcluded} residential excluded)`
      : `No eligible public app locations found (${totalLoaded} total, ${residentialExcluded} residential excluded) — all defaults use static venue names`,
  };

  return { events, proof };
}