import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin } from 'lucide-react';

export default function CommunityEventsStrip({ currentUser }) {
  const scrollRef = useRef(null);

  const { data: events = [] } = useQuery({
    queryKey: ['communityEvents', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      // Fetch both shared community events AND user-owned events (user_calendar source).
      // The calendar writes with owner_email + source='user_calendar'.
      // This is the SAME entity and the SAME query key used by MomentsCalendar — one source of truth.
      const result = await base44.entities.CommunityEvent.filter(
        { owner_email: currentUser.email, is_active: true },
        '-start_date',
        50
      );
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return result.filter(e => {
        if (!e.start_date) return false;
        // Show user-created events regardless of community strip toggle — they were explicitly created
        // Show community events that are active and not expired
        const isPast = new Date(e.start_date) < cutoff;
        if (isPast) return false;
        // For user-created events: only show on strip if show_on_community_strip !== false
        if (e.source === 'user_calendar' || e.source === 'user') {
          return e.show_on_community_strip !== false;
        }
        return true;
      });
    },
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000, // 2 min — needs to be fresher than Moments (which invalidates on create)
    gcTime: 15 * 60 * 1000,
  });

  const displayEvents = events;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      {displayEvents.length === 0 && (
        <p className="text-xs text-muted-foreground/60 italic">No upcoming events. Add one from Moments.</p>
      )}
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