/**
 * MANDATORY MULTI-SOURCE LOCATION RESOLUTION ENGINE
 * 
 * This engine enforces authoritative source-first resolution of where a character is
 * and which location/zone resources should be used for image generation.
 * 
 * CRITICAL RULES:
 * 1. Avatar/character background images are for character IDENTITY ONLY (0% environment authority)
 * 2. Location truth comes ONLY from character file + LocationReference records
 * 3. Zone truth comes ONLY from stored zone records + zone images
 * 4. DO NOT infer room type from furniture in character photos
 * 5. DO NOT ask user for data already queryable from Character + LocationReference entities
 */

/**
 * PROVIDER ACCESSIBILITY FILTER
 * 
 * Generation provider can ONLY fetch:
 * - media.base44.com CDN URLs (public, no auth)
 * - External HTTPS CDNs (public, no auth)
 * 
 * CANNOT fetch:
 * - base44.app/api/apps/ paths (require API auth + session)
 * - /files/mp/private/ (explicitly private)
 * - Signed URLs with ?token=, ?signed=, X-Amz-Signature (unstable)
 */
function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  // CRITICAL: base44.app/api/apps/ paths require API auth even if they contain /files/mp/public/
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

/**
 * MANDATORY CHARACTER FILE RESOLUTION
 * 
 * Check character file fields in strict priority order.
 * Do NOT skip levels or use avatar background as fallback.
 */
async function resolveCharacterLocation(charRecord, base44, createdBy) {
  const result = {
    locationId: null,
    source: null,
    presence: charRecord?.resolved_presence_status || 'home',
    isHome: false,
    isAtWork: false,
    isTraveling: false,
  };

  result.isHome = ['home', 'sleeping', 'napping'].includes(result.presence);
  result.isAtWork = result.presence === 'at_work';
  result.isTraveling = result.presence === 'traveling';

  // STRICT PRIORITY ORDER — do not skip or reorder
  if (charRecord?.resolved_current_location_id) {
    result.locationId = charRecord.resolved_current_location_id;
    result.source = 'character.resolved_current_location_id (PRIMARY — system-resolved current location)';
  } else if (charRecord?.current_home_location_id) {
    result.locationId = charRecord.current_home_location_id;
    result.source = 'character.current_home_location_id (SECONDARY — explicitly assigned home)';
  } else if (charRecord?.home_location_id) {
    result.locationId = charRecord.home_location_id;
    result.source = 'character.home_location_id (TERTIARY — legacy home assignment)';
  } else if (result.isAtWork && charRecord?.current_work_location_id) {
    result.locationId = charRecord.current_work_location_id;
    result.source = 'character.current_work_location_id (WORK)';
  } else if (charRecord?.occupation_location_id) {
    result.locationId = charRecord.occupation_location_id;
    result.source = 'character.occupation_location_id (FALLBACK WORK)';
  }

  console.log(`[LOCATION_ENGINE] Character file resolution: ${result.source || 'NOT FOUND'} | presence=${result.presence}`);
  return result;
}

/**
 * AUTHORITATIVE LOCATION RECORD LOOKUP
 * 
 * Fetch the actual LocationReference record by ID.
 * This record contains the ONLY authoritative zone structure and image mappings.
 */
