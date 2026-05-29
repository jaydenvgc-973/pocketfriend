/**
 * auditTravelHistoryCard
 * 
 * Complete diagnostic of a character's 24-hour travel history.
 * Shows all raw records from each source, deduplication results, and final card rows.
 * 
 * Payload:
 *   characterId: string
 *   ownerEmail: string
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, ownerEmail } = await req.json();
    if (!characterId || !ownerEmail) {
      return Response.json({ error: 'characterId and ownerEmail required' }, { status: 400 });
    }

    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    console.log(`[auditTravelHistoryCard] Starting audit for ${characterId} | owner=${ownerEmail}`);
    console.log(`[auditTravelHistoryCard] Now: ${now.toISOString()} | Cutoff: ${cutoff24h.toISOString()}`);

    // ── Load character (user-scoped) ──
    const charList = await base44.entities.Character.filter(
      { owner_email: ownerEmail },
      null, 300
    ).catch(() => []);
    const character = charList.find(c => c.id === characterId);

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const result = {
      character: {
        id: character.id,
        name: character.name,
        owner_email: character.owner_email,
      },
      audit: {
        current_time: now.toISOString(),
        cutoff_24h_ago: cutoff24h.toISOString(),
      },
      raw_records: {
        location_history: [],
        travel_session: [],
        recent_location_history: [],
        automatic_narrative: [],
      },
      deduplication: {
        total_raw: 0,
        total_after_dedup: 0,
        duplicates_removed: [],
      },
      final_card_rows: [],
    };

    // ── Source 1: LocationHistory ──
    const locationHistoryRaw = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id: characterId, owner_email: ownerEmail },
      '-arrival_time', 200
    ).catch(() => []);
    const locationHistoryValid = locationHistoryRaw.filter(r => new Date(r.arrival_time) >= cutoff24h);
    result.raw_records.location_history = locationHistoryValid.map(r => ({
      id: r.id,
      arrival_time: r.arrival_time,
      location_name: r.location_name,
      location_id: r.location_id,
      event_type: r.event_type,
      travel_source: r.travel_source,
      travel_reason: r.travel_reason,
    }));
    console.log(`[auditTravelHistoryCard] LocationHistory: ${locationHistoryValid.length} in 24h window (${locationHistoryRaw.length} total)`);

    // ── Source 2: TravelSession ──
    const travelSessionRaw = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: characterId, owner_email: ownerEmail },
      '-updated_date', 200
    ).catch(() => []);
    const travelSessionValid = travelSessionRaw.filter(s => {
      const arrTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : null;
      const estTime = s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null;
      const refTime = arrTime || estTime;
      return refTime && refTime >= cutoff24h;
    });
    result.raw_records.travel_session = travelSessionValid.map(s => {
      const arrTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : null;
      const estTime = s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null;
      const refTime = arrTime || estTime;
      return {
        id: s.id,
        reference_time: refTime?.toISOString(),
        actual_arrival_time: s.actual_arrival_time,
        estimated_arrival_time: s.estimated_arrival_time,
        origin_location_name: s.origin_location_name,
        origin_location_id: s.origin_location_id,
        destination_location_name: s.destination_location_name,
        destination_location_id: s.destination_location_id,
        route_status: s.route_status,
        travel_source: s.travel_source,
        travel_reason: s.travel_reason,
      };
    });
    console.log(`[auditTravelHistoryCard] TravelSession: ${travelSessionValid.length} in 24h window (${travelSessionRaw.length} total)`);

    // ── Source 3: Character.recent_location_history ──
    const recentLocHistory = (character.recent_location_history || []).filter(h => {
      const arrTime = h.arrived_at ? new Date(h.arrived_at) : null;
      return arrTime && arrTime >= cutoff24h;
    });
    result.raw_records.recent_location_history = recentLocHistory.map(h => ({
      location_id: h.location_id,
      location_name: h.location_name,
      arrived_at: h.arrived_at,
      left_at: h.left_at,
      reason: h.reason,
    }));
    console.log(`[auditTravelHistoryCard] Recent Location History: ${recentLocHistory.length} in 24h window`);

    // ── Source 4: AutomaticNarrative ──
    const narrativesRaw = await base44.asServiceRole.entities.AutomaticNarrative.filter(
      { character_id: characterId, owner_email: ownerEmail },
      '-timestamp', 200
    ).catch(() => []);
    const narrativesValid = narrativesRaw.filter(n => {
      const isTravelEvent = ['travel_arrival', 'travel_departure', 'location_change'].includes(n.event_type);
      return isTravelEvent && new Date(n.timestamp) >= cutoff24h;
    });
    result.raw_records.automatic_narrative = narrativesValid.map(n => ({
      id: n.id,
      timestamp: n.timestamp,
      event_type: n.event_type,
      location_name: n.location_name,
      location_id: n.location_id,
      narrative_text: n.narrative_text?.substring(0, 80) + '...',
    }));
    console.log(`[auditTravelHistoryCard] AutomaticNarrative: ${narrativesValid.length} in 24h window`);

    // ── Merge all movements ──
    const allMovements = [];

    locationHistoryValid.forEach(h => {
      allMovements.push({
        timestamp: new Date(h.arrival_time),
        type: 'proven',
        source: 'LocationHistory',
        origin: h.location_name,
        destination: null,
        location_id: h.location_id,
        record_id: h.id,
        event_type: h.event_type,
        travel_source: h.travel_source,
        travel_reason: h.travel_reason,
      });
    });

    travelSessionValid.forEach(s => {
      const arrTime = s.actual_arrival_time ? new Date(s.actual_arrival_time) : null;
      const estTime = s.estimated_arrival_time ? new Date(s.estimated_arrival_time) : null;
      const refTime = arrTime || estTime;
      
      let sourceLabel = 'TravelSession';
      let evidenceType = 'proven';
      if (s.route_status === 'arrival_due') {
        sourceLabel = 'TravelSession (stuck arrival)';
        evidenceType = 'inferred';
      } else if (s.route_status !== 'arrived') {
        sourceLabel = `TravelSession (${s.route_status})`;
        evidenceType = 'inferred';
      }
      
      allMovements.push({
        timestamp: refTime,
        type: evidenceType,
        source: sourceLabel,
        origin: s.origin_location_name,
        destination: s.destination_location_name,
        location_id: s.destination_location_id,
        record_id: s.id,
        travel_source: s.travel_source,
        travel_reason: s.travel_reason,
      });
    });

    recentLocHistory.forEach(h => {
      allMovements.push({
        timestamp: new Date(h.arrived_at),
        type: 'proven',
        source: 'Recent Location History',
        origin: h.location_name,
        destination: null,
        location_id: h.location_id,
        record_id: `recent_${h.location_id}_${h.arrived_at}`,
        reason: h.reason,
      });
    });

    narrativesValid.forEach(n => {
      allMovements.push({
        timestamp: new Date(n.timestamp),
        type: 'proven',
        source: 'AutomaticNarrative',
        origin: n.location_name,
        destination: null,
        location_id: n.location_id,
        record_id: n.id,
        event_type: n.event_type,
      });
    });

    result.deduplication.total_raw = allMovements.length;
    console.log(`[auditTravelHistoryCard] Total raw movements: ${allMovements.length}`);

    // ── Deduplication ──
    const dedupeMap = new Map();
    const duplicatesRemoved = [];

    allMovements.forEach(m => {
      const timeBucket = Math.round(m.timestamp.getTime() / 60000); // 1-minute buckets
      const dedupeKey = `${m.location_id || m.origin}:${timeBucket}`;
      
      const existing = dedupeMap.get(dedupeKey);
      if (!existing) {
        dedupeMap.set(dedupeKey, m);
      } else {
        // Keep proven over inferred
        if (m.type === 'proven' && existing.type === 'inferred') {
          duplicatesRemoved.push({
            removed_record_id: existing.record_id,
            removed_source: existing.source,
            kept_record_id: m.record_id,
            kept_source: m.source,
          });
          dedupeMap.set(dedupeKey, m);
        } else {
          duplicatesRemoved.push({
            removed_record_id: m.record_id,
            removed_source: m.source,
            kept_record_id: existing.record_id,
            kept_source: existing.source,
          });
        }
      }
    });

    result.deduplication.total_after_dedup = dedupeMap.size;
    result.deduplication.duplicates_removed = duplicatesRemoved;
    console.log(`[auditTravelHistoryCard] After dedup: ${dedupeMap.size} rows | Removed: ${duplicatesRemoved.length}`);

    // ── Final card rows (sorted newest first) ──
    const finalMovements = Array.from(dedupeMap.values());
    finalMovements.sort((a, b) => b.timestamp - a.timestamp);
    
    result.final_card_rows = finalMovements.map(m => ({
      timestamp: m.timestamp.toISOString(),
      time_display: m.timestamp.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      type: m.type,
      source: m.source,
      origin: m.origin,
      destination: m.destination,
      location_id: m.location_id,
      record_id: m.record_id,
      travel_source: m.travel_source,
      travel_reason: m.travel_reason,
    }));

    console.log(`[auditTravelHistoryCard] Final card will display ${result.final_card_rows.length} rows`);
    console.log(`[auditTravelHistoryCard] Audit complete ✓`);

    return Response.json(result);
  } catch (error) {
    console.error('[auditTravelHistoryCard] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});