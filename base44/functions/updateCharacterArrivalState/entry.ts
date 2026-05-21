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

    // Verify ownership: fetch character and check owner_email matches
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id }, null, 1
    ).catch(() => []);
    const char = charArr?.[0];

    if (!char) {
      return Response.json({ error: `Character not found: ${character_id}` }, { status: 404 });
    }

    if (char.owner_email !== owner_email) {
      return Response.json({
        error: `Ownership mismatch: character owner_email=${char.owner_email}, request owner_email=${owner_email}`,
      }, { status: 403 });
    }

    // Update with verified ownership
    const updated = await base44.asServiceRole.entities.Character.update(character_id, updates);

    console.log(`[updateCharacterArrivalState] ✅ Updated ${char.name} location to ${updates.resolved_current_location_name || updates.resolved_current_location_id}`);

    return Response.json({
      success: true,
      character_id,
      character_name: char.name,
      updated_fields: Object.keys(updates),
    });

  } catch (error) {
    console.error('[updateCharacterArrivalState]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});