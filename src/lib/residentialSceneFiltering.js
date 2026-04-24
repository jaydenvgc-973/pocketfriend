/**
 * Residential Scene Image Person Filtering
 *
 * Enforces strict resident-only rule for residential (home category) locations.
 * The ONLY sources of truth for who may appear in a home scene image are:
 *   1. location.residents[].character_id  — explicit residents array
 *   2. location.resident_family_members[] — family NPCs listed on the location
 *   3. character.current_home_location_id === location.id (active_created_character residents)
 *   4. character.resolved_current_location_id === location.id (confirmed physically present)
 *   5. The current user, if they physically traveled here
 *
 * NOT valid sources:
 *   - location.owner_character_id / owner_npc_name (ownership ≠ residence)
 *   - location.character_id / assigned_character_id (character-specific access ≠ residence)
 *   - backend owner / created_by (data ownership ≠ physical residence)
 *   - worker_character_ids (employment ≠ residence)
 *   - Any ambient/generic NPCs
 */

/**
 * Determines if a location is a private residence.
 * Uses category === 'home' which is the authoritative field in this app.
 */
export function isResidentialLocation(location) {
  if (!location) return false;
  // Primary check: category field (authoritative in this app)
  if (location.category === 'home') return true;
  // Legacy fallback: location_type string
  const locType = (location.location_type || '').toLowerCase();
  if (['home', 'residence', 'house', 'apartment', 'condo'].includes(locType)) return true;
  return false;
}

/**
 * Resolves the allowed_people list for a scene image.
 *
 * For residential locations: strict resident-only rule.
 * For non-residential: pass-through (public crowd logic handled by caller).
 *
 * @param {Object} sceneLocation - The LocationReference record
 * @param {Array} allCharactersInScene - Characters already determined to be in the scene by the caller
 * @param {Object} currentUser - The authenticated user object
 * @param {boolean} includeUser - Whether the user physically traveled here
 * @returns {Array} Filtered list of valid people for image generation
 */
export function resolveSceneImagePeople(
  sceneLocation,
  allCharactersInScene = [],
  currentUser = null,
  includeUser = false
) {
  if (!isResidentialLocation(sceneLocation)) {
    // Non-residential: return as-is, caller handles public crowd rules
    return allCharactersInScene;
  }

  // ── RESIDENTIAL: build allowed_people from authoritative sources only ──────

  const allowedPeople = [];
  const seenIds = new Set();

  const add = (person) => {
    if (!person || !person.id) return;
    if (seenIds.has(person.id)) return;
    seenIds.add(person.id);
    allowedPeople.push(person);
  };

  // SOURCE 1: characters who are confirmed physically present at this location
  // resolved_current_location_id is the single authoritative location truth
  allCharactersInScene.forEach(char => {
    if (!char || char.isNpc) return; // real Character entities only in this pass
    // Must be currently at this location OR living here
    const isLivingHere = char.current_home_location_id === sceneLocation.id;
    const isPhysicallyHere = char.resolved_current_location_id === sceneLocation.id;
    if (isLivingHere || isPhysicallyHere) {
      add(char);
    }
  });

  // SOURCE 2: residents explicitly listed in location.residents array
  (sceneLocation.residents || []).forEach(resident => {
    if (!resident?.character_id) return;
    // Find the full character object if available in the passed-in array
    const charObj = allCharactersInScene.find(c => c.id === resident.character_id);
    if (charObj) {
      add(charObj);
    } else {
      // Resident is listed but not in our character array — add as minimal stub
      // (prevents their absence from causing a random stranger to be generated instead)
      add({ id: resident.character_id, name: resident.character_name || 'Resident', isResident: true });
    }
  });

  // SOURCE 3: resident_family_members listed on the location record
  // These are NPC family members who LIVE here — treat as valid residents
  (sceneLocation.resident_family_members || []).forEach(fm => {
    if (!fm?.name) return;
    // Only include if they are in the passed-in scene array (i.e. caller confirmed them present)
    const fmObj = allCharactersInScene.find(c =>
      c.isNpc && c.name?.trim().toLowerCase() === fm.name.trim().toLowerCase()
    );
    if (fmObj) {
      add(fmObj);
    }
    // If not in scene array, do NOT invent them — the caller (Scene.jsx) decides who is present
  });

  // SOURCE 4: the current user, if they physically traveled here
  if (includeUser && currentUser) {
    const userEntry = { ...currentUser, id: currentUser.id || 'user', is_user: true };
    add(userEntry);
  }

  return allowedPeople;
}

/**
 * Builds image prompt segment restricting people for residential locations.
 * Returns an empty string for non-residential locations.
 */
export function buildResidentialImageConstraint(sceneLocation, allowedPeople = []) {
  if (!isResidentialLocation(sceneLocation)) {
    return '';
  }

  const peopleNames = allowedPeople
    .map(p => p.name || p.fictional_world_name || null)
    .filter(Boolean);

  if (peopleNames.length === 0) {
    return `\n\nRESIDENTIAL PRIVACY LOCK — ABSOLUTE RULE: This is a private home. There are NO people in this image whatsoever. No humans, no silhouettes, no background figures, no shadows of people. Only the room itself. Any person in this image is a generation failure.`;
  }

  const allowedList = peopleNames.join(', ');
  return `\n\nRESIDENTIAL OCCUPANT LOCK — ABSOLUTE RULE: This is a private home. The ONLY people who may appear are the actual residents/occupants: ${allowedList}. Nobody else exists in this home. No strangers, no crowd filler, no background figures, no landlords, no owners, no random people. If a person appears who is not in this list, it is a generation failure. Do not add people to "fill" the scene.`;
}

/**
 * Validates that a prompt for a residential location includes the proper constraint.
 */
export function validateResidentialImageCompliance(sceneLocation, promptUsed = '') {
  if (!isResidentialLocation(sceneLocation)) return { valid: true };

  const hasConstraint =
    promptUsed.includes('RESIDENTIAL OCCUPANT LOCK') ||
    promptUsed.includes('RESIDENTIAL PRIVACY LOCK') ||
    promptUsed.includes('private home') ||
    promptUsed.includes('residents only');

  if (!hasConstraint) {
    console.warn(`[residentialSceneFiltering] Residential location "${sceneLocation.name}" image prompt lacks occupant filtering.`);
    return { valid: false, warning: 'Residential constraint not found in prompt' };
  }

  return { valid: true };
}