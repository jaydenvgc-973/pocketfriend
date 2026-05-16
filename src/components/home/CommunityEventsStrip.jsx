import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin } from 'lucide-react';

export default function CommunityEventsStrip({ currentUser }) {
  const scrollRef = useRef(null);

  const { data: events = [] } = useQuery({
    queryKey: ['communityEvents', currentUser?.email],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Query 1: Global/system/community events — no owner_email filter.
      // These are the original pre-existing strip events. Must never be filtered out.
      const globalQuery = base44.entities.CommunityEvent.filter(
        { is_active: true },
        '-start_date',
        100
      ).catch(() => []);

      // Query 2: User-created calendar events — owner_email scoped.
      // These are additive. Only shown on strip when show_on_community_strip !== false.
      const userQuery = currentUser?.email
        ? base44.entities.CommunityEvent.filter(
            { owner_email: currentUser.email, is_active: true },
            '-start_date',
            50
          ).catch(() => [])
        : Promise.resolve([]);

      const [globalEvents, userEvents] = await Promise.all([globalQuery, userQuery]);

      // Merge: global events first, then user-created additions.
      // Dedup by id in case a user-created event also appears in the global query.
      const seenIds = new Set();
      const merged = [];

      for (const e of [...globalEvents, ...userEvents]) {
        if (!e.start_date) continue;
        if (new Date(e.start_date) < cutoff) continue;
        // For user-created events: respect show_on_community_strip flag
        if ((e.source === 'user_calendar' || e.source === 'user') && e.show_on_community_strip === false) continue;
        if (seenIds.has(e.id)) continue;
        seenIds.add(e.id);
        merged.push(e);
      }

      // Sort by start_date ascending (soonest first)
      return merged.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    },
    enabled: true, // always run — global events don't require auth
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const displayEvents = events;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-2"
      >
        {displayEvents.slice(0, 8).map((event) => (
          <div
            key={event.id}
            className="flex-shrink-0 w-56 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors cursor-pointer"
          >
            <p className="text-sm font-semibold text-foreground truncate">{event.name}</p>
            <p className="text-xs text-muted-foreground capitalize mb-2">{event.event_type}</p>
            
            <div className="space-y-1 text-xs text-muted-foreground mb-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{event.location_name || 'TBD'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  {new Date(event.start_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/70">
                Vibe: <span className="capitalize text-foreground">{event.vibe}</span>
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
                {event.participations_count || 0}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}