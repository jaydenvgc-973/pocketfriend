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
      const result = await base44.entities.CommunityEvent.filter(
        { owner_email: currentUser.email, is_active: true },
        '-start_date',
        10
      );
      return result.filter(e => new Date(e.start_date) >= new Date(Date.now() - 24*60*60*1000));
    },
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  // Fallback events when no backend events exist
  const fallbackEvents = [
    {
      id: 'fallback-1',
      name: 'Open Mic Night',
      event_type: 'entertainment',
      location_name: 'Downtown Coffee House',
      start_date: new Date(Date.now() + 3*24*60*60*1000).toISOString(),
      vibe: 'social',
      participations_count: 3,
    },
    {
      id: 'fallback-2',
      name: 'Community Yoga',
      event_type: 'fitness',
      location_name: 'Riverside Park',
      start_date: new Date(Date.now() + 1*24*60*60*1000).toISOString(),
      vibe: 'quiet',
      participations_count: 8,
    },
    {
      id: 'fallback-3',
      name: 'Book Club',
      event_type: 'educational',
      location_name: 'Library Community Room',
      start_date: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
      vibe: 'social',
      participations_count: 5,
    },
  ];

  const displayEvents = events.length > 0 ? events : fallbackEvents;

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