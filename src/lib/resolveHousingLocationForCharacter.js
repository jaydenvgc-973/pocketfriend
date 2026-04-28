/**
 * PHASE 1: Housing Location Resolver
 * 
 * Read-only helper that examines character state and available locations.
 * Returns a decision object without writing, mutating, or creating records.
 * 
 * Does NOT:
 * - Write to database
 * - Create hotel/shelter records
 * - Deduct money
 * - Modify character state
 * - Create Moments
 * 
 * Only returns diagnostic information for downstream decision-making.
 */

/**
 * Resolves housing location for a character and returns decision object.
 * 
 * @param {Object} character - Full character record
 * @param {Array|Object} locations - Location records (array or {id: location} map)
 * @param {Object} options - Options object
 * @param {boolean} options.strict - If true, fail if home ID exists but location missing
 * @returns {Object} Housing decision object
 */
export function resolveHousingLocationForCharacter(character, locations, options = {}) {
  if (!character) {
    return createDecisionObject(null, null, null, 'no_character', false, false, true, 'error');
  }

  // Normalize locations to map for O(1) lookup
  const locationMap = Array.isArray(locations)
    ? locations.reduce((map, loc) => ({ ...map, [loc.id]: loc }), {})
    : (locations || {});

  // ── SCENARIO 1: Valid Permanent Home ────────────────────────────────────
  const homeId = character.current_home_location_id || character.home_location_id;
  if (homeId) {
    const homeLocation = locationMap[homeId];
    if (homeLocation) {
      return createDecisionObject(
        homeId,
        homeLocation.name || 'Home',
        'stable_home',
        'permanent_home_valid',
        false,
        false,
        false,
        getZoneRefStatus(homeLocation)
      );
    }
    // Home ID exists but location not in map → SCENARIO 2
    return createDecisionObject(
      homeId,
      null,
      'stable_home',
      'home_id_exists_lookup_failed',
      true, // resolution_failed = true
      false,
      true, // requires_user_attention = true
      'location_not_available'
    );
  }

  // ── SCENARIO 3: Last-Known Home (from resolved presence) ────────────────
  const lastLocationId = character.resolved_current_location_id;
  const lastLocationType = character.resolved_location_type;
  if (lastLocationId && lastLocationType === 'home') {
    const lastLocation = locationMap[lastLocationId];
    if (lastLocation) {
      return createDecisionObject(
        lastLocationId,
        lastLocation.name || 'Home',
        'stable_home',
        'last_known_home',
        false,
        false,
        false,
        getZoneRefStatus(lastLocation)
      );
    }
  }

  // ── SCENARIO 4: True Null Home (Homeless) ──────────────────────────────
  // Check if character has any home association via resident scan
  const homeLocs = Object.values(locationMap).filter(
    loc => (loc.category === 'home' || loc.category === 'generic') &&
           ((loc.resident_character_ids || []).includes(character.id) ||
            (loc.residents || []).some(r => r.character_id === character.id))
  );

  if (homeLocs.length === 0) {
    // Truly homeless — no home ID, no resident records, no last location
    // SCENARIOS 5, 6, 7: Check eligibility for temporary housing
    
    const balance = character.current_balance ?? 6000; // Default from CharacterFinancial schema
    
    // SCENARIO 5: Eligible for hotel ($150/night)
    if (balance >= 150) {
      return createDecisionObject(
        null,
        null,
        'temporary_hotel',
        'homeless_eligible_for_hotel',
        false,
        true, // may_assign_temporary_housing = true
        true, // requires_user_attention = true
        'no_permanent_home'
      );
    }
    
    // SCENARIO 6: Eligible only for shelter ($0/night)
    return createDecisionObject(
      null,
      null,
      'temporary_shelter',
      'homeless_eligible_for_shelter',
      false,
      true, // may_assign_temporary_housing = true
      true, // requires_user_attention = true
      'no_permanent_home'
    );
  }

  // Fallback: No explicit home field, but found via resident scan
  const fallbackHome = homeLocs[0];
  return createDecisionObject(
    fallbackHome.id,
    fallbackHome.name || 'Home',
    'stable_home',
    'home_from_resident_scan',
    false,
    false,
    false,
    getZoneRefStatus(fallbackHome)
  );
}

/**
 * Internal: Create a decision object with standard fields.
 * 
 * @private
 */
