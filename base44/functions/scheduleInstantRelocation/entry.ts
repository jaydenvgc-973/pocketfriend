/**
 * scheduleInstantRelocation
 *
 * Replaces startCharacterTravel.
 * Creates a simple scheduled relocation that instantly moves character at scheduled time.
 * No slow travel sessions, no path simulation.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      character_id,
      destination_location_id,
      destination_location_name,
      scheduled_move_time, // ISO datetime
      location_reason,
      commitment_id
    } = await req.json();

    if (!character_id || !destination_location_id || !scheduled_move_time) {
      return Response.json(
        { error: 'character_id, destination_location_id, scheduled_move_time required' },
        { status: 400 }
      );
    }

    // Get character
    const char = await base44.entities.Character.filter(
      { id: character_id, owner_email: user.email },
      null,
      1
    ).then(r => r[0]);

    if (!char) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Store scheduled relocation on character (not as TravelSession)
    const moveTimeObj = new Date(scheduled_move_time);
    const now = new Date();
    const minutesUntilMove = (moveTimeObj - now) / 60000;

    // If move time is in the past or very soon, execute immediately
    if (minutesUntilMove < 1) {
      await base44.entities.Character.update(character_id, {
        resolved_current_location_id: destination_location_id,
        resolved_current_location_name: destination_location_name,
        resolved_location_type: location_reason || 'visit',
        resolved_presence_status: 'at_location',
        resolved_last_updated_at: now.toISOString(),
        arrived_at: now.toISOString(),
        travel_destination_location_id: null,
        travel_status: 'not_traveling'
      });

      return Response.json({
        success: true,
        action: 'instant_relocation',
        character_id,
        character_name: char.name,
        destination: destination_location_name,
        message: 'Character instantly relocated (scheduled time was immediate or past)'
      });
    }

    // Schedule for later: store pending relocation on character
    await base44.entities.Character.update(character_id, {
      travel_destination_location_id: destination_location_id,
      travel_destination_location_name: destination_location_name,
      resolved_last_updated_at: now.toISOString(),
      // Do NOT set travel_status to 'traveling' - they stay at current location until move time
      // travel_status should remain as-is (home, at_work, at_school, etc.)
    });

    return Response.json({
      success: true,
      action: 'scheduled_relocation',
      character_id,
      character_name: char.name,
      current_location: char.resolved_current_location_name,
      destination: destination_location_name,
      scheduled_move_time,
      minutes_until_move: Math.round(minutesUntilMove),
      commitment_id,
      message: 'Character scheduled to relocate. Will instantly move at scheduled time.'
    });

  } catch (error) {
    console.error('[scheduleInstantRelocation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});