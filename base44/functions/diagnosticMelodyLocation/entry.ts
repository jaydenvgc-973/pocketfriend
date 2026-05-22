import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Melody — owner_email scope only (created_by is permanently forbidden)
    const characters = await base44.entities.Character.filter({ owner_email: user.email }, '-updated_date', 200);
    const melody = characters.find(c => c.name === 'Melody Jackson Perry');
    
    if (!melody) {
      return Response.json({ error: 'Melody not found' }, { status: 404 });
    }

    // Get all locations
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    
    // Find VGC Gym
    const vgcGym = locations.find(l => l.name && l.name.toLowerCase().includes('vgc'));
    
    // Check home location
    let homeLocObj = null;
    if (melody.current_home_location_id) {
      homeLocObj = locations.find(l => l.id === melody.current_home_location_id);
    }

    return Response.json({
      melody: {
        id: melody.id,
        name: melody.name,
        status: melody.status,
        character_type: melody.character_type,
        current_activity: melody.current_activity,
        current_home_location_id: melody.current_home_location_id,
        current_work_location_id: melody.current_work_location_id,
        daily_micro_narration: melody.daily_micro_narration
      },
      homeLocation: homeLocObj ? { id: homeLocObj.id, name: homeLocObj.name } : null,
      vgcGym: vgcGym ? { id: vgcGym.id, name: vgcGym.name } : null,
      totalLocations: locations.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});