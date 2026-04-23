import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch Ethan Thompson character — search by name fragment since exact match may not work
    const allChars = await base44.asServiceRole.entities.Character.filter({}, '-created_date', 500);
    const ethan = allChars.find(c => c.name && c.name.toLowerCase().includes('ethan'));
    if (!ethan) {
      console.log(`[AUDIT] No character with 'ethan' in name found. Total characters: ${allChars.length}`);
      console.log(`[AUDIT] First 10 character names: ${allChars.slice(0, 10).map(c => c.name).join(', ')}`);
      return Response.json({ error: 'Ethan Thompson character not found', total_characters: allChars.length }, { status: 404 });
    }

    console.log(`[AUDIT] Found Ethan Thompson: id=${ethan.id}`);
    console.log(`[AUDIT] resolved_current_location_id="${ethan.resolved_current_location_id || 'null'}"`);
    console.log(`[AUDIT] current_home_location_id="${ethan.current_home_location_id || 'null'}"`);
    console.log(`[AUDIT] home_location_id="${ethan.home_location_id || 'null'}"`);

    // Resolve home location
    let homeLocId = ethan.resolved_current_location_id || ethan.current_home_location_id || ethan.home_location_id;
    if (!homeLocId) {
      return Response.json({ error: 'Ethan Thompson has no home location assigned' }, { status: 404 });
    }

    // Fetch location
    let homeLoc = await base44.asServiceRole.entities.LocationReference.get(homeLocId).catch(() => null);
    if (!homeLoc) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: homeLocId }, null, 1);
      homeLoc = locList?.[0];
    }

    if (!homeLoc) {
      return Response.json({ error: `Location ${homeLocId} not found` }, { status: 404 });
    }

    console.log(`[AUDIT] ═══ HOME LOCATION AUDIT ═══`);
    console.log(`[AUDIT] name="${homeLoc.name}" | id=${homeLoc.id}`);
    console.log(`[AUDIT] flat image_urls count: ${(homeLoc.image_urls || []).length}`);
    console.log(`[AUDIT] zones count: ${(homeLoc.zones || []).length}`);

    // Log all flat images
    if (homeLoc.image_urls?.length > 0) {
      console.log(`[AUDIT] ─── FLAT IMAGE_URLS ───`);
      homeLoc.image_urls.forEach((url, i) => {
        console.log(`[AUDIT]   [${i}] ${url}`);
      });
    }

    // Log all zones and their images
    if (homeLoc.zones?.length > 0) {
      console.log(`[AUDIT] ─── ZONES ───`);
      homeLoc.zones.forEach((zone, zi) => {
        console.log(`[AUDIT] Zone[${zi}]: name="${zone.zone_name}" | image_urls count=${zone.image_urls?.length || 0}`);
        if (zone.image_urls?.length > 0) {
          zone.image_urls.forEach((url, ui) => {
            console.log(`[AUDIT]   Image[${ui}]: ${url}`);
          });
        }
      });
    }

    return Response.json({
      success: true,
      location_name: homeLoc.name,
      location_id: homeLoc.id,
      flat_image_urls_count: (homeLoc.image_urls || []).length,
      zones_count: (homeLoc.zones || []).length,
      zones: (homeLoc.zones || []).map(z => ({
        name: z.zone_name,
        image_count: z.image_urls?.length || 0,
        images: z.image_urls || []
      })),
      flat_images: homeLoc.image_urls || [],
    });
  } catch (error) {
    console.error('[auditEthanThompsonHome]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});