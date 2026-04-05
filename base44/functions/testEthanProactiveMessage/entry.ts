import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Read Ethan directly by ID instead of by filter
    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Read by exact ID match
    const ethanDirect = await base44.entities.Character.filter({ id: ethan.id });
    const ethanById = ethanDirect[0];

    // Log ALL fields to see what's actually stored
    const allFields = Object.keys(ethanById || {}).sort();
    const locationFields = allFields.filter(k => k.includes('location'));

    return Response.json({
      ethanId: ethan.id,
      name: ethanById.name,
      allLocationFields: locationFields,
      locationFieldValues: {
        current_location_id: ethanById.current_location_id,
        current_home_location_id: ethanById.current_home_location_id,
        occupation_location_id: ethanById.occupation_location_id,
        education_location_id: ethanById.education_location_id,
      },
      allFieldsCount: allFields.length,
      hasAnyLocationId: locationFields.some(f => !!ethanById[f]),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});