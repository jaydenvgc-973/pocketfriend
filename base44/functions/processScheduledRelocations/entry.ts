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
      if (!char.owner_email) continue;

      // PRIORITY 1: User-confirmed movement commitment (via chat confirmation)
      if (char.pending_scheduled_relocation_at && char.next_location_id) {
        const scheduledTime = new Date(char.pending_scheduled_relocation_at);
        if (now >= scheduledTime) {
          const fromLocation = char.resolved_current_location_name || 'Home';
          const toLocation = char.next_location_name || 'Destination';

          await base44.entities.Character.update(char.id, {
            resolved_current_location_id: char.next_location_id,
            resolved_current_location_name: toLocation,
            resolved_presence_status: 'at_location',
            resolved_location_type: 'visit',
            resolved_source_reason: 'scheduled_user_confirmed_relocation',
            resolved_last_updated_at: nowIso,
            arrived_at: nowIso,
            // Clear all pending relocation fields
            pending_scheduled_relocation_at: null,
            pending_relocation_from: null,
            pending_relocation_from_name: null,
            pending_relocation_source: null,
            pending_relocation_message_id: null,
            pending_relocation_confirmed_at: null,
            next_location_id: null,
            next_location_name: null,
            travel_status: 'not_traveling',
            travel_destination_location_id: null,
            travel_destination_location_name: null,
            traveling_to_location_id: null,
            traveling_to_location_name: null,
          }).catch(() => {});

          relocated.push({
            character_name: char.name,
            from: fromLocation,
            to: toLocation,
            reason: 'user_confirmed_commitment'
          });
          continue;
        }
      }

      // PRIORITY 2: Legacy travel_destination (fallback)
      if (!char.travel_destination_location_id) continue;

      // Clear stale traveling states
      if (char.travel_status === 'traveling' || ['traveling', 'in_transit'].includes(char.resolved_presence_status)) {
        console.warn(`[processScheduledRelocations] Character ${char.name} still marked as traveling. Clearing stale state.`);
        await base44.entities.Character.update(char.id, {
          travel_status: 'not_traveling',
          resolved_presence_status: 'home'
        }).catch(() => {});
        continue;
      }

      // Instant relocation at scheduled time
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
          reason: 'legacy_travel_fallback'
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