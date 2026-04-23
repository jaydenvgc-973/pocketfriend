import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 });

    const { locationId } = await req.json();

    const loc = await base44.asServiceRole.entities.LocationReference.get(locationId);
    if (!loc) return Response.json({ error: 'Location not found' }, { status: 404 });

    // Find the BLUE MODERN COUCH image in Office zone
    const officeZone = loc.zones?.find(z => z.zone_name === 'Office');
    const livingRoomZone = loc.zones?.find(z => z.zone_name === 'Living Room');

    if (!officeZone || !livingRoomZone) {
      return Response.json({ error: 'Zones not found' }, { status: 400 });
    }

    // The blue couch images in Office are likely: 1000024942.png or 1000024944.png
    // We need to move one of these to Living Room
    const blueImageFromOffice = officeZone.image_urls?.find(img =>
      img.includes('1000024941') || img.includes('1000024944')
    );

    if (!blueImageFromOffice) {
      return Response.json({ error: 'Blue couch image not found in Office' }, { status: 400 });
    }

    // Replace Living Room image with the blue couch image
    const updatedZones = loc.zones.map(zone => {
      if (zone.zone_name === 'Living Room') {
        return {
          ...zone,
          image_urls: [blueImageFromOffice]
        };
      }
      if (zone.zone_name === 'Office') {
        // Remove the blue couch image from Office
        return {
          ...zone,
          image_urls: zone.image_urls?.filter(img => img !== blueImageFromOffice) || []
        };
      }
      return zone;
    });

    await base44.asServiceRole.entities.LocationReference.update(locationId, {
      zones: updatedZones
    });

    console.log(`[SWAP] ✓ Swapped images: Living Room now has blue couch from Office`);

    return Response.json({
      success: true,
      movedImage: blueImageFromOffice,
      toZone: 'Living Room',
      fromZone: 'Office'
    });
  } catch (error) {
    console.error('[swapZoneImages]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});