function createDecisionObject(
  housingLocationId,
  housingLocationName,
  housingContext,
  sourceReason,
  homeResolutionFailed,
  mayAssignTemporaryHousing,
  requiresUserAttention,
  zoneReferenceStatus
) {
  return {
    // Housing Location
    housing_location_id: housingLocationId || null,
    housing_location_name: housingLocationName || null,
    
    // Housing Context (matches Character schema enum)
    housing_context: housingContext || 'stable_home',
    // Values: 'stable_home', 'temporary_hotel', 'temporary_shelter', 'homeless_unsheltered'
    
    // Diagnostic Reason
    source_reason: sourceReason || 'unknown',
    // Values: 'permanent_home_valid', 'home_id_exists_lookup_failed', 'last_known_home',
    //         'homeless_eligible_for_hotel', 'homeless_eligible_for_shelter',
    //         'home_from_resident_scan', 'no_character', etc.
    
    // Resolution State
    home_resolution_failed: homeResolutionFailed === true,
    // true = home ID exists but lookup failed (transient issue, preserve ID)
    
    // Temporary Housing Eligibility
    may_assign_temporary_housing: mayAssignTemporaryHousing === true,
    // true = character is homeless and financially eligible for temp housing
    
    // User Attention Flag
    requires_user_attention: requiresUserAttention === true,
    // true = situation needs review (home ID missing, or homeless, or lookup failed)
    
    // Zone Reference Status
    zone_reference_status: zoneReferenceStatus || 'unknown',
    // Values: 'has_zones_with_images', 'has_zones_no_images', 'no_zones', 'location_not_available', 'error'
  };
}

/**
 * Internal: Determine zone reference status for a location.
 * 
 * @private
 */
function getZoneRefStatus(location) {
  if (!location) return 'location_not_available';
  
  const zones = location.zones || [];
  if (zones.length === 0) return 'no_zones';
  
  const hasImages = zones.some(z => (z.image_urls || []).length > 0);
  return hasImages ? 'has_zones_with_images' : 'has_zones_no_images';
}

/**
 * PHASE 1 DRY-RUN HELPERS (for testing — do not use in production)
 * 
 * These simulate scenarios without making actual changes.
 */

export function dryRunExample1_ValidPermanentHome() {
  const character = {
    id: 'char_123',
    current_home_location_id: 'loc_home_1',
    current_balance: 10000,
  };
  const locations = [
    { id: 'loc_home_1', name: 'My Apartment', category: 'home', zones: [{ zone_name: 'bedroom', image_urls: ['img1'] }] },
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample2_HomeIdExistsButLookupFailed() {
  const character = {
    id: 'char_123',
    current_home_location_id: 'loc_home_missing',
    current_balance: 10000,
  };
  const locations = [
    // loc_home_missing NOT in this list → lookup will fail
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample3_LastKnownHome() {
  const character = {
    id: 'char_123',
    current_home_location_id: null,
    resolved_current_location_id: 'loc_last_home',
    resolved_location_type: 'home',
    current_balance: 10000,
  };
  const locations = [
    { id: 'loc_last_home', name: 'Old Apartment', category: 'home', zones: [{ zone_name: 'living_room', image_urls: ['img2'] }] },
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample4_TrueNullHome_EligibleHotel() {
  const character = {
    id: 'char_123',
    current_home_location_id: null,
    resolved_current_location_id: null,
    current_balance: 500, // >= $150
  };
  const locations = [
    // No home locations, no resident records for this character
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample5_TrueNullHome_EligibleShelter() {
  const character = {
    id: 'char_123',
    current_home_location_id: null,
    resolved_current_location_id: null,
    current_balance: 50, // < $150
  };
  const locations = [
    // No home locations, no resident records
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample6_HomeFromResidentScan() {
  const character = {
    id: 'char_123',
    current_home_location_id: null, // No explicit home field
    resolved_current_location_id: null,
    current_balance: 10000,
  };
  const locations = [
    {
      id: 'loc_shared',
      name: 'Shared House',
      category: 'home',
      residents: [{ character_id: 'char_123' }], // Found via resident scan
      zones: [{ zone_name: 'kitchen', image_urls: ['img3'] }],
    },
  ];
  return resolveHousingLocationForCharacter(character, locations);
}

export function dryRunExample7_NoZoneImages() {
  const character = {
    id: 'char_123',
    current_home_location_id: 'loc_home_2',
    current_balance: 10000,
  };
  const locations = [
    {
      id: 'loc_home_2',
      name: 'House with No Zones',
      category: 'home',
      zones: [{ zone_name: 'bedroom' }], // No image_urls
    },
  ];
  return resolveHousingLocationForCharacter(character, locations);
}