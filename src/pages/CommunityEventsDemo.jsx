import React from 'react';
import { Calendar, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';

const DEMO_EVENTS = [
  {
    id: '1',
    name: 'Open Mic Night',
    event_type: 'entertainment',
    location_name: 'Downtown Coffee House',
    start_date: '2026-05-10T19:00:00Z',
    description: 'Local musicians and poets showcase their talent. Open to all skill levels.',
    vibe: 'social',
    participations_count: 3,
  },
  {
    id: '2',
    name: 'Community Yoga',
    event_type: 'fitness',
    location_name: 'Riverside Park',
    start_date: '2026-05-07T09:00:00Z',
    description: 'Free yoga session for all levels. Bring your mat or use ours.',
    vibe: 'quiet',
    participations_count: 8,
  },
  {
    id: '3',
    name: 'Book Club Meeting',
    event_type: 'educational',
    location_name: 'Library Community Room',
    start_date: '2026-05-15T18:30:00Z',
    description: "This month we're discussing 'Braiding Sweetgrass'.",
    vibe: 'social',
    participations_count: 5,
  },
];

export default function CommunityEventsDemo() {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-lg mx-auto space-y-6">

        {/* Simulate the Home page context */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <p className="text-xs text-muted-foreground mb-1">Simulated Home page context</p>
          <h1 className="text-xl font-bold text-foreground">Pocketfriend</h1>
        </div>

        {/* THE COMMUNITY EVENTS STRIP */}
        <div className="pt-4 border-t border-border">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Community Activity
          </h3>
          <div className="grid gap-2">
            {DEMO_EVENTS.map((event) => (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{event.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{event.event_type}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap flex-shrink-0">
                      {event.participations_count} attending
                    </span>
                  </div>
                  <div className="space-y-1 mb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{event.location_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3 flex-shrink-0" />
                      <span>
                        {new Date(event.start_date).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                  {event.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{event.description}</p>
                  )}
                  <div className="mt-2 pt-2 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground/70">
                      Vibe: <span className="capitalize text-foreground">{event.vibe}</span>
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}