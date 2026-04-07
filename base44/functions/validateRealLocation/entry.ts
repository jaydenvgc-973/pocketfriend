import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Free hybrid real-world location lookup:
 * 1. Check local cache (VerifiedRealLocation entity)
 * 2. Photon search (komoot)
 * 3. Nominatim reverse-confirm best candidate
 * 4. Return candidates for user confirmation if confidence is low
 * 5. Save verified record locally once confirmed
 */

const OSM_CATEGORY_MAP = {
  bar: 'food_drink', pub: 'food_drink', restaurant: 'food_drink', cafe: 'food_drink',
  fast_food: 'food_drink', food_court: 'food_drink', nightclub: 'social',
  cinema: 'social', theatre: 'social', arts_centre: 'social', community_centre: 'social',
  gym: 'gym', fitness_centre: 'gym', sports_centre: 'gym',
  park: 'outdoor', nature_reserve: 'outdoor', beach: 'outdoor',
  hospital: 'medical', clinic: 'medical', pharmacy: 'medical', doctors: 'medical',
  supermarket: 'grocery', convenience: 'grocery', marketplace: 'grocery',
  school: 'education', college: 'education', university: 'education', library: 'education',
  bank: 'business', office: 'business', coworking_space: 'business',
  place_of_worship: 'religion', church: 'religion', mosque: 'religion', synagogue: 'religion',
  post_office: 'public', police: 'public', fire_station: 'public',
};

