import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;

    // Query for existing temporary hotel location by system_location_role
    const existing = await base44.entities.LocationReference.filter({
      owner_email: ownerEmail,
      is_system_managed: true,
      system_location_role: 'temporary_hotel',
    });

    // REUSE if found
    if (existing.length > 0) {
      if (existing.length > 1) {
        console.warn(
          `[getOrCreateTemporaryHotelLocation] Multiple temp hotels found for ${ownerEmail} (data integrity issue). Using first match.`
        );
      }
      return Response.json({
        success: true,
        location_id: existing[0].id,
        location_name: existing[0].name,
        created: false,
        message: 'Reused existing temporary hotel location',
      });
    }

    // CREATE if not found
    const newHotel = await base44.entities.LocationReference.create({
      name: 'Temporary Hotel',
      location_type: 'global',
      category: 'generic',
      scope: 'account_global',
      owner_email: ownerEmail,
      visibility_scope: 'account_private',
      is_system_managed: true,
      system_location_role: 'temporary_hotel',
      is_default_generic: false,
      zones: [
        {
          zone_name: 'Main Area',
          image_urls: [],
        },
      ],
      description: 'System-created temporary housing location for emergency hotel stays',
    });

    return Response.json({
      success: true,
      location_id: newHotel.id,
      location_name: newHotel.name,
      created: true,
      message: 'Created new temporary hotel location',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});