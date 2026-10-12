/**
 * RESIDENTIAL UNIT RESOLVER
 *
 * Single source of truth for residential unit / household resolution.
 *
 * A residential unit is a distinct living space within a parent location
 * (e.g. Apartment 1, Unit 4B). A household is the group of occupants who
 * live together in the same unit.
 *
 * Key rules:
 * - Building residency (location.resident_character_ids) ≠ household membership
 * - A character can be a building resident without being assigned to any unit
 * - Household membership is user-configured — never inferred from location sharing,
 *   family relationships, romantic relationships, surnames, or proximity
 * - Physical presence is separate from household membership
 * - Units reuse existing zone images from the parent location by default
 *
 * This resolver is pure-data — no DB queries, no writes, no side effects.
 * It reads from already-loaded LocationReference records.
 */

/**
 * Get all residential units for a location.
 * @param {object} location - LocationReference record
 * @returns {object[]} Array of unit objects (empty if none configured)
 */
export function getResidentialUnits(location) {
  if (!location) return [];
  return Array.isArray(location.residential_units) ? location.residential_units : [];
}

/**
 * Check whether a location has any residential units configured.
 * @param {object} location - LocationReference record
 * @returns {boolean}
 */
export function hasResidentialUnits(location) {
  return getResidentialUnits(location).length > 0;
}

/**
 * Find which unit a character is assigned to within a location.
 * @param {object} location - LocationReference record
 * @param {string} characterId - Canonical character ID
 * @returns {object|null} The unit object, or null if not assigned to any unit
 */
export function getCharacterUnit(location, characterId) {
  if (!location || !characterId) return null;
  const units = getResidentialUnits(location);
  return units.find(u => (u.occupant_character_ids || []).includes(characterId)) || null;
}

/**
 * Get the unit ID for a character within a location.
 * @param {object} location - LocationReference record
 * @param {string} characterId - Canonical character ID
 * @returns {string|null} Unit ID, or null if not assigned
 */
export function getCharacterUnitId(location, characterId) {
  const unit = getCharacterUnit(location, characterId);
  return unit?.unit_id || null;
}

/**
 * Get the unit name for a character within a location.
 * @param {object} location - LocationReference record
 * @param {string} characterId - Canonical character ID
 * @returns {string|null} Unit name, or null if not assigned
 */
export function getCharacterUnitName(location, characterId) {
  const unit = getCharacterUnit(location, characterId);
  return unit?.unit_name || null;
}

/**
 * Get all occupant character IDs for a specific unit.
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {string[]} Array of occupant character IDs
 */
export function getUnitOccupantIds(location, unitId) {
  if (!location || !unitId) return [];
  const unit = getResidentialUnits(location).find(u => u.unit_id === unitId);
  return unit?.occupant_character_ids || [];
}

/**
 * Get the household size for a unit (number of occupants).
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {number}
 */
export function getUnitHouseholdSize(location, unitId) {
  return getUnitOccupantIds(location, unitId).length;
}

/**
 * Get all character IDs assigned to ANY unit in this location.
 * @param {object} location - LocationReference record
 * @returns {string[]} Array of all assigned character IDs
 */
export function getAllAssignedCharacterIds(location) {
  const units = getResidentialUnits(location);
  const ids = new Set();
  units.forEach(u => {
    (u.occupant_character_ids || []).forEach(id => ids.add(id));
  });
  return Array.from(ids);
}

/**
 * Get building resident IDs that are NOT assigned to any unit.
 * These are residents with building residency but no household grouping.
 * @param {object} location - LocationReference record
 * @returns {string[]} Array of unassigned character IDs
 */
export function getUnassignedResidentIds(location) {
  if (!location) return [];
  const buildingResidents = location.resident_character_ids || [];
  const assignedIds = new Set(getAllAssignedCharacterIds(location));
  return buildingResidents.filter(id => !assignedIds.has(id));
}

/**
 * Check if a character is an occupant of a specific unit.
 * @param {object} location - LocationReference record
 * @param {string} characterId - Canonical character ID
 * @param {string} unitId - Unit ID
 * @returns {boolean}
 */
export function isCharacterInUnit(location, characterId, unitId) {
  return getUnitOccupantIds(location, unitId).includes(characterId);
}

