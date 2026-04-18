/**
 * Residential Scene Image Person Filtering
 * 
 * Enforces strict resident-only rule for residential locations.
 * Non-residential locations may include crowd/background people.
 */

/**
 * Determines if a location is residential
 */
export function isResidentialLocation(location) {
  if (!location) return false;
  const resTypes = ['home', 'residence', 'house', 'apartment', 'condo'];
  const locType = (location.location_type || '').toLowerCase();
  return resTypes.includes(locType);
}

/**
 * Resolves valid people for a scene image based on residency rules
 * 
 * @param {Object} sceneLocation - The current location
 * @param {Array} allCharactersInScene - All characters potentially in the scene
 * @param {Object} currentUser - The user object
 * @param {boolean} includeUser - Whether to include user in the image
 * @returns {Array} Filtered list of valid people to show in the image
 */
export function resolveSceneImagePeople(
  sceneLocation,
  allCharactersInScene = [],
  currentUser = null,
  includeUser = false
) {
  // If not residential, allow multi-person public crowd logic
  if (!isResidentialLocation(sceneLocation)) {
    return resolveNonResidentialPeople(sceneLocation, allCharactersInScene, currentUser, includeUser);
  }

  // RESIDENTIAL LOCATION: Strict resident-only rule
  const allowedPeople = [];

  // Add valid residents
  const residentIds = sceneLocation.resident_ids || [];
  const residents = allCharactersInScene.filter(char =>
    residentIds.includes(char.id) || (char.home_location_id === sceneLocation.id)
  );
  allowedPeople.push(...residents);

  // Optionally add user
  if (includeUser && currentUser) {
    // Check if user already in list
    const userAlreadyIncluded = allowedPeople.some(p => p.id === 'user' || p.is_user);
    if (!userAlreadyIncluded) {
      allowedPeople.push(currentUser);
    }
  }

  return allowedPeople;
}

/**
 * Resolves people for non-residential (public) locations
 * Allows multi-person and background crowd generation
 */
function resolveNonResidentialPeople(
  sceneLocation,
  allCharactersInScene = [],
  currentUser = null,
  includeUser = false
) {
  const allowedPeople = [];

  // For public locations, include relevant characters from the scene
  allowedPeople.push(...allCharactersInScene);

  // Add user if applicable
  if (includeUser && currentUser) {
    const userAlreadyIncluded = allowedPeople.some(p => p.id === 'user' || p.is_user);
    if (!userAlreadyIncluded) {
      allowedPeople.push(currentUser);
    }
  }

  return allowedPeople;
}

/**
 * Builds image prompt segment restricting people for residential locations
 * Adds explicit instructions to image generation about allowed people
 */
export function buildResidentialImageConstraint(
  sceneLocation,
  allowedPeople = []
) {
  if (!isResidentialLocation(sceneLocation)) {
    return ''; // No constraint for non-residential
  }

  const peopleNames = allowedPeople
    .map(p => p.name || p.fictional_world_name || 'the user')
    .filter(Boolean);

  if (peopleNames.length === 0) {
    return `\n\n🏠 RESIDENTIAL PRIVACY LOCK:\nThis is a private residence. Only people who live here may appear in this image. No random strangers, crowd extras, or unrelated people.`;
  }

  const allowedList = peopleNames.join(', ');
  return `\n\n🏠 RESIDENTIAL OCCUPANT ONLY:\nThis is a private home. The ONLY people allowed in this image are the residents: ${allowedList}.\nAbsolutely NO random strangers, crowd filler, unknown background people, or unrelated NPCs.\nIf only one person lives here, only that person may appear (plus user if included).`;
}

/**
 * Validates that generated image people match residential rules
 * Returns warning if non-residents were likely generated
 */
export function validateResidentialImageCompliance(
  sceneLocation,
  promptUsed = ''
) {
  if (!isResidentialLocation(sceneLocation)) return { valid: true };

  // Check if prompt includes residential constraint
  const hasResidentialConstraint = promptUsed.includes('RESIDENTIAL OCCUPANT ONLY') ||
    promptUsed.includes('RESIDENTIAL PRIVACY LOCK') ||
    promptUsed.includes('private home') ||
    promptUsed.includes('residents only');

  if (!hasResidentialConstraint) {
    console.warn(
      `[COMPLIANCE] Residential location ${sceneLocation.name} image may lack occupant filtering.`
    );
    return {
      valid: false,
      warning: 'Residential constraint not found in prompt'
    };
  }

  return { valid: true };
}