/**
 * CHARACTER TYPE CONSTANTS
 * 
 * EXACT in-app character type names.
 * Do NOT rename, simplify, or substitute these values.
 * These are core routing classes, not cosmetic labels.
 */

export const CHARACTER_TYPE = {
  ACTIVE_CREATED_CHARACTER: 'active_created_character',
  NPC_FICTITIOUS: 'npc_fictitious',
  NPC_FAMILY_MEMBER: 'npc_family_member',
  NPC_REGULAR: 'npc_regular',
};

/**
 * Type ordering hierarchy
 * Used whenever mixed-type lists are displayed
 * Lower index = higher priority
 */
export const TYPE_HIERARCHY_ORDER = [
  CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER,  // 0
  CHARACTER_TYPE.NPC_FICTITIOUS,            // 1
  CHARACTER_TYPE.NPC_FAMILY_MEMBER,         // 2
  CHARACTER_TYPE.NPC_REGULAR,               // 3
];

/**
 * Get numeric priority of a type (lower = higher priority)
 */
export function getTypeHierarchyPriority(type) {
  const index = TYPE_HIERARCHY_ORDER.indexOf(type);
  return index >= 0 ? index : 999; // Unknown types go to end
}

/**
 * Type display labels (for UI only, not for logic)
 */
export const TYPE_DISPLAY_LABELS = {
  [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: 'Active Character',
  [CHARACTER_TYPE.NPC_FICTITIOUS]: 'Contact NPC',
  [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: 'Family Member',
  [CHARACTER_TYPE.NPC_REGULAR]: 'Regular NPC',
};

/**
 * List membership rules
 * Which character types belong on which lists
 */
export const LIST_MEMBERSHIP = {
  homepage_character_cards: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: false,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: false,
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  homepage_contact_npc: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: false,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: false,
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  character_profile_people_in_world: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: false,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true, // Non-family relationships
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: false,
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  character_profile_family: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: false,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: false,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true, // Family titles
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  manage_characters: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true,
    [CHARACTER_TYPE.NPC_REGULAR]: true,
  },
  
  resident_selection: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true,
    [CHARACTER_TYPE.NPC_REGULAR]: true,
  },
  
  media_grid_character_dropdown: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true,
    [CHARACTER_TYPE.NPC_REGULAR]: true,
  },
};

/**
 * Page visibility rules
 */
export const PAGE_VISIBILITY = {
  homepage: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true, // In Contact NPC list
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: false,
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  character_profiles: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true, // In people in their world
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true, // In family section
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  travel: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: false,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: false,
    [CHARACTER_TYPE.NPC_REGULAR]: false,
  },
  
  scene: {
    [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: true,
    [CHARACTER_TYPE.NPC_FICTITIOUS]: true,
    [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: true,
    [CHARACTER_TYPE.NPC_REGULAR]: true,
  },
};

/**
 * Avatar usage rules
 * Which types have avatars and what they're used for
 */
export const AVATAR_USAGE = {
  [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: {
    hasAvatar: true,
    usedForImageGeneration: true,
    imageGenerationReferences: ['face', 'features', 'hair', 'body_type'],
  },
  [CHARACTER_TYPE.NPC_FICTITIOUS]: {
    hasAvatar: true,
    usedForImageGeneration: true,
    imageGenerationReferences: ['face', 'features', 'hair', 'body_type'],
  },
  [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: {
    hasAvatar: true,
    usedForImageGeneration: true,
    imageGenerationReferences: ['face', 'features', 'hair', 'body_type'],
  },
  [CHARACTER_TYPE.NPC_REGULAR]: {
    hasAvatar: false,
    usedForImageGeneration: false,
    imageGenerationReferences: [],
  },
};

/**
 * Promotion eligibility
 * Which types can be promoted to what
 */
export const PROMOTION_RULES = {
  [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER]: {
    canBePromoted: false,
    canBePromotedTo: [],
  },
  [CHARACTER_TYPE.NPC_FICTITIOUS]: {
    canBePromoted: true,
    canBePromotedTo: [CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER],
  },
  [CHARACTER_TYPE.NPC_FAMILY_MEMBER]: {
    canBePromoted: false,
    canBePromotedTo: [],
  },
  [CHARACTER_TYPE.NPC_REGULAR]: {
    canBePromoted: false,
    canBePromotedTo: [],
  },
};

/**
 * Validation function
 * Check if a character type is valid
 */
export function isValidCharacterType(type) {
  return Object.values(CHARACTER_TYPE).includes(type);
}

/**
 * Check if character belongs on a list
 */
export function belongsOnList(characterType, listName) {
  const rules = LIST_MEMBERSHIP[listName];
  if (!rules) return false;
  return rules[characterType] === true;
}

/**
 * Check if character is visible on a page
 */
export function isVisibleOnPage(characterType, pageName) {
  const rules = PAGE_VISIBILITY[pageName];
  if (!rules) return false;
  return rules[characterType] === true;
}

/**
 * Get all character types that belong on a list
 */
export function getTypesForList(listName) {
  const rules = LIST_MEMBERSHIP[listName];
  if (!rules) return [];
  return Object.keys(rules).filter(type => rules[type] === true);
}