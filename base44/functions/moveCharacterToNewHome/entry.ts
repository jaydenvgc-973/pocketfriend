/**
 * moveCharacterToNewHome — REPAIRED
 *
 * Previously wrote Character.resolved_current_location_id + current_home_location_id
 * directly with zero LocationHistory proof, and LocationReference resident lists
 * with no rollback. Now: writes Character first, then calls writeVerifiedLocationHistory
 * to produce the authoritative proof record. If proof fails, Character is reverted
 * (compensating rollback). LocationReference resident-list updates are best-effort
 * secondary writes — if they fail, the Character revert still fires on proof failure.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, fromLocationId, toLocationId } = await req.json();
    if (!characterId || !toLocationId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const characters = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    const character = characters[0];
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    if (character.owner_email !== user.email) {
      return Response.json({ error: 'Character does not belong to your account' }, { status: 403 });
    }

    const locations = await base44.asServiceRole.entities.LocationReference.filter({
      id: { $in: [toLocationId, ...(fromLocationId ? [fromLocationId] : [])] }
    });
    const toLocation = locations.find(l => l.id === toLocationId);
    if (!toLocation) return Response.json({ error: 'Destination location not found' }, { status: 404 });

    const oldHomeId = fromLocationId || character.current_home_location_id;
    const oldLocation = oldHomeId ? locations.find(l => l.id === oldHomeId) : null;

    // Pre-write snapshot for rollback
    const preMoveSnapshot = {
      current_home_location_id: character.current_home_location_id,
      resolved_current_location_id: character.resolved_current_location_id,
      resolved_current_location_name: character.resolved_current_location_name,
    };

    // 1. Update character's home + resolved location
    await base44.asServiceRole.entities.Character.update(characterId, {
      current_home_location_id: toLocationId,
      resolved_current_location_id: toLocationId,
      resolved_current_location_name: toLocation.name,
      resolved_presence_status: 'home',
      resolved_location_type: 'home',
      resolved_source_reason: 'move_to_new_home',
      resolved_last_updated_at: new Date().toISOString(),
    });

    // 2. Remove from old location's resident list (best-effort secondary)
    if (oldLocation) {
      try {
        const oldResidents = (oldLocation.resident_character_ids || []).filter(id => id !== characterId);
        await base44.asServiceRole.entities.LocationReference.update(oldHomeId, {
          resident_character_ids: oldResidents,
        });
      } catch (secondaryErr) {
        console.warn(`[moveCharacterToNewHome] old resident-list update failed (non-fatal): ${secondaryErr.message}`);
      }
    }

    // 3. Add to new location's resident list (best-effort secondary)
    try {
      const newResidents = [...(toLocation.resident_character_ids || []), characterId];
      await base44.asServiceRole.entities.LocationReference.update(toLocationId, {
        resident_character_ids: newResidents,
      });
    } catch (secondaryErr) {
      console.warn(`[moveCharacterToNewHome] new resident-list update failed (non-fatal): ${secondaryErr.message}`);
    }

    // 4. PRODUCE VERIFIED LocationHistory PROOF — if this fails, revert Character
    try {
      const proofResult = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
        character_id: characterId,
        owner_email: character.owner_email,
        location_id: toLocationId,
        event_type: 'return_home',
        travel_source: 'manual',
        travel_reason: 'move_to_new_home',
      });
      if (!proofResult?.data?.success) {
        let revertError = null;
        try { await base44.asServiceRole.entities.Character.update(characterId, preMoveSnapshot); }
        catch (e) { revertError = e.message; }
        return Response.json({
          success: false,
          error: 'unverified_state_write',
          reason: `LocationHistory proof failed — Character state reverted. proof_error=${proofResult?.data?.error || 'unknown'}`,
          revert_error: revertError,
        }, { status: 500 });
      }
    } catch (proofError) {
      let revertError = null;
      try { await base44.asServiceRole.entities.Character.update(characterId, preMoveSnapshot); }
      catch (e) { revertError = e.message; }
      return Response.json({
        success: false,
        error: 'unverified_state_write',
        reason: `LocationHistory proof call threw — Character state reverted. proof_error=${proofError.message}`,
        revert_error: revertError,
      }, { status: 500 });
    }

    return Response.json({
      success: true,
      character: { id: characterId, name: character.name },
      fromLocation: oldLocation ? { id: oldHomeId, name: oldLocation.name } : null,
      toLocation: { id: toLocationId, name: toLocation.name },
      proof_written: true,
    });
  } catch (error) {
    console.error('[moveCharacterToNewHome]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});