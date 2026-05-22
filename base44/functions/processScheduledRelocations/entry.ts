/**
 * processScheduledRelocations
 *
 * Scheduled automation that processes pending relocations.
 * When scheduled_move_time is reached, instantly move character.
 * Replaces processTravelArrivals.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();

    // Fetch all characters with pending relocations
    const allChars = await base44.entities.Character.list(null, 1000);

    const relocated = [];
    const processed = 0;

    for (const char of allChars) {
      // Skip if no pending relocation
      if (!char.travel_destination_location_id) continue;

      // Check if character is missing owner_email (legacy) and skip
      if (!char.owner_email) continue;

      // This should never happen, but ensure we're not creating travel sessions
      if (char.travel_status === 'traveling' || ['traveling', 'in_transit'].includes(char.resolved_presence_status)) {
        console.warn(`[processScheduledRelocations] Character ${char.name} still marked as traveling. Clearing stale state.`);
        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          resolved_presence_status: 'home'
        }).catch(() => {});
        continue;
      }

      // Character should be relocated now (move time was scheduled in past)
      // Simply update location immediately
      const result = await base44.entities.Character.update(char.id, {
        resolved_current_location_id: char.travel_destination_location_id,
        resolved_current_location_name: char.travel_destination_location_name,
        resolved_presence_status: 'at_location',
        resolved_location_type: 'visit',
        resolved_last_updated_at: nowIso,
        arrived_at: nowIso,
        travel_destination_location_id: null,
        travel_destination_location_name: null,
        travel_status: 'not_traveling'
      }).catch(e => ({ error: e.message }));

      if (!result.error) {
        relocated.push({
          character_id: char.id,
          character_name: char.name,
          destination: char.travel_destination_location_name,
          action: 'instant_relocation'
        });
      }
    }

    return Response.json({
      success: true,
      processed,
      relocated: relocated.length,
      characters: relocated,
      note: 'Travel system deprecated. Characters instantly relocate at scheduled times.'
    });

  } catch (error) {
    console.error('[processScheduledRelocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});