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
        if (cancelled) return;
        const enriched = raw.map(enrichSessionProgress);

        // If any session is overdue (past ETA and still in_transit), trigger backend arrival
        // completion immediately rather than waiting up to 5 min for the scheduled task.
        const overdue = enriched.filter(s => s.is_overdue);
        if (overdue.length > 0) {
          console.log(`[InTransitPanel] ${overdue.length} overdue session(s) detected — triggering processTravelArrivals`, overdue.map(s => ({
            character_id: s.character_id,
            character: s.character_name,
            origin: s.origin_location_name,
            destination: s.destination_location_name,
            travel_status_before: s.route_status,
            computed_progress: s.computed_progress,
            arrival_triggered: true,
          })));
          // Step 1: Mark sessions arrived (service-role — can't write Character)
          // Step 2: For each overdue session, call completeCharacterArrival to write
          //         Character.resolved_current_location_id = destination (user-scoped, with read-back proof)
          base44.functions.invoke('processTravelArrivals', {})
            .then(async () => {
              if (cancelled) return;

              // Wait briefly for processTravelArrivals DB writes to propagate
              await new Promise(r => setTimeout(r, 1500));
              if (cancelled) return;

              // Load which sessions are now marked "arrived" for our overdue set
              for (const s of overdue) {
                try {
                  // Fetch the session to check if it's now "arrived"
                  const arrivedArr = await base44.entities.TravelSession.filter(
                    { id: s.id },
                    null, 1
                  ).catch(() => []);
                  const arrivedSession = arrivedArr?.[0];
                  if (arrivedSession?.route_status === 'arrived') {
                    // Complete the arrival — writes Character destination with read-back proof
                    const completeRes = await base44.functions.invoke('completeCharacterArrival', {
                      session_id: s.id,
                    }).catch(e => ({ data: { success: false, error: e.message } }));
                    const cData = completeRes?.data || {};
                    if (cData.success) {
                      console.log(`[InTransitPanel] ARRIVAL PROOF | character=${s.character_name} | origin=${s.origin_location_name} | destination=${s.destination_location_name} | final_location=${cData.after_location} | destination_verified=${cData.after_location === s.destination_location_name}`);
                    } else {
                      console.error(`[InTransitPanel] completeCharacterArrival FAILED | character=${s.character_name} | error=${cData.error}`);
                    }
                  }
                } catch (e) {
                  console.warn(`[InTransitPanel] arrival completion error for ${s.character_name}:`, e.message);
                }
              }

              // Re-fetch active sessions to update the panel
              if (cancelled) return;
              const refreshed = await base44.entities.TravelSession.filter(
                { owner_email: ownerEmail, route_status: 'in_transit' },
                '-created_at', 20
              ).catch(() => []);
              if (!cancelled) {
                setSessions(refreshed.map(enrichSessionProgress));
              }
            })
            .catch(err => {
              console.warn('[InTransitPanel] processTravelArrivals invoke failed:', err.message);
            });
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