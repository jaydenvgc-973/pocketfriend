import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Ethan with fresh query
    const chars = await base44.entities.Character.filter({ 
      created_by: user.email 
    });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));
    
    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Just read back his current state without updating anything yet
    const state = {
      id: ethan.id,
      name: ethan.name,
      hasCurrentLocationId: !!ethan.current_location_id,
      currentLocationId: ethan.current_location_id || null,
      hasOccupationId: !!ethan.occupation_location_id,
      occupationLocationId: ethan.occupation_location_id || null,
      currentActivity: ethan.current_activity || 'unset',
      hasSystemPrompt: !!ethan.system_prompt,
    };

    // The real issue: backfill set home location but NOT work location as current
    // Let's check if the earlier backfill accidentally set current_location_id to HOME instead of WORK
    const locations = await base44.entities.LocationReference.list();
    const homeLocation = locations.find(l => l.id === ethan.current_home_location_id);
    const workLocation = locations.find(l => l.id === ethan.occupation_location_id);

    // Now actually try the update with explicit field setting
    try {
      await base44.entities.Character.update(ethan.id, {
        current_location_id: ethan.occupation_location_id, // Force work location as current
        current_activity: 'working',
      });
    } catch (updateErr) {
      return Response.json({
        error: 'Update failed',
        updateError: updateErr.message,
        ethanState: state,
        homeLocation: homeLocation?.name,
        workLocation: workLocation?.name,
      }, { status: 500 });
    }

    // Re-fetch to confirm
    const refetch = await base44.entities.Character.filter({ id: ethan.id });
    const confirmed = refetch[0];

    return Response.json({
      ethanId: ethan.id,
      beforeState: state,
      afterState: {
        currentLocationId: confirmed.current_location_id,
        currentActivity: confirmed.current_activity,
        home: homeLocation?.name,
        work: workLocation?.name,
      },
      updateSucceeded: !!confirmed.current_location_id,
      status: confirmed.current_location_id ? 'FIXED' : 'STILL BROKEN',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});