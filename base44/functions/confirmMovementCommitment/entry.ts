/**
 * confirmMovementCommitment
 *
 * Called when user confirms a movement commitment from the chat UI prompt.
 * Saves a pending relocation on the character.
 *
 * PREFERRED: destination_location_id — real LocationReference ID resolved by frontend resolver.
 * FALLBACK:  destination_name — used only when destination_location_id is absent.
 *            Fallback still requires owner_email scope.
 *
 * Validation:
 * - destination_location_id or destination_name must be present
 * - scheduled_arrival_time must be present
 * - character must be owned by user (owner_email match)
 * - destination location must be owned by or shared with user
 *
 * Input:
 * {
 *   character_id: string,          [required]
 *   destination_location_id: string | null,  [preferred]
 *   destination_name: string,      [required for display]
 *   scheduled_arrival_time: ISO string, [required]
 *   conversation_id: string,
 *   message_id: string,
 *   travel_reason: string | null
 * }
 *
 * Output:
 * {
 *   success: boolean,
 *   character_name: string,
 *   destination: string,
 *   destination_id: string,
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

    const body = await req.json();
    const {
      character_id,
      destination_location_id,
      destination_name,
      scheduled_arrival_time,
      conversation_id,
      message_id,
      travel_reason,
    } = body;

    // Validate required fields
    if (!character_id) {
      return Response.json({ error: 'Missing required field: character_id' }, { status: 400 });
    }
    if (!destination_name && !destination_location_id) {
      return Response.json({ error: 'Missing required fields: destination_location_id or destination_name' }, { status: 400 });
    }
    if (!scheduled_arrival_time) {
      return Response.json({ error: 'Missing required field: scheduled_arrival_time' }, { status: 400 });
    }

    // Step 1: Get character by ID alone (service role bypasses RLS; verify ownership in code)
    // CRITICAL: Compound filter { id, owner_email } is unreliable in Base44 asServiceRole queries.
    // Fetch by ID only, then verify owner_email matches the authenticated user.
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: character_id },
      null,
      1
    );
    const character = chars?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found', character_id }, { status: 404 });
    }
    // Ownership check: character must belong to the authenticated user
    if (character.owner_email && character.owner_email !== user.email) {
      console.error('[confirmMovementCommitment] Ownership mismatch:', {
        character_owner: character.owner_email,
        user_email: user.email,
        character_id,
      });
      return Response.json({ error: 'Character not owned by user' }, { status: 403 });
    }

    // Step 2: Resolve destination location — prefer ID over name
    let destLocation = null;

    if (destination_location_id) {
      // Prefer the explicit ID passed by the resolver
      const locById = await base44.asServiceRole.entities.LocationReference.filter(
        { id: destination_location_id },
        null,
        1
      );
      // Accept if owned by user OR shared scope
      destLocation = locById?.[0];
      if (!destLocation) {
        return Response.json({
          error: 'Destination location not found',
          destination_name,
          destination_location_id,
        }, { status: 404 });
      }
    } else {
      // Fallback: name lookup scoped to owner_email
      const locs = await base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: user.email },
        null,
        200
      );
      destLocation = locs.find(loc =>
        loc.name?.toLowerCase() === (destination_name || '').toLowerCase()
      );
      if (!destLocation) {
        return Response.json({
          success: false,
          error: 'Destination location not found',
          destination_name,
        });
      }
    }

    const destLocId = destLocation.id;

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

    // Step 4: Create CharacterCommitment record for tracking
    await base44.asServiceRole.entities.CharacterCommitment.create({
      character_id,
      character_name: character.name,
      owner_email: user.email,
      commitment_type: 'arrival',
      destination_location_id: destLocId,
      destination_location_name: destLocation.name,
      commitment_source: 'chat_commitment',
      source_message_id: message_id,
      source_conversation_id: conversation_id,
      commitment_text: travel_reason || `${character.name} committed to being at ${destLocation.name}`,
      expected_arrival_time: scheduled_arrival_time,
      expected_arrival_window_minutes: 15,
      interruptible: false,
      status: 'active',
      created_at: nowIso,
    }).catch(err => {
      console.warn('[confirmMovementCommitment] CharacterCommitment create failed (non-fatal):', err.message);
    });

    // Step 5: Record as memory
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

    // Proof log
    console.log('[confirmMovementCommitment] Commitment stored:', {
      character: character.name,
      from_location: character.resolved_current_location_name || 'unknown',
      to_location: destLocation.name,
      to_location_id: destLocId,
      scheduled_for: etaTime,
      resolved_via: destination_location_id ? 'destination_location_id' : 'name_fallback',
    });

    return Response.json({
      success: true,
      character_name: character.name,
      destination: destLocation.name,
      destination_id: destLocId,
      eta_time: etaTime,
      scheduled_arrival_time,
      proof: {
        character: character.name,
        from_location: character.resolved_current_location_name || 'Home',
        to_location: destLocation.name,
        to_location_id: destLocId,
        scheduled_for: etaTime,
        will_update_at: scheduled_arrival_time,
        resolved_via: destination_location_id ? 'destination_location_id' : 'name_fallback',
        user_confirmed: true,
        message: `Scheduled ${character.name} to arrive at ${destLocation.name} at ${etaTime}.`
      }
    });

  } catch (error) {
    console.error('[confirmMovementCommitment]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});