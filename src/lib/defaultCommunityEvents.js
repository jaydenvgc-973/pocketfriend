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
 * Real app location injection (smart matching):
 *   - buildDefaultCommunityEvents(appLocations?) accepts an optional LocationReference array
 *   - At least 1 of every 10 default events will use a real public/semi-public app location
 *   - Residential categories are excluded from system event injection
 *   - Matched by event type → preferred location categories (semantic affinity)
 *   - Location must be OPEN at the event time (operating_hours check)
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

/**
 * Semantic affinity: maps event_type + template keywords → preferred location categories
 * More specific = higher priority. First matching category wins.
 */
const EVENT_TYPE_CATEGORY_AFFINITY = {
  // event_type → ordered list of preferred location categories
  social:           ['food_drink', 'social', 'community', 'public', 'generic'],
  entertainment:    ['social', 'food_drink', 'community', 'public', 'generic'],
  fitness:          ['gym', 'outdoor', 'community', 'public', 'generic'],
  educational:      ['education', 'community', 'public', 'generic'],
  cultural:         ['community', 'social', 'education', 'public', 'generic'],
  health_awareness: ['medical', 'community', 'public', 'generic'],
  support:          ['medical', 'community', 'public', 'generic'],
  celebration:      ['social', 'food_drink', 'community', 'public', 'generic'],
  resource_fair:    ['community', 'public', 'generic'],
  other:            ['community', 'public', 'generic'],
};

/**
 * Extra name-based keyword hints for finer semantic matching within a category.
 * If the event name contains any keyword, prefer locations whose names contain matching terms.
 */
const EVENT_NAME_KEYWORDS = {
  coffee:   ['coffee', 'café', 'cafe', 'roast', 'bean', 'brew'],
  karaoke:  ['karaoke', 'lounge', 'bar'],
  poetry:   ['bookstore', 'book', 'library', 'café', 'cafe', 'lounge'],
  yoga:     ['park', 'gym', 'community', 'fitness'],
  fitness:  ['gym', 'park', 'fitness', 'community'],
  health:   ['clinic', 'health', 'medical', 'community', 'center'],
  art:      ['gallery', 'art', 'studio', 'community'],
  book:     ['library', 'bookstore', 'book', 'café', 'cafe'],
  game:     ['bar', 'games', 'community', 'social', 'café', 'cafe'],
  music:    ['lounge', 'bar', 'venue', 'studio'],
  open_mic: ['lounge', 'bar', 'café', 'cafe', 'community', 'venue'],
};

/**
 * Determine keyword hints for an event name.
 * Returns an array of preferred name substrings (lowercase).
 */
function getNameKeywordsForEvent(eventName) {
  const nameLower = eventName.toLowerCase();
  if (nameLower.includes('coffee') || nameLower.includes('coffeehouse')) return EVENT_NAME_KEYWORDS.coffee;
  if (nameLower.includes('karaoke')) return EVENT_NAME_KEYWORDS.karaoke;
  if (nameLower.includes('poetry') || nameLower.includes('poem')) return EVENT_NAME_KEYWORDS.poetry;
  if (nameLower.includes('yoga')) return EVENT_NAME_KEYWORDS.yoga;
  if (nameLower.includes('fitness') || nameLower.includes('workout')) return EVENT_NAME_KEYWORDS.fitness;
  if (nameLower.includes('health') || nameLower.includes('testing') || nameLower.includes('screening')) return EVENT_NAME_KEYWORDS.health;
  if (nameLower.includes('art') || nameLower.includes('exhibit') || nameLower.includes('gallery')) return EVENT_NAME_KEYWORDS.art;
  if (nameLower.includes('book') || nameLower.includes('reading') || nameLower.includes('library')) return EVENT_NAME_KEYWORDS.book;
  if (nameLower.includes('game')) return EVENT_NAME_KEYWORDS.game;
  if (nameLower.includes('music') || nameLower.includes('open mic')) return EVENT_NAME_KEYWORDS.music;
  return [];
}

// ── OPERATING HOURS CHECK ─────────────────────────────────────────────────────
/**
 * Parse "HH:MM" string → total minutes from midnight
 */
function timeStrToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Check if a location is open at the given Date using its operating_hours array.
 * operating_hours items: { day_of_week?: number, open_time: "HH:MM", close_time: "HH:MM" }
 * If no operating_hours are configured, assume open (safe default).
 *
 * @param {Object} location - LocationReference record
 * @param {Date} eventDate - Date object for the event
 * @returns {{ isOpen: boolean, reason: string, matchedHours: object|null }}
 */
function checkLocationOpenAt(location, eventDate) {
  const hours = location.operating_hours;
  if (!hours || hours.length === 0) {
    return { isOpen: true, reason: 'No operating hours configured — assumed open', matchedHours: null };
  }

  const dayOfWeek = eventDate.getDay(); // 0=Sun, 6=Sat
  const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

  // Find a matching hours entry for this day
  // Some entries may have day_of_week; if omitted we treat it as applying to all days
  const matchingEntry = hours.find(h => h.day_of_week === undefined || h.day_of_week === dayOfWeek);
  if (!matchingEntry) {
    return { isOpen: false, reason: `No hours entry for day ${dayOfWeek} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`, matchedHours: null };
  }

  const openMin = timeStrToMinutes(matchingEntry.open_time);
  const closeMin = timeStrToMinutes(matchingEntry.close_time);

  if (openMin === null || closeMin === null) {
    return { isOpen: true, reason: 'Operating hours present but unparseable — assumed open', matchedHours: matchingEntry };
  }

  // Handle midnight-spanning ranges (e.g. open 20:00, close 02:00)
  let isOpen;
  if (closeMin <= openMin) {
    // Spans midnight
    isOpen = eventMinutes >= openMin || eventMinutes < closeMin;
  } else {
    isOpen = eventMinutes >= openMin && eventMinutes < closeMin;
  }

  const hhmm = (m) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const reason = isOpen
    ? `Open ${matchingEntry.open_time}–${matchingEntry.close_time} on day ${dayOfWeek}; event at ${hhmm(eventMinutes)}`
    : `Closed — hours ${matchingEntry.open_time}–${matchingEntry.close_time} on day ${dayOfWeek}; event at ${hhmm(eventMinutes)}`;

  return { isOpen, reason, matchedHours: matchingEntry };
}

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
      /('s|s')\b/.test(nameLower); // e.g. "Jayden's Apartment"
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
 * Pick the best real location for a given event template from the eligible list.
 * Scoring:
 *   +3  location category matches affinity preference (higher if earlier in affinity list)
 *   +2  location name contains a keyword hint for the event
 *   +0  location is open at event time (required: location must be open OR have no hours)
 *   -∞  location is CLOSED at event time (disqualify)
 *
 * Returns { location, hoursCheck, score, rejectedCandidates } or null if none eligible.
 *
 * @param {Object} tmpl - Event template
 * @param {Date} eventDate - Resolved event Date
 * @param {Array} eligible - Filtered public LocationReference records
 * @returns {{ location: Object, hoursCheck: Object, score: number, rejectedCandidates: Array }|null}
 */
function pickBestLocation(tmpl, eventDate, eligible) {
  if (!eligible.length) return null;

  const affinity = EVENT_TYPE_CATEGORY_AFFINITY[tmpl.event_type] || ['community', 'public', 'generic'];
  const nameKeywords = getNameKeywordsForEvent(tmpl.name);
  const rejectedCandidates = [];

  // Score each eligible location
  const scored = eligible.map(loc => {
    const hoursCheck = checkLocationOpenAt(loc, eventDate);
    if (!hoursCheck.isOpen) {
      rejectedCandidates.push({
        locationId: loc.id,
        locationName: loc.name,
        category: loc.category,
        rejectedReason: hoursCheck.reason,
      });
      return null;
    }

    let score = 0;
    const locCat = loc.category || 'generic';
    const locNameLower = (loc.name || '').toLowerCase();

    // Category affinity score: higher if earlier in the preference list
    const affinityIdx = affinity.indexOf(locCat);
    if (affinityIdx !== -1) {
      score += Math.max(1, affinity.length - affinityIdx); // max for first match
    }

    // Name keyword bonus
    if (nameKeywords.length > 0) {
      const hasKeyword = nameKeywords.some(kw => locNameLower.includes(kw));
      if (hasKeyword) score += 2;
    }

    return { location: loc, hoursCheck, score };
  }).filter(Boolean);

  if (!scored.length) return null;

  // Sort by descending score, then alphabetically for stability
  scored.sort((a, b) => b.score - a.score || a.location.name.localeCompare(b.location.name));

  return { ...scored[0], rejectedCandidates };
}

