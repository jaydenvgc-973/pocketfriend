import React, { useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin } from 'lucide-react';
import { buildDefaultCommunityEvents, EVENT_TYPE_ICONS } from '@/lib/defaultCommunityEvents';

export default function CommunityEventsStrip({ currentUser }) {
  const scrollRef = useRef(null);

  // Subscribe reactively to the locations query so this component re-renders
  // when Home finishes loading locations. Using queryClient.getQueryData() was
  // a non-reactive read — it read once on mount and never updated.
  const { data: appLocations = [] } = useQuery({
    queryKey: ['locationReferences', currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

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

  const displayEvents = useMemo(() => {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const seenIds = new Set();
    const merged = [];

    // Confinement name fragments — events at these locations must never appear in the community strip
    const CONFINEMENT_NAME_FRAGMENTS = [
      'jail', 'prison', 'detention', 'correctional', 'holding cell',
      'juvenile detention', 'halfway house', 'cgv jail',
    ];
    const isConfinementVenue = (locationName) => {
      if (!locationName) return false;
      const lower = locationName.toLowerCase();
      return CONFINEMENT_NAME_FRAGMENTS.some(f => lower.includes(f));
    };

    // Layer 1: Global/system DB records — skip confinement venues
    for (const e of globalDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if (isConfinementVenue(e.location_name)) {
        console.warn('[COMMUNITY_STRIP] Skipped DB event with confinement venue:', e.name, '→', e.location_name);
        continue;
      }
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    // Layer 2: User Moments calendar events (additive, respects show_on_community_strip)
    for (const e of userDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if ((e.source === 'user_calendar' || e.source === 'user') && e.show_on_community_strip === false) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    merged.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    // Layer 3: Smart-matched defaults — always injected, deduped by id.
    // These fill in gaps AND ensure correctly matched events (e.g., Coffeehouse Meetup → Velvet Bean).
    // Pass real appLocations so tier1 venue intent matching (coffee → café) works.
    for (const e of buildDefaultCommunityEvents(appLocations)) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    return merged.slice(0, 10);
  }, [globalDbEvents, userDbEvents, appLocations]);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {displayEvents.map((event) => {
          const icon = event._icon || EVENT_TYPE_ICONS[event.event_type] || '📌';
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