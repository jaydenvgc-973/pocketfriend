import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only for user's personal use — check if they have an "Ethan" character
    const ethanCharacters = await base44.entities.Character.filter(
      { name: 'Ethan', created_by: user.email },
      "-created_date",
      1
    );

    if (!ethanCharacters || ethanCharacters.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No Ethan character found for this user' 
      });
    }

    const ethanId = ethanCharacters[0].id;

    // Get or create user settings
    let userSettings = await base44.entities.UserSettings.filter(
      { created_by: user.email },
      "-created_date",
      1
    ).then(arr => arr?.[0]);

    if (!userSettings) {
      userSettings = await base44.entities.UserSettings.create({
        created_by: user.email,
        protected_character_ids: [ethanId]
      });
      return Response.json({ 
        success: true, 
        message: 'Ethan added to protection list (new settings created)',
        protected: true 
      });
    }

    // Add to existing settings if not already there
    const protected_ids = userSettings.protected_character_ids || [];
    if (!protected_ids.includes(ethanId)) {
      protected_ids.push(ethanId);
      await base44.entities.UserSettings.update(userSettings.id, {
        protected_character_ids: protected_ids
      });
    }

    return Response.json({ 
      success: true, 
      message: 'Ethan is now protected',
      protected: true 
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});