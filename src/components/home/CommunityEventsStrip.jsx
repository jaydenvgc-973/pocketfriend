import React, { useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin, Activity } from 'lucide-react';

const AMBIENT_VIBES = ['social', 'quiet', 'energetic', 'mixed'];

const PRESENCE_ACTIVITY_LABELS = {
  at_work:   { label: 'at work',       icon: '💼' },
  at_school: { label: 'at school',     icon: '📚' },
  home:      { label: 'at home',       icon: '🏠' },
  visiting:  { label: 'out & about',   icon: '🚶' },
  traveling: { label: 'traveling',     icon: '🚗' },
  sleeping:  { label: 'resting',       icon: '😴' },
  napping:   { label: 'taking a nap',  icon: '💤' },
};

function buildAmbientEvents(characters) {
  if (!characters || characters.length === 0) return [];
  const events = [];
  const locationGroups = {};

  for (const c of characters) {
    if (!c.name || c.status === 'deleted' || c.status === 'moved_away') continue;
    const locId = c.resolved_current_location_id || c.current_home_location_id || 'unknown';
    const locName = c.resolved_current_location_name || c.occupation_location_name || c.education_location_name || null;
    const presence = c.resolved_presence_status || c.location_status || 'home';
    const activity = c.current_activity || null;
    if (!locationGroups[locId]) locationGroups[locId] = { locName, presence, activity, characters: [] };
    locationGroups[locId].characters.push(c.name);
  }

  for (const [locId, group] of Object.entries(locationGroups)) {
    if (!group.characters.length) continue;
    const charList = group.characters.slice(0, 3).join(', ') +
      (group.characters.length > 3 ? ` +${group.characters.length - 3} more` : '');
    const presenceLabel = PRESENCE_ACTIVITY_LABELS[group.presence] || { label: 'active', icon: '✨' };
    events.push({
      id: `ambient_${locId}`,
      name: group.activity ? `${charList} — ${group.activity}` : `${charList} ${presenceLabel.label}`,
      event_type: 'community',
      location_name: group.locName || null,
      start_date: new Date().toISOString(),
      vibe: AMBIENT_VIBES[events.length % AMBIENT_VIBES.length],
      participations_count: group.characters.length,
      _isAmbient: true,
      _icon: presenceLabel.icon,
    });
  }

  return events.slice(0, 6);
}

export default function CommunityEventsStrip({ currentUser, characters = [] }) {
  const scrollRef = useRef(null);

  const { data: globalDbEvents = [] } = useQuery({
    queryKey: ['communityEventsGlobal'],
    queryFn: () => base44.entities.CommunityEvent.filter({ is_active: true }, '-start_date', 100).catch(() => []),
    enabled: true,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: userDbEvents = [] } = useQuery({
    queryKey: ['communityEventsUser', currentUser?.email],
    queryFn: () => base44.entities.CommunityEvent.filter(
      { owner_email: currentUser.email, is_active: true }, '-start_date', 50
    ).catch(() => []),
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const ambientEvents = useMemo(() => buildAmbientEvents(characters), [characters]);

  const displayEvents = useMemo(() => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seenIds = new Set();
    const merged = [];

    for (const e of globalDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    for (const e of userDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if ((e.source === 'user_calendar' || e.source === 'user') && e.show_on_community_strip === false) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    merged.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    for (const e of ambientEvents) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    return merged.slice(0, 10);
  }, [globalDbEvents, userDbEvents, ambientEvents]);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {displayEvents.map((event) => (
          <div
            key={event.id}
            className="flex-shrink-0 w-56 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors"
          >
            <div className="flex items-start gap-1.5 mb-1">
              {event._icon && <span className="text-sm leading-none mt-0.5 shrink-0">{event._icon}</span>}
              <p className="text-sm font-semibold text-foreground truncate leading-snug">{event.name}</p>
            </div>
            <p className="text-xs text-muted-foreground capitalize mb-2">
              {event._isAmbient ? 'world activity' : event.event_type}
            </p>
            <div className="space-y-1 text-xs text-muted-foreground mb-2">
              {event.location_name && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{event.location_name}</span>
                </div>
              )}
              {!event._isAmbient && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">
                    {new Date(event.start_date).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              )}
              {event._isAmbient && (
                <div className="flex items-center gap-2">
                  <Activity className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{event.participations_count} active</span>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/70">
                Vibe: <span className="capitalize text-foreground">{event.vibe || 'social'}</span>
              </span>
              {!event._isAmbient && (
                <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
                  {event.participations_count || 0}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}