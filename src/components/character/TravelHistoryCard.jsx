import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapPin, Clock, AlertCircle, ChevronDown } from 'lucide-react';

const TRAVEL_SOURCE_LABELS = {
  schedule: 'Schedule', autonomous: 'Autonomous', promise: 'Promise',
  commitment: 'Commitment', need_fulfillment: 'Need', manual: 'Manual',
  system: 'System', work_schedule: 'Work Schedule', school_schedule: 'School Schedule',
  autonomous_need: 'Autonomous Need', autonomous_want: 'Autonomous Want',
  routine: 'Routine', event: 'Event',
};

const fmtTime = (d) => {
  if (!d) return '—';
  try {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return '—'; }
};

// ── Build schedule-derived RECONSTRUCTED segments from character fields ────────
// If no direct records exist, we still know where the character was based on
// work schedule, school schedule, and current location state.
function buildScheduleSegments(character, cutoff24h, now) {
  const segments = [];
  const nowMs = now.getTime();
  const cutoffMs = cutoff24h.getTime();

  // ── Work schedule ─────────────────────────────────────────────────────────
  const workStart = character.work_start_time;
  const workEnd   = character.work_end_time;
  const workDays  = character.work_days || [];
  const workLocName = character.occupation_location_name || character.occupation_location_id
    ? (character.occupation_location_name || 'Work')
    : null;
  const homeName = character.resolved_current_location_name || 'Home';

  if (workLocName && workStart && workEnd && workDays.length > 0) {
    // Check last 2 days for work shifts that occurred
    for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
      const dayDate = new Date(now);
      dayDate.setDate(dayDate.getDate() - daysAgo);
      const dayOfWeek = dayDate.getDay(); // 0=Sun

      if (workDays.includes(dayOfWeek)) {
        const [sh, sm] = workStart.split(':').map(Number);
        const [eh, em] = workEnd.split(':').map(Number);

        const shiftStart = new Date(dayDate);
        shiftStart.setHours(sh, sm, 0, 0);

        const shiftEnd = new Date(dayDate);
        shiftEnd.setHours(eh, em, 0, 0);

        // Only include if shift start is within our 24h window
        if (shiftStart.getTime() >= cutoffMs && shiftStart.getTime() <= nowMs) {
          segments.push({
            timestamp: shiftStart,
            endTimestamp: shiftEnd.getTime() <= nowMs ? shiftEnd : null,
            type: 'reconstructed',
            source: 'Work Schedule',
            evidenceLabel: 'RECONSTRUCTED',
            location: workLocName,
            origin: homeName,
            destination: workLocName,
            description: `Work shift ${workStart}–${workEnd}`,
            locationId: character.occupation_location_id || 'work_schedule',
          });
        }

        // Also add departure (going home) if shift ended
        if (shiftEnd.getTime() >= cutoffMs && shiftEnd.getTime() <= nowMs) {
          segments.push({
            timestamp: shiftEnd,
            type: 'reconstructed',
            source: 'Work Schedule',
            evidenceLabel: 'RECONSTRUCTED',
            location: homeName,
            origin: workLocName,
            destination: homeName,
            description: `Left work after shift (${workEnd})`,
            locationId: character.current_home_location_id || 'home',
          });
        }
      }
    }
  }

  // ── School schedule ────────────────────────────────────────────────────────
  const schoolLocName = character.education_location_name || null;
  const isStudent = character.student_status === 'enrolled';
  if (isStudent && schoolLocName) {
    // Use standard school hours 8am–3pm as fallback when no explicit schedule exists
    for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
      const dayDate = new Date(now);
      dayDate.setDate(dayDate.getDate() - daysAgo);
      const dayOfWeek = dayDate.getDay();
      // Mon–Fri
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const schoolArrival = new Date(dayDate);
        schoolArrival.setHours(8, 0, 0, 0);
        if (schoolArrival.getTime() >= cutoffMs && schoolArrival.getTime() <= nowMs) {
          segments.push({
            timestamp: schoolArrival,
            type: 'reconstructed',
            source: 'School Schedule',
            evidenceLabel: 'RECONSTRUCTED',
            location: schoolLocName,
            origin: homeName,
            destination: schoolLocName,
            description: `School day at ${schoolLocName}`,
            locationId: character.education_location_id || 'school_schedule',
          });
        }
      }
    }
  }

  // ── Current location anchor ───────────────────────────────────────────────
  // Always include the character's current verified location as a RECONSTRUCTED anchor
  const currentLocName = character.resolved_current_location_name;
  const lastArrived = character.last_arrived_time;
  if (currentLocName && lastArrived) {
    const arrivedAt = new Date(lastArrived);
    if (arrivedAt.getTime() >= cutoffMs) {
      segments.push({
        timestamp: arrivedAt,
        type: 'reconstructed',
        source: 'Current Location State',
        evidenceLabel: 'RECONSTRUCTED',
        location: currentLocName,
        origin: null,
        destination: currentLocName,
        description: `Currently at ${currentLocName} (verified by system)`,
        locationId: character.resolved_current_location_id || 'current',
      });
    }
  }

  return segments;
}

