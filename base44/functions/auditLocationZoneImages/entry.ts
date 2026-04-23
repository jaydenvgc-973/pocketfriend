import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { locationId, zoneName } = await req.json();
    if (!locationId) return Response.json({ error: 'locationId required' }, { status: 400 });

    // Fetch the location directly
    const loc = await base44.asServiceRole.entities.LocationReference.get(locationId);
    if (!loc) {
      return Response.json({ error: 'Location not found', success: false }, { status: 404 });
    }

    console.log(`[AUDIT] Location: "${loc.name}" (${locationId})`);
    console.log(`[AUDIT] Total zones: ${loc.zones?.length || 0}`);
    console.log(`[AUDIT] Flat images: ${loc.image_urls?.length || 0}`);

    // List all zones and their images
    const zoneReport = (loc.zones || []).map((zone, idx) => {
      console.log(`[AUDIT] Zone[${idx}]: "${zone.zone_name}" | images=${zone.image_urls?.length || 0}`);
      (zone.image_urls || []).forEach((url, imgIdx) => {
        console.log(`[AUDIT]   Image[${imgIdx}]: ${url}`);
      });
      return {
        zone_name: zone.zone_name,
        image_count: zone.image_urls?.length || 0,
        images: zone.image_urls || []
      };
    });

    // If specific zone requested, extract it
    let specificZone = null;
    if (zoneName) {
      specificZone = (loc.zones || []).find(z => z.zone_name?.toLowerCase() === zoneName.toLowerCase());
      if (specificZone) {
        console.log(`[AUDIT] ✓ Zone FOUND: "${zoneName}"`);
        console.log(`[AUDIT] Images in "${zoneName}":`, specificZone.image_urls || []);
      } else {
        console.log(`[AUDIT] ✗ Zone NOT FOUND: "${zoneName}"`);
      }
    }

    return Response.json({
      success: true,
      location: {
        id: loc.id,
        name: loc.name,
        zone_count: loc.zones?.length || 0,
        flat_image_count: loc.image_urls?.length || 0
      },
      zones: zoneReport,
      specific_zone: specificZone ? {
        zone_name: specificZone.zone_name,
        images: specificZone.image_urls || []
      } : null
    });
  } catch (error) {
    console.error('[auditLocationZoneImages]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});