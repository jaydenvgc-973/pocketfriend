import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find Melody Jackson Perry
    const chars = await base44.entities.Character.filter({ 
      created_by: user.email,
      status: 'active'
    });
    
    const melody = chars.find(c => 
      c.name?.toLowerCase().includes('melody') || 
      c.full_name?.toLowerCase().includes('melody jackson') ||
      c.display_name?.toLowerCase().includes('melody')
    );

    if (!melody) {
      return Response.json({ error: 'Melody not found' }, { status: 404 });
    }

    // Melody should be at her home location, not marked as working at a boutique
    // Clear any erroneous work location assignments and reset to home
    const updates = {
      resolved_current_location_id: melody.current_home_location_id || null,
      resolved_presence_status: 'home',
      resolved_location_type: 'home',
      travel_status: 'not_traveling',
      traveling_to_location_id: null,
      // Clear any temp work location
      current_location_id: null,
    };

    await base44.entities.Character.update(melody.id, updates);

    return Response.json({ 
      success: true, 
      message: `Fixed Melody's location. Now at home: ${melody.current_home_location_id ? 'assigned home location' : 'no home yet'}`,
      melodyId: melody.id,
      melodyName: melody.name,
      newHome: melody.current_home_location_id,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});