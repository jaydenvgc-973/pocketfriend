/**
 * recordLocationHistoryEvent
 *
 * Writes a LocationHistory record whenever a character moves to/from a location.
 * Called from travel completion, school/work schedule enforcement, scene entry,
 * and any place that changes a character's resolved location.
 *
 * Also closes the previous open entry (sets departure_time, duration_minutes, is_current=false)
 * when the character leaves.
 *
 * Payload:
 *   characterId           string  — Character ID
 *   characterName         string  — Character display name
 *   ownerEmail            string  — Owner email for RLS
 *   locationId            string  — Destination location ID
 *   locationName          string  — Destination location name
 *   locationCategory      string  — e.g. "home", "work", "school", "gym", etc.
 *   eventType             string  — arrival|departure|return_home|work_start|work_end|school_start|school_end|religious_service|food_need|social_visit|gym_visit|transit|other
 *   travelSource          string  — schedule|autonomous|promise|commitment|need_fulfillment|manual|system|other
 *   travelReason          string  — human-readable reason
 *   arrivalTime           string  — ISO datetime (optional, defaults to now)
 *   previousLocationId    string  — previous location ID (to close open record)
 *   notes                 string  — optional context notes
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const {
      characterId,
      characterName,
      ownerEmail,
      locationId,
      locationName,
      locationCategory = 'other',
      eventType = 'arrival',
      travelSource = 'system',
      travelReason,
      arrivalTime,
      previousLocationId,
      notes,
    } = await req.json();

    if (!characterId || !ownerEmail || !locationId || !locationName) {
      return Response.json({ error: 'characterId, ownerEmail, locationId, locationName are required' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const effectiveArrivalTime = arrivalTime || now;

    // Step 1: Close any open LocationHistory record for this character
    // (i.e., records where is_current=true and character_id matches)
    const openRecords = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id: characterId, owner_email: ownerEmail, is_current: true },
      null, 10
    ).catch(() => []);

    for (const open of openRecords) {
      if (open.id === locationId) continue; // same location, skip
      const arrivalMs = new Date(open.arrival_time).getTime();
      const departureMs = new Date(effectiveArrivalTime).getTime();
      const durationMinutes = Math.round((departureMs - arrivalMs) / 60000);
      await base44.asServiceRole.entities.LocationHistory.update(open.id, {
        is_current: false,
        departure_time: effectiveArrivalTime,
        duration_minutes: durationMinutes > 0 ? durationMinutes : null,
      }).catch(() => {});
    }

    // Step 2: Write the new arrival record
    const record = await base44.asServiceRole.entities.LocationHistory.create({
      character_id: characterId,
      character_name: characterName || 'Unknown',
      owner_email: ownerEmail,
      location_id: locationId,
      location_name: locationName,
      location_category: locationCategory,
      event_type: eventType,
      arrival_time: effectiveArrivalTime,
      travel_source: travelSource,
      travel_reason: travelReason || null,
      is_current: true,
      notes: notes || null,
    });

    console.log(`[recordLocationHistoryEvent] Written | char=${characterName}(${characterId}) | loc=${locationName} | event=${eventType} | source=${travelSource}`);

    return Response.json({ success: true, record_id: record.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});