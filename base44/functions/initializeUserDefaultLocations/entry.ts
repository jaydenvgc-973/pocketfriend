import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_LOCATIONS = [
  { name: "VGC Gym", category: "gym" },
  { name: "VGC Towers", category: "home" },
  { name: "VGC Medical Center", category: "medical" },
  { name: "The Velvet Bean Cafe", category: "food_drink" },
  { name: "Carter Grocery Store", category: "grocery" },
  { name: "VGC Realty", category: "business" },
  { name: "Estrellas Boutique", category: "business" },
  { name: "Bar", category: "social" },
  { name: "Club", category: "social" },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only for non-admin users
    if (user.role === 'admin') {
      return Response.json({ message: 'Admin users skip default location creation' });
    }

    // Check if locations already exist for this user
    const existing = await base44.entities.LocationReference.filter(
      { created_by: user.email },
      "-created_date",
      1
    );

    if (existing && existing.length > 0) {
      return Response.json({ message: 'User already has locations' });
    }

    // Create default locations with empty employee/resident lists
    const created = [];
    for (const loc of DEFAULT_LOCATIONS) {
      const newLoc = await base44.entities.LocationReference.create({
        name: loc.name,
        category: loc.category,
        location_type: "global",
        worker_character_ids: [],
        resident_character_ids: [],
        resident_family_members: [],
        resident_cost_split: {},
      });
      created.push(newLoc);
    }

    return Response.json({
      success: true,
      created_count: created.length,
      locations: created.map(l => ({ id: l.id, name: l.name })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});