/**
 * Build resolved default events with real ISO start_date values.
 * Optionally injects smart-matched real app locations — at least 1 per 10 events.
 * Rotates by day of week so order feels fresh each day.
 *
 * @param {Array} appLocations - Optional LocationReference array from the app
 * @returns {Array} Event objects compatible with CommunityEventsStrip and MomentsCalendar
 */
export function buildDefaultCommunityEvents(appLocations = []) {
  return buildDefaultCommunityEventsWithProof(appLocations).events;
}

/**
 * Build default events AND return full proof of real location injection with diagnostics.
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
  const injectionSlots = new Set();
  if (eligible.length > 0) {
    for (let i = 0; i < rotated.length; i += 10) {
      injectionSlots.add(i);
    }
  }

  const proofEntries = []; // full per-slot diagnostics

  const events = rotated.map((tmpl, idx) => {
    const dt = new Date(thisYear, thisMonth, today + tmpl.offsetDays, tmpl.hour, tmpl.minute, 0);

    let locationName = tmpl.location_name;
    let locationId = null;
    let locationCategory = null;
    let usedRealLocation = false;
    let slotProof = null;

    if (injectionSlots.has(idx) && eligible.length > 0) {
      const pick = pickBestLocation(tmpl, dt, eligible);

      if (pick) {
        locationName = pick.location.name;
        locationId = pick.location.id;
        locationCategory = pick.location.category || null;
        usedRealLocation = true;

        slotProof = {
          slot: idx,
          eventName: tmpl.name,
          eventType: tmpl.event_type,
          eventTime: dt.toISOString(),
          chosenLocation: pick.location.name,
          chosenLocationId: pick.location.id,
          chosenCategory: pick.location.category,
          operatingHours: pick.location.operating_hours || [],
          isOpen: pick.hoursCheck.isOpen,
          hoursReason: pick.hoursCheck.reason,
          score: pick.score,
          selectionReason: `Best semantic match (score ${pick.score}) for event_type="${tmpl.event_type}", event name="${tmpl.name}"`,
          rejectedCandidates: pick.rejectedCandidates,
          usedRealLocation: true,
        };
      } else {
        // No open eligible location — fall back to static name
        slotProof = {
          slot: idx,
          eventName: tmpl.name,
          eventType: tmpl.event_type,
          eventTime: dt.toISOString(),
          chosenLocation: tmpl.location_name,
          chosenLocationId: null,
          chosenCategory: null,
          operatingHours: [],
          isOpen: null,
          hoursReason: null,
          score: null,
          selectionReason: `No open eligible app location found for this event — using static fallback "${tmpl.location_name}"`,
          rejectedCandidates: pickBestLocation(tmpl, dt, eligible) === null
            ? eligible.map(loc => ({
                locationId: loc.id,
                locationName: loc.name,
                category: loc.category,
                rejectedReason: checkLocationOpenAt(loc, dt).reason,
              }))
            : [],
          usedRealLocation: false,
        };
      }
      if (slotProof) proofEntries.push(slotProof);
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
    realLocationsInjectedCount: proofEntries.filter(p => p.usedRealLocation).length,
    staticFallbackCount: proofEntries.filter(p => !p.usedRealLocation).length,
    proofEntries,
    summary: eligible.length > 0
      ? `${proofEntries.filter(p => p.usedRealLocation).length} of ${events.length} default events use a real app location (eligible: ${eligible.length} public locations from ${totalLoaded} total, ${residentialExcluded} residential excluded)`
      : `No eligible public app locations found (${totalLoaded} total, ${residentialExcluded} residential excluded) — all defaults use static venue names`,
  };

  // Expose last proof for debugging (module-level, non-blocking)
  buildDefaultCommunityEventsWithProof._lastProof = proof;

  return { events, proof };
}