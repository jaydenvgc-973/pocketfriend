import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterName } = await req.json();

    if (!characterName) {
      return Response.json({ error: 'characterName required' }, { status: 400 });
    }

    // Find character by name for this user only
    const characters = await base44.entities.Character.filter(
      { name: characterName, created_by: user.email }
    );

    if (!characters || characters.length === 0) {
      return Response.json({ error: `Character "${characterName}" not found on your account` }, { status: 404 });
    }

    const character = characters[0];
    const characterId = character.id;

    // Get user settings
    const settings = await base44.entities.UserSettings.filter(
      { created_by: user.email }
    );

    if (!settings || settings.length === 0) {
      return Response.json({ error: 'User settings not found' }, { status: 404 });
    }

    const userSettings = settings[0];
    const protectedIds = userSettings.protected_character_ids || [];

    // Check if already protected
    if (protectedIds.includes(characterId)) {
      return Response.json({
        success: false,
        message: `${characterName} is already protected on your account`,
        characterId,
        protectedCharacters: protectedIds
      });
    }

    // Add to protected list
    const updatedProtectedIds = [...protectedIds, characterId];
    await base44.entities.UserSettings.update(userSettings.id, {
      protected_character_ids: updatedProtectedIds
    });

    return Response.json({
      success: true,
      message: `${characterName} (${characterId}) is now protected on your account`,
      characterId,
      protectedCharacters: updatedProtectedIds
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});