import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin, Users, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function CommunityEventsStrip({ currentUser }) {
  const [hoveredEventId, setHoveredEventId] = useState(null);

  // Fetch active community events for this user
  const { data: events = [] } = useQuery({
    queryKey: ['communityEvents', currentUser?.email],
    queryFn: async () => {
      if (!currentUser?.email) return [];
      const result = await base44.entities.CommunityEvent.filter(
        { owner_email: currentUser.email, is_active: true },
        '-start_date',
        10
      );
      // Only show upcoming or current events
      return result.filter(e => new Date(e.start_date) >= new Date(Date.now() - 24*60*60*1000));
    },
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  if (events.length === 0) return null;

  const displayEvents = events.slice(0, 5);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div className="grid gap-2">
        <AnimatePresence>
          {displayEvents.map((event) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onHoverStart={() => setHoveredEventId(event.id)}
              onHoverEnd={() => setHoveredEventId(null)}
              className="relative"
            >
              <div className="p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors cursor-pointer">
                {/* Event name + type */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {event.name}
                    </p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {event.event_type}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap flex-shrink-0">
                    {event.participations_count || 0} attending
                  </span>
                </div>

                {/* Location & Time */}
                <div className="space-y-1 mb-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{event.location_name || 'TBD'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3 flex-shrink-0" />
                    <span>
                      {new Date(event.start_date).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>

                {/* Description (if expanded) */}
                {hoveredEventId === event.id && event.description && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-muted-foreground mt-2 leading-relaxed"
                  >
                    {event.description}
                  </motion.p>
                )}

                {/* Vibe indicator */}
                {event.vibe && (
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground/70">
                      Vibe: <span className="capitalize text-foreground">{event.vibe}</span>
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* See more link */}
      {events.length > 5 && (
        <button className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-primary hover:text-primary/80 py-2">
          View all events
          <ChevronRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}