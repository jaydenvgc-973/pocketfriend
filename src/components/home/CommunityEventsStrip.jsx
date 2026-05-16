import React, { useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin } from 'lucide-react';

// ── DEFAULT COMMUNITY EVENTS ─────────────────────────────────────────────────
// These are lightweight world-context defaults shown when the database has no
// seeded CommunityEvent records. They are NOT derived from character presence,
// character homes, or private character state. They are public/community events
// at public/semi-public venues — the same category of event the strip was
// designed for. They rotate weekly so they never feel stale.
//
// These defaults are NEVER shown if DB-backed records already cover the strip.
// User-created Moments events are ADDITIVE on top of both sources.

function buildDefaultEvents() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();
  const today = now.getDate();

  // Build dates relative to today so events always feel upcoming
  function daysFromNow(d, h = 19, m = 0) {
    const dt = new Date(thisYear, thisMonth, today + d, h, m, 0);
    return dt.toISOString();
  }

  const defaults = [
    {
      id: 'def_openmic',
      name: 'Open Mic Night',
      event_type: 'entertainment',
      location_name: 'The Loft Bar & Lounge',
      start_date: daysFromNow(1, 20, 0),
      vibe: 'social',
      description: 'Local talent takes the stage — poetry, music, and comedy welcome.',
    },
    {
      id: 'def_yoga',
      name: 'Community Yoga in the Park',
      event_type: 'fitness',
      location_name: 'Riverside Park',
      start_date: daysFromNow(2, 8, 0),
      vibe: 'quiet',
      description: 'Free outdoor yoga session. All levels welcome. Bring a mat.',
    },
    {
      id: 'def_bookclub',
      name: 'Book Club Meetup',
      event_type: 'educational',
      location_name: 'Public Library — Meeting Room B',
      start_date: daysFromNow(3, 18, 30),
      vibe: 'quiet',
      description: 'Monthly discussion. New members welcome — no prep required.',
    },
    {
      id: 'def_karaoke',
      name: 'Karaoke Night',
      event_type: 'entertainment',
      location_name: 'Spectrum Lounge',
      start_date: daysFromNow(3, 21, 0),
      vibe: 'energetic',
      description: 'Weekly karaoke. No auditions. Just vibes.',
    },
    {
      id: 'def_healthfair',
      name: 'Community Health Fair',
      event_type: 'health_awareness',
      location_name: 'Community Center — Main Hall',
      start_date: daysFromNow(4, 10, 0),
      vibe: 'mixed',
      description: 'Free screenings, HIV/STI testing, mental health resources, and more.',
    },
    {
      id: 'def_artexhibit',
      name: 'Art Exhibit Opening',
      event_type: 'cultural',
      location_name: 'Gallery 47',
      start_date: daysFromNow(4, 18, 0),
      vibe: 'social',
      description: 'Opening reception for local emerging artists. Light refreshments.',
    },
    {
      id: 'def_coffeemeetup',
      name: 'Coffeehouse Meetup',
      event_type: 'social',
      location_name: 'Common Ground Coffee',
      start_date: daysFromNow(5, 10, 0),
      vibe: 'quiet',
      description: 'Casual weekend morning meetup. Good conversation, no agenda.',
    },
    {
      id: 'def_gamenight',
      name: 'Game Night',
      event_type: 'social',
      location_name: 'The Social — Bar & Games',
      start_date: daysFromNow(5, 19, 0),
      vibe: 'energetic',
      description: 'Board games, trivia, and prizes. Teams of 2–6.',
    },
    {
      id: 'def_foodpantry',
      name: 'Food Pantry & Resource Day',
      event_type: 'support',
      location_name: 'First Baptist Community Hall',
      start_date: daysFromNow(6, 9, 0),
      vibe: 'mixed',
      description: 'Free groceries, hygiene kits, and community resource referrals.',
    },
    {
      id: 'def_poetry',
      name: 'Poetry Reading',
      event_type: 'cultural',
      location_name: 'Ink & Pages Bookstore',
      start_date: daysFromNow(6, 17, 0),
      vibe: 'quiet',
      description: 'Featured readers and open floor. Bring a poem or just listen.',
    },
    {
      id: 'def_ballroom',
      name: 'Ballroom & Vogue Social',
      event_type: 'celebration',
      location_name: 'The Grand Ballroom',
      start_date: daysFromNow(7, 21, 0),
      vibe: 'energetic',
      description: 'Community ballroom social. All houses welcome.',
    },
    {
      id: 'def_supportgroup',
      name: 'Community Support Circle',
      event_type: 'support',
      location_name: 'Wellness Center — Room 3',
      start_date: daysFromNow(7, 17, 0),
      vibe: 'quiet',
      description: 'Peer support group. Safe, confidential, drop-in.',
    },
  ];

  // Rotate based on day of week so the order shifts naturally each day
  const offset = dayOfWeek % defaults.length;
  return [...defaults.slice(offset), ...defaults.slice(0, offset)];
}

