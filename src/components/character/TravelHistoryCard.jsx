import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, AlertCircle, ChevronDown } from 'lucide-react';

const LOCATION_ICONS = {
  home: '🏠', work: '💼', school: '🎓', gym: '💪', food_drink: '🍽️',
  religion: '🙏', social: '👥', shopping: '🛍️', medical: '⚕️', other: '📍',
};

const TRAVEL_SOURCE_LABELS = {
  schedule: 'Schedule',
  autonomous: 'Autonomous',
  promise: 'Promise',
  commitment: 'Commitment',
  need_fulfillment: 'Need',
  manual: 'Manual',
  system: 'System',
  work_schedule: 'Work Schedule',
  school_schedule: 'School Schedule',
};

export default function TravelHistoryCard({ characterId, ownerEmail, character }) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const formatTime = (iso) => {
    if (!iso) return null;
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Audit all movement sources
  const { data: auditData = null, isLoading } = useQuery({
    queryKey: ['travelHistoryAudit', characterId, ownerEmail],
    queryFn: async () => {
      if (!characterId || !ownerEmail) return null;
      
      const now = new Date();
      const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const movements = [];
      const dedupeMap = new Map(); // key: "${location_id}:${Math.round(timestamp/60000)}" — dedupe by location + minute
      let audit = {
        locationHistory: 0,
        travelSession: 0,
        automaticNarrative: 0,
        recentLocationHistory: 0,
        totalFound: 0,
        totalAfterDedup: 0,
      };

      try {
        // Source 1: LocationHistory records
        const locationHistory = await base44.entities.LocationHistory.filter(
          { character_id: characterId, owner_email: ownerEmail },
          '-arrival_time', 100
        ).catch(() => []);
        const validLocHist = locationHistory.filter(r => new Date(r.arrival_time) >= cutoff24h);
        audit.locationHistory = validLocHist.length;
        
        validLocHist.forEach(h => {
          movements.push({
            timestamp: new Date(h.arrival_time),
            type: 'proven',
            source: 'LocationHistory',
            origin: h.location_name,
            destination: null,
            eventType: h.event_type,
            travelSource: h.travel_source,
            travelReason: h.travel_reason,
            isCurrent: h.is_current,
            locationId: h.location_id,
            recordId: h.id,
            data: h,
          });
        });

        // Source 2: TravelSession records (all statuses with actual/estimated arrival in 24h window)
        const travelSessionsRaw = await base44.entities.TravelSession.filter(
          { character_id: characterId, owner_email: ownerEmail },
          '-updated_date', 100
        ).catch(() => []);
        const validSessions = travelSessionsRaw.filter(s => {
          // Include if actual_arrival_time OR estimated_arrival_time falls in 24h window
          const arrivalTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : null;
          const estTime = s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null;
          const refTime = arrivalTime || estTime;
          return refTime && refTime >= cutoff24h;
        });
        audit.travelSession = validSessions.length;
        
        validSessions.forEach(s => {
          const arrivalTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : null;
          const estTime = s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null;
          const refTime = arrivalTime || estTime;
          
          if (!refTime) return;
          
          let evidenceType = 'proven';
          let sourceLabel = 'TravelSession';
          if (s.route_status === 'arrived' && s.actual_arrival_time) {
            sourceLabel = 'TravelSession (arrived)';
          } else if (s.route_status === 'arrival_due') {
            evidenceType = 'inferred';
            sourceLabel = 'TravelSession (stuck arrival)';
          } else {
            evidenceType = 'inferred';
            sourceLabel = `TravelSession (${s.route_status})`;
          }
          
          movements.push({
            timestamp: refTime,
            type: evidenceType,
            source: sourceLabel,
            origin: s.origin_location_name,
            destination: s.destination_location_name,
            travelSource: s.travel_source,
            travelReason: s.travel_reason,
            routeStatus: s.route_status,
            arrivalPending: s.arrival_pending_character_write,
            locationId: s.destination_location_id,
            recordId: s.id,
            data: s,
          });
        });

        // Source 3: Character.recent_location_history array entries
        if (character?.recent_location_history && Array.isArray(character.recent_location_history)) {
          const validRecent = character.recent_location_history.filter(h => {
            const arrTime = h.arrived_at ? new Date(h.arrived_at) : null;
            return arrTime && arrTime >= cutoff24h;
          });
          audit.recentLocationHistory = validRecent.length;
          
          validRecent.forEach(h => {
            movements.push({
              timestamp: new Date(h.arrived_at),
              type: 'proven',
              source: 'Recent Location History',
              origin: h.location_name,
              destination: null,
              locationId: h.location_id,
              recordId: `recent_${h.location_id}_${h.arrived_at}`, // synthetic ID
              reason: h.reason,
              data: h,
            });
          });
        }

        // Source 4: AutomaticNarrative travel/location events
        const narratives = await base44.entities.AutomaticNarrative.filter(
          { character_id: characterId, owner_email: ownerEmail },
          '-timestamp', 100
        ).catch(() => []);
        const travelNarratives = narratives.filter(n => {
          const isTravelEvent = ['travel_arrival', 'travel_departure', 'location_change'].includes(n.event_type);
          return isTravelEvent && new Date(n.timestamp) >= cutoff24h;
        });
        audit.automaticNarrative = travelNarratives.length;
        
        travelNarratives.forEach(n => {
          movements.push({
            timestamp: new Date(n.timestamp),
            type: 'proven',
            source: 'AutomaticNarrative',
            origin: n.location_name,
            destination: null,
            eventType: n.event_type,
            narrativeText: n.narrative_text,
            locationId: n.location_id,
            recordId: n.id,
            data: n,
          });
        });

        // ── DEDUPLICATION PASS ──
        // Deduplicate by: location_id + timestamp (rounded to 1-minute buckets)
        // Keep proven records over inferred, keep first source if same evidence type
        audit.totalFound = movements.length;
        
        movements.forEach(m => {
          // Round timestamp to nearest minute for deduplication
          const timeBucket = Math.round(m.timestamp.getTime() / 60000);
          const dedupeKey = `${m.locationId || m.origin}:${timeBucket}`;
          
          const existing = dedupeMap.get(dedupeKey);
          if (!existing) {
            dedupeMap.set(dedupeKey, m);
          } else {
            // Keep proven over inferred; keep first if same type
            if (m.type === 'proven' && existing.type === 'inferred') {
              dedupeMap.set(dedupeKey, m);
            }
          }
        });

        // Extract deduplicated movements
        const finalMovements = Array.from(dedupeMap.values());
        audit.totalAfterDedup = finalMovements.length;

        // Sort by timestamp descending (newest first)
        finalMovements.sort((a, b) => b.timestamp - a.timestamp);

        return {
          movements: finalMovements,
          audit,
          cutoff24h: cutoff24h.toISOString(),
          currentLocation: character?.resolved_current_location_name || 'Unknown',
          currentPresenceStatus: character?.resolved_presence_status || 'Unknown',
          lastLocationUpdate: character?.last_location_update_time,
          lastArrived: character?.last_arrived_time,
          characterId,
          now: now.toISOString(),
        };
      } catch (error) {
        console.error('[TravelHistoryAudit] Error:', error?.message);
        return {
          movements: [],
          audit,
          error: error?.message,
          currentLocation: character?.resolved_current_location_name || 'Unknown',
          currentPresenceStatus: character?.resolved_presence_status || 'Unknown',
          cutoff24h: cutoff24h.toISOString(),
          now: now.toISOString(),
          characterId,
        };
      }
    },
    enabled: !!characterId && !!ownerEmail && !!character,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground animate-pulse">Auditing movement sources...</div>
        </CardContent>
      </Card>
    );
  }

  if (!auditData) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="w-3 h-3" />
            Travel history unavailable.
          </div>
        </CardContent>
      </Card>
    );
  }

  const { movements, audit, currentLocation, currentPresenceStatus, lastLocationUpdate, error } = auditData;
  const hasMovement = movements.length > 0;
  const provenMovements = movements.filter(m => m.type === 'proven');
  const inferredMovements = movements.filter(m => m.type === 'inferred');

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <MapPin className="w-4 h-4" /> Travel History · Last 24 Hours
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Location Summary */}
        <div className="bg-muted/40 rounded-lg p-3 space-y-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase">Current Status</div>
          <div className="text-sm font-medium">{currentLocation}</div>
          <div className="text-xs text-muted-foreground">
            Status: <span className="text-foreground capitalize">{currentPresenceStatus}</span>
            {lastLocationUpdate && (
              <span className="ml-2">
                · Updated {formatTime(lastLocationUpdate)}
              </span>
            )}
          </div>
        </div>

        {/* Movement Timeline */}
        {!hasMovement ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-lg p-3">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>Travel history unavailable.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Proven Movements */}
            {provenMovements.map((m, i) => (
              <div key={`proven-${i}`} className="border-l-2 border-primary/50 pl-3 py-1">
                <div className="text-xs font-medium flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  {formatTime(m.timestamp)}
                </div>
                <div className="text-xs mt-1 text-foreground">
                  {m.origin} → {m.destination || m.origin}
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {m.travelSource && (
                    <Badge variant="secondary" className="text-[10px]">
                      {TRAVEL_SOURCE_LABELS[m.travelSource] || m.travelSource}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] bg-green-500/10 border-green-500/30 text-green-700">
                    {m.source}
                  </Badge>
                </div>
                {m.travelReason && (
                  <div className="text-[11px] text-muted-foreground mt-1">{m.travelReason}</div>
                )}
              </div>
            ))}

            {/* Inferred Movements */}
            {inferredMovements.map((m, i) => (
              <div key={`inferred-${i}`} className="border-l-2 border-amber-400/50 pl-3 py-1 bg-amber-400/5 rounded">
                <div className="text-xs font-medium flex items-center gap-2 text-amber-700">
                  <Clock className="w-3 h-3" />
                  {formatTime(m.timestamp)}
                </div>
                <div className="text-xs mt-1 text-foreground">
                  {m.origin} → {m.destination || m.origin}
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  <Badge variant="outline" className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-700">
                    Inferred Movement
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Diagnostics Toggle */}
        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors p-2 hover:bg-muted/50 rounded"
        >
          <span>Travel History Audit</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`} />
        </button>

        {/* Diagnostics Section */}
        {showDiagnostics && (
          <div className="bg-muted/30 rounded-lg p-3 space-y-3 text-[10px]">
            <div>
              <span className="font-semibold text-muted-foreground">24-hour window:</span>
              <div className="mt-1 space-y-0.5 text-muted-foreground font-mono text-[9px]">
                <div>Now: {auditData?.now ? formatTime(new Date(auditData.now)) : '—'}</div>
                <div>Cutoff: {auditData?.cutoff24h ? formatTime(new Date(auditData.cutoff24h)) : '—'}</div>
              </div>
            </div>
            
            <div>
              <span className="font-semibold text-muted-foreground">Raw records by source:</span>
              <div className="mt-1 space-y-0.5 text-muted-foreground">
                <div>LocationHistory: {audit.locationHistory}</div>
                <div>TravelSession: {audit.travelSession}</div>
                <div>Recent Location History: {audit.recentLocationHistory}</div>
                <div>AutomaticNarrative: {audit.automaticNarrative}</div>
                <div className="font-semibold mt-1 pt-1 border-t border-muted">
                  Total found: {audit.totalFound}
                </div>
              </div>
            </div>

            <div>
              <span className="font-semibold text-muted-foreground">After deduplication:</span>
              <div className="mt-1 text-muted-foreground">
                {audit.totalAfterDedup} final rows (merged by location + timestamp)
              </div>
            </div>

            {movements.length > 0 && (
              <div>
                <span className="font-semibold text-muted-foreground">Most recent movement:</span>
                <div className="mt-1 text-muted-foreground">
                  {movements[0].origin} → {movements[0].destination || movements[0].origin}
                </div>
                <div className="text-muted-foreground">
                  Source: {movements[0].source}
                </div>
                <div className="text-muted-foreground">
                  Time: {formatTime(movements[0].timestamp)}
                </div>
              </div>
            )}
            {error && (
              <div className="text-red-600 font-medium">
                Query Error: {error}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}