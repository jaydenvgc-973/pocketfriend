/**
 * updateCharacterArrivalState
 *
 * Helper function for processTravelArrivals to update Character location state.
 * Called from processTravelArrivals (scheduled) to update a character's location
 * after arrival without hitting RLS permission denied.
 *
 * Strategy: Query as service role (allowed), then update only if owner_email matches.
 * This avoids the RLS check on write while maintaining ownership verification.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, owner_email, updates } = await req.json();

    if (!character_id || !owner_email || !updates) {
      return Response.json({ error: 'Missing character_id, owner_email, or updates' }, { status: 400 });
    }

    // Verify ownership: fetch character with owner_email in filter to bypass RLS read issue
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: owner_email }, null, 1
    ).catch(() => []);
    const char = charArr?.[0];

    if (!char) {
      return Response.json({ 
        success: false,
        error: `Character not found or ownership mismatch: ${character_id}/${owner_email}` 
      }, { status: 404 });
    }

    // Verify destination location exists
    const destLocArr = await base44.asServiceRole.entities.LocationReference.filter(
      { id: updates.resolved_current_location_id }, null, 1
    ).catch(() => []);
    if (!destLocArr?.[0]) {
      return Response.json({ 
        success: false,
        error: `Destination location not found: ${updates.resolved_current_location_id}` 
      }, { status: 400 });
    }

    // Update with verified ownership
    await base44.asServiceRole.entities.Character.update(character_id, updates);

    // READ BACK verification: confirm destination write persisted
    const verifyArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id }, null, 1
    ).catch(() => []);
    const verified = verifyArr?.[0];

    if (!verified || verified.resolved_current_location_id !== updates.resolved_current_location_id) {
      return Response.json({ 
        success: false,
        error: `Destination write verification failed: expected ${updates.resolved_current_location_id}, got ${verified?.resolved_current_location_id || 'null'}` 
      }, { status: 500 });
    }

    if (verified.travel_status !== 'not_traveling' || verified.traveling_to_location_id !== null) {
      return Response.json({ 
        success: false,
        error: `Travel flags not cleared: travel_status=${verified.travel_status}, traveling_to_id=${verified.traveling_to_location_id}` 
      }, { status: 500 });
    }

    console.log(`[updateCharacterArrivalState] ✅ Updated and verified ${char.name} destination: ${updates.resolved_current_location_name || updates.resolved_current_location_id}`);

    return Response.json({
      success: true,
      character_id,
      character_name: char.name,
      updated_fields: Object.keys(updates),
      verified: true,
    });

  } catch (error) {
    console.error('[updateCharacterArrivalState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});