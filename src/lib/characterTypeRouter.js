/**
 * CHARACTER TYPE ROUTING ENGINE
 * 
 * Maps character_type to world-behavior and system-routing rules.
 * NOT a cosmetic label — determines visibility, lists, presence, and housing.
 */

export const CHARACTER_TYPES = {
  ACTIVE_CREATED_CHARACTER: 'active_created_character',
  NPC_REGULAR: 'npc_regular',
  NPC_FAMILY_MEMBER: 'npc_family_member',
  NPC_FICTITIOUS: 'npc_fictitious',
};

/**
 * Routing rules for each character type
 */
export const TYPE_ROUTING_RULES = {
  [CHARACTER_TYPES.ACTIVE_CREATED_CHARACTER]: {
    label: 'Active Created Character',
    description: 'User-created, fully interactive character',
    isActiveCreated: true,
    isNPC: false,
    isFamilyNPC: false,
    isFictitious: false,
    
    // List inclusion
    appearsInActiveList: true,
    appearsInNPCList: false,
    appearsInFamilyNPCList: false,
    appearsInFictitousList: false,
    
    // Page visibility
    appearsOnHomePage: true,
    appearsOnTravelPage: true,
    appearsOnScenePage: true,
    appearsInGroupChat: true,
    
    // World presence
    hasFullPresenceTracking: true,
    requiresLocation: true,
    participatesInTravel: true,
    participatesInSchedules: true,
    
    // Housing rules
    canHaveHome: true,
    canLiveAtVGCTowers: true,
    canRemainHomeAtTravelTime: false, // No, must distribute
    canHaveJobs: true,
    canHaveSchools: true,
    canHaveFinancials: true,
    
    // Relationships
    canHaveRelationships: true,
    canHaveMemories: true,
    hasFullSimulation: true,
  },

  [CHARACTER_TYPES.NPC_REGULAR]: {
    label: 'NPC Regular',
    description: 'Normal NPC who participates in general world activity',
    isActiveCreated: false,
    isNPC: true,
    isFamilyNPC: false,
    isFictitious: false,
    
    // List inclusion
    appearsInActiveList: false,
    appearsInNPCList: true,
    appearsInFamilyNPCList: false,
    appearsInFictitousList: false,
    
    // Page visibility
    appearsOnHomePage: true,
    appearsOnTravelPage: true,
    appearsOnScenePage: true,
    appearsInGroupChat: true,
    
    // World presence
    hasFullPresenceTracking: true,
    requiresLocation: true,
    participatesInTravel: true,
    participatesInSchedules: true,
    
    // Housing rules
    canHaveHome: true,
    canLiveAtVGCTowers: true,
    canRemainHomeAtTravelTime: false, // No, must distribute
    canHaveJobs: true,
    canHaveSchools: false,
    canHaveFinancials: false,
    
    // Relationships
    canHaveRelationships: true,
    canHaveMemories: false,
    hasFullSimulation: false,
  },

  [CHARACTER_TYPES.NPC_FAMILY_MEMBER]: {
    label: 'NPC Family Member',
    description: 'Family-linked NPC with special residence rules',
    isActiveCreated: false,
    isNPC: true,
    isFamilyNPC: true,
    isFictitious: false,
    
    // List inclusion
    appearsInActiveList: false,
    appearsInNPCList: false,
    appearsInFamilyNPCList: true,
    appearsInFictitousList: false,
    
    // Page visibility
    appearsOnHomePage: true,
    appearsOnTravelPage: true,
    appearsOnScenePage: true,
    appearsInGroupChat: true,
    
    // World presence
    hasFullPresenceTracking: true,
    requiresLocation: true,
    participatesInTravel: true,
    participatesInSchedules: true,
    
    // Housing rules — SPECIAL
    canHaveHome: true,
    canLiveAtVGCTowers: true,
    canRemainHomeAtTravelTime: true, // YES — exception to distribution rule
    canHaveJobs: false,
    canHaveSchools: false,
    canHaveFinancials: false,
    
    // Relationships
    canHaveRelationships: true,
    canHaveMemories: false,
    hasFullSimulation: false,
  },

  [CHARACTER_TYPES.NPC_FICTITIOUS]: {
    label: 'NPC Fictitious',
    description: 'Fictional/world-built NPC with separate display rules',
    isActiveCreated: false,
    isNPC: true,
    isFamilyNPC: false,
    isFictitious: true,
    
    // List inclusion
    appearsInActiveList: false,
    appearsInNPCList: false,
    appearsInFamilyNPCList: false,
    appearsInFictitousList: true,
    
    // Page visibility — SEPARATE SYSTEMS
    appearsOnHomePage: false,
    appearsOnTravelPage: false,
    appearsOnScenePage: false,
    appearsInGroupChat: false,
    
    // World presence
    hasFullPresenceTracking: false,
    requiresLocation: false,
    participatesInTravel: false,
    participatesInSchedules: false,
    
    // Housing rules
    canHaveHome: false,
    canLiveAtVGCTowers: false,
    canRemainHomeAtTravelTime: false,
    canHaveJobs: false,
    canHaveSchools: false,
    canHaveFinancials: false,
    
    // Relationships
    canHaveRelationships: true,
    canHaveMemories: false,
    hasFullSimulation: false,
  },
};

