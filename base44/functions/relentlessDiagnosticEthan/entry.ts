import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = characters.find(c => c.name.toLowerCase().includes('ethan'));
    
    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    const issues = [];
    const fixes = [];

    // Issue 1: currentLocationId is null
    if (!ethan.current_location_id) {
      issues.push('CRITICAL: current_location_id is null');
      
      // Use work location as the primary location
      const updatePayload = { current_location_id: ethan.occupation_location_id };
      await base44.entities.Character.update(ethan.id, updatePayload);
      fixes.push(`Set current_location_id to ${ethan.occupation_location_id}`);
    }

    // Issue 2: current_activity is stale ("sleeping" when it's 14:40 and he should be at work)
    if (ethan.current_activity === 'sleeping') {
      issues.push('current_activity is stale (sleeping at 14:40 on work day)');
      await base44.entities.Character.update(ethan.id, {
        current_activity: 'at work',
      });
      fixes.push('Updated current_activity to "at work"');
    }

    // Issue 3: Check if character schema has location data properly saved
    const allChars = await base44.entities.Character.filter({ created_by: user.email });
    const ethanRefresh = allChars.find(c => c.id === ethan.id);

    return Response.json({
      timestamp: new Date().toISOString(),
      characterName: ethan.name,
      characterId: ethan.id,
      issues,
      fixes,
      beforeUpdate: {
        currentLocationId: ethan.current_location_id,
        currentActivity: ethan.current_activity,
        occupationLocationId: ethan.occupation_location_id,
      },
      afterUpdate: {
        currentLocationId: ethanRefresh?.current_location_id,
        currentActivity: ethanRefresh?.current_activity,
        occupationLocationId: ethanRefresh?.occupation_location_id,
      },
      dataConsistency: {
        locationsMatch: ethanRefresh?.current_location_id === ethan.occupation_location_id,
        activityUpdated: ethanRefresh?.current_activity === 'at work',
      },
      recommendation: ethanRefresh?.current_location_id ? 
        'Location data is now set correctly. Refresh the app to see changes.' :
        'WARNING: Location data did not persist. This indicates a deeper database issue.',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});