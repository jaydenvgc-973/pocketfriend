import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melody = characters.find(c => c.name === 'Melody Jackson Perry');
    
    if (!melody) {
      return Response.json({ error: 'Melody not found' }, { status: 404 });
    }

    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const vgcGym = locations.find(l => l.name === 'VGC Gym');

    // Update using current_home_location_id (which DOES persist)
    await base44.entities.Character.update(melody.id, {
      current_home_location_id: vgcGym.id,
      current_activity: 'at VGC Gym'
    });

    // Verify
    const updated = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melodyVerify = updated.find(c => c.id === melody.id);

    return Response.json({
      success: melodyVerify.current_home_location_id === vgcGym.id,
      melodyId: melody.id,
      field: 'current_home_location_id',
      value: melodyVerify.current_home_location_id,
      vgcGymId: vgcGym.id,
      activity: melodyVerify.current_activity,
      message: melodyVerify.current_home_location_id === vgcGym.id ? 'Melody now at VGC Gym (home field)' : 'Still failed'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});