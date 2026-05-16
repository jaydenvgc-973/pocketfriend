import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Search all locations for CGV Jail
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter({}, '-created_date', 500);
    
    const cgvJail = allLocs.find(l => l.name?.toLowerCase().includes('cgv') && l.name?.toLowerCase().includes('jail'));
    
    if (!cgvJail) {
      return Response.json({ found: false, message: 'CGV Jail not found', total_locations: allLocs.length });
    }

    return Response.json({
      found: true,
      record: {
        id: cgvJail.id,
        name: cgvJail.name,
        owner_email: cgvJail.owner_email,
        owner_user_id: cgvJail.owner_user_id,
        scope: cgvJail.scope,
        location_type: cgvJail.location_type,
        created_by: cgvJail.created_by,
        created_by_role: cgvJail.created_by_role,
        category: cgvJail.category,
      }
    });
  } catch (error) {
    console.error('[findCGVJailRecord]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});