export default function TravelHistoryCard({ characterId, ownerEmail, character }) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const { data: auditData = null, isLoading } = useQuery({
    queryKey: ['travelHistoryAudit', characterId, ownerEmail],
    queryFn: async () => {
      if (!characterId || !ownerEmail) return null;

      const now = new Date();
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const allMovements = [];
      const dedupeMap = new Map();
      const audit = {
        locationHistory: 0, travelSession: 0,
        automaticNarrative: 0, recentLocationHistory: 0,
        scheduleSegments: 0, currentStateDerived: 0,
        totalFound: 0, totalAfterDedup: 0,
      };

      // ── Source 1: LocationHistory ─────────────────────────────────────────
      const locationHistory = await base44.entities.LocationHistory.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-arrival_time', 100
      ).catch(() => []);
      const validLocHist = locationHistory.filter(r => r.arrival_time && new Date(r.arrival_time) >= cutoff24h);
      audit.locationHistory = validLocHist.length;
      validLocHist.forEach(h => {
        allMovements.push({
          timestamp: new Date(h.arrival_time),
          type: 'proven',
          evidenceLabel: 'PROVEN',
          source: 'LocationHistory',
          origin: h.location_name,
          destination: null,
          location: h.location_name,
          travelSource: h.travel_source,
          travelReason: h.travel_reason,
          locationId: h.location_id,
          description: h.travel_reason || h.event_type || 'Location arrival',
        });
      });

      // ── Source 2: TravelSession ────────────────────────────────────────────
      const travelSessions = await base44.entities.TravelSession.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-updated_date', 100
      ).catch(() => []);
      const validSessions = travelSessions.filter(s => {
        const refTime = s.actual_arrival_time
          ? new Date(s.actual_arrival_time)
          : (s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null);
        return refTime && refTime >= cutoff24h;
      });
      audit.travelSession = validSessions.length;
      validSessions.forEach(s => {
        const arrTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : new Date(s.estimated_arrival_time);
        const isArrived = s.route_status === 'arrived' && s.actual_arrival_time;
        allMovements.push({
          timestamp: arrTime,
          type: isArrived ? 'proven' : 'inferred',
          evidenceLabel: isArrived ? 'PROVEN' : 'INFERRED',
          source: isArrived ? 'TravelSession (arrived)' : `TravelSession (${s.route_status})`,
          origin: s.origin_location_name,
          destination: s.destination_location_name,
          location: s.destination_location_name,
          travelSource: s.travel_source,
          travelReason: s.travel_reason,
          locationId: s.destination_location_id,
          description: s.travel_reason || `Travel to ${s.destination_location_name}`,
        });
      });

      // ── Source 3: Character.recent_location_history ────────────────────────
      const recentHist = Array.isArray(character?.recent_location_history)
        ? character.recent_location_history
        : [];
      const validRecent = recentHist.filter(h => h.arrived_at && new Date(h.arrived_at) >= cutoff24h);
      audit.recentLocationHistory = validRecent.length;
      validRecent.forEach(h => {
        allMovements.push({
          timestamp: new Date(h.arrived_at),
          type: 'proven',
          evidenceLabel: 'PROVEN',
          source: 'Recent Location History',
          origin: h.location_name,
          destination: null,
          location: h.location_name,
          locationId: h.location_id,
          description: h.reason || 'Location visit',
        });
      });

      // ── Source 4: AutomaticNarrative travel events ─────────────────────────
      const narratives = await base44.entities.AutomaticNarrative.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-timestamp', 100
      ).catch(() => []);
      const travelNarratives = narratives.filter(n =>
        ['travel_arrival', 'travel_departure', 'location_change'].includes(n.event_type)
        && n.timestamp && new Date(n.timestamp) >= cutoff24h
      );
      audit.automaticNarrative = travelNarratives.length;
      travelNarratives.forEach(n => {
        allMovements.push({
          timestamp: new Date(n.timestamp),
          type: 'proven',
          evidenceLabel: 'PROVEN',
          source: 'AutomaticNarrative',
          origin: n.location_name,
          destination: null,
          location: n.location_name,
          locationId: n.location_id,
          description: (n.narrative_text || '').substring(0, 80) || n.event_type,
        });
      });

      // ── Source 5–8: Schedule + Current State RECONSTRUCTED segments ────────
      // Only add reconstructed segments if there is very little direct evidence
      const directCount = audit.locationHistory + audit.travelSession + audit.recentLocationHistory + audit.automaticNarrative;
      const schedSegments = buildScheduleSegments(character, cutoff24h, now);
      audit.scheduleSegments = schedSegments.length;
      schedSegments.forEach(seg => allMovements.push(seg));

      // ── DEDUPLICATION ──────────────────────────────────────────────────────
      // Priority: proven > inferred > reconstructed. Within same type: keep first.
      audit.totalFound = allMovements.length;
      const typePriority = { proven: 3, inferred: 2, reconstructed: 1 };

      allMovements.forEach(m => {
        const timeBucket = Math.round(m.timestamp.getTime() / 60000);
        const dedupeKey = `${m.locationId || m.location || m.origin}:${timeBucket}`;
        const existing = dedupeMap.get(dedupeKey);
        if (!existing) {
          dedupeMap.set(dedupeKey, m);
        } else {
          const mPri = typePriority[m.type] || 0;
          const exPri = typePriority[existing.type] || 0;
          if (mPri > exPri) dedupeMap.set(dedupeKey, m);
        }
      });

      const finalMovements = Array.from(dedupeMap.values());
      audit.totalAfterDedup = finalMovements.length;
      finalMovements.sort((a, b) => b.timestamp - a.timestamp);

      return {
        movements: finalMovements,
        audit,
        directCount,
        cutoff24h: cutoff24h.toISOString(),
        currentLocation: character?.resolved_current_location_name || '—',
        currentPresenceStatus: character?.resolved_presence_status || '—',
        lastLocationUpdate: character?.last_location_update_time,
        now: now.toISOString(),
      };
    },
    enabled: !!characterId && !!ownerEmail && !!character,
    staleTime: 5 * 60 * 1000,
  });

  // ── RENDER ─────────────────────────────────────────────────────────────────
  // This card ALWAYS renders — never returns null, never throws, never blocks siblings.

  const typeColor = {
    proven: 'border-primary/50',
    inferred: 'border-amber-400/50',
    reconstructed: 'border-blue-400/30',
  };
  const typeBadgeStyle = {
    proven: 'bg-green-500/10 border-green-500/30 text-green-700',
    inferred: 'bg-amber-500/10 border-amber-500/30 text-amber-700',
    reconstructed: 'bg-blue-500/10 border-blue-500/30 text-blue-700',
  };
  const typeBg = {
    proven: '',
    inferred: 'bg-amber-400/5',
    reconstructed: 'bg-blue-400/5',
  };

  return (
    <div className="rounded-xl overflow-hidden bg-card border border-border">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Location Continuity · Last 24 Hours
        </p>
        {isLoading && <span className="text-[9px] text-muted-foreground animate-pulse">Auditing...</span>}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Current status bar */}
        {auditData && (
          <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium">{auditData.currentLocation}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{auditData.currentPresenceStatus}</div>
            </div>
            {auditData.lastLocationUpdate && (
              <div className="text-[9px] text-muted-foreground text-right">
                Updated<br />{fmtTime(new Date(auditData.lastLocationUpdate))}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="text-xs text-muted-foreground animate-pulse py-2">Auditing movement sources…</div>
        )}

        {/* No data */}
        {!isLoading && !auditData && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            Location data unavailable.
          </div>
        )}

        {/* Movement timeline */}
        {!isLoading && auditData && auditData.movements.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-lg p-3">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>No location activity recorded in the past 24 hours from any source.</span>
          </div>
        )}

        {!isLoading && auditData && auditData.movements.length > 0 && (
          <div className="space-y-2">
            {auditData.movements.map((m, i) => (
              <div
                key={i}
                className={`border-l-2 ${typeColor[m.type] || 'border-border'} ${typeBg[m.type] || ''} pl-3 py-1.5 rounded-r`}
              >
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {fmtTime(m.timestamp)}
                  <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] border ${typeBadgeStyle[m.type] || ''}`}>
                    {m.evidenceLabel}
                  </span>
                </div>
                <div className="text-xs text-foreground mt-1">
                  {m.origin && m.destination && m.origin !== m.destination
                    ? <>{m.origin} <span className="text-muted-foreground">→</span> {m.destination}</>
                    : m.location || m.origin || m.destination || '—'}
                </div>
                {m.description && m.description !== m.location && (
                  <div className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{m.description}</div>
                )}
                <div className="text-[9px] text-muted-foreground/60 mt-0.5">{m.source}</div>
              </div>
            ))}
          </div>
        )}

        {/* Diagnostics toggle */}
        {auditData && (
          <>
            <button
              onClick={() => setShowDiagnostics(!showDiagnostics)}
              className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1 py-1"
            >
              <span>Location Continuity Audit</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
            </button>

            {showDiagnostics && (
              <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-[9px] font-mono text-muted-foreground">
                <div>
                  <div className="font-semibold text-[10px] mb-1">Sources checked:</div>
                  <div>LocationHistory: {auditData.audit.locationHistory}</div>
                  <div>TravelSession: {auditData.audit.travelSession}</div>
                  <div>Recent Location History: {auditData.audit.recentLocationHistory}</div>
                  <div>AutomaticNarrative: {auditData.audit.automaticNarrative}</div>
                  <div>Schedule-derived: {auditData.audit.scheduleSegments}</div>
                  <div className="font-semibold mt-1 pt-1 border-t border-muted/60">
                    Total raw: {auditData.audit.totalFound} → After dedup: {auditData.audit.totalAfterDedup}
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-[10px]">Legend:</div>
                  <div>PROVEN = direct arrival/travel record</div>
                  <div>INFERRED = ETA passed, write pending</div>
                  <div>RECONSTRUCTED = derived from schedule / current state</div>
                </div>
                <div>
                  <div>Window: {auditData.cutoff24h ? fmtTime(new Date(auditData.cutoff24h)) : '—'} → {auditData.now ? fmtTime(new Date(auditData.now)) : '—'}</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}