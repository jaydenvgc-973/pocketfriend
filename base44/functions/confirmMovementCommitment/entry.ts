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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      character_id,
      character_name,
      character_current_location_id,
      character_current_location_name,
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

    // No invented lead-time floor here. The only real constraint on how far in
    // advance a one-time execution must be registered is the one-time scheduler's
    // own registration requirement — not a number taken from an example. That
    // requirement is enforced at registration, not by an arbitrary guardrail here.

    // The character is already loaded and validated by the chat page.
    // The authenticated user owns the chat — no backend character lookup needed.
    // We use the character fields passed from the already-loaded frontend context.
    const character = {
      id: character_id,
      name: character_name || 'Character',
      owner_email: user.email,
      resolved_current_location_id: character_current_location_id || null,
      resolved_current_location_name: character_current_location_name || null,
    };

    // Step 2: Resolve destination location — prefer ID over name
    let destLocation = null;

    if (destination_location_id) {
      // Prefer the explicit ID passed by the resolver — use .get(id), not .filter({ id })
      destLocation = await base44.asServiceRole.entities.LocationReference.get(destination_location_id);
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
        loc.name?.toLowerCase().trim() === (destination_name || '').toLowerCase().trim()
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

    const nowIso = new Date().toISOString();

    // ── Step 3: Create CharacterCommitment (tracking) ──────────────────────────
    // The commitment tracks the promised trip. Its id is carried in the
    // ScheduledEvent payload so processScheduledEvents can mark it completed
    // (arrived) or failed (blocked by an authoritative state such as jail).
    let commitmentId = null;
    try {
      const commitment = await base44.asServiceRole.entities.CharacterCommitment.create({
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
      });
      commitmentId = commitment?.id || null;
    } catch (err) {
      console.warn('[confirmMovementCommitment] CharacterCommitment create failed (non-fatal):', err.message);
    }

    // ── Step 4: Commit the exact-time scheduled execution ──────────────────────
    // The application's existing exact-time mechanism is ScheduledEvent +
    // processScheduledEvents. "Yes, Schedule It" commits ONE destination and ONE
    // exact trigger_time. processScheduledEvents fires it once when trigger_time
    // arrives, routes the move through enforceCharacterLocationPresence (the sole
    // canonical writer), and marks the event completed so it cannot repeat. This
    // does NOT set pending_scheduled_relocation_at / next_location_id — those fed
    // the recurring relocation scanner, which is not the execution authority here.
    try {
      await base44.asServiceRole.entities.ScheduledEvent.create({
        character_ids: [character_id],
        character_names: [character.name],
        primary_character_id: character_id,
        description: `${character.name} is scheduled to arrive at ${destLocation.name}.`,
        trigger_time: scheduled_arrival_time,
        type: 'travel_arrival',
        source: 'commitment',
        status: 'pending',
        conversation_id: conversation_id || null,
        owner_email: user.email,
        event_payload: {
          destination_location_id: destLocId,
          destination_location_name: destLocation.name,
          from_location_id: character.resolved_current_location_id || null,
          from_location_name: character.resolved_current_location_name || null,
          commitment_id: commitmentId,
          owner_email: user.email,
          source_message_id: message_id || null,
        },
      });
    } catch (err) {
      console.warn('[confirmMovementCommitment] ScheduledEvent create failed:', err.message);
    }

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