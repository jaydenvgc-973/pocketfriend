import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all locations
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 1000);
    
    // Filter for generic hospital, gym, and grocery
    const toDelete = allLocations.filter(loc => 
      loc.is_default_generic === true && 
      (loc.generic_type === 'hospital' || 
       loc.generic_type === 'gym' || 
       loc.generic_type === 'grocery' ||
       loc.category === 'gym' ||
       loc.category === 'medical' ||
       loc.category === 'grocery')
    );

    let deleted = 0;
    for (const loc of toDelete) {
      try {
        await base44.asServiceRole.entities.LocationReference.delete(loc.id);
        deleted++;
      } catch (err) {
        console.warn(`Failed to delete location ${loc.id}:`, err.message);
      }
    }

    return Response.json({ 
      success: true, 
      deleted_count: deleted,
      locations_deleted: toDelete.map(l => ({ id: l.id, name: l.name, category: l.category }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});