import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Grant or revoke a home key from a character to the user.
 * action: "grant" | "revoke"
 * characterId: the character giving the key
 * locationId: the home location (defaults to character's current_home_location_id)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, characterId, locationId } = await req.json();

    if (!action || !characterId) {
      return Response.json({ error: 'action and characterId required' }, { status: 400 });
    }

    // Get character
    const character = await base44.entities.Character.get(characterId);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Determine the location
    const targetLocationId = locationId || character.current_home_location_id;
    let locationName = null;
    if (targetLocationId) {
      const loc = await base44.entities.LocationReference.get(targetLocationId).catch(() => null);
      locationName = loc?.name || null;
    }

    // Get user settings
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email }, null, 1);
    const settings = settingsList[0];
    if (!settings) {
      return Response.json({ error: 'User settings not found' }, { status: 404 });
    }

    const currentKeys = settings.home_key_holders || [];

    if (action === 'grant') {
      // Add key if not already there
      const alreadyHasKey = currentKeys.some(k => k.character_id === characterId);
      if (alreadyHasKey) {
        return Response.json({ success: true, message: 'Key already granted', alreadyHadKey: true });
      }
      const newKey = {
        character_id: characterId,
        character_name: character.name,
        location_id: targetLocationId || null,
        location_name: locationName,
        granted_at: new Date().toISOString(),
      };
      await base44.entities.UserSettings.update(settings.id, {
        home_key_holders: [...currentKeys, newKey],
      });
      return Response.json({ success: true, message: `Key granted from ${character.name}` });
    }

    if (action === 'revoke') {
      const updated = currentKeys.filter(k => k.character_id !== characterId);
      await base44.entities.UserSettings.update(settings.id, {
        home_key_holders: updated,
      });
      return Response.json({ success: true, message: `Key revoked from ${character.name}` });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});