/**
 * Check if two characters share a household (same unit) at a location.
 * @param {object} location - LocationReference record
 * @param {string} charIdA - First character ID
 * @param {string} charIdB - Second character ID
 * @returns {boolean}
 */
export function areCharactersInSameHousehold(location, charIdA, charIdB) {
  if (!location || !charIdA || !charIdB || charIdA === charIdB) return false;
  const unitA = getCharacterUnitId(location, charIdA);
  const unitB = getCharacterUnitId(location, charIdB);
  return !!unitA && unitA === unitB;
}

/**
 * Resolve which unit to visit when traveling to see a specific character.
 * @param {object} location - LocationReference record (the parent location)
 * @param {string} targetCharacterId - The character being visited
 * @returns {{unitId: string|null, unitName: string|null, unit: object|null}}
 */
export function resolveUnitForVisit(location, targetCharacterId) {
  if (!location || !targetCharacterId) return { unitId: null, unitName: null, unit: null };
  const unit = getCharacterUnit(location, targetCharacterId);
  return {
    unitId: unit?.unit_id || null,
    unitName: unit?.unit_name || null,
    unit: unit,
  };
}

/**
 * Get the effective rent for a unit.
 * Falls back to the parent location's rent if the unit doesn't have its own.
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {number}
 */
export function getUnitRent(location, unitId) {
  if (!location || !unitId) return location?.rent_or_housing_cost || 0;
  const unit = getResidentialUnits(location).find(u => u.unit_id === unitId);
  if (unit?.rent != null) return unit.rent;
  return location.rent_or_housing_cost || 0;
}

/**
 * Get the effective utilities for a unit.
 * Falls back to the parent location's utilities if the unit doesn't have its own.
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {object} Utilities object
 */
export function getUnitUtilities(location, unitId) {
  const defaultUtils = location?.utility_costs || { electricity: 0, water: 0, gas: 0, internet: 0, other: 0 };
  if (!location || !unitId) return defaultUtils;
  const unit = getResidentialUnits(location).find(u => u.unit_id === unitId);
  if (unit?.utilities) return { ...defaultUtils, ...unit.utilities };
  return defaultUtils;
}

/**
 * Get the total housing cost (rent + utilities) for a unit.
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {number}
 */
export function getUnitTotalHousingCost(location, unitId) {
  const rent = getUnitRent(location, unitId);
  const utilities = getUnitUtilities(location, unitId);
  const utilSum = Object.values(utilities).reduce((s, v) => s + (v || 0), 0);
  return rent + utilSum;
}

/**
 * Get the per-resident rent for a unit (rent / household size).
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {number|null} Per-resident rent, or null if household size is 0
 */
export function getUnitPerResidentRent(location, unitId) {
  const size = getUnitHouseholdSize(location, unitId);
  if (size === 0) return null;
  return getUnitRent(location, unitId) / size;
}

/**
 * Get the zone images for a unit, considering overrides.
 * If the unit has a zone_image_overrides entry for the zone, use those.
 * Otherwise, fall back to the parent location's zone images.
 *
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @param {string} zoneName - Zone name
 * @returns {string[]} Array of image URLs
 */
export function getUnitZoneImages(location, unitId, zoneName) {
  if (!location || !zoneName) return [];
  const zones = location.zones || [];
  const parentZone = zones.find(z =>
    (z.zone_name || '').toLowerCase() === zoneName.toLowerCase()
  );
  const parentImages = parentZone?.image_urls || [];

  if (!unitId) return parentImages;

  const unit = getResidentialUnits(location).find(u => u.unit_id === unitId);
  if (!unit?.zone_image_overrides) return parentImages;

  // Find override by zone name (case-insensitive)
  const overrideKey = Object.keys(unit.zone_image_overrides).find(
    k => k.toLowerCase() === zoneName.toLowerCase()
  );
  if (overrideKey) {
    return unit.zone_image_overrides[overrideKey];
  }

  return parentImages;
}

/**
 * Get the grocery estimate for a unit based on its household size.
 * Uses the same baseline as the existing system (~$150/person/month).
 * @param {object} location - LocationReference record
 * @param {string} unitId - Unit ID
 * @returns {number} Estimated monthly grocery spend
 */
export function getUnitGroceryEstimate(location, unitId) {
  const size = getUnitHouseholdSize(location, unitId);
  if (size === 0) return 0;
  return location.grocery_average_spend || Math.round(size * 150);
}

