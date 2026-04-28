import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // Query for existing emergency shelter location by system_location_role
    const existing = await base44.entities.LocationReference.filter({
      owner_email: ownerEmail,
      is_system_managed: true,
      system_location_role: 'emergency_shelter',
    });

    // REUSE if found
    if (existing.length > 0) {
      if (existing.length > 1) {
        console.warn(
          `[getOrCreateEmergencyShelterLocation] Multiple emergency shelters found for ${ownerEmail} (data integrity issue). Using first match.`
        );
      }
      return Response.json({
        success: true,
        location_id: existing[0].id,
        location_name: existing[0].name,
        created: false,
        message: 'Reused existing emergency shelter location',
      });
    }

    // CREATE if not found
    const newShelter = await base44.entities.LocationReference.create({
      name: 'Emergency Shelter',
      location_type: 'global',
      category: 'generic',
      scope: 'account_global',
      owner_email: ownerEmail,
      visibility_scope: 'account_private',
      is_system_managed: true,
      system_location_role: 'emergency_shelter',
      is_default_generic: false,
      zones: [
        {
          zone_name: 'Main Area',
          image_urls: [],
        },
      ],
      description: 'System-created emergency shelter location for characters without funds',
    });

    return Response.json({
      success: true,
      location_id: newShelter.id,
      location_name: newShelter.name,
      created: true,
      message: 'Created new emergency shelter location',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});