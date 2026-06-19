import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function deterministicFloat(...parts) {
  const str = parts.join('|');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return ((h >>> 0) % 10000) / 10000;
}

function jitterMinutes(minAdd, maxAdd, ...seedParts) {
  const f = deterministicFloat(...seedParts);
  return minAdd + f * (maxAdd - minAdd);
}

function estimateTravelTime({ originLoc, destLoc, travelMode = 'unknown', characterId = '' }) {
  const geoO = originLoc?.geo_mode || 'unknown';
  const geoD = destLoc?.geo_mode || 'unknown';

  const today = new Date().toISOString().slice(0, 10);
  const seed = [characterId, originLoc?.id || 'no_origin', destLoc?.id || 'no_dest', today];

  if (originLoc?.same_building_group_id && originLoc.same_building_group_id === destLoc?.same_building_group_id) {
    const dur = 1 + jitterMinutes(0, 2, ...seed, 'same_building');
    return { durationMinutes: dur, distanceMiles: 0.05, positioningMode: 'fictional_coordinates' };
  }

  const hasRealOrigin = geoO === 'real_world' && originLoc.latitude && originLoc.longitude;
  const hasRealDest   = geoD === 'real_world' && destLoc?.latitude && destLoc.longitude;
  if (hasRealOrigin && hasRealDest) {
    const latDiff = Math.abs(originLoc.latitude - destLoc.latitude);
    const lngDiff = Math.abs(originLoc.longitude - destLoc.longitude);
    const distMiles = Math.sqrt((latDiff * 69) ** 2 + (lngDiff * 52) ** 2);
    const mph = travelMode === 'walking' ? 3 : travelMode === 'bus' || travelMode === 'train' ? 18 : 22;
    const baseMin = Math.max(3, Math.round((distMiles / mph) * 60));
    const jitter = jitterMinutes(-baseMin * 0.1, baseMin * 0.1, ...seed, 'real_coords');
    return {
      durationMinutes: Math.max(2, Math.round(baseMin + jitter)),
      distanceMiles: Math.round(distMiles * 10) / 10,
      positioningMode: 'real_coordinates',
    };
  }

  const hasFicO = originLoc?.map_x != null && originLoc?.map_y != null;
  const hasFicD = destLoc?.map_x != null && destLoc?.map_y != null;
  if (hasFicO && hasFicD) {
    const dx = originLoc.map_x - destLoc.map_x;
    const dy = originLoc.map_y - destLoc.map_y;
    const mapDist = Math.sqrt(dx * dx + dy * dy);
    const estMiles = (mapDist / 100) * 8;
    const mph = travelMode === 'walking' ? 3 : 20;
    const baseMin = Math.max(3, Math.round((estMiles / mph) * 60));
    const jitter = jitterMinutes(-1, 2, ...seed, 'fictional_coords');
    return {
      durationMinutes: Math.max(2, Math.round(baseMin + jitter)),
      distanceMiles: Math.round(estMiles * 10) / 10,
      positioningMode: 'fictional_coordinates',
    };
  }

  return {
    durationMinutes: Math.round(7 + jitterMinutes(0, 3, ...seed, 'unknown_region')),
    distanceMiles: null,
    positioningMode: 'fallback_estimate',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active', is_test_character: true },
      '-updated_date', 1
    );
    const testChar = allChars[0];

    if (!testChar) {
      return Response.json({ error: 'No test character found' }, { status: 404 });
    }

    const locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const originLoc = locations.find(l => l.id === testChar.resolved_current_location_id);
    const destLoc = locations.find(l => 
      l.id !== testChar.resolved_current_location_id && 
      l.category !== 'home'
    );

    if (!destLoc) {
      return Response.json({ error: 'No valid destination found' }, { status: 404 });
    }

    const { durationMinutes, distanceMiles, positioningMode } = estimateTravelTime({
      originLoc,
      destLoc,
      characterId: testChar.id,
    });

    const now = new Date();
    const eta = new Date(now.getTime() + durationMinutes * 60 * 1000);

    const characterSnapshot = {
      id: testChar.id,
      name: testChar.name,
      owner_email: testChar.owner_email,
      is_jailed: testChar.is_jailed || false,
      house_arrest_active: testChar.house_arrest_active || false,
      resolved_presence_status: testChar.resolved_presence_status || 'traveling',
      current_home_location_id: testChar.current_home_location_id || null,
    };

    const travelSession = await base44.asServiceRole.entities.TravelSession.create({
      character_id:              testChar.id,
      character_name:            testChar.name,
      owner_email:               testChar.owner_email,
      origin_location_id:        originLoc?.id || null,
      origin_location_name:      originLoc?.name || null,
      destination_location_id:   destLoc.id,
      destination_location_name: destLoc.name,
      travel_reason:             'proof_of_full_direct_creation',
      travel_source:             'autonomous_need',
      estimated_departure_time:  now.toISOString(),
      estimated_arrival_time:    eta.toISOString(),
      duration_minutes:          Math.round(durationMinutes),
      route_status:              'in_transit',
      progress_percent:          0,
      character_snapshot:        characterSnapshot,
      character_home_location_id: testChar.current_home_location_id || null,
      interruption_allowed:      true,
    });

    return Response.json({
      success: true,
      created_test_session_id: travelSession.id,
      origin: originLoc?.name,
      destination: destLoc.name,
      eta: eta.toISOString(),
      owner_email: testChar.owner_email,
      character_id: testChar.id,
      proof_char_is_test: testChar.is_test_character,
      proof_no_live_char_processed: !testChar.is_live_character, // Assuming is_live_character is a field
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});