/**
 * Build a summary of all households at a location for display.
 * Returns an array of { unitId, unitName, occupantNames, householdSize, rent, totalCost }
 *
 * @param {object} location - LocationReference record
 * @param {object[]} characters - Full character records for name resolution
 * @param {string} currentUserId - Current user ID (for player resolution)
 * @param {string} userDisplayName - Current user's display name
 * @returns {object[]} Array of household summaries
 */
export function buildHouseholdSummaries(location, characters = [], currentUserId = null, userDisplayName = 'You') {
  const units = getResidentialUnits(location);
  return units.map(unit => {
    const occupantIds = unit.occupant_character_ids || [];
    const occupantNames = occupantIds.map(id => {
      if (id === currentUserId) return userDisplayName;
      const char = characters.find(c => c.id === id);
      return char?.name || unit.occupant_character_names?.[occupantIds.indexOf(id)] || 'Unknown';
    });
    return {
      unitId: unit.unit_id,
      unitName: unit.unit_name,
      occupantNames,
      householdSize: occupantIds.length,
      rent: getUnitRent(location, unit.unit_id),
      totalCost: getUnitTotalHousingCost(location, unit.unit_id),
      perResidentRent: getUnitPerResidentRent(location, unit.unit_id),
      groceryEstimate: getUnitGroceryEstimate(location, unit.unit_id),
    };
  });
}

/**
 * Generate a stable unit ID.
 * Uses crypto.randomUUID when available, falls back to timestamp-based ID.
 * @returns {string}
 */
