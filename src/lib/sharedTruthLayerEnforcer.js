/**
 * SHARED TRUTH LAYER ENFORCER
 * 
 * This module ensures every system reads from the same authoritative sources.
 * 
 * Core principles:
 * 1. One user scope per operation
 * 2. Character location truth is resolved once
 * 3. Avatar sources are consistent across all systems
 * 4. Internal family is treated as real residents
 * 5. Zone images are zone-specific
 * 6. No duplication of truth resolution
 */

/**
 * Resolve the authoritative current location for a character
 * Returns the location ID where they physically are RIGHT NOW
 * 
 * LEGACY COMPATIBLE: Supports older field names
 */
export function resolveCurrentLocation(character) {
  // AUTHORITY: resolved_current_location_id is the source of truth if set
  if (character.resolved_current_location_id) {
    return character.resolved_current_location_id;
  }

  // FALLBACK: current_location_id (or legacy current_location)
  if (character.current_location_id) {
    return character.current_location_id;
  }

  // LEGACY: older field names
  if (character.current_location) {
    return character.current_location;
  }

  // HOME: If nowhere else specified, they're home
  const homeId = character.current_home_location_id || character.home_location_id || character.home_location;
  return homeId || null;
}

/**
 * Resolve the authoritative home location for a character
 * LEGACY COMPATIBLE: Supports older field names
 */
export function resolveHomeLocation(character) {
  return character.current_home_location_id 
    || character.home_location_id 
    || character.home_location 
    || character.residence_location_id 
    || null;
}

/**
 * Build the authoritative avatar list for a character
 * Returns [avatar_url] in priority order
 * 
 * LEGACY COMPATIBLE: Supports older field names (photo_url, profile_image_url, etc.)
 */
export function resolveCharacterAvatars(character) {
  const avatars = [];

  // Priority 1: avatar_url (primary source)
  if (character.avatar_url) {
    avatars.push(character.avatar_url);
  }

  // Priority 1b: Legacy photo_url or profile_image_url
  if (!character.avatar_url && !avatars.includes(character.photo_url) && character.photo_url) {
    avatars.push(character.photo_url);
  }
  if (!avatars.includes(character.profile_image_url) && character.profile_image_url) {
    avatars.push(character.profile_image_url);
  }

  // Priority 2: image_avatar_url (fallback)
  if (character.image_avatar_url && !avatars.includes(character.image_avatar_url)) {
    avatars.push(character.image_avatar_url);
  }

  // Priority 3: reference_image_urls (or legacy reference_images)
  const refImages = character.reference_image_urls || character.reference_images || [];
  if (Array.isArray(refImages)) {
    refImages.forEach(url => {
      if (url && !avatars.includes(url)) avatars.push(url);
    });
  }

  // Priority 4: generated_avatar_urls (or legacy generated_avatars)
  const genAvatars = character.generated_avatar_urls || character.generated_avatars || [];
  if (Array.isArray(genAvatars)) {
    genAvatars.forEach(url => {
      if (url && !avatars.includes(url)) avatars.push(url);
    });
  }

  return avatars;
}

/**
 * Build the authoritative internal family list with avatars
 * For residential Scene image generation
 */
export function resolveInternalFamilyWithAvatars(character) {
  if (!character.family_members || character.family_members.length === 0) {
    return [];
  }

  return character.family_members.map(fm => ({
    id: `family_${fm.name?.replace(/\s+/g, '_')}`,
    name: fm.name,
    relationship_type: fm.relationship_type,
    avatar_url: fm.photo_url, // Internal family avatar
    age: fm.age,
    isFamily: true,
  })).filter(f => f.name); // Only include named family members
}

/**
 * Resolve zone-specific images from a location
 * Ensures no cross-zone contamination
 */
export function resolveZoneImages(location, zoneName) {
  if (!location.zones || !Array.isArray(location.zones)) {
    return [];
  }

  const zone = location.zones.find(z => z.zone_name === zoneName);
  if (!zone || !zone.image_urls || !Array.isArray(zone.image_urls)) {
    return [];
  }

  return zone.image_urls;
}

/**
 * Build avatar reference stack for image generation
 * Order: identity (avatars) first, then environment
 */
export function buildAvatarReferenceStack(people, locationImages = []) {
  const stack = [];

  // Add character avatars FIRST (identity authority)
  people.forEach(person => {
    if (person.avatar_url) {
      stack.push(person.avatar_url);
    } else if (person.image_avatar_url) {
      stack.push(person.image_avatar_url);
    }
  });

  // Add location/zone images SECOND (environment)
  locationImages.forEach(img => {
    if (img && !stack.includes(img)) {
      stack.push(img);
    }
  });

  return stack;
}