async function fetchLocationRecord(locationId, base44) {
  if (!locationId) return null;

  try {
    let loc = await base44.asServiceRole.entities.LocationReference.get(locationId).catch(() => null);
    if (!loc) {
      const locList = await base44.asServiceRole.entities.LocationReference.filter(
        { id: locationId },
        null,
        1
      ).catch(() => []);
      loc = locList?.[0] || null;
    }
    if (loc) {
      console.log(`[LOCATION_ENGINE] Location record found: "${loc.name}" (${loc.id}) | zones=${loc.zones?.length || 0} | flat_images=${loc.image_urls?.length || 0}`);
    }
    return loc;
  } catch (err) {
    console.error(`[LOCATION_ENGINE] Location lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * ZONE IMAGE RESOLUTION
 * 
 * Match zone based on:
 * 1. Explicit user zone selection (when provided)
 * 2. Prompt keywords (bathroom, kitchen, bedroom, etc.)
 * 3. Default zone hint from location category or character state
 * 
 * DO NOT infer zone from furniture in character photos.
 * Zone comes ONLY from location's stored zone structure.
 */
function resolveZoneImages(prompt, locationRecord, forceZoneHint) {
  if (!locationRecord?.zones || locationRecord.zones.length === 0) {
    // No zones — use flat location images
    return {
      zoneImages: (locationRecord?.image_urls || []).slice(0, 6),
      zoneName: null,
      matchType: 'location_flat_images',
    };
  }

  const zones = locationRecord.zones.filter(z => z.image_urls?.length > 0);
  if (zones.length === 0) {
    return {
      zoneImages: (locationRecord?.image_urls || []).slice(0, 6),
      zoneName: null,
      matchType: 'location_flat_images_no_zones',
    };
  }

  const promptLower = (prompt || '').toLowerCase();
  
  // ZONE KEYWORD MAP — matches prompt keywords to zone names
  const ZONE_KEYWORDS = [
    { keywords: ["bathroom", "shower", "bathtub", "toilet"], zone: "bathroom" },
    { keywords: ["bedroom", "bed", "sleeping", "nightstand"], zone: "bedroom" },
    { keywords: ["kitchen", "stove", "fridge", "cooking", "counter"], zone: "kitchen" },
    { keywords: ["living room", "couch", "sofa", "tv", "lounge"], zone: "living room" },
    { keywords: ["dining room", "dining table", "dinner"], zone: "dining room" },
    { keywords: ["office", "desk", "work", "workspace"], zone: "office" },
    { keywords: ["backyard", "patio", "yard", "garden"], zone: "backyard" },
  ];

  // Try prompt keyword match
  for (const entry of ZONE_KEYWORDS) {
    if (entry.keywords.some(kw => promptLower.includes(kw))) {
      const matchedZone = zones.find(z => z.zone_name?.toLowerCase() === entry.zone.toLowerCase());
      if (matchedZone) {
        return {
          zoneImages: matchedZone.image_urls.slice(0, 6),
          zoneName: matchedZone.zone_name,
          matchType: 'prompt_keyword_match',
        };
      }
    }
  }

  // Try forced hint (e.g., "bedroom" when character is sleeping)
  if (forceZoneHint) {
    const hintZone = zones.find(z => z.zone_name?.toLowerCase() === forceZoneHint.toLowerCase());
    if (hintZone) {
      return {
        zoneImages: hintZone.image_urls.slice(0, 6),
        zoneName: hintZone.zone_name,
        matchType: 'forced_hint_match',
      };
    }
  }

  // Default: first zone with images
  const firstZone = zones[0];
  return {
    zoneImages: firstZone.image_urls.slice(0, 6),
    zoneName: firstZone.zone_name,
    matchType: 'first_zone_fallback',
  };
}

/**
 * MAIN RESOLUTION FUNCTION
 * 
 * Orchestrates mandatory multi-source location resolution.
 * Returns null if the request cannot be resolved with valid location refs.
 */
async function resolveLocation(characterId, charRecord, base44, manualLocationId, manualZoneId, prompt) {
  const result = {
    locationId: null,
    locationName: null,
    zoneName: null,
    locationImages: [],
    source: null,
    trace: [],
  };

  // ── STEP 1: Manual override (if provided) ──
  if (manualLocationId) {
    result.trace.push('✓ STEP 1: User-selected location provided');
    const loc = await fetchLocationRecord(manualLocationId, base44);
    if (loc) {
      result.locationId = loc.id;
      result.locationName = loc.name;
      result.source = 'manual_location_selection';

      // Resolve zone within that location
      const zoneResult = resolveZoneImages(prompt, loc, manualZoneId);
      result.locationImages = zoneResult.zoneImages;
      result.zoneName = zoneResult.zoneName;
      result.trace.push(`✓ STEP 2: Zone resolved (${zoneResult.matchType})`);
      return result;
    }
    result.trace.push('⚠ User-selected location not found in records');
  }

  // ── STEP 2: Character file resolution ──
  result.trace.push('✓ STEP 1: Checking character file...');
  const charLocResult = await resolveCharacterLocation(charRecord, base44, charRecord?.created_by);
  if (!charLocResult.locationId) {
    result.trace.push('⛔ No location found in character file (all fields checked: resolved_current_location_id, current_home_location_id, home_location_id, work/school locations)');
    return result;
  }
  result.trace.push(`✓ STEP 2: Character file checked — source: ${charLocResult.source}`);

  // ── STEP 3: LocationReference record lookup ──
  result.trace.push('✓ STEP 3: Fetching LocationReference record...');
  const loc = await fetchLocationRecord(charLocResult.locationId, base44);
  if (!loc) {
    result.trace.push(`⛔ LocationReference record not found (id=${charLocResult.locationId})`);
    return result;
  }
  result.locationId = loc.id;
  result.locationName = loc.name;
  result.source = charLocResult.source;
  result.trace.push(`✓ Location record found: "${loc.name}"`);

  // ── STEP 4: Zone resolution ──
  result.trace.push('✓ STEP 4: Resolving zone...');
  
  // Force zone hint based on character state
  let forceHint = null;
  if (charLocResult.presence === 'sleeping' || charLocResult.presence === 'napping') {
    forceHint = 'bedroom';
    result.trace.push('ℹ Character is sleeping — zone hint: bedroom');
  }

  const zoneResult = resolveZoneImages(prompt, loc, forceHint);
  result.locationImages = zoneResult.zoneImages;
  result.zoneName = zoneResult.zoneName;
  result.trace.push(`✓ Zone resolved: ${zoneResult.zoneName || '(using flat location images)'} (match: ${zoneResult.matchType})`);

  return result;
}

export {
  isProviderAccessible,
  resolveCharacterLocation,
  fetchLocationRecord,
  resolveZoneImages,
  resolveLocation,
};