export function generateUnitId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `unit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Determine which characters are eligible to appear in a scene at a residential location.
 *
 * Resolution hierarchy:
 *   Parent Location → Active Residential Environment → Residential Unit → Active Zone → Present Occupants
 *
 * For PRIVATE residential scenes (inside a specific unit):
 *   - Only that unit's household occupants + authorized visitors are eligible
 *   - Other building residents are NOT included just because they share the building
 *
 * For COMMON AREAS (lobby, gym, courtyard, etc.):
 *   - Any building resident who is authoritatively present at the location is eligible
 *   - Uses existing shared-area population rules
 *
 * @param {object} location - LocationReference record
 * @param {object} opts
 * @param {string|null} opts.targetUnitId - Unit being visited (if visiting a specific character, use resolveUnitForVisit)
 * @param {string|null} opts.activeZoneName - Current zone name (to distinguish private unit vs common area)
 * @param {string[]} opts.allPresentCharacterIds - All character IDs authoritatively present at this location
 * @param {string[]} opts.explicitlyIncludedIds - Characters explicitly included by the user (companions, invitees)
 * @returns {{isPrivateUnitScene: boolean, eligibleIds: string[], unitId: string|null, unitName: string|null, excludedIds: string[], reason: string}}
 */
export function resolveResidentialScenePopulation(location, opts = {}) {
  const {
    targetUnitId = null,
    activeZoneName = null,
    allPresentCharacterIds = [],
    explicitlyIncludedIds = [],
  } = opts;

  if (!location) {
    return { isPrivateUnitScene: false, eligibleIds: [], unitId: null, unitName: null, excludedIds: [], reason: 'no_location' };
  }

  const units = getResidentialUnits(location);

  // If no units configured, all present residents are eligible (legacy behavior)
  if (units.length === 0) {
    return {
      isPrivateUnitScene: false,
      eligibleIds: [...new Set([...allPresentCharacterIds, ...explicitlyIncludedIds])],
      unitId: null,
      unitName: null,
      excludedIds: [],
      reason: 'no_units_legacy_behavior',
    };
  }

  // Determine if this is a private unit scene or a common area scene.
  // A scene is private if:
  //   1. A target unit is explicitly specified, OR
  //   2. The active zone is part of a residential environment (not a common area)
  //
  // Common areas are zones that belong to operational/community environments,
  // not residential environments. If the zone is in a residential environment,
  // it's a private unit scene.

  const environments = location.environments || [];
  const residentialEnv = environments.find(e => e.type === 'residential');
  const residentialZoneNames = residentialEnv?.zone_names || [];

  const isZoneInResidentialEnv = activeZoneName
    ? residentialZoneNames.some(zn => zn.toLowerCase() === activeZoneName.toLowerCase())
    : false;

  const isPrivateUnitScene = !!targetUnitId || isZoneInResidentialEnv;

  if (!isPrivateUnitScene) {
    // Common area scene — all building residents present at the location are eligible
    return {
      isPrivateUnitScene: false,
      eligibleIds: [...new Set([...allPresentCharacterIds, ...explicitlyIncludedIds])],
      unitId: null,
      unitName: null,
      excludedIds: [],
      reason: 'common_area',
    };
  }

  // Private unit scene — restrict to that unit's occupants + explicitly included + present visitors
  const unit = targetUnitId
    ? units.find(u => u.unit_id === targetUnitId)
    : null;

  if (!unit) {
    // Target unit not found — fall back to all present (shouldn't happen in practice)
    return {
      isPrivateUnitScene: false,
      eligibleIds: [...new Set([...allPresentCharacterIds, ...explicitlyIncludedIds])],
      unitId: null,
      unitName: null,
      excludedIds: [],
      reason: 'target_unit_not_found',
    };
  }

  const unitOccupantIds = unit.occupant_character_ids || [];

  // Eligible: unit occupants who are present + explicitly included characters
  // A unit occupant is eligible even if not in allPresentCharacterIds — they live here
  // and may be home. The authoritative presence check happens upstream.
  const eligibleSet = new Set([...unitOccupantIds, ...explicitlyIncludedIds]);

  // Also include any present characters who are explicitly visiting this unit
  // (authorized visitors). For now, any present character not assigned to a
  // DIFFERENT unit is eligible if they're in the explicitly included list.
  // Characters assigned to other units are excluded from private scenes.
  const otherUnitOccupantIds = new Set();
  units.forEach(u => {
    if (u.unit_id === unit.unit_id) return;
    (u.occupant_character_ids || []).forEach(id => otherUnitOccupantIds.add(id));
  });

  // Excluded: characters assigned to OTHER units (they're in their own apartments)
  const excludedIds = [...otherUnitOccupantIds];

  // Remove excluded from eligible
  excludedIds.forEach(id => eligibleSet.delete(id));

  return {
    isPrivateUnitScene: true,
    eligibleIds: [...eligibleSet],
    unitId: unit.unit_id,
    unitName: unit.unit_name,
    excludedIds,
    reason: 'private_unit',
  };
}

/**
 * Build a prompt context block describing the residential unit for narrative/image generation.
 * This tells the LLM which unit the character is in and who their household members are.
 *
 * @param {object} location - LocationReference record
 * @param {string} characterId - The character whose unit context we're building
 * @param {object[]} characters - Full character records for name resolution
 * @returns {string} Prompt context block, or empty string if no units configured
 */
export function buildResidentialUnitPromptBlock(location, characterId, characters = []) {
  if (!location || !characterId) return '';
  const units = getResidentialUnits(location);
  if (units.length === 0) return '';

  const unit = getCharacterUnit(location, characterId);
  if (!unit) return '';

  const occupantNames = (unit.occupant_character_ids || []).map(id => {
    const char = characters.find(c => c.id === id);
    return char?.name || unit.occupant_character_names?.[(unit.occupant_character_ids || []).indexOf(id)] || 'Unknown';
  }).filter(name => name !== 'Unknown' || true);

  const otherUnits = units.filter(u => u.unit_id !== unit.unit_id);
  const otherHouseholdNames = otherUnits.map(u => {
    const names = (u.occupant_character_ids || []).map(id => {
      const char = characters.find(c => c.id === id);
      return char?.name || 'Unknown';
    });
    return `${u.unit_name}: ${names.join(', ')}`;
  });

  const lines = [
    `RESIDENTIAL UNIT CONTEXT:`,
    `  ${characterId === location.character_id ? 'This character' : 'This character'} lives in ${unit.unit_name} at ${location.name}.`,
    `  Household members (share this unit): ${occupantNames.join(', ')}`,
  ];

  if (otherHouseholdNames.length > 0) {
    lines.push(`  Other households in this building (DO NOT appear in private unit scenes):`);
    otherHouseholdNames.forEach(h => lines.push(`    • ${h}`));
    lines.push(`  These other residents live in SEPARATE units. They do NOT share this household.`);
    lines.push(`  They should NOT appear in ${unit.unit_name} unless explicitly visiting.`);
  }

  return lines.join('\n');
}