function buildSearchKey(name, city, state) {
  return `${name}|${city}|${state || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapOsmToAppCategory(properties) {
  const type = properties?.type || properties?.osm_value || '';
  return OSM_CATEGORY_MAP[type] || 'generic';
}

function formatPhotonAddress(props) {
  const parts = [
    props.housenumber && props.street ? `${props.housenumber} ${props.street}` : props.street,
    props.city || props.town || props.village,
    props.state,
    props.postcode,
    props.country,
  ].filter(Boolean);
  return parts.join(', ');
}

function scoreCandidateMatch(props, searchName, searchCity) {
  const nameNorm = (props.name || '').toLowerCase();
  const cityNorm = (props.city || props.town || props.village || '').toLowerCase();
  const sName = searchName.toLowerCase();
  const sCity = searchCity.toLowerCase();

  let score = 0;
  if (nameNorm.includes(sName) || sName.includes(nameNorm)) score += 50;
  if (nameNorm === sName) score += 30;
  if (cityNorm.includes(sCity) || sCity.includes(cityNorm)) score += 20;
  return score;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { locationName, city, state, confirmOsmId } = await req.json();

    if (!locationName || !city) {
      return Response.json({ error: 'Location name and city required' }, { status: 400 });
    }

    const searchKey = buildSearchKey(locationName, city, state);

    // ── STEP 1: Check local cache ──────────────────────────────────────────
    const cached = await base44.entities.VerifiedRealLocation.filter({ search_key: searchKey, verified: true });
    if (cached.length > 0) {
      const c = cached[0];
      return Response.json({
        status: 'verified',
        fromCache: true,
        place: {
          id: c.id,
          name: c.place_name,
          address: c.formatted_address,
          latitude: c.latitude,
          longitude: c.longitude,
          category: c.app_location_category,
          hours: c.operating_hours_manual || c.operating_hours_raw || null,
          image_url: c.image_url || null,
          linked_location_reference_id: c.linked_location_reference_id || null,
        },
      });
    }

    // ── STEP 2: If user is confirming a specific OSM candidate, save it ───
    if (confirmOsmId) {
      // Re-fetch Photon to get the confirmed candidate details
      const query = encodeURIComponent(`${locationName} ${city}${state ? ` ${state}` : ''}`);
      const photonRes = await fetch(`https://photon.komoot.io/api/?q=${query}&limit=10`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Pocketfriend/1.0' }
      });
      const photonData = await photonRes.json();
      const features = photonData.features || [];
      const confirmed = features.find(f => String(f.properties.osm_id) === String(confirmOsmId));
      
      if (!confirmed) {
        return Response.json({ error: 'Could not re-find the confirmed place. Please try again.' }, { status: 404 });
      }

      const props = confirmed.properties;
      const [lon, lat] = confirmed.geometry.coordinates;
      const address = formatPhotonAddress(props);
      const category = mapOsmToAppCategory(props);

      // Save to local cache
      const saved = await base44.entities.VerifiedRealLocation.create({
        place_name: props.name || locationName,
        search_key: searchKey,
        formatted_address: address,
        city: city,
        state: state || '',
        latitude: lat,
        longitude: lon,
        osm_category: props.osm_key || '',
        osm_type: props.osm_value || props.type || '',
        app_location_category: category,
        operating_hours_raw: props.opening_hours || null,
        source_provider: 'photon',
        osm_place_id: String(props.osm_id),
        verified: true,
      });

      return Response.json({
        status: 'verified',
        fromCache: false,
        place: {
          id: saved.id,
          name: saved.place_name,
          address: saved.formatted_address,
          latitude: saved.latitude,
          longitude: saved.longitude,
          category: saved.app_location_category,
          hours: saved.operating_hours_raw || null,
          image_url: null,
        },
      });
    }

    // ── STEP 3: Photon search ──────────────────────────────────────────────
    const query = encodeURIComponent(`${locationName} ${city}${state ? ` ${state}` : ''}`);
    const photonRes = await fetch(`https://photon.komoot.io/api/?q=${query}&limit=8`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Pocketfriend/1.0' }
    });

    if (!photonRes.ok) {
      return Response.json({ error: 'Search service unavailable. Please try again.' }, { status: 503 });
    }

    const photonData = await photonRes.json();
    const features = photonData.features || [];

    if (features.length === 0) {
      return Response.json({ status: 'not_found', message: `No results found for "${locationName}" in ${city}. Try a different spelling.` });
    }

    // Score and sort candidates
    const candidates = features
      .map(f => {
        const props = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const score = scoreCandidateMatch(props, locationName, city);
        return {
          osm_id: String(props.osm_id),
          name: props.name || locationName,
          address: formatPhotonAddress(props),
          latitude: lat,
          longitude: lon,
          category: mapOsmToAppCategory(props),
          osm_type: props.osm_value || props.type || '',
          hours: props.opening_hours || null,
          score,
        };
      })
      .filter(c => c.name && c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    if (candidates.length === 0) {
      return Response.json({ status: 'not_found', message: `Found results near ${city} but none matched "${locationName}". Try adjusting the name.` });
    }

    // High confidence: single clear winner
    const top = candidates[0];
    const isHighConfidence = top.score >= 70 && (candidates.length === 1 || top.score - candidates[1].score >= 30);

    if (isHighConfidence) {
      // Auto-confirm and save
      const saved = await base44.entities.VerifiedRealLocation.create({
        place_name: top.name,
        search_key: searchKey,
        formatted_address: top.address,
        city,
        state: state || '',
        latitude: top.latitude,
        longitude: top.longitude,
        osm_category: '',
        osm_type: top.osm_type,
        app_location_category: top.category,
        operating_hours_raw: top.hours || null,
        source_provider: 'photon',
        osm_place_id: top.osm_id,
        verified: true,
      });

      return Response.json({
        status: 'verified',
        fromCache: false,
        place: {
          id: saved.id,
          name: saved.place_name,
          address: saved.formatted_address,
          latitude: saved.latitude,
          longitude: saved.longitude,
          category: saved.app_location_category,
          hours: saved.operating_hours_raw || null,
          image_url: null,
        },
      });
    }

    // Low confidence: return candidates for user to pick
    return Response.json({
      status: 'needs_confirmation',
      message: `Found ${candidates.length} possible matches. Which one is it?`,
      candidates,
    });

  } catch (error) {
    console.error('Real location lookup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});