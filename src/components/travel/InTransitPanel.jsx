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
import { Navigation, Clock, MapPin, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
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
        // Load in_transit + arrival_due + arrival_failed sessions — all are "active travel" states
        const [inTransit, arrivalDue, arrivalFailed] = await Promise.all([
          base44.entities.TravelSession.filter(
            { owner_email: ownerEmail, route_status: 'in_transit' }, '-created_at', 20
          ).catch(() => []),
          base44.entities.TravelSession.filter(
            { owner_email: ownerEmail, route_status: 'arrival_due' }, '-created_at', 20
          ).catch(() => []),
          base44.entities.TravelSession.filter(
            { owner_email: ownerEmail, route_status: 'arrival_failed' }, '-created_at', 10
          ).catch(() => []),
        ]);

        if (cancelled) return;

        const allActive = [...inTransit, ...arrivalDue, ...arrivalFailed];
        const enriched  = allActive.map(s => ({
          ...enrichSessionProgress(s),
          _display_status: s.route_status, // preserve raw status for UI badges
        }));

        // Overdue in_transit: trigger arrival pipeline (sets arrival_due, then verified write)
        const overdueInTransit = inTransit.filter(s => {
          if (!s.estimated_arrival_time) return false;
          return new Date(s.estimated_arrival_time).getTime() < Date.now();
        });

        if (overdueInTransit.length > 0 || arrivalDue.length > 0) {
          console.log(`[InTransitPanel] ${overdueInTransit.length} overdue in_transit + ${arrivalDue.length} arrival_due — triggering completeTravelArrivalVerified`);
          // Trigger the verified completion pipeline (user-scoped, Character write + read-back)
          base44.functions.invoke('completeTravelArrivalVerified', {})
            .then(async (res) => {
              if (cancelled) return;
              const verifiedCount = res?.data?.verified_arrivals || 0;
              if (verifiedCount > 0) {
                // Re-fetch sessions after verified arrivals
                await new Promise(r => setTimeout(r, 1500));
                if (cancelled) return;
                const refreshed = await base44.entities.TravelSession.filter(
                  { owner_email: ownerEmail, route_status: { $in: ['in_transit', 'arrival_due', 'arrival_failed'] } },
                  '-created_at', 30
                ).catch(() => []);
                if (!cancelled) {
                  setSessions(refreshed.map(s => ({ ...enrichSessionProgress(s), _display_status: s.route_status })));
                }
              }
            })
            .catch(err => console.warn('[InTransitPanel] completeTravelArrivalVerified failed:', err.message));
        }

        setSessions(enriched);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSessions();
    // Re-fetch from DB every 15 seconds (not just remap stale data — catches arrivals and backend updates)
    const interval = setInterval(fetchSessions, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ownerEmail]);

  if (loading) return null;
  if (sessions.length === 0) return null;

  const statusBadge = (session) => {
    const status = session._display_status || session.route_status;
    if (status === 'arrival_due' || status === 'arrival_pending_write') {
      return (
        <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-400/10 rounded-full px-2 py-0.5">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          Finalizing arrival…
        </span>
      );
    }
    if (status === 'arrival_failed') {
      return (
        <span className="flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
          <AlertCircle className="w-2.5 h-2.5" />
          Arrival error — retrying
        </span>
      );
    }
    return null;
  };

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

      {sessions.map(session => {
        const displayStatus = session._display_status || session.route_status;
        const isArrivalDue    = displayStatus === 'arrival_due';
        const isArrivalFailed = displayStatus === 'arrival_failed';
        const borderColor = isArrivalFailed ? 'border-destructive/30' : isArrivalDue ? 'border-amber-500/30' : 'border-blue-500/20';

        return (
        <div
          key={session.id}
          className={`bg-card border ${borderColor} rounded-xl p-3 space-y-2`}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">{session.character_name}</p>
              <p className="text-xs text-muted-foreground">
                {session.origin_location_name || 'Unknown origin'} → {session.destination_location_name}
              </p>
            </div>
            <div className="text-right shrink-0 space-y-1">
              {!isArrivalDue && !isArrivalFailed && (
                <p className="text-xs font-medium text-blue-400">{session.eta_display}</p>
              )}
              {statusBadge(session)}
              {session.travel_source && !isArrivalDue && !isArrivalFailed && (
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
          {session.distance_miles && !isArrivalDue && !isArrivalFailed && (
            <div className="flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5 text-muted-foreground/40" />
              <p className="text-[10px] text-muted-foreground/50">
                ~{session.distance_miles} mi · {session.travel_mode || 'unknown mode'}
              </p>
            </div>
          )}

          {/* Arrival failed — visible repair error */}
          {isArrivalFailed && (
            <div className="flex items-start gap-1.5 pt-0.5">
              <AlertCircle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
              <p className="text-[10px] text-destructive/80">
                Arrival write failed — system is retrying. {session.blocker_reason ? `(${session.blocker_reason})` : ''}
              </p>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}