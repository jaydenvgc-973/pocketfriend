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
 *   - Jail/confinement facilities are NEVER eligible for community events
 *   - User-created events can use ANY location (including residential)
 *   - Dates are always relative to "today" so they remain upcoming
 *   - Rotates by day-of-week so the ordering shifts naturally each day
 *   - Used as FALLBACK ONLY when the DB produces fewer than 4 real CommunityEvent records
 *
 * Real app location injection — HARD VENUE INTENT RULES:
 *   - Each event template may declare `venueIntent` tiers:
 *       tier1_must_match: location name/subtype/keywords must contain these terms
 *                         → if any open tier1 location exists, it WINS. No exceptions.
 *       tier2_preferred_categories: categories considered before fallback
 *       tier3_exclude_name_fragments: locations whose names contain these are skipped unless no other option
 *   - Category affinity is secondary; hard name matching is primary for coffeehouse/café events.
 *   - Operating hours are mandatory — a closed location is never chosen.
 *   - Full per-candidate proof is returned (score, tier, open/closed, why winner was chosen).
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

// ── CONFINEMENT / RESIDENTIAL CATEGORIES — never eligible for community events ──
const EXCLUDED_CATEGORIES = new Set([
  'home', 'hotel', 'shelter',
  'jail', 'prison', 'detention_center', 'correctional_facility',
  'juvenile_detention', 'halfway_house', 'holding_cell',
]);

// Public/semi-public categories eligible for system event injection
const PUBLIC_CATEGORIES = new Set([
  'social', 'outdoor', 'food_drink', 'medical', 'education',
  'grocery', 'religion', 'government', 'public', 'business',
  'school', 'community', 'gym', 'workplace', 'generic',
]);

