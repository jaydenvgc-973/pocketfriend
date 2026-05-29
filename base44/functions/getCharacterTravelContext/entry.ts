/**
 * getCharacterTravelContext
 *
 * Returns a compact last-24-hour travel/location summary for a character.
 * Used by buildCanonicalCharacterContext to inject "what did you do today" awareness.
 *
 * SOURCE PRIORITY ORDER:
 *   1. LocationHistory entity records (durable, explicit — written by recordLocationHistoryEvent)
 *   2. Character.recent_location_history[] (in-memory field written by updateCharacterLocation
 *      on every confirmed arrival — reliable bridge until LocationHistory has coverage)
 *   3. TravelSession records (arrived sessions show destination + actual_arrival_time)
 *   4. AutomaticNarrative travel events (travel_arrival, work_start, school_start, etc.)
 *   5. Character presence fields (current live state — tells us NOW, not history)
 *
 * Payload:
 *   characterId   string — Character ID
 *   ownerEmail    string — Owner email for scoping
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  const mm = m.toString().padStart(2, '0');
  return mm === '00' ? `${h12}${ampm}` : `${h12}:${mm}${ampm}`;
}

function getEventLabel(eventType) {
  const labels = {
    arrival: 'Arrived at',
    departure: 'Left',
    return_home: 'Returned home to',
    work_start: 'Started work at',
    work_end: 'Left work at',
    school_start: 'Went to school at',
    school_end: 'Left school at',
    religious_service: 'Attended service at',
    food_need: 'Got food at',
    social_visit: 'Visited',
    gym_visit: 'Went to gym at',
    transit: 'Traveling through',
    stay: 'Stayed at',
    other: 'Visited',
  };
  return labels[eventType] || 'Visited';
}

function reasonLabel(reason, source) {
  if (reason) return reason;
  const map = {
    schedule: 'schedule',
    work_schedule: 'work schedule',
    school_schedule: 'school schedule',
    autonomous: 'autonomous travel',
    autonomous_needs_driven: 'need-based travel',
    autonomous_movement: 'autonomous travel',
    promise: 'promised to be there',
    commitment: 'commitment',
    need_fulfillment: 'fulfilling a need',
    manual: 'manual move',
    system: 'system',
    return_home: 'returned home',
    verified_arrival: 'arrived',
  };
  return map[source] || source || '';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, ownerEmail } = await req.json();

    if (!characterId || !ownerEmail) {
      return Response.json({ error: 'characterId and ownerEmail required' }, { status: 400 });
    }

    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch all data sources in parallel — service role for cross-account safety
    const [locationHistory, travelSessions, narratives, character] = await Promise.all([
      base44.asServiceRole.entities.LocationHistory.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-arrival_time', 30
      ).catch(() => []),
      base44.asServiceRole.entities.TravelSession.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-created_at', 15
      ).catch(() => []),
      base44.asServiceRole.entities.AutomaticNarrative.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-timestamp', 20
      ).catch(() => []),
      base44.asServiceRole.entities.Character.filter(
        { id: characterId }
      ).then(r => r[0]).catch(() => null),
    ]);

    // Filter to last 24 hours
    const recentHistory = locationHistory.filter(h => h.arrival_time && new Date(h.arrival_time) >= cutoff24h);

    const summaryLines = [];
    let sourceUsed = 'none';

    // ── SOURCE 1: LocationHistory entity (durable explicit records) ──────────
    if (recentHistory.length > 0) {
      sourceUsed = 'LocationHistory';
      for (const h of recentHistory) {
        const arrTime = fmtTime(h.arrival_time);
        const depTime = h.departure_time ? fmtTime(h.departure_time) : null;
        const timeStr = depTime ? `${arrTime}–${depTime}` : `${arrTime} (still here)`;
        const rsn = reasonLabel(h.travel_reason, h.travel_source);
        const rsnStr = rsn ? ` [${rsn}]` : '';
        const label = getEventLabel(h.event_type);
        summaryLines.push(`- ${label} ${h.location_name} at ${timeStr}${rsnStr}`);
      }
    }

    // ── SOURCE 2: Character.recent_location_history[] ─────────────────────────
    // Written by updateCharacterLocation on every confirmed arrival.
    // This is the most reliable bridge while LocationHistory entity builds up coverage.
    if (summaryLines.length === 0 && character?.recent_location_history?.length > 0) {
      sourceUsed = 'recent_location_history';
      const todayHistory = character.recent_location_history
        .filter(h => h.arrived_at && new Date(h.arrived_at) >= cutoff24h)
        .sort((a, b) => new Date(a.arrived_at) - new Date(b.arrived_at));

      for (const h of todayHistory) {
        const arrTime = fmtTime(h.arrived_at);
        const leftTime = h.left_at ? fmtTime(h.left_at) : null;
        const timeStr = leftTime ? `${arrTime}–${leftTime}` : `${arrTime} (still here)`;
        const rsn = reasonLabel(null, h.reason || h.location_type);
        const rsnStr = rsn ? ` [${rsn}]` : '';
        // Derive event label from location_type
        let label = 'Visited';
        if (h.location_type === 'home' || h.location_type === 'return_home') label = 'Returned home to';
        else if (h.location_type === 'work') label = 'Worked at';
        else if (h.location_type === 'school') label = 'Attended school at';
        summaryLines.push(`- ${label} ${h.location_name} at ${timeStr}${rsnStr}`);
      }
    }

    // ── SOURCE 3: TravelSession (arrived sessions — durable movement record) ─
    if (summaryLines.length === 0) {
      const arrivedSessions = travelSessions.filter(s =>
        s.route_status === 'arrived' &&
        s.actual_arrival_time &&
        new Date(s.actual_arrival_time) >= cutoff24h
      ).sort((a, b) => new Date(a.actual_arrival_time) - new Date(b.actual_arrival_time));

      if (arrivedSessions.length > 0) {
        sourceUsed = 'TravelSession';
        for (const s of arrivedSessions) {
          const arrTime = fmtTime(s.actual_arrival_time);
          const depTime = s.estimated_departure_time ? fmtTime(s.estimated_departure_time) : null;
          const rsn = reasonLabel(s.travel_reason, s.travel_source);
          const rsnStr = rsn ? ` [${rsn}]` : '';
          const depStr = depTime ? ` (departed ${depTime})` : '';
          summaryLines.push(`- Arrived at ${s.destination_location_name} at ${arrTime}${depStr}${rsnStr}`);
          if (s.origin_location_name) {
            summaryLines.push(`  Came from ${s.origin_location_name}`);
          }
        }
      }
    }

    // ── SOURCE 4: AutomaticNarrative travel events ────────────────────────────
    if (summaryLines.length === 0) {
      const travelEvents = ['travel_arrival', 'travel_departure', 'work_start', 'work_end', 'school_start', 'school_end', 'location_change'];
      const locNarratives = narratives
        .filter(n => n.timestamp && new Date(n.timestamp) >= cutoff24h && travelEvents.includes(n.event_type))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      if (locNarratives.length > 0) {
        sourceUsed = 'AutomaticNarrative';
        for (const n of locNarratives) {
          const ts = fmtTime(n.timestamp);
          const locName = n.location_name || '';
          const evtLabel = {
            travel_arrival: 'Arrived at',
            travel_departure: 'Left',
            work_start: 'Started work at',
            work_end: 'Left work at',
            school_start: 'Started school at',
            school_end: 'Left school at',
            location_change: 'Moved to',
          }[n.event_type] || 'Visited';
          if (locName) {
            summaryLines.push(`- ${evtLabel} ${locName} at ${ts}`);
          }
        }
      }
    }

    // ── SOURCE 5: Character live presence fields (current state only — tells NOW) ──
    // Only used as last resort — shows where they ARE now, not full history
    if (summaryLines.length === 0 && character) {
      sourceUsed = 'character_presence';
      const presence = character.resolved_presence_status || '';
      const locName = character.resolved_current_location_name || '';
      const updatedAt = character.resolved_last_updated_at;

      if (presence === 'at_work' && (character.occupation_location_name || locName)) {
        const wl = character.occupation_location_name || locName;
        const wsTime = character.work_start_time ? ` (started around ${character.work_start_time})` : '';
        summaryLines.push(`- Currently at work: ${wl}${wsTime}`);
      } else if (presence === 'at_school' && (character.education_location_name || locName)) {
        summaryLines.push(`- Currently at school: ${character.education_location_name || locName}`);
      } else if ((presence === 'sleeping' || presence === 'napping') && character.last_sleep_start) {
        summaryLines.push(`- Sleeping at home since ${fmtTime(character.last_sleep_start)}`);
      } else if (locName && presence && presence !== 'home') {
        const timeStr = updatedAt ? ` since ${fmtTime(updatedAt)}` : '';
        summaryLines.push(`- Currently at ${locName}${timeStr}`);
      }
    }

    const hasHistory = summaryLines.length > 0;

    // Build the context block injected into character prompts
    let contextBlock = '';
    if (!hasHistory) {
      const isSleeping = ['sleeping', 'napping'].includes(character?.resolved_presence_status || '');
      if (isSleeping && character?.last_sleep_start) {
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No recorded movement. ${character.name || 'This character'} has been home, sleeping since ${fmtTime(character.last_sleep_start)}.`;
      } else {
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No location changes recorded. ${character?.name || 'This character'} appears to have stayed home today. Do NOT say "I slept all day" unless sleep records confirm this — simply say you were home.`;
      }
    } else {
      contextBlock = `LOCATION HISTORY (Last 24 Hours — oldest to newest):\n${summaryLines.join('\n')}\n\nCRITICAL: Use this history to answer questions like "what did you do today?", "where were you earlier?", "were you home all day?". Do NOT say you slept all day if this history shows movement. Reference actual locations and times naturally.`;
    }

    return Response.json({
      success: true,
      characterId,
      characterName: character?.name || null,
      has_history: hasHistory,
      history_count: recentHistory.length,
      source_used: sourceUsed,
      summary_lines: summaryLines,
      context_block: contextBlock,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});