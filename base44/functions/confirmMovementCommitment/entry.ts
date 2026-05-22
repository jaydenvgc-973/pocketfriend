/**
 * confirmMovementCommitment
 *
 * Called when user confirms a movement commitment from the chat UI prompt.
 * Saves a pending relocation on the character.
 *
 * Input:
 * {
 *   character_id: string,
 *   destination_name: string,
 *   destination_id: string | null (can be looked up by name if not provided),
 *   scheduled_arrival_time: ISO string,
 *   conversation_id: string,
 *   message_id: string
 * }
 *
 * Output:
 * {
 *   success: boolean,
 *   scheduled_relocation_id: string,
 *   character_name: string,
 *   destination: string,
 *   eta_time: string,
 *   proof: {...}
 * }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, destination_name, destination_id, scheduled_arrival_time, conversation_id, message_id } = await req.json();
    
    if (!character_id || !destination_name || !scheduled_arrival_time) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Step 1: Get character and verify ownership
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: user.email },
      null,
      1
    );
    const character = chars?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found or not owned by user' }, { status: 404 });
    }

    // Step 2: Resolve destination location
    let destLocId = destination_id;
    let destLocation = null;

    if (!destLocId) {
      // Look up by name
      const locs = await base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: user.email },
        null,
        200
      );
      destLocation = locs.find(loc => loc.name?.toLowerCase() === destination_name.toLowerCase());
      if (!destLocation) {
        return Response.json({
          success: false,
          error: 'Destination location not found',
          destination_name
        });
      }
      destLocId = destLocation.id;
    } else {
      // Verify destination exists
      const locs = await base44.asServiceRole.entities.LocationReference.filter(
        { id: destLocId, owner_email: user.email },
        null,
        1
      );
      destLocation = locs?.[0];
      if (!destLocation) {
        return Response.json({ error: 'Destination location not found or not owned by user' }, { status: 404 });
      }
    }

    // Step 3: Save pending scheduled relocation on character
    const nowIso = new Date().toISOString();
    
    await base44.asServiceRole.entities.Character.update(character_id, {
      next_location_id: destLocId,
      next_location_name: destLocation.name,
      pending_scheduled_relocation_at: scheduled_arrival_time,
      pending_relocation_from: character.resolved_current_location_id,
      pending_relocation_from_name: character.resolved_current_location_name,
      pending_relocation_source: 'user_confirmed_commitment',
      pending_relocation_message_id: message_id,
      pending_relocation_confirmed_at: nowIso,
      resolved_last_updated_at: nowIso,
    });

    // Step 4: Record as memory
    await base44.asServiceRole.entities.CharacterMemory.create({
      character_id,
      memory_type: 'event',
      memory_text: `${character.name} committed to being at ${destLocation.name} at ${new Date(scheduled_arrival_time).toLocaleTimeString()}. User confirmed the scheduled move.`,
      memory_summary: `committed_relocation::${destLocation.name}`,
      importance_score: 7,
      permanence: 'short_term',
    }).catch(() => {});

    const etaTime = new Date(scheduled_arrival_time).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return Response.json({
      success: true,
      scheduled_relocation_id: `relocation_${Date.now()}`,
      character_name: character.name,
      destination: destLocation.name,
      destination_id: destLocId,
      eta_time: etaTime,
      scheduled_arrival_time,
      proof: {
        character: character.name,
        from_location: character.resolved_current_location_name || 'Home',
        to_location: destLocation.name,
        scheduled_for: etaTime,
        will_update_at: scheduled_arrival_time,
        user_confirmed: true,
        message: `Scheduled ${character.name} to arrive at ${destLocation.name} at ${etaTime}.`
      }
    });

  } catch (error) {
    console.error('[confirmMovementCommitment]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});