// ── VENUE INTENT RULES ────────────────────────────────────────────────────────
// Per-template: define hard matching tiers so coffee events always go to cafés, etc.
//
// tier1_name_keywords: location name OR subtype[] OR keywords[] must contain at least one
//                      of these strings (lowercase) → HARD WINNER if open
// tier1_category:      location category must be one of these (only used together with
//                      tier1_name_keywords — both checks must pass for a tier1 match)
// tier2_categories:    preferred categories when no tier1 match exists
// tier3_exclude_name_fragments: exclude locations whose names contain these strings
//                               unless they are the absolute last option
//
// If NO tier1 open match exists → fall back to tier2 category matching → then generic
// A bar/grill/nightclub is in tier3_exclude for coffeehouse events.
const VENUE_INTENT_RULES = {
  def_coffeemeetup: {
    tier1_name_keywords: ['coffee', 'café', 'cafe', 'bean', 'brew', 'espresso', 'roast', 'roastery'],
    tier2_categories: ['food_drink', 'social', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'lounge', 'nightclub', 'club', 'tavern', 'pub'],
  },
  def_yoga: {
    tier1_name_keywords: ['park', 'yoga', 'fitness', 'wellness'],
    tier2_categories: ['gym', 'outdoor', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'club', 'lounge'],
  },
  def_bookclub: {
    tier1_name_keywords: ['library', 'bookstore', 'book', 'literary'],
    tier2_categories: ['education', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'club'],
  },
  def_healthfair: {
    tier1_name_keywords: ['clinic', 'health', 'medical', 'wellness', 'center', 'community'],
    tier2_categories: ['medical', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'lounge', 'club'],
  },
  def_artexhibit: {
    tier1_name_keywords: ['gallery', 'art', 'studio', 'museum', 'exhibit'],
    tier2_categories: ['community', 'social', 'education', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub'],
  },
  def_openmic: {
    tier1_name_keywords: ['lounge', 'bar', 'venue', 'stage', 'loft', 'café', 'cafe', 'coffee'],
    tier2_categories: ['social', 'food_drink', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: [],
  },
  def_karaoke: {
    tier1_name_keywords: ['karaoke', 'lounge', 'bar', 'venue'],
    tier2_categories: ['social', 'food_drink', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: [],
  },
  def_gamenight: {
    tier1_name_keywords: ['bar', 'games', 'social', 'lounge', 'arcade'],
    tier2_categories: ['social', 'food_drink', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: [],
  },
  def_supportgroup: {
    tier1_name_keywords: ['wellness', 'center', 'clinic', 'community', 'health', 'support'],
    tier2_categories: ['medical', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'lounge'],
  },
  def_foodpantry: {
    tier1_name_keywords: ['community', 'church', 'hall', 'center', 'pantry', 'ministry'],
    tier2_categories: ['community', 'religion', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'lounge', 'club'],
  },
  def_poetry: {
    tier1_name_keywords: ['bookstore', 'book', 'library', 'café', 'cafe', 'coffee'],
    tier2_categories: ['education', 'community', 'social', 'public', 'generic'],
    tier3_exclude_name_fragments: ['bar', 'grill', 'nightclub', 'club'],
  },
  def_ballroom: {
    tier1_name_keywords: ['ballroom', 'venue', 'event', 'hall', 'lounge'],
    tier2_categories: ['social', 'community', 'public', 'generic'],
    tier3_exclude_name_fragments: [],
  },
};

// ── OPERATING HOURS CHECK ─────────────────────────────────────────────────────
function timeStrToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Check if a location is open at the given Date using its operating_hours array.
 * If no operating_hours are configured, assume open (safe default).
 * Returns { isOpen, reason, matchedHours }
 */
function checkLocationOpenAt(location, eventDate) {
  const hours = location.operating_hours;
  if (!hours || hours.length === 0) {
    return { isOpen: true, reason: 'No operating hours configured — assumed open', matchedHours: null };
  }

  const dayOfWeek = eventDate.getDay();
  const eventMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();

  const matchingEntry = hours.find(h => h.day_of_week === undefined || h.day_of_week === dayOfWeek);
  if (!matchingEntry) {
    return {
      isOpen: false,
      reason: `No hours entry for day ${dayOfWeek} (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayOfWeek]})`,
      matchedHours: null,
    };
  }

  const openMin = timeStrToMinutes(matchingEntry.open_time);
  const closeMin = timeStrToMinutes(matchingEntry.close_time);

  if (openMin === null || closeMin === null) {
    return { isOpen: true, reason: 'Operating hours present but unparseable — assumed open', matchedHours: matchingEntry };
  }

  let isOpen;
  if (closeMin <= openMin) {
    // spans midnight
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

// ── STATIC TEMPLATES ──────────────────────────────────────────────────────────
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
 * Extract eligible public/semi-public locations from a LocationReference array.
 * Jail/confinement and residential are always excluded.
 * Also excludes personal home names (e.g. "Jayden's Apartment").
 * CRITICAL: Apply name-based confinement failsafe — any location name containing
 * jail/prison/detention/etc. is ALWAYS excluded even if category/flag is wrong.
 */
function extractPublicLocations(appLocations = []) {
  const totalLoaded = appLocations.length;
  let residentialExcluded = 0;
  const eligible = [];

  // Name-based confinement failsafe: locations whose names contain these are ALWAYS excluded
  const CONFINEMENT_NAME_FRAGMENTS = [
    'jail', 'prison', 'detention', 'correctional', 'holding cell',
    'juvenile detention', 'halfway house', 'confinement',
  ];

  for (const loc of appLocations) {
    if (!loc.name) continue;
    const cat = loc.category || 'generic';
    const nameLower = (loc.name || '').toLowerCase();

    // Hard exclude: residential, confinement, jail — never a community event venue
    if (EXCLUDED_CATEGORIES.has(cat) || loc.is_confinement_facility) {
      residentialExcluded++;
      continue;
    }

    // Hard exclude: confinement name fragments (failsafe for wrongly-categorized records)
    if (CONFINEMENT_NAME_FRAGMENTS.some(frag => nameLower.includes(frag))) {
      residentialExcluded++;
      continue;
    }

    // Hard exclude: personal home names
    const isPersonalHome =
      /\b(apartment|apt|house|home|condo|townhouse|unit|suite|residence|flat)\b/.test(nameLower) &&
      /('s|s')\b/.test(nameLower);
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
 * Check whether a location matches the tier1 hard name/subtype/keywords requirement.
 * Checks: location.name, location.subtype[], location.keywords[]
 * Returns true if ANY field contains ANY of the tier1 terms (case-insensitive).
 */
function matchesTier1(loc, tier1Keywords) {
  if (!tier1Keywords || tier1Keywords.length === 0) return false;
  const nameLower = (loc.name || '').toLowerCase();
  const subtypes = (loc.subtype || []).map(s => s.toLowerCase());
  const keywords = (loc.keywords || []).map(k => k.toLowerCase());
  const searchFields = [nameLower, ...subtypes, ...keywords].join(' ');
  return tier1Keywords.some(kw => searchFields.includes(kw));
}

/**
 * Check whether a location name contains any tier3 "exclude" fragment.
 * These are locations that are plausible fallbacks but should only be used
 * if nothing better exists.
 */
function hasTier3Fragment(loc, excludeFragments) {
  if (!excludeFragments || excludeFragments.length === 0) return false;
  const nameLower = (loc.name || '').toLowerCase();
  return excludeFragments.some(frag => nameLower.includes(frag));
}

/**
 * Score a single open location candidate against the event template.
 *
 * Tier system (hard priority, not additive — tier1 ALWAYS beats tier2+):
 *   tier1: name/subtype/keywords match tier1_name_keywords → base score 1000
 *   tier2: category in tier2_categories → score = (list length - index) * 10 (max 50)
 *   tier3_penalty: name contains tier3_exclude fragment → score -= 200 (heavy penalty but not disqualifying)
 *
 * Within the same tier, higher score wins. Equal scores → alphabetical for stability.
 *
 * Returns { location, tier, score, hoursCheck, scoreBreakdown }
 */
function scoreCandidate(loc, tmpl, eventDate, rules) {
  const hoursCheck = checkLocationOpenAt(loc, eventDate);
  if (!hoursCheck.isOpen) return null; // closed = disqualified

  const locCat = loc.category || 'generic';
  const locNameLower = (loc.name || '').toLowerCase();
  const scoreBreakdown = {
    tier1Match: false,
    tier2CategoryScore: 0,
    tier3Penalty: 0,
    finalScore: 0,
    tier: 3,
  };

  let score = 0;
  let tier = 3;

  // ── TIER 1: hard name/subtype/keyword match ──────────────────────────────
  if (rules?.tier1_name_keywords?.length > 0 && matchesTier1(loc, rules.tier1_name_keywords)) {
    score = 1000;
    tier = 1;
    scoreBreakdown.tier1Match = true;
  }

  // ── TIER 2: category affinity (only contributes if not already tier1) ────
  const tier2Cats = rules?.tier2_categories || ['community', 'public', 'generic'];
  const catIdx = tier2Cats.indexOf(locCat);
  if (catIdx !== -1) {
    const catScore = Math.max(1, tier2Cats.length - catIdx) * 10;
    scoreBreakdown.tier2CategoryScore = catScore;
    if (tier > 1) {
      score += catScore;
      tier = 2;
    }
  }

  // ── TIER 3 PENALTY: bar/grill/nightclub for a coffee event etc. ──────────
  if (rules?.tier3_exclude_name_fragments?.length > 0 && hasTier3Fragment(loc, rules.tier3_exclude_name_fragments)) {
    const penalty = -200;
    scoreBreakdown.tier3Penalty = penalty;
    score += penalty; // can go negative, still better than nothing if truly no other option
  }

  scoreBreakdown.finalScore = score;
  scoreBreakdown.tier = tier;

  return {
    location: loc,
    tier,
    score,
    hoursCheck,
    scoreBreakdown,
    nameLower: locNameLower,
    subtypes: loc.subtype || [],
    keywords: loc.keywords || [],
    category: locCat,
  };
}

/**
 * Pick the best real location for a given event template.
 * Uses hard venue intent rules (VENUE_INTENT_RULES) keyed by template id.
 * Falls back to generic affinity if no rules defined for the template.
 *
 * Returns { location, tier, score, hoursCheck, scoreBreakdown, allCandidates, rejectedClosed }
 * or null if no open eligible location exists.
 */
function pickBestLocation(tmpl, eventDate, eligible) {
  if (!eligible.length) return null;

  const rules = VENUE_INTENT_RULES[tmpl.id] || null;
  const rejectedClosed = [];
  const scoredOpen = [];

  for (const loc of eligible) {
    const result = scoreCandidate(loc, tmpl, eventDate, rules);
    if (!result) {
      rejectedClosed.push({
        locationId: loc.id,
        locationName: loc.name,
        category: loc.category,
        subtype: loc.subtype || [],
        keywords: loc.keywords || [],
        rejectedReason: checkLocationOpenAt(loc, eventDate).reason,
      });
    } else {
      scoredOpen.push(result);
    }
  }

  if (!scoredOpen.length) return null;

  // Sort: highest score first, then alphabetically for stability
  scoredOpen.sort((a, b) => b.score - a.score || a.nameLower.localeCompare(b.nameLower));

  const winner = scoredOpen[0];

  return {
    location: winner.location,
    tier: winner.tier,
    score: winner.score,
    hoursCheck: winner.hoursCheck,
    scoreBreakdown: winner.scoreBreakdown,
    allCandidates: scoredOpen.map(c => ({
      locationId: c.location.id,
      locationName: c.location.name,
      category: c.category,
      subtype: c.subtypes,
      keywords: c.keywords,
      tier: c.tier,
      score: c.score,
      scoreBreakdown: c.scoreBreakdown,
      hoursReason: c.hoursCheck.reason,
    })),
    rejectedClosed,
  };
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Build default community events. Optionally injects real app locations using
 * hard venue intent rules (coffeehouse → café/coffee, not bar).
 */
export function buildDefaultCommunityEvents(appLocations = []) {
  return buildDefaultCommunityEventsWithProof(appLocations).events;
}

/**
 * Build default events AND return full proof with per-candidate diagnostics.
 */
export function buildDefaultCommunityEventsWithProof(appLocations = []) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = now.getDate();

  const { eligible, totalLoaded, residentialExcluded } = extractPublicLocations(appLocations);

  // Rotate templates by day-of-week
  const offset = dayOfWeek % EVENT_TEMPLATES.length;
  const rotated = [...EVENT_TEMPLATES.slice(offset), ...EVENT_TEMPLATES.slice(0, offset)];

  // Injection slots: at least 1 per 10 events
  // Additionally: always attempt injection for the coffeemeetup template specifically
  const injectionSlots = new Set();
  if (eligible.length > 0) {
    for (let i = 0; i < rotated.length; i += 10) {
      injectionSlots.add(i);
    }
    // Always try to inject a real location for coffeemeetup regardless of slot
    const coffeeIdx = rotated.findIndex(t => t.id === 'def_coffeemeetup');
    if (coffeeIdx !== -1) injectionSlots.add(coffeeIdx);
  }

  const proofEntries = [];

  const events = rotated.map((tmpl, idx) => {
    const dt = new Date(thisYear, thisMonth, today + tmpl.offsetDays, tmpl.hour, tmpl.minute, 0);

    let locationName = tmpl.location_name;
    let locationId = null;
    let locationCategory = null;
    let usedRealLocation = false;
    let slotProof = null;

    if (injectionSlots.has(idx) && eligible.length > 0) {
      const pick = pickBestLocation(tmpl, dt, eligible);

      // DEBUG: log proof for coffeehouse events
      if (tmpl.id === 'def_coffeemeetup' && pick) {
        console.log('[COFFEEHOUSE_PROOF]', {
          eventName: tmpl.name,
          eventTime: dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
          chosenLocation: pick.location.name,
          chosenCategory: pick.location.category,
          chosenSubtype: pick.location.subtype,
          chosenKeywords: pick.location.keywords,
          chosenTier: pick.tier,
          chosenScore: pick.score,
          openHours: pick.hoursCheck.reason,
          allCandidates: pick.allCandidates.slice(0, 3).map(c => ({
            name: c.locationName,
            category: c.category,
            subtype: c.subtype,
            keywords: c.keywords,
            tier: c.tier,
            score: c.score,
          })),
          rejectedClosed: pick.rejectedClosed.map(r => ({ name: r.locationName, reason: r.rejectedReason })),
        });
      }

      if (pick) {
        locationName = pick.location.name;
        locationId = pick.location.id;
        locationCategory = pick.location.category || null;
        usedRealLocation = true;

        slotProof = {
          slot: idx,
          eventId: tmpl.id,
          eventName: tmpl.name,
          eventType: tmpl.event_type,
          eventTime: dt.toISOString(),
          venueIntentRules: VENUE_INTENT_RULES[tmpl.id] || null,
          chosenLocation: pick.location.name,
          chosenLocationId: pick.location.id,
          chosenCategory: pick.location.category,
          chosenSubtype: pick.location.subtype || [],
          chosenKeywords: pick.location.keywords || [],
          chosenOperatingHours: pick.location.operating_hours || [],
          isOpen: pick.hoursCheck.isOpen,
          hoursReason: pick.hoursCheck.reason,
          tier: pick.tier,
          score: pick.score,
          scoreBreakdown: pick.scoreBreakdown,
          selectionReason: `Tier ${pick.tier} match, score ${pick.score} — won against ${pick.allCandidates.length - 1} other open candidates`,
          allCandidates: pick.allCandidates,
          rejectedClosed: pick.rejectedClosed,
          usedRealLocation: true,
        };
      } else {
        // No open eligible location — use static fallback
        const allClosed = eligible.map(loc => ({
          locationId: loc.id,
          locationName: loc.name,
          category: loc.category,
          subtype: loc.subtype || [],
          keywords: loc.keywords || [],
          rejectedReason: checkLocationOpenAt(loc, dt).reason,
        }));

        slotProof = {
          slot: idx,
          eventId: tmpl.id,
          eventName: tmpl.name,
          eventType: tmpl.event_type,
          eventTime: dt.toISOString(),
          venueIntentRules: VENUE_INTENT_RULES[tmpl.id] || null,
          chosenLocation: tmpl.location_name,
          chosenLocationId: null,
          chosenCategory: null,
          isOpen: null,
          hoursReason: null,
          tier: null,
          score: null,
          selectionReason: `No open eligible app location — using static fallback "${tmpl.location_name}"`,
          allCandidates: [],
          rejectedClosed: allClosed,
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
    eligiblePublicLocations: eligible.map(l => ({
      id: l.id,
      name: l.name,
      category: l.category,
      subtype: l.subtype || [],
      keywords: l.keywords || [],
    })),
    eligibleCount: eligible.length,
    totalDefaultEvents: events.length,
    injectionSlots: [...injectionSlots],
    realLocationsInjectedCount: proofEntries.filter(p => p.usedRealLocation).length,
    staticFallbackCount: proofEntries.filter(p => !p.usedRealLocation).length,
    proofEntries,
    summary: eligible.length > 0
      ? `${proofEntries.filter(p => p.usedRealLocation).length} of ${events.length} default events use a real app location. Eligible: ${eligible.length} public (${totalLoaded} total, ${residentialExcluded} residential/confinement excluded).`
      : `No eligible public app locations (${totalLoaded} total, ${residentialExcluded} residential/confinement excluded) — all defaults use static venue names.`,
  };

  buildDefaultCommunityEventsWithProof._lastProof = proof;

  return { events, proof };
}