/**
 * diagnosEthanZoneImages
 * Tests every zone image URL for Ethan's home location to verify CDN conversion and reachability.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: '69d03c56a5e65c211c8a6105' }, null, 1);
    const loc = locList?.[0];
    if (!loc) return Response.json({ error: 'Location not found' }, { status: 404 });

    const zones = loc.zones || [];
    const results = [];

    for (const zone of zones) {
      const zoneResult = { zone_name: zone.zone_name, images: [] };
      for (const rawUrl of (zone.image_urls || [])) {
        const cdnUrl = toPublicCDN(rawUrl);
        const passesAccessible = isAccessible(cdnUrl);
        let httpStatus = null;
        let reachable = false;
        try {
          const r = await fetch(cdnUrl, { method: 'HEAD' });
          httpStatus = r.status;
          reachable = r.ok;
        } catch(e) {
          httpStatus = `ERROR: ${e.message}`;
        }
        console.log(`[zone:${zone.zone_name}] rawUrl=${rawUrl}`);
        console.log(`[zone:${zone.zone_name}] cdnUrl=${cdnUrl}`);
        console.log(`[zone:${zone.zone_name}] passesAccessible=${passesAccessible} | http=${httpStatus}`);
        zoneResult.images.push({ rawUrl, cdnUrl, passesAccessible, httpStatus, reachable });
      }
      results.push(zoneResult);
    }

    return Response.json({ location: loc.name, zones: results });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
});