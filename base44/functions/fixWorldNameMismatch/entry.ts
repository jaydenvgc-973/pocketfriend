import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch current user settings
    const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const userSettings = settings[0];

    if (!userSettings) {
      return Response.json({ error: 'No user settings found' }, { status: 404 });
    }

    const currentWorldName = userSettings.fictional_world_name;

    // Get the correct world name from the request body
    const body = await req.json().catch(() => ({}));
    const correctWorldName = body.correctWorldName || 'Jayden';

    if (currentWorldName === correctWorldName) {
      return Response.json({
        success: true,
        message: `World name is already correct: ${correctWorldName}`,
        currentWorldName,
        noChange: true
      });
    }

    // Update to the correct world name
    await base44.entities.UserSettings.update(userSettings.id, {
      fictional_world_name: correctWorldName
    });

    return Response.json({
      success: true,
      message: `Fixed world name mismatch`,
      oldWorldName: currentWorldName,
      newWorldName: correctWorldName,
      userEmail: user.email
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});