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

    // Check ALL location-related fields on Melody
    const locationFields = {
      current_location_id: melody.current_location_id,
      current_home_location_id: melody.current_home_location_id,
      current_work_location_id: melody.current_work_location_id,
      current_school_location_id: melody.current_school_location_id,
      occupation_location_id: melody.occupation_location_id,
      education_location_id: melody.education_location_id
    };

    // Try updating ONLY current_location_id in isolation
    console.log('Attempting isolated location_id update...');
    await base44.entities.Character.update(melody.id, {
      current_location_id: vgcGym.id
    });

    // Re-fetch
    const refetched = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const melodyCheck = refetched.find(c => c.id === melody.id);

    return Response.json({
      melodyLocationFields: locationFields,
      vgcGymId: vgcGym.id,
      updateAttempt: 'isolated current_location_id only',
      afterUpdate: {
        current_location_id: melodyCheck.current_location_id,
        current_activity: melodyCheck.current_activity
      },
      persistenceSuccess: melodyCheck.current_location_id === vgcGym.id
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});