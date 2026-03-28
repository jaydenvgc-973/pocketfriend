import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get or create user settings
    const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
    
    if (settings.length === 0) {
      // Create default settings with voice enabled
      const newSettings = await base44.entities.UserSettings.create({
        voice_enabled: true,
        openai_api_key: '',
        voice_minutes_used: 0,
      });
      return Response.json({ success: true, settings: newSettings });
    } else {
      // Enable voice if not already enabled
      const currentSettings = settings[0];
      if (!currentSettings.voice_enabled) {
        const updated = await base44.entities.UserSettings.update(currentSettings.id, {
          voice_enabled: true,
        });
        return Response.json({ success: true, settings: updated });
      }
      return Response.json({ success: true, settings: currentSettings });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});