import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find Ethan character owned by this user
    const characters = await base44.entities.Character.filter(
      { created_by: user.email, name: 'Ethan' },
      "-created_date",
      1
    );

    if (!characters || characters.length === 0) {
      return Response.json({
        success: false,
        message: 'No character named Ethan found on your account'
      }, { status: 404 });
    }

    const ethanChar = characters[0];
    const ethanId = ethanChar.id;

    // Get or create user settings
    const userSettings = await base44.entities.UserSettings.filter(
      { created_by: user.email },
      "-created_date",
      1
    ).then(arr => arr?.[0]);

    const protectedIds = [...(userSettings?.protected_character_ids || [])];

    // Only add if not already protected
    if (!protectedIds.includes(ethanId)) {
      protectedIds.push(ethanId);

      if (userSettings?.id) {
        await base44.entities.UserSettings.update(userSettings.id, {
          protected_character_ids: protectedIds
        });
      } else {
        await base44.entities.UserSettings.create({
          protected_character_ids: protectedIds
        });
      }
    }

    return Response.json({
      success: true,
      message: `Ethan (${ethanId.substring(0, 8)}) is now protected on your account`,
      characterId: ethanId,
      protectedCount: protectedIds.length
    });

  } catch (error) {
    return Response.json({
      error: error.message,
      success: false
    }, { status: 500 });
  }
});