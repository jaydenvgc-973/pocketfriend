import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { locationId } = await req.json();
    
    // Get location and check operating hours
    const locations = await base44.entities.LocationReference.list();
    const targetLocation = locations.find(l => l.id === locationId);
    
    if (!targetLocation) {
      return Response.json({ error: 'Location not found' }, { status: 404 });
    }

    // Check if location is currently open
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const todayHours = targetLocation.operating_hours?.find(h => h.day_of_week === dayOfWeek);
    const isOpen = todayHours && currentTime >= todayHours.open_time && currentTime <= todayHours.close_time;

    if (!isOpen) {
      return Response.json({ 
        closed: true, 
        message: `${targetLocation.name} is currently closed`,
        locationName: targetLocation.name
      });
    }

    return Response.json({ closed: false });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});