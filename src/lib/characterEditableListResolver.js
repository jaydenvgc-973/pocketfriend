/**
 * UNIFIED CHARACTER RESOLVER + PRESENCE ENGINE
 * 
 * Enforces strict user scope isolation, character type filtering, and legacy fallbacks.
 * Provides unified presence resolution for all location/travel/world systems.
 * 
 * Rules:
 * - User scope comes FIRST (owner_user_id, owner_email, or assigned scope)
 * - Character type is resolved only AFTER scope validation
 * - Legacy records are safely resolved via fallback chain
 * - Service-created records included if user-owned (NOT excluded by created_by)
 * - Presence truth is single-source (resolved_current_location_id, residency assignment)
 * - Family characters are world-presence entities (map, popup, counts)
 * - Age rules enforce movement, access, supervision constraints
 * - No cross-account contamination
 * - No UI-only filtering (all filtering is data-level)
 */

/**
 * CORE RESOLVER: Get all user-scoped characters with resolved types.
 * This is the foundation for ALL character discovery.
 * 
 * @param {Array} allCharacters - raw character list from query
 * @param {string} currentUserId - logged-in user ID
 * @param {string} currentUserEmail - logged-in user email
 * @returns {Array} all characters owned by current user with resolved types
 */
export function resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail) {
  if (!allCharacters || !Array.isArray(allCharacters)) return [];
  if (!currentUserId && !currentUserEmail) return [];

  return allCharacters
    .filter(char => isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail))
    .map(char => ({
      ...char,
      _resolvedType: resolveCharacterType(char),
      _displayName: resolveDisplayName(char),
      _avatarUrl: resolveAvatarUrl(char),
    }));
}

/**
 * Resolve which characters are eligible for editing in a given Settings module.
 * 
 * @param {Array} allCharacters - raw character list from query
 * @param {string} currentUserId - logged-in user ID
 * @param {string} currentUserEmail - logged-in user email
 * @param {string} moduleType - Settings module: "story", "photos", "emotions", "relationships", "traits", "religion", "locations", "work_school", "needs"
 * @returns {Array} filtered and validated characters eligible for editing
 */
export function getEditableCharactersForModule(allCharacters, currentUserId, currentUserEmail, moduleType) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  return scoped.filter(char => isCharacterEligibleForModule(char._resolvedType, moduleType));
}

/**
 * Get characters for homepage display.
 * 
 * @returns {Object} { activeCharacters, npcFictitious, allForLocationSystems }
 */
export function getCharactersForHomepage(allCharacters, currentUserId, currentUserEmail) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  return {
    activeCharacters: scoped.filter(c => c._resolvedType === 'active_created_character'),
    npcFictitious: scoped.filter(c => c._resolvedType === 'npc_fictitious'),
    // For location systems: include all valid types
    allForLocationSystems: scoped.filter(c => 
      ['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(c._resolvedType)
    ),
  };
}

/**
 * Get settings character list with strict type ordering.
 * Order: user, active_created_character, npc_fictitious, npc_family_member
 * 
 * @returns {Array} ordered list suitable for Settings → Manage Characters
 */
export function getCharactersForSettingsList(allCharacters, currentUserId, currentUserEmail, currentUserObject) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  // Define sort order
  const typeOrder = {
    'user': 0,
    'active_created_character': 1,
    'npc_fictitious': 2,
    'npc_family_member': 3,
    'npc_regular': 4,
    'unknown': 5,
  };
  
  const userCharacters = scoped.filter(c => c._resolvedType === 'active_created_character' || c._resolvedType === 'npc_fictitious' || c._resolvedType === 'npc_family_member');
  
  // Sort by type order, then by name
  return userCharacters.sort((a, b) => {
    const aOrder = typeOrder[a._resolvedType] ?? 99;
    const bOrder = typeOrder[b._resolvedType] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return (a._displayName || '').localeCompare(b._displayName || '');
  });
}

/**
 * Get all characters for location-based systems (residence, work, school, presence).
 * Includes: active_created_character, npc_fictitious, npc_family_member
 */
