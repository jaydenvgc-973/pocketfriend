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
      return Response.json({ error: 'Melody Jackson Perry not found' }, { status: 404 });
    }

    // Get all locations and find VGC Gym
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const vgcGym = locations.find(l => l.name === 'VGC Gym');
    
    if (!vgcGym) {
      return Response.json({ error: 'VGC Gym location not found' }, { status: 404 });
    }

    // Update Melody
    await base44.entities.Character.update(melody.id, {
      current_location_id: vgcGym.id,
      current_activity: 'at gym'
    });

    return Response.json({
      success: true,
      message: 'Melody updated to VGC Gym',
      melodyId: melody.id,
      vgcGymId: vgcGym.id,
      previousActivity: melody.current_activity,
      newActivity: 'at gym'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});