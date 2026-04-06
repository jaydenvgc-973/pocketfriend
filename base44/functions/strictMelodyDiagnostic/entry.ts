import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Melody FRESH from database
    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melody = characters.find(c => c.name === 'Melody Jackson Perry');
    
    if (!melody) {
      return Response.json({ error: 'Melody Jackson Perry not found' }, { status: 404 });
    }

    // Get locations FRESH
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const vgcGym = locations.find(l => l.name === 'VGC Gym');

    const report = {
      timestamp: new Date().toISOString(),
      melodyData: {
        id: melody.id,
        name: melody.name,
        current_location_id: melody.current_location_id,
        current_activity: melody.current_activity,
        character_type: melody.character_type,
        status: melody.status
      },
      vgcGymData: vgcGym ? {
        id: vgcGym.id,
        name: vgcGym.name,
        category: vgcGym.category
      } : null,
      locationMatch: melody.current_location_id === vgcGym?.id,
      activityMatch: melody.current_activity?.toLowerCase().includes('gym'),
      fullMatch: melody.current_location_id === vgcGym?.id && melody.current_activity?.toLowerCase().includes('gym'),
      allLocationIds: locations.map(l => ({ id: l.id, name: l.name, category: l.category }))
    };

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});