export function getCharactersForLocationSystems(allCharacters, currentUserId, currentUserEmail) {
  const scoped = resolveUserScopedCharacters(allCharacters, currentUserId, currentUserEmail);
  
  return scoped.filter(c => 
    ['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(c._resolvedType)
  );
}

/**
 * Check if a character belongs to the current user's scope.
 * Uses safe fallback chain to handle legacy records.
 *
 * LEGACY COMPATIBILITY: Characters created before ownership fields were introduced
 * may have null/missing owner_email and owner_user_id. These characters are
 * ALREADY RLS-scoped by the query that loaded them (filter by owner_email at the
 * query layer). If they arrived in the allCharacters array, the query already
 * confirmed ownership. The check here is a secondary guard — it must not exclude
 * valid legacy records that passed RLS but lack the newer ownership fields.
 *
 * RULE: If at least one ownership signal matches OR both ownership fields are
 * absent (legacy record that passed RLS), treat as owned. Only exclude when an
 * ownership field is PRESENT but does NOT match (active mismatch = wrong account).
 */
function isCharacterOwnedByCurrentUser(character, currentUserId, currentUserEmail) {
  if (!character) return false;

  // 1. owner_email present and matches — confirmed owned
  if (character.owner_email && character.owner_email === currentUserEmail) {
    return true;
  }

  // 2. owner_email present but does NOT match — active mismatch, exclude
  if (character.owner_email && character.owner_email !== currentUserEmail) {
    return false;
  }

  // 3. owner_email is absent — check owner_user_id
  if (character.owner_user_id && character.owner_user_id === currentUserId) {
    return true;
  }

  // 4. owner_user_id present but does NOT match — active mismatch, exclude
  if (character.owner_user_id && character.owner_user_id !== currentUserId) {
    return false;
  }

  // 5. Legacy record: BOTH owner_email and owner_user_id are absent/null.
  // This character arrived via an owner_email-scoped RLS query — the platform
  // already verified ownership at the data layer. Trust the query result.
  // Mark it as needing a compatibility repair pass but DO NOT exclude it.
  if (!character.owner_email && !character.owner_user_id) {
    console.warn(
      `[characterEditableListResolver] Legacy character "${character.name}" (${character.id}) ` +
      `has no owner_email or owner_user_id — treating as owned (passed RLS). Needs compat repair.`
    );
    return true;
  }

  // 6. Additional legacy fields (assigned_user_id, profile_owner)
  if (character.assigned_user_id && character.assigned_user_id === currentUserId) return true;
  if (character.profile_owner && character.profile_owner === currentUserEmail) return true;

  return false;
}

/**
 * Resolve character type safely, handling legacy records.
 * Only call after user scope is validated.
 *
 * LEGACY COMPATIBILITY: character_type may be null/absent on older records.
 * NEVER return 'unknown' as the terminal state — unknown-typed characters become
 * invisible because no UI module includes 'unknown' in its allowed types.
 * Always resolve to the most appropriate valid type using the fallback chain.
 */
function resolveCharacterType(character) {
  if (!character) return 'active_created_character'; // safest visible default

  // If character_type is explicitly set and valid, use it
  const validTypes = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular', 'ambient'];
  if (character.character_type && validTypes.includes(character.character_type)) {
    return character.character_type;
  }

  // LEGACY FALLBACK: infer type from behavior/data if character_type is missing.
  // This path runs ONLY for legacy records with null/absent character_type.
  // It must produce a visible type — never 'unknown'.

  // If it's explicitly marked as family → npc_family_member
  if (character.is_family_member || character.relationship_type === 'family') {
    return 'npc_family_member';
  }

  // If it has full editable story, needs, schedule, etc. → active_created_character
  if (hasFullEditableProfile(character)) {
    return 'active_created_character';
  }

  // If it's in "People in their world" and is standalone (not family) → npc_fictitious
  if (character.fictional_relationships?.length > 0 && !character.is_family_member) {
    return 'npc_fictitious';
  }

  // Final fallback: default to active_created_character so the character remains
  // visible everywhere active characters are shown. This is the safest visible default
  // for legacy records that predate the character_type field entirely.
  console.warn(
    `[resolveCharacterType] Legacy character "${character.name}" (${character.id}) ` +
    `has no character_type — defaulting to active_created_character for visibility.`
  );
  return 'active_created_character';
}

/**
 * Check if character has full editable profile (legacy type resolution heuristic).
 */
function hasFullEditableProfile(character) {
  // Characters with these traits are likely active_created_character
  const hasProfileData = character.backstory || character.personality_traits || character.emotional_state;
  const hasSchedule = character.wake_up_time || character.sleep_start_time;
  const hasNeeds = character.hunger_value !== undefined || character.energy_value !== undefined;
  
  return hasProfileData && (hasSchedule || hasNeeds);
}

/**
 * Safely resolve display name for a character.
 */
function resolveDisplayName(character) {
  return character.display_name || character.primary_name || character.full_name || character.name || 'Unknown';
}

/**
 * Safely resolve avatar URL for a character.
 */
function resolveAvatarUrl(character) {
  return character.avatar_url || character.image_avatar_url || null;
}

/**
 * Resolve initials for fallback avatar display.
 */
function resolveInitials(character) {
  const name = resolveDisplayName(character);
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Determine if a resolved character type is eligible for a specific Settings module.
 */
function isCharacterEligibleForModule(resolvedType, moduleType) {
  // Most Settings modules: active_created_character + npc_fictitious
  const standardAllowed = ['active_created_character', 'npc_fictitious'];

  switch (moduleType) {
    // Special case: Needs editing is ONLY for active_created_character
    case 'needs':
      return resolvedType === 'active_created_character';

    // Standard modules: allow active_created + npc_fictitious
    case 'story':
    case 'photos':
    case 'emotions':
    case 'relationships':
    case 'traits':
    case 'religion':
    case 'locations':
    case 'work_school':
    case 'default_character':
    case 'profile':
      return standardAllowed.includes(resolvedType);

    // Fallback: deny unknown modules
    default:
      return false;
  }
}

/**
 * Helper: Hydrate a character ID to a displayable character object.
 * Used for residency lists, relationship displays, etc.
 * 
 * Returns { name, avatarUrl, type, initials } suitable for UI rendering.
 * NEVER returns raw ID — always resolves to displayable object or null.
 */
export function hydrateCharacterReference(characterId, allCharacters, currentUserId, currentUserEmail) {
  const char = allCharacters.find(c => c.id === characterId);
  if (!char) {
    return null;
  }
  
  // Validate it's in current user scope
  if (!isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail)) {
    return null;
  }
  
  return {
    id: char.id,
    name: resolveDisplayName(char),
    avatarUrl: resolveAvatarUrl(char),
    type: resolveCharacterType(char),
    initials: resolveInitials(char),
  };
}

/**
 * Batch hydrate character IDs to displayable objects.
 * Filters out invalid IDs and cross-account characters automatically.
 */
export function hydrateCharacterReferences(characterIds, allCharacters, currentUserId, currentUserEmail) {
  if (!Array.isArray(characterIds)) return [];
  
  return characterIds
    .map(id => hydrateCharacterReference(id, allCharacters, currentUserId, currentUserEmail))
    .filter(Boolean);
}

/**
 * Helper: Get minimal character info for a character ID lookup.
 * Ensures the lookup result respects user scope.
 */
export function findCharacterInScope(characterId, allCharacters, currentUserId, currentUserEmail) {
  const char = allCharacters.find(c => c.id === characterId);
  if (!char) return null;
  
  // Validate it's in current user scope
  if (!isCharacterOwnedByCurrentUser(char, currentUserId, currentUserEmail)) {
    return null;
  }
  
  return char;
}

/**
 * UNIFIED PRESENCE RESOLVER
 * 
 * Determines world-presence state for a character at a location.
 * Used by Travel page, map, popups, resident lists, and counts.
 * 
 * Returns { isPresent, presenceStatus, isResident, reasonCode }
 */
export function resolveCharacterPresenceAtLocation(character, location, currentTime = new Date()) {
  if (!character || !location) {
    return { isPresent: false, presenceStatus: null, isResident: false, reasonCode: 'invalid_input' };
  }

  // Check if character is assigned as a resident
  const isResident = (location.resident_character_ids || []).includes(character.id) ||
    (location.resident_family_members || []).some(fm => fm.name?.toLowerCase() === (character.name || '').toLowerCase());

  // If character is traveling elsewhere, not present here
  if (character.resolved_current_location_id && character.resolved_current_location_id !== location.id) {
    return {
      isPresent: false,
      presenceStatus: 'away',
      isResident,
      reasonCode: 'traveling_elsewhere'
    };
  }

  // Check resolved_current_location_id (authoritative)
  if (character.resolved_current_location_id === location.id) {
    const status = character.resolved_presence_status || 'visiting';
    return {
      isPresent: true,
      presenceStatus: status,
      isResident,
      reasonCode: 'at_location'
    };
  }

  // Home fallback: resident with no explicit location elsewhere → treat as home.
  // ONLY applies to npc_fictitious and npc_family_member.
  // active_created_character MUST NOT use this fallback — they are travel-capable and can only be
  // physically present where their resolved_current_location_id points. Using the home fallback for
  // them causes duplicate presence (appearing both at their actual location AND at home).
  if (character.character_type !== 'active_created_character' &&
      isResident && character.current_home_location_id === location.id) {
    return {
      isPresent: true,
      presenceStatus: 'home',
      isResident,
      reasonCode: 'home_and_not_traveling'
    };
  }

  // Not present
  return {
    isPresent: false,
    presenceStatus: null,
    isResident,
    reasonCode: 'not_at_location'
  };
}

/**
 * Get all world-presence entities at a location (includes family characters).
 * 
 * UNIFIED RESOLVER: Map, popup, side panel, travel cards all use this.
 * Returns array of { character, presence } tuples.
 */
export function getLocationPresence(location, characters = []) {
  if (!location) return [];

  const presence = [];

  // All character types at this location
  characters.forEach(char => {
    if (!['active_created_character', 'npc_fictitious', 'npc_family_member'].includes(char.character_type || resolveCharacterType(char))) {
      return;
    }

    const p = resolveCharacterPresenceAtLocation(char, location);
    if (p.isPresent) {
      presence.push({ character: char, presence: p });
    }
  });

  // Family members from resident list — shown as household residents
  // These are NOT standalone travel actors; they are displayed as residents only
  (location.resident_family_members || []).forEach(familyMember => {
    if (!familyMember.name) return;
    // Check if this NPC is actually present at this location (from fictional_relationships)
    let npcAtThisLocation = false;
    for (const char of characters) {
      const rel = (char.fictional_relationships || []).find(
        r => r.person_name?.trim().toLowerCase() === familyMember.name.trim().toLowerCase() && !r.related_character_id
      );
      if (rel && rel.current_location_id === location.id) {
        npcAtThisLocation = true;
        break;
      }
    }

    // Family members assigned to home are present unless proven elsewhere
    if (!npcAtThisLocation || location.category === 'home' || location.category === 'generic') {
      presence.push({
        character: {
          id: `family_${familyMember.name}`,
          name: familyMember.name,
          character_type: 'npc_family_member',
          avatar_url: null,
        },
        presence: {
          isPresent: true,
          presenceStatus: 'home',
          isResident: true,
          reasonCode: 'family_resident'
        }
      });
    }
  });

  return presence;
}

/**
 * UNIFIED TRAVEL PRESENCE RESOLVER FOR VGC TOWERS
 * 
 * Used exclusively by all Travel UI components (map, popup, side panel, travel cards).
 * Ensures all components agree on who is where and why.
 * 
 * Returns:
 * {
 *   currentlyAt: [{ character, presence }],
 *   count: number,
 *   vgcTowerResidents: [character],
 *   travelingOut: [character]
 * }
 */
export function resolveTravelPresenceForUserScope(location, characters = []) {
  if (!location) {
    return { currentlyAt: [], count: 0, vgcTowerResidents: [], travelingOut: [] };
  }

  // Use unified resolver to get all presence at this location
  const allPresence = getLocationPresence(location, characters);

  // For VGC Towers specifically, identify residents vs travelers
  const isVGCTowers = location.name === 'VGC Towers';

  if (isVGCTowers) {
    const vgcTowerResidents = allPresence.filter(p => 
      p.presence.isResident && p.presence.isPresent
    ).map(p => p.character);

    const travelingOut = characters.filter(c =>
      (c.character_type === 'npc_fictitious' || c.character_type === 'npc_family_member') &&
      c.current_home_location_id === location.id &&
      c.resolved_current_location_id &&
      c.resolved_current_location_id !== location.id
    );

    return {
      currentlyAt: allPresence,
      count: allPresence.length,
      vgcTowerResidents,
      travelingOut,
    };
  }

  // For non-VGC locations
  return {
    currentlyAt: allPresence,
    count: allPresence.length,
    vgcTowerResidents: [],
    travelingOut: [],
  };
}

// ─── MODULE ELIGIBILITY MAP ───────────────────────────────────────────────────
const MODULE_ALLOWED_TYPES = {
  story:             ['active_created_character', 'npc_fictitious'],
  photos:            ['active_created_character', 'npc_fictitious'],
  emotions:          ['active_created_character', 'npc_fictitious'],
  relationships:     ['active_created_character', 'npc_fictitious'],
  traits:            ['active_created_character', 'npc_fictitious'],
  religion:          ['active_created_character', 'npc_fictitious'],
  profile:           ['active_created_character', 'npc_fictitious'],
  work_school:       ['active_created_character', 'npc_fictitious'],
  default_character: ['active_created_character', 'npc_fictitious'],
  locations:         ['active_created_character', 'npc_fictitious'],
  needs:             ['active_created_character'],
};

// Enforced hierarchy order for grouping
const TYPE_HIERARCHY = ['active_created_character', 'npc_fictitious', 'npc_family_member'];

const SECTION_LABELS = {
  active_created_character: 'Active Characters',
  npc_fictitious:           'NPC Fictitious',
  npc_family_member:        'NPC Family Members',
};

/**
 * MANDATORY SHARED SETTINGS LIST RESOLVER
 *
 * Use this in ALL Settings subpages that show a character-selection list.
 *
 * Returns sectioned data:
 * [{ section, label, items: [...] }]
 *
 * Pipeline:
 * 1. user scope / ownership
 * 2. module eligibility
 * 3. character type resolution
 * 4. grouping by hierarchy
 * 5. within-group alpha sort
 * 6. return sectioned output
 *
 * @param {Array}  allCharacters    - raw merged character list
 * @param {Object} currentUser      - { id, email }
 * @param {string} moduleType       - e.g. "story", "photos", "needs"
 * @returns {Array} sectioned list
 */
export function resolveSettingsCharacterLists(allCharacters, currentUser, moduleType) {
  const allowedTypes = MODULE_ALLOWED_TYPES[moduleType] || ['active_created_character'];

  // 1. User scope
  const scoped = resolveUserScopedCharacters(allCharacters, currentUser?.id, currentUser?.email);

  // 2. Status filter (exclude deleted/soft_deleted/merged).
  // LEGACY COMPATIBILITY: status may be null/absent on older records.
  // Absent status means the character was never explicitly deleted — treat as active.
  // Only exclude when status is EXPLICITLY set to a terminal value.
  const live = scoped.filter(c => !['deleted', 'soft_deleted', 'merged'].includes(c.status));

  // 3. Module eligibility — only keep allowed types
  const eligible = live.filter(c => allowedTypes.includes(c._resolvedType));

  // 4. Group by type
  const groups = {};
  TYPE_HIERARCHY.forEach(t => { groups[t] = []; });

  eligible.forEach(c => {
    if (groups[c._resolvedType]) {
      groups[c._resolvedType].push(c);
    }
  });

  // 5. Sort within each group alphabetically
  Object.keys(groups).forEach(type => {
    groups[type].sort((a, b) => (a._displayName || '').localeCompare(b._displayName || ''));
  });

  // 6. Build sections — only include types allowed for this module, in hierarchy order
  const sections = TYPE_HIERARCHY
    .filter(type => allowedTypes.includes(type) && groups[type].length > 0)
    .map(type => ({
      section: type,
      label: SECTION_LABELS[type],
      items: groups[type],
    }));

  console.log(`[resolveSettingsCharacterLists] module=${moduleType}`, {
    scopedCount: scoped.length,
    eligibleCount: eligible.length,
    sections: sections.map(s => ({ label: s.label, count: s.items.length })),
  });

  return sections;
}

/**
 * Check if a location appears empty (no residents or current occupants).
 * 
 * Used to determine if "vacant" or "no one here" labels should appear.
 */
export function isLocationEmpty(location, characters = []) {
  const presence = getLocationPresence(location, characters);
  return presence.length === 0;
}

/**
 * Check if character can travel to/visit a location based on age and rules.
 */
export function canCharacterTravelToLocation(character, location, currentTime = new Date()) {
  if (!character) return { allowed: false, reason: 'Invalid character' };

  const age = resolveCharacterAge(character);

  // Under 5: cannot leave home
  if (age !== null && age < 5) {
    if (location.category !== 'home' && location.category !== 'generic') {
      return { allowed: false, reason: 'Too young to leave home' };
    }
  }

  // Under 21: cannot go to bars/clubs
  if (age !== null && age < 21) {
    if (location.category === 'social' || location.category === 'food_drink') {
      const subtype = Array.isArray(location.subtype) ? location.subtype : [location.subtype];
      const isBarnightlife = subtype.some(s =>
        ['cocktail_bar', 'dive_bar', 'sports_bar', 'beer_hall', 'gay_bar', 'lesbian_bar', 'queer_bar',
          'upscale_lounge', 'wine_bar', 'tiki_bar', 'house_music_club', 'hip_hop_club', 'electronic_club',
          'punk_venue', 'rock_venue', 'latin_dance_club', 'country_bar', 'jazz_club', 'karaoke_bar',
          'nightclub', 'dance_club', 'rave_venue', 'rooftop_bar', 'lounge_club'].includes(s)
      );
      if (isBarnightlife) {
        return { allowed: false, reason: 'Too young for bars and nightlife venues' };
      }
    }
  }

  return { allowed: true, reason: null };
}

/**
 * Resolve character age from birthday or age field.
 */
function resolveCharacterAge(character) {
  if (!character) return null;

  if (character.age !== undefined && character.age !== null) {
    return character.age;
  }

  if (character.birthday) {
    const birthDate = new Date(character.birthday);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  }

  return null;
}