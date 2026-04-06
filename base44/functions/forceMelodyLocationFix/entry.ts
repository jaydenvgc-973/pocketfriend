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

    // Get locations
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const vgcGym = locations.find(l => l.name === 'VGC Gym');
    
    if (!vgcGym) {
      return Response.json({ error: 'VGC Gym not found' }, { status: 404 });
    }

    // BEFORE state
    const before = {
      id: melody.id,
      current_location_id: melody.current_location_id,
      current_activity: melody.current_activity
    };

    // UPDATE with all necessary fields
    await base44.entities.Character.update(melody.id, {
      current_location_id: vgcGym.id,
      current_activity: 'at VGC Gym'
    });

    // RE-FETCH immediately to verify
    const updated = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melodyAfter = updated.find(c => c.id === melody.id);

    const after = {
      id: melodyAfter.id,
      current_location_id: melodyAfter.current_location_id,
      current_activity: melodyAfter.current_activity
    };

    const success = melodyAfter.current_location_id === vgcGym.id && melodyAfter.current_activity === 'at VGC Gym';

    return Response.json({
      success,
      before,
      after,
      vgcGymId: vgcGym.id,
      verified: success,
      message: success ? 'Melody successfully updated and verified' : 'Update failed - location ID not persisting'
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});