/**
 * Get routing rules for a character
 */
export function getCharacterRoutingRules(characterType) {
  return TYPE_ROUTING_RULES[characterType] || null;
}

/**
 * Check if character should appear in a list
 */
export function shouldAppearInList(characterType, listType) {
  const rules = getCharacterRoutingRules(characterType);
  if (!rules) return false;
  
  switch (listType) {
    case 'active':
      return rules.appearsInActiveList;
    case 'npc':
      return rules.appearsInNPCList;
    case 'family_npc':
      return rules.appearsInFamilyNPCList;
    case 'fictitious':
      return rules.appearsInFictitousList;
    default:
      return false;
  }
}

/**
 * Check if character should appear on a page
 */
export function shouldAppearOnPage(characterType, pageType) {
  const rules = getCharacterRoutingRules(characterType);
  if (!rules) return false;
  
  switch (pageType) {
    case 'home':
      return rules.appearsOnHomePage;
    case 'travel':
      return rules.appearsOnTravelPage;
    case 'scene':
      return rules.appearsOnScenePage;
    case 'group_chat':
      return rules.appearsInGroupChat;
    default:
      return false;
  }
}

/**
 * Check if character can be in a location
 */
export function canCharacterLiveInLocation(characterType, locationType) {
  const rules = getCharacterRoutingRules(characterType);
  if (!rules) return false;
  
  // Check if character type allows living at this location
  if (locationType === 'vgc_towers') {
    return rules.canLiveAtVGCTowers;
  } else if (locationType === 'home') {
    return rules.canHaveHome;
  }
  
  return false;
}

/**
 * Check if character can remain home during travel time
 */
export function canRemainHomeDuringTravelTime(characterType) {
  const rules = getCharacterRoutingRules(characterType);
  return rules?.canRemainHomeAtTravelTime || false;
}

/**
 * Get filtering rules for character lists by type
 */
export function getActiveCreatedCharacterFilter() {
  return {
    character_type: CHARACTER_TYPES.ACTIVE_CREATED_CHARACTER,
    status: 'active',
  };
}

export function getNPCCharacterFilter() {
  return {
    character_type: {
      $in: [
        CHARACTER_TYPES.NPC_REGULAR,
        CHARACTER_TYPES.NPC_FAMILY_MEMBER,
      ],
    },
    status: 'active',
  };
}

export function getNPCRegularFilter() {
  return {
    character_type: CHARACTER_TYPES.NPC_REGULAR,
    status: 'active',
  };
}

export function getNPCFamilyMemberFilter() {
  return {
    character_type: CHARACTER_TYPES.NPC_FAMILY_MEMBER,
    status: 'active',
  };
}

export function getNPCFictitousFilter() {
  return {
    character_type: CHARACTER_TYPES.NPC_FICTITIOUS,
    status: 'active',
  };
}

/**
 * Validate character for page visibility
 */
export function validateCharacterForPage(character, pageType) {
  if (!character) return false;
  if (character.status !== 'active') return false;
  return shouldAppearOnPage(character.character_type, pageType);
}

/**
 * Validate character for list inclusion
 */
export function validateCharacterForList(character, listType) {
  if (!character) return false;
  if (character.status !== 'active') return false;
  return shouldAppearInList(character.character_type, listType);
}