const EVENT_TYPE_ICONS = {
  entertainment: '🎤',
  fitness: '🧘',
  educational: '📚',
  cultural: '🎨',
  health_awareness: '❤️',
  social: '☕',
  support: '🤝',
  celebration: '✨',
  resource_fair: '🏠',
  personal: '📅',
  other: '📌',
};

export default function CommunityEventsStrip({ currentUser }) {
  const scrollRef = useRef(null);

  // Source 1: Global/system DB-backed community events (no owner filter — system-wide)
  const { data: globalDbEvents = [] } = useQuery({
    queryKey: ['communityEventsGlobal'],
    queryFn: () => base44.entities.CommunityEvent.filter({ is_active: true }, 'start_date', 100).catch(() => []),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Source 2: User-created Moments calendar events (opt-in, additive)
  const { data: userDbEvents = [] } = useQuery({
    queryKey: ['communityEventsUser', currentUser?.email],
    queryFn: () => base44.entities.CommunityEvent.filter(
      { owner_email: currentUser.email, is_active: true }, 'start_date', 50
    ).catch(() => []),
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Source 3: Static default rotation — shown only if DB has no records.
  // These are real public community events. Never derived from character state.
  const defaultEvents = useMemo(() => buildDefaultEvents(), []);

  const displayEvents = useMemo(() => {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000); // allow events from last 12h
    const seenIds = new Set();
    const merged = [];

    // Layer 1: Global/system DB records
    for (const e of globalDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    // Layer 2: User Moments calendar events (additive, respects show_on_community_strip flag)
    for (const e of userDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if ((e.source === 'user_calendar' || e.source === 'user') && e.show_on_community_strip === false) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    merged.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    // Layer 3: Static defaults fill in ONLY if DB produced fewer than 4 real events
    if (merged.length < 4) {
      for (const e of defaultEvents) {
        if (seenIds.has(e.id)) continue;
        seenIds.add(e.id);
        merged.push(e);
      }
    }

    return merged.slice(0, 10);
  }, [globalDbEvents, userDbEvents, defaultEvents]);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {displayEvents.map((event) => {
          const icon = EVENT_TYPE_ICONS[event.event_type] || '📌';
          const eventDate = event.start_date ? new Date(event.start_date) : null;
          return (
            <div
              key={event.id}
              className="flex-shrink-0 w-52 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-1.5 mb-1">
                <span className="text-sm leading-none mt-0.5 shrink-0">{icon}</span>
                <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{event.name}</p>
              </div>
              <p className="text-xs text-muted-foreground capitalize mb-2">
                {(event.event_type || 'community').replace(/_/g, ' ')}
              </p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {event.location_name && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{event.location_name}</span>
                  </div>
                )}
                {eventDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' · '}
                      {eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
              {event.vibe && (
                <p className="text-[10px] text-muted-foreground/60 mt-2 capitalize">
                  Vibe: <span className="text-foreground/70">{event.vibe}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}