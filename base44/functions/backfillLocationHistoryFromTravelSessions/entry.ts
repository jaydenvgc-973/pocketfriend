/**
 * backfillLocationHistoryFromTravelSessions
 *
 * One-time (or re-runnable) backfill: creates LocationHistory records
 * from existing TravelSession records (arrived sessions only) for the last 7 days.
 *
 * Safe to re-run — deduplicates by character_id + location_id + arrival_time bucket (1h).
 *
 * Also backfills from Character.recent_location_history[] if present.
 *
 * Payload:
 *   ownerEmail  string   — limit to one user (optional; if omitted runs all users)
 *   characterId string   — limit to one character (optional)
 *   daysBack    number   — how far back to scan (default 7)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const { ownerEmail, characterId, daysBack = 7 } = await req.json().catch(() => ({}));

    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    // Fetch TravelSessions in range
    const sessionFilter = { route_status: 'arrived' };
    if (ownerEmail) sessionFilter.owner_email = ownerEmail;
    if (characterId) sessionFilter.character_id = characterId;

    const sessions = await base44.asServiceRole.entities.TravelSession.filter(
      sessionFilter,
      '-created_at',
      500
    ).catch(() => []);

    const recent = sessions.filter(s => {
      const ts = s.actual_arrival_time || s.estimated_arrival_time || s.created_at;
      return ts && new Date(ts) >= new Date(cutoff);
    });

    console.log(`[backfillLocationHistory] Found ${recent.length} arrived sessions in last ${daysBack} days`);

    // Fetch existing LocationHistory records to avoid duplicates
    const existingFilter = {};
    if (ownerEmail) existingFilter.owner_email = ownerEmail;
    if (characterId) existingFilter.character_id = characterId;
    const existing = await base44.asServiceRole.entities.LocationHistory.filter(
      existingFilter, null, 1000
    ).catch(() => []);

    // Dedup key: character_id + location_id + arrival hour bucket
    const existingKeys = new Set(existing.map(e => {
      const hour = e.arrival_time ? new Date(e.arrival_time).toISOString().substring(0, 13) : '';
      return `${e.character_id}::${e.location_id}::${hour}`;
    }));

    const toCreate = [];
    for (const s of recent) {
      const arrivalTime = s.actual_arrival_time || s.estimated_arrival_time;
      if (!arrivalTime || !s.destination_location_id) continue;

      const hour = new Date(arrivalTime).toISOString().substring(0, 13);
      const key = `${s.character_id}::${s.destination_location_id}::${hour}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);

      // Derive event type from travel_source + reason
      let eventType = 'arrival';
      const src = s.travel_source || '';
      const reason = s.travel_reason || '';
      if (src === 'work_schedule' || reason.includes('work')) eventType = 'work_start';
      else if (src === 'school_schedule' || reason.includes('school')) eventType = 'school_start';
      else if (src === 'autonomous_need' || reason.includes('food') || reason.includes('hunger')) eventType = 'food_need';
      else if (reason.includes('gym') || reason.includes('fitness')) eventType = 'gym_visit';
      else if (reason.includes('church') || reason.includes('worship') || reason.includes('religious')) eventType = 'religious_service';
      else if (reason.includes('social') || reason.includes('visit')) eventType = 'social_visit';

      const travelSrcMap = {
        autonomous_need: 'need_fulfillment',
        autonomous_want: 'autonomous',
        routine: 'schedule',
        event: 'other',
        promise: 'promise',
        manual: 'manual',
        work_schedule: 'schedule',
        school_schedule: 'schedule',
      };

      toCreate.push({
        character_id: s.character_id,
        character_name: s.character_name,
        owner_email: s.owner_email,
        location_id: s.destination_location_id,
        location_name: s.destination_location_name,
        location_category: 'other', // can't resolve category without LocationReference fetch
        event_type: eventType,
        arrival_time: arrivalTime,
        departure_time: null,
        duration_minutes: null,
        travel_source: travelSrcMap[src] || 'system',
        travel_reason: reason || null,
        is_current: false,
        notes: `Backfilled from TravelSession ${s.id}`,
      });
    }

    // Also backfill from Character.recent_location_history[] if present
    // Fetch characters
    const charFilter = {};
    if (ownerEmail) charFilter.owner_email = ownerEmail;
    if (characterId) charFilter.id = characterId;
    const chars = await base44.asServiceRole.entities.Character.filter(charFilter, null, 200).catch(() => []);
    for (const c of chars) {
      const history = c.recent_location_history || [];
      for (const h of history) {
        if (!h.arrived_at || !h.location_id) continue;
        if (new Date(h.arrived_at) < new Date(cutoff)) continue;
        const hour = new Date(h.arrived_at).toISOString().substring(0, 13);
        const key = `${c.id}::${h.location_id}::${hour}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);

        toCreate.push({
          character_id: c.id,
          character_name: c.name,
          owner_email: c.owner_email,
          location_id: h.location_id,
          location_name: h.location_name || 'Unknown',
          location_category: 'other',
          event_type: 'arrival',
          arrival_time: h.arrived_at,
          departure_time: h.left_at || null,
          duration_minutes: null,
          travel_source: 'system',
          travel_reason: h.reason || null,
          is_current: !h.left_at,
          notes: 'Backfilled from Character.recent_location_history',
        });
      }
    }

    console.log(`[backfillLocationHistory] Creating ${toCreate.length} new LocationHistory records`);

    let created = 0;
    let failed = 0;
    for (const record of toCreate) {
      const ok = await base44.asServiceRole.entities.LocationHistory.create(record).catch(() => null);
      if (ok) created++;
      else failed++;
    }

    return Response.json({
      success: true,
      sessions_scanned: recent.length,
      records_created: created,
      records_failed: failed,
      skipped_duplicates: toCreate.length === 0 ? recent.length : 0,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});