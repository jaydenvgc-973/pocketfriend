import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find James Anderson
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const james = characters.find(c => c.name === 'James Anderson');
    
    if (!james) {
      return Response.json({ error: 'James Anderson not found' }, { status: 404 });
    }

    // Clear the current_activity field that's making him show as at the gym
    // This is stale data from before the closure logic
    await base44.entities.Character.update(james.id, {
      current_activity: null,
      current_location_id: james.current_home_location_id || null, // Move to home if no location set
    });

    return Response.json({ 
      success: true, 
      message: `Fixed James Anderson's location. Cleared stale activity data.`,
      characterId: james.id,
      charName: james.name
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});