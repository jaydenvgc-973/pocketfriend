import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Melody
    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melody = characters.find(c => c.name === 'Melody Jackson Perry');
    
    if (!melody) {
      return Response.json({ error: 'Melody not found' }, { status: 404 });
    }

    // Get all locations to find VGC Gym
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const vgcGym = locations.find(l => l.name && l.name.toLowerCase().includes('vgc'));
    
    if (!vgcGym) {
      return Response.json({ 
        error: 'VGC Gym location not found',
        melody: melody.name
      }, { status: 404 });
    }

    // Update Melody with BOTH current_location_id (for real-time tracking) AND current_activity
    await base44.entities.Character.update(melody.id, {
      current_location_id: vgcGym.id,
      current_activity: `at ${vgcGym.name}`,
      current_work_location_id: vgcGym.id,
      current_home_location_id: vgcGym.id
    });

    return Response.json({
      success: true,
      melody: {
        name: melody.name,
        previousActivity: melody.current_activity,
        newActivity: `at ${vgcGym.name}`,
        locationId: vgcGym.id,
        locationName: vgcGym.name,
        note: 'Set current_location_id for real-time tracking (priority over activity keyword)'
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});