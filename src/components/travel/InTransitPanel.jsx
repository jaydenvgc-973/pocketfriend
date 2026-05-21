/**
 * InTransitPanel
 *
 * Shows all characters currently in transit with:
 * - Origin → Destination
 * - ETA and progress bar
 * - Travel source label
 * - Positioning disclaimer if applicable
 *
 * Read-only display panel — does not modify travel state.
 */
import React, { useEffect, useState } from 'react';
import { Navigation, Clock, MapPin, AlertCircle } from 'lucide-react';
import { enrichSessionProgress } from '@/lib/travelSessionEngine';
import { base44 } from '@/api/base44Client';

export default function InTransitPanel({ ownerEmail }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ownerEmail) return;
    let cancelled = false;

    const fetchSessions = async () => {
      try {
        const raw = await base44.entities.TravelSession.filter(
          { owner_email: ownerEmail, route_status: 'in_transit' },
          '-created_at',
          20
        ).catch(() => []);
        if (!cancelled) setSessions(raw.map(enrichSessionProgress));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSessions();
    // Refresh progress every 15 seconds
    const interval = setInterval(() => {
      setSessions(prev => prev.map(enrichSessionProgress));
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ownerEmail]);

  if (loading) return null;
  if (sessions.length === 0) return null;

  const travelSourceLabel = (source) => {
    if (!source) return null;
    const labels = {
      promise:          '💬 Promise',
      autonomous_need:  '⚡ Needs-driven',
      autonomous_want:  '✨ Wants-driven',
      routine:          '🔄 Routine',
      event:            '📅 Event',
      manual:           '🗺 Manual',
      work_schedule:    '💼 Work',
      school_schedule:  '📚 School',
    };
    return labels[source] || source;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Navigation className="w-4 h-4 text-blue-400 animate-pulse" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          In Transit ({sessions.length})
        </p>
      </div>

      {sessions.map(session => (
        <div
          key={session.id}
          className="bg-card border border-blue-500/20 rounded-xl p-3 space-y-2"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{session.character_name}</p>
              <p className="text-xs text-muted-foreground">
                {session.origin_location_name || 'Unknown origin'} → {session.destination_location_name}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs font-medium text-blue-400">{session.eta_display}</p>
              {session.travel_source && (
                <p className="text-[10px] text-muted-foreground/70">{travelSourceLabel(session.travel_source)}</p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                style={{ width: `${session.computed_progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">{session.computed_progress}% complete</p>
              <div className="flex items-center gap-1">
                <Clock className="w-2.5 h-2.5 text-muted-foreground/50" />
                <p className="text-[10px] text-muted-foreground">
                  {session.mins_remaining > 0 ? `${session.mins_remaining} min remaining` : 'Arriving...'}
                </p>
              </div>
            </div>
          </div>

          {/* Positioning disclaimer */}
          {session.positioning_label && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <AlertCircle className="w-3 h-3 text-amber-400/70 shrink-0" />
              <p className="text-[10px] text-amber-400/70">{session.positioning_label}</p>
            </div>
          )}

          {/* Distance if available */}
          {session.distance_miles && (
            <div className="flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 text-muted-foreground/40" />
              <p className="text-[10px] text-muted-foreground/50">
                ~{session.distance_miles} mi · {session.travel_mode || 'unknown mode'}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}