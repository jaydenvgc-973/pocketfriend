import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Helper: check if a URL is truly private/inaccessible to the generation provider.
// /files/mp/public/ paths in base44.app ARE publicly accessible — do NOT flag them.
// Only private storage and signed/expiring URLs are truly inaccessible.
function isPrivateURL(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.includes('/files/mp/private/')) return true;
  if (url.includes('/files/private/')) return true;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return true;
  return false;
}

// Helper: fetch a private file and re-upload to get a stable public CDN URL.
// Only call this for URLs where isPrivateURL() returned true.
async function convertPrivateURLToPublic(privateURL, base44) {
  if (!isPrivateURL(privateURL)) {
    console.log(`[repairPrivateURLs] URL is already public — no conversion needed: ${privateURL?.substring(0, 60)}`);
    return null; // no conversion needed
  }

  try {
    console.log(`[repairPrivateURLs] Fetching private URL: ${privateURL.substring(0, 80)}...`);
    const response = await fetch(privateURL);
    if (!response.ok) {
      console.error(`[repairPrivateURLs] ✗ Fetch failed (${response.status}): ${privateURL.substring(0, 60)}`);
      return null;
    }

    const blob = await response.blob();
    console.log(`[repairPrivateURLs] Blob size: ${blob.size} bytes`);

    // Re-upload via Core.UploadFile to get public CDN URL
    const uploadRes = await base44.asServiceRole.integrations.Core.UploadFile({ file: blob });
    if (!uploadRes?.file_url) {
      console.error(`[repairPrivateURLs] ✗ UploadFile returned no URL`);
      return null;
    }

    console.log(`[repairPrivateURLs] ✓ Converted to public CDN: ${uploadRes.file_url.substring(0, 80)}...`);
    return uploadRes.file_url;
  } catch (err) {
    console.error(`[repairPrivateURLs] ✗ Conversion failed: ${err.message}`);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, locationId } = await req.json();
    if (!characterId && !locationId) {
      return Response.json({ error: 'characterId or locationId required' }, { status: 400 });
    }

    const repaired = { characters: [], locations: [] };

    // ── REPAIR CHARACTER REFS ────────────────────────────────────────────
    if (characterId) {
      let char = null;
      try {
        char = await base44.asServiceRole.entities.Character.get(characterId);
      } catch (_) {
        const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
        char = charList?.[0] || null;
      }

      if (char && char.reference_image_urls?.length > 0) {
        console.log(`[repairPrivateURLs] Character: ${char.name} | refs=${char.reference_image_urls.length}`);

        const updated = [];
        for (const ref of char.reference_image_urls) {
          if (isPrivateURL(ref)) {
            const publicURL = await convertPrivateURLToPublic(ref, base44);
            updated.push(publicURL || ref); // keep original if conversion failed
            if (publicURL) repaired.characters.push({ old: ref.substring(0, 60), new: publicURL.substring(0, 60) });
          } else {
            updated.push(ref); // already public
          }
        }

        // Update character with new public refs
        await base44.asServiceRole.entities.Character.update(characterId, { reference_image_urls: updated });
        console.log(`[repairPrivateURLs] Character refs updated: ${repaired.characters.length} converted`);
      }
    }

    // ── REPAIR LOCATION/ZONE REFS ────────────────────────────────────────
    if (locationId) {
      let loc = null;
      try {
        loc = await base44.asServiceRole.entities.LocationReference.get(locationId);
      } catch (_) {
        const locList = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1);
        loc = locList?.[0] || null;
      }

      if (loc) {
        console.log(`[repairPrivateURLs] Location: ${loc.name} | zones=${loc.zones?.length || 0}`);

        // Repair flat image_urls
        if (loc.image_urls?.length > 0) {
          const updatedFlat = [];
          for (const url of loc.image_urls) {
            if (isPrivateURL(url)) {
              const publicURL = await convertPrivateURLToPublic(url, base44);
              updatedFlat.push(publicURL || url);
              if (publicURL) repaired.locations.push({ type: 'flat', old: url.substring(0, 60), new: publicURL.substring(0, 60) });
            } else {
              updatedFlat.push(url);
            }
          }
          loc.image_urls = updatedFlat;
        }

        // Repair zone images
        if (loc.zones?.length > 0) {
          for (const zone of loc.zones) {
            if (zone.image_urls?.length > 0) {
              const updatedZone = [];
              for (const url of zone.image_urls) {
                if (isPrivateURL(url)) {
                  const publicURL = await convertPrivateURLToPublic(url, base44);
                  updatedZone.push(publicURL || url);
                  if (publicURL) {
                    repaired.locations.push({
                      type: `zone:${zone.zone_name}`,
                      old: url.substring(0, 60),
                      new: publicURL.substring(0, 60)
                    });
                  }
                } else {
                  updatedZone.push(url);
                }
              }
              zone.image_urls = updatedZone;
            }
          }
        }

        // Update location
        await base44.asServiceRole.entities.LocationReference.update(locationId, {
          image_urls: loc.image_urls,
          zones: loc.zones
        });
        console.log(`[repairPrivateURLs] Location refs updated: ${repaired.locations.length} converted`);
      }
    }

    console.log(`[repairPrivateURLs] ✓ REPAIR COMPLETE | character_refs=${repaired.characters.length} | location_refs=${repaired.locations.length}`);
    return Response.json({
      success: true,
      repaired
    });
  } catch (error) {
    console.error('[repairPrivateURLs] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});