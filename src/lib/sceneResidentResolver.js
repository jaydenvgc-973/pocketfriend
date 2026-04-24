/**
 * Scene Resident Resolver — Unified People Discovery
 * 
 * Single source of truth for all residents, family members, workers, and NPCs
 * visible in a scene. Used by both the Who's Here panel and image generation.
 * 
 * Returns standardized person objects with guaranteed avatar/reference image data.
 */

/**
 * Resolves all people present at a location for a specific user account
 * Returns a single authoritative list used by both UI and image generation
 * 
 * @param {Object} location - LocationReference entity
 * @param {Array} characters - All active_created_character records for this user
 * @param {Object} currentUser - Authenticated user
 * @returns {Array} Resolved people list with avatar_url, reference_image_urls, and source tracking
 */
export function resolveScenePeople(location, characters = [], currentUser = null) {
  if (!location) return [];

  const people = [];
  const seen = new Set();

  const add = (person) => {
    if (!person || !person.id) return;
    if (seen.has(person.id)) return;
    seen.add(person.id);
    people.push(person);
  };

  // ── RESIDENTS: Real Character entities living here ────────────────────────
  characters.forEach(char => {
    if (!char || char.isNpc || char.character_type === 'family_npc') return;
    const isLivingHere = char.current_home_location_id === location.id;
    const isPhysicallyHere = char.resolved_current_location_id === location.id;

    if (isLivingHere || isPhysicallyHere) {
      const person = {
        id: char.id,
        display_name: char.name,
        character_type: 'active_created_character',
        resident_status: 'resident',
        presence_status: isPhysicallyHere ? 'physically_present' : 'resident',
        parent_active_character_id: null, // this IS an active_created_character
        avatar_url: char.avatar_url || null,
        reference_image_urls: char.reference_image_urls || [],
        source: 'active_created_character_resident',
        source_id: char.id,
      };
      console.log(`[sceneResidentResolver] RESIDENT: "${char.name}" (${char.id}) | avatar: ${!!person.avatar_url}`);
      add(person);
    }
  });

  // ── FAMILY MEMBERS: Internal family files from parent active_created_character ────
  // Build a map of parent character to their family members for source tracking
  const familyMemberMap = {}; // "Thomas" -> { parentCharId: "ethan_id", avatar_url: "...", ... }
  characters.forEach(char => {
    if (!char.family_members) return;
    char.family_members.forEach(fm => {
      if (fm?.name) {
        familyMemberMap[fm.name.trim().toLowerCase()] = {
          parentCharId: char.id,
          parentCharName: char.name,
          avatar_url: fm.photo_url || null,
          source_character: char,
        };
      }
    });
  });

  // Now match resident_family_members to their parent character data
  (location.resident_family_members || []).forEach(fm => {
    if (!fm?.name) return;

    const key = fm.name.trim().toLowerCase();
    const parentData = familyMemberMap[key];

    if (parentData) {
      const person = {
        id: `resident_family_${fm.name.replace(/\s+/g, '_')}_${parentData.parentCharId}`,
        display_name: fm.name,
        character_type: 'family_npc',
        resident_status: 'resident',
        presence_status: 'resident',
        parent_active_character_id: parentData.parentCharId,
        parent_active_character_name: parentData.parentCharName,
        avatar_url: parentData.avatar_url || null,
        reference_image_urls: [],
        source: 'internal_family_file',
        source_id: `family_${fm.name}_of_${parentData.parentCharId}`,
      };
      console.log(`[sceneResidentResolver] FAMILY RESIDENT: "${fm.name}" | parent: "${parentData.parentCharName}" (${parentData.parentCharId}) | avatar: ${!!person.avatar_url}`);
      add(person);
    } else {
      // Not found in parent characters — still add to preserve name constraint
      const person = {
        id: `resident_family_${fm.name.replace(/\s+/g, '_')}_unknown`,
        display_name: fm.name,
        character_type: 'family_npc',
        resident_status: 'resident',
        presence_status: 'resident',
        parent_active_character_id: fm.source_character_id || null,
        avatar_url: null,
        reference_image_urls: [],
        source: 'internal_family_file_unmatched',
        source_id: null,
      };
      console.warn(`[sceneResidentResolver] FAMILY RESIDENT UNMATCHED: "${fm.name}" | source_character_id: ${fm.source_character_id || 'unknown'} | avatar: false`);
      add(person);
    }
  });

  // ── LISTED RESIDENTS: Explicit location.residents array ─────────────────
  (location.residents || []).forEach(resident => {
    if (!resident?.character_id) return;
    const char = characters.find(c => c.id === resident.character_id);
    if (char && !seen.has(resident.character_id)) {
      // Already added above, skip
      return;
    }
    if (!char) {
      // Listed but not in characters array — add stub
      const person = {
        id: resident.character_id,
        display_name: resident.character_name || 'Resident',
        character_type: 'unknown',
        resident_status: 'listed_resident',
        presence_status: 'unknown',
        parent_active_character_id: null,
        avatar_url: null,
        reference_image_urls: [],
        source: 'location_residents_array',
        source_id: resident.character_id,
      };
      console.warn(`[sceneResidentResolver] LISTED RESIDENT NOT IN CHARACTERS: "${resident.character_name}" (${resident.character_id})`);
      add(person);
    }
  });

  // ── CURRENT USER: if they physically traveled here ─────────────────────
  if (currentUser) {
    const person = {
      id: currentUser.id || 'user',
      display_name: currentUser.fictional_world_name || currentUser.full_name || 'You',
      character_type: 'user',
      resident_status: 'user',
      presence_status: 'present',
      parent_active_character_id: null,
      avatar_url: currentUser.generated_avatar_urls?.[0] || currentUser.avatar_url || null,
      reference_image_urls: currentUser.generated_avatar_urls || [],
      source: 'authenticated_user',
      source_id: currentUser.id,
    };
    console.log(`[sceneResidentResolver] USER: "${person.display_name}" | avatar: ${!!person.avatar_url}`);
    add(person);
  }

  console.log(`[sceneResidentResolver] TOTAL PEOPLE: ${people.length}`);
  return people;
}