/**
 * Validate that character data is consistent before image generation
 */
export function validateCharacterForImageGeneration(character) {
  const errors = [];

  // Check location resolution
  const currentLoc = resolveCurrentLocation(character);
  if (!currentLoc) {
    errors.push(`No current location resolved for ${character.name}`);
  }

  // Check avatar availability
  const avatars = resolveCharacterAvatars(character);
  if (avatars.length === 0) {
    errors.push(`No avatars available for ${character.name}`);
  }

  // Check character type support
  const supportsFullSim = ['active_created_character', 'npc_fictitious_character'].includes(character.character_type);
  if (!supportsFullSim && character.character_type !== 'user') {
    errors.push(`Character type '${character.character_type}' may not support full simulation`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Resolve narrative eligibility based on shared truth
 * LEGACY COMPATIBLE: Supports older field names and character types
 */
export function resolveNarrativeEligibility(character) {
  const reasons = [];

  // Check 1: Character type (support legacy type names)
  const charType = character.character_type || character.char_type || 'active_created_character';
  const supportsNarratives = ['active_created_character', 'npc_fictitious_character', 'character', 'npc'].includes(charType);
  if (!supportsNarratives) {
    reasons.push('unsupported_character_type');
    return { eligible: false, reasons };
  }

  // Check 2: Status (support legacy status field names)
  const status = character.status || character.char_status || 'active';
  if (status !== 'active') {
    reasons.push('not_active');
  }

  // Check 3: Test flag (support legacy test_character field)
  const isTest = character.is_test_character || character.diagnostic_only || character.test_character === true;
  if (isTest) {
    reasons.push('test_or_diagnostic');
  }

  // Check 4: Overdue (support legacy last_narrative_at field)
  const lastNarrative = character.last_autonomous_narrative_at || character.last_narrative_at;
  const daysSince = lastNarrative ? Math.floor((Date.now() - new Date(lastNarrative)) / (1000 * 60 * 60 * 24)) : null;
  const isOverdue = !lastNarrative || daysSince > 1;

  if (!isOverdue && lastNarrative) {
    reasons.push('narrative_too_recent');
  }

  // Check 5: Narrative mode
  const narrativeMode = character.narrative_mode;
  if (narrativeMode === 'manual') {
    reasons.push('narrative_mode_manual');
  }

  const eligible = reasons.length === 0;
  return { eligible, reasons, lastNarrative, daysSince };
}

/**
 * Resolve travel eligibility based on shared truth
 * LEGACY COMPATIBLE: Supports older field names and character types
 */
export function resolveTravelEligibility(character) {
  const reasons = [];

  // Check 1: Character type (support legacy type names)
  const charType = character.character_type || character.char_type || 'active_created_character';
  const canTravel = ['active_created_character', 'npc_fictitious_character', 'character', 'npc'].includes(charType);
  if (!canTravel) {
    reasons.push('unsupported_character_type');
    return { eligible: false, reasons };
  }

  // Check 2: Has home location
  const homeLocation = resolveHomeLocation(character);
  if (!homeLocation) {
    reasons.push('no_home_location');
  }

  // Check 3: Currently at home (or unplaced)
  const currentLocation = resolveCurrentLocation(character);
  if (currentLocation && currentLocation !== homeLocation) {
    reasons.push('already_traveling');
  }

  // Check 4: Not already in transit (support legacy travel_status field)
  const travelStatus = character.travel_status || character.travel_state;
  if (travelStatus === 'traveling' || travelStatus === 'in_transit') {
    reasons.push('already_in_transit');
  }

  const eligible = reasons.length === 0;
  return { eligible, reasons };
}

/**
 * Log the truth state for debugging
 */
export function logTruthState(character, context = '') {
  const location = resolveCurrentLocation(character);
  const home = resolveHomeLocation(character);
  const avatars = resolveCharacterAvatars(character);
  const narrativeEligible = resolveNarrativeEligibility(character);
  const travelEligible = resolveTravelEligibility(character);

  console.log(`[TRUTH STATE] ${context || character.name}`);
  console.log(`  Location: current=${location}, home=${home}`);
  console.log(`  Avatar: ${avatars.length} source(s)`);
  console.log(`  Narrative: ${narrativeEligible.eligible ? 'ELIGIBLE' : `INELIGIBLE (${narrativeEligible.reasons.join(', ')})`}`);
  console.log(`  Travel: ${travelEligible.eligible ? 'ELIGIBLE' : `INELIGIBLE (${travelEligible.reasons.join(', ')})`}`);
}