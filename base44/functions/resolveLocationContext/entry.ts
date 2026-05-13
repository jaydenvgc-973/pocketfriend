/**
 * resolveLocationContext — Non-blocking location fetch with caching
 * 
 * Called by generateImageAsync with a timeout. If it fails/times out,
 * image generation continues with fallback context (prompt-provided or minimal).
 * 
 * Returns: { envRefs, locationName, zoneName } or null if unavailable
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// In-memory cache: { "loc_<email>": { envRefs, locationName, zoneName, timestamp } }
const LOCATION_CACHE = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      charRecord,           // Character entity record
      characterId,          // Character ID
      requestingUser,       // User email (for ownership check)
      prompt,              // Scene prompt (for zone matching)
    } = await req.json();

    if (!charRecord && !characterId) {
      return Response.json({ success: true, data: null }); // no character = no location
    }

    const cacheKey = `loc_${requestingUser}`;
    const cached = LOCATION_CACHE[cacheKey];

    // Return cached result if fresh
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log(`[resolveLocationContext] ✓ Cached result (${Math.round((Date.now() - cached.timestamp) / 1000)}s old)`);
      return Response.json({ success: true, data: cached.data });
    }

    let envRefs = [];
    let locationName = null;
    let zoneName = null;

    // Priority order for location ID
    const locationId =
      charRecord?.resolved_current_location_id ||
      charRecord?.current_home_location_id ||
      charRecord?.home_location_id ||
      charRecord?.current_work_location_id ||
      charRecord?.occupation_location_id ||
      null;

    if (locationId) {
      // Verify location belongs to this user
      let locRecord = null;
      const locListUser = await base44.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
      locRecord = locListUser?.[0] || null;

      if (!locRecord) {
        const locListSR = await base44.asServiceRole.entities.LocationReference.filter({ id: locationId }, null, 1).catch(() => []);
        const candidate = locListSR?.[0] || null;
        if (candidate) {
          const locOwner = candidate.owner_email;
          const isShared = candidate.scope === 'shared' || candidate.location_type === 'shared';
          if (locOwner && locOwner !== requestingUser && !isShared) {
            console.error(`[resolveLocationContext] ⛔ Cross-account location: ${locationId} owned by ${locOwner}`);
            locRecord = null;
          } else {
            locRecord = candidate;
          }
        }
      }

      if (locRecord) {
        const promptLower = (prompt || '').toLowerCase();
        
        // Import zone resolution logic (inlined to avoid Deno import issues)
        const ZONE_KEYWORD_MAP = [
          { keywords: ['bedroom', 'in bed', 'on the bed', 'sleeping', 'woke up', 'waking up', 'nightstand', 'duvet', 'pillow', 'mattress', 'my room', 'her room', 'his room'], zone: 'bedroom' },
          { keywords: ['kitchen', 'cooking', 'stove', 'fridge', 'oven', 'microwave', 'counter', 'pancake', 'breakfast', 'making food', 'grabbing food'], zone: 'kitchen' },
          { keywords: ['bathroom', 'shower', 'bathtub', 'toilet', 'vanity', 'brushing teeth', 'getting ready'], zone: 'bathroom' },
          { keywords: ['living room', 'couch', 'sofa', 'tv ', 'on the couch', 'lounge', 'sectional', 'watching tv', 'watching a movie'], zone: 'living room' },
          { keywords: ['gym', 'workout', 'weights', 'treadmill', 'lifting', 'training', 'exercise'], zone: 'gym' },
        ];

        function cdnFilterNoGenerated(urls) {
          return (urls || [])
            .map(url => {
              if (!url || typeof url !== 'string') return url;
              if (url.startsWith('https://media.base44.com/')) return url;
              const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
              if (match) return `https://media.base44.com/images/public/${match[1]}`;
              return url;
            })
            .filter(url => {
              if (!url || typeof url !== 'string') return false;
              if (!url.startsWith('https://')) return false;
              if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
              if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
              if (url.includes('base44.app/api/apps/')) return false;
              if (url.includes('generated_image')) return false;
              return true;
            });
        }

        const zones = (locRecord.zones || []).filter(z => cdnFilterNoGenerated(z.image_urls || []).length > 0);

        if (zones.length === 0) {
          const flat = cdnFilterNoGenerated(locRecord.image_urls || []).slice(0, 4);
          envRefs = flat;
        } else {
          // Exact zone name match
          for (const zone of zones) {
            if (zone.zone_name && promptLower.includes(zone.zone_name.toLowerCase())) {
              const imgs = cdnFilterNoGenerated(zone.image_urls).slice(0, 4);
              if (imgs.length > 0) {
                envRefs = imgs;
                zoneName = zone.zone_name;
                break;
              }
            }
          }

          // Keyword match
          if (envRefs.length === 0) {
            for (const entry of ZONE_KEYWORD_MAP) {
              if (entry.keywords.some(kw => promptLower.includes(kw))) {
                const matched = zones.find(z => z.zone_name && z.zone_name.toLowerCase().includes(entry.zone));
                if (matched) {
                  const imgs = cdnFilterNoGenerated(matched.image_urls).slice(0, 4);
                  if (imgs.length > 0) {
                    envRefs = imgs;
                    zoneName = matched.zone_name;
                    break;
                  }
                }
              }
            }
          }

          // Single zone fallback
          if (envRefs.length === 0 && zones.length === 1) {
            const imgs = cdnFilterNoGenerated(zones[0].image_urls).slice(0, 4);
            envRefs = imgs;
            zoneName = zones[0].zone_name;
          }

          // First zone with images
          if (envRefs.length === 0 && zones.length > 0) {
            const imgs = cdnFilterNoGenerated(zones[0].image_urls).slice(0, 4);
            envRefs = imgs;
            zoneName = zones[0].zone_name;
          }
        }

        locationName = locRecord.name;
        const result = { envRefs, locationName, zoneName };
        LOCATION_CACHE[cacheKey] = { data: result, timestamp: Date.now() };
        console.log(`[resolveLocationContext] ✓ Location "${locationName}" → zone "${zoneName || 'none'}" → ${envRefs.length} env refs`);
        return Response.json({ success: true, data: result });
      }
    } else {
      // Resident match scan
      const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: requestingUser }, '-created_date', 50).catch(() => []);
      const residentHome = savedLocs.find(l =>
        l.category === 'home' &&
        ((l.resident_character_ids || []).includes(characterId) ||
         (l.residents || []).some(r => r.character_id === characterId))
      );
      if (residentHome) {
        const promptLower = (prompt || '').toLowerCase();
        const result = { envRefs: [], locationName: residentHome.name, zoneName: null };
        LOCATION_CACHE[cacheKey] = { data: result, timestamp: Date.now() };
        console.log(`[resolveLocationContext] ✓ Resident match found "${residentHome.name}"`);
        return Response.json({ success: true, data: result });
      }
    }

    // No location found
    console.log(`[resolveLocationContext] ⚠️ No location context available`);
    return Response.json({ success: true, data: null });

  } catch (error) {
    console.warn(`[resolveLocationContext] LOCATION_CONTEXT_FALLBACK_USED: ${error.message}`);
    return Response.json({ success: true, data: null }); // non-blocking: return null, never fail
  }
});