/**
 * Matches user-selected person name against resolved people list
 * Returns the fully resolved person object with avatar/reference data
 * 
 * Used when a user selects a name for image generation — ensures we use
 * the exact resolved object with all identity data, not a new lookup.
 */
export function resolveSelectedPerson(selectedName, resolvedPeople = []) {
  if (!selectedName || !resolvedPeople.length) return null;

  const normalized = selectedName.trim().toLowerCase();
  const match = resolvedPeople.find(p =>
    p.display_name?.trim().toLowerCase() === normalized
  );

  if (match && match.avatar_url) {
    console.log(`[sceneResidentResolver] SELECTED PERSON MATCHED: "${match.display_name}" | avatar: ${!!match.avatar_url} | source: ${match.source}`);
  } else if (match) {
    console.warn(`[sceneResidentResolver] SELECTED PERSON MATCHED BUT NO AVATAR: "${match.display_name}" | source: ${match.source}`);
  } else {
    console.warn(`[sceneResidentResolver] SELECTED PERSON NOT FOUND: "${selectedName}"`);
  }

  return match || null;
}

/**
 * Validates that selected people have avatars available
 * Returns list of people with avatar_url found and missing
 * Used to detect cases where Who's Here shows an avatar but image gen doesn't have it
 */
export function validateSelectedPeopleAvatars(selectedPeople = []) {
  const validation = {
    total_selected: selectedPeople.length,
    with_avatar: [],
    without_avatar: [],
  };

  selectedPeople.forEach(person => {
    if (person.avatar_url) {
      validation.with_avatar.push({
        name: person.display_name,
        avatar_url: person.avatar_url,
        source: person.source,
      });
    } else {
      validation.without_avatar.push({
        name: person.display_name,
        source: person.source,
      });
    }
  });

  if (validation.without_avatar.length > 0) {
    console.warn(
      `[sceneResidentResolver] VALIDATION FAILED: ${validation.without_avatar.length} selected people have no avatar`,
      validation.without_avatar
    );
  }

  return validation;
}