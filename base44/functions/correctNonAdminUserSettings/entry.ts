import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admin can run this
    if (user.email !== 'murqart@gmail.com') {
      return Response.json({ error: 'Forbidden: Admin only' }, { status: 403 });
    }

    // Fetch all UserSettings
    const allSettings = await base44.asServiceRole.entities.UserSettings.list('-created_date', 1000);

    // Filter: exclude admin, include only non-onboarded
    const toCorrect = allSettings.filter(settings =>
      settings.created_by !== 'murqart@gmail.com' &&
      settings.has_completed_onboarding !== true
    );

    console.log(`Found ${toCorrect.length} non-admin, non-onboarded UserSettings to correct`);

    // Update each one
    let corrected = 0;
    for (const settings of toCorrect) {
      try {
        await base44.asServiceRole.entities.UserSettings.update(settings.id, {
          fictional_world_name: null,
          user_balance: 6000,
        });
        corrected++;
      } catch (err) {
        console.error(`Failed to correct UserSettings ${settings.id}:`, err.message);
      }
    }

    return Response.json({
      success: true,
      found: toCorrect.length,
      corrected,
      message: `Corrected ${corrected} UserSettings records`,
    });
  } catch (error) {
    console.error('[correctNonAdminUserSettings]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});