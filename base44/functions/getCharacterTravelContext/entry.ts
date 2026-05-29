/**
 * getCharacterTravelContext
 *
 * Returns a compact last-24-hour travel/location summary for a character.
 * Used by buildCanonicalCharacterContext to inject "what did you do today" awareness.
 *
 * Falls back to deriving context from TravelSession, AutomaticNarrative,
 * and Character fields (schedule, presence) if no LocationHistory records exist.
 *
 * Payload:
 *   characterId   string — Character ID
 *   ownerEmail    string — Owner email for scoping
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { format } from 'npm:date-fns@3';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, ownerEmail } = await req.json();

    if (!characterId || !ownerEmail) {
      return Response.json({ error: 'characterId and ownerEmail required' }, { status: 400 });
    }

    const now = new Date();
    const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch data sources in parallel
    const [locationHistory, travelSessions, narratives, character] = await Promise.all([
      base44.asServiceRole.entities.LocationHistory.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-arrival_time', 30
      ).catch(() => []),
      base44.asServiceRole.entities.TravelSession.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-created_at', 10
      ).catch(() => []),
      base44.asServiceRole.entities.AutomaticNarrative.filter(
        { character_id: characterId, owner_email: ownerEmail },
        '-timestamp', 15
      ).catch(() => []),
      base44.asServiceRole.entities.Character.filter(
        { id: characterId }
      ).then(r => r[0]).catch(() => null),
    ]);

    // Filter to last 24 hours
    const recentHistory = locationHistory.filter(h => new Date(h.arrival_time) >= new Date(cutoff24h));
    const recentSessions = travelSessions.filter(s =>
      s.created_at && new Date(s.created_at) >= new Date(cutoff24h)
    );
    const recentNarratives = narratives.filter(n =>
      n.timestamp && new Date(n.timestamp) >= new Date(cutoff24h)
    );

    // Build compact summary lines
    const summaryLines = [];

    // From LocationHistory (most authoritative — explicit events)
    if (recentHistory.length > 0) {
      for (const h of recentHistory) {
        const arrTime = format(new Date(h.arrival_time), 'h:mm a');
        const depTime = h.departure_time ? format(new Date(h.departure_time), 'h:mm a') : null;
        const timeStr = depTime ? `${arrTime}–${depTime}` : `${arrTime} (still here)`;
        const reason = h.travel_reason || h.travel_source || '';
        const reasonStr = reason ? ` [${reason}]` : '';
        const label = getEventLabel(h.event_type);
        summaryLines.push(`- ${label} ${h.location_name} at ${timeStr}${reasonStr}`);
      }
    } else {
      // Fallback: derive from TravelSessions
      for (const s of recentSessions) {
        if (s.route_status === 'arrived' || s.route_status === 'in_transit') {
          const ts = s.estimated_departure_time ? format(new Date(s.estimated_departure_time), 'h:mm a') : 'earlier today';
          const reason = s.travel_reason || s.travel_source || '';
          summaryLines.push(`- Traveled to ${s.destination_location_name} (departed ${ts}${reason ? ', ' + reason : ''})`);
          if (s.route_status === 'arrived' && s.actual_arrival_time) {
            const arrTime = format(new Date(s.actual_arrival_time), 'h:mm a');
            summaryLines.push(`  Arrived at ${s.destination_location_name} at ${arrTime}`);
          }
        }
      }

      // Fallback: derive from narratives with location events
      const locationNarratives = recentNarratives.filter(n =>
        ['travel_arrival', 'travel_departure', 'work_start', 'work_end', 'school_start', 'school_end', 'location_change'].includes(n.event_type)
      );
      for (const n of locationNarratives) {
        const ts = format(new Date(n.timestamp), 'h:mm a');
        summaryLines.push(`- ${n.location_name || n.location_id || 'location'} at ${ts} (${n.event_type.replace('_', ' ')})`);
      }

      // Fallback: derive from character schedule/presence fields
      if (character) {
        const presence = character.resolved_presence_status || '';
        const locationName = character.resolved_current_location_name || '';
        if (presence === 'at_work' && character.occupation_location_name) {
          summaryLines.push(`- Currently at work: ${character.occupation_location_name}`);
          if (character.work_start_time) summaryLines.push(`  Work started around ${character.work_start_time}`);
        }
        if (presence === 'at_school' && character.education_location_name) {
          summaryLines.push(`- Currently at school: ${character.education_location_name}`);
        }
        if (presence === 'sleeping' || presence === 'napping') {
          summaryLines.push(`- Currently sleeping`);
          if (character.last_sleep_start) {
            summaryLines.push(`  Went to sleep at ${format(new Date(character.last_sleep_start), 'h:mm a')}`);
          }
        }
        if (locationName && presence !== 'sleeping' && presence !== 'at_work' && presence !== 'at_school') {
          summaryLines.push(`- Currently at: ${locationName}`);
        }
      }
    }

    // Check if character was home all day (no movement recorded)
    const wasHomeAllDay = summaryLines.length === 0;

    // Build the final context block
    let contextBlock = '';
    if (wasHomeAllDay) {
      const homeLocation = character?.resolved_current_location_name ||
        character?.current_home_location_id ? 'home' : 'home';
      const isSleeping = ['sleeping', 'napping'].includes(character?.resolved_presence_status || '');
      if (isSleeping) {
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No recorded movement. ${character?.name || 'This character'} has been home${character?.last_sleep_start ? ', currently sleeping (sleep began ' + format(new Date(character.last_sleep_start), 'h:mm a') + ')' : ''}.`;
      } else {
        contextBlock = `LOCATION HISTORY (Last 24 Hours): No location changes recorded. ${character?.name || 'This character'} appears to have stayed home today. Do not assume they slept all day unless sleep records confirm this.`;
      }
    } else {
      contextBlock = `LOCATION HISTORY (Last 24 Hours — most recent first):\n${summaryLines.join('\n')}\n\nIMPORTANT: Use this history to answer "what did you do today?" accurately. Do NOT say you slept all day if location history shows movement.`;
    }

    return Response.json({
      success: true,
      characterId,
      has_history: !wasHomeAllDay,
      history_count: recentHistory.length,
      summary_lines: summaryLines,
      context_block: contextBlock,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

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