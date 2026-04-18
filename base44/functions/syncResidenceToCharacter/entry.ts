/**
 * syncResidenceToCharacter
 *
 * Called when a user assigns or removes a character as a resident on the Location Page.
 * Writes home assignment fields directly onto the character entity.
 *
 * This is the authoritative sync — location page is source of truth.
 * Writes: home_location_id, home_location_name, is_homeless
 * Does NOT modify jobs, schools, or any other system fields.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, locationId, locationName, action } = body;
    // action: "assign" | "remove"

    if (!characterId || !action) {
      return Response.json({ error: 'characterId and action are required' }, { status: 400 });
    }

    // CRITICAL: Verify character ownership
    const character = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    if (character[0].owner_email !== user.email) {
      return Response.json({ error: 'Unauthorized: character does not belong to current user' }, { status: 403 });
    }

    if (action === 'assign') {
      if (!locationId || !locationName) {
        return Response.json({ error: 'locationId and locationName required for assign' }, { status: 400 });
      }

      // CRITICAL: Verify location ownership
      const location = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId });
      if (!location || location.length === 0) {
        return Response.json({ error: 'Location not found' }, { status: 404 });
      }
      if (location[0].owner_email !== user.email) {
        return Response.json({ error: 'Unauthorized: location does not belong to current user' }, { status: 403 });
      }

      await base44.asServiceRole.entities.Character.update(characterId, {
        home_location_id: locationId,
        home_location_name: locationName,
        is_homeless: false,
        owner_email: user.email,
      });
      return Response.json({ success: true, action: 'assigned', characterId, locationId, locationName });
    }

    if (action === 'remove') {
      await base44.asServiceRole.entities.Character.update(characterId, {
        home_location_id: null,
        home_location_name: null,
        is_homeless: true,
      });
      return Response.json({ success: true, action: 'removed', characterId });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (error) {
    console.error('syncResidenceToCharacter error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});