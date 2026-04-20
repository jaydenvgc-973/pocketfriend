import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const targetEmail = 'murqart@gmail.com';

    // Get ALL locations
    const [userLocs, sharedLocs] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ created_by: targetEmail }),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    const allLocs = [...userLocs, ...sharedLocs];
    const searchTerms = ['Escalita', 'BGC', 'Medical', 'JoJo', 'Central'];

    const found = allLocs.filter(l =>
      searchTerms.some(term => l.name?.toLowerCase().includes(term.toLowerCase()))
    ).map(l => ({
      name: l.name,
      id: l.id,
      category: l.category,
      scope: l.scope,
      created_by: l.created_by,
    }));

    return Response.json({
      total_locations: allLocs.length,
      matching_locations: found,
      all_location_names: allLocs.map(l => l.name).sort(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});