/**
 * CHARACTER DETECTION AND CLASSIFICATION FLOW
 * 
 * Handles new character detection popups and strict classification logic.
 * Implements all 4 options: family tie, non-family tie, already exists, nonsense.
 */

import { CHARACTER_TYPE } from './characterTypeConstants';

/**
 * New character detection popup options
 */
export const DETECTION_OPTIONS = {
  FAMILY_TIE: 'family_tie',
  NON_FAMILY_TIE: 'non_family_tie',
  ALREADY_EXISTS: 'already_exists',
  NONSENSE: 'nonsense',
};

/**
 * Classification result for a detected character
 */
export function createDetectionResult(option, detectedName, activeCharacterId, existingCharacterId = null) {
  const result = {
    option,
    detectedName,
    activeCharacterId,
    timestamp: new Date().toISOString(),
  };

  switch (option) {
    case DETECTION_OPTIONS.FAMILY_TIE:
      return {
        ...result,
        action: 'create',
        characterType: CHARACTER_TYPE.NPC_FAMILY_MEMBER,
        relationshipType: 'family', // User will specify (parent, sibling, etc.)
        shouldAddToList: 'family_section',
        requiresCompleteData: true,
        description: 'Family member of the active character',
      };

    case DETECTION_OPTIONS.NON_FAMILY_TIE:
      return {
        ...result,
        action: 'create',
        characterType: CHARACTER_TYPE.NPC_FICTITIOUS,
        relationshipType: 'non_family',
        shouldAddToList: ['people_in_their_world', 'contact_npc'],
        requiresCompleteData: true, // MUST fill all fields
        description: 'Non-family relationship NPC (Contact NPC)',
      };

    case DETECTION_OPTIONS.ALREADY_EXISTS:
      return {
        ...result,
        action: 'link',
        existingCharacterId: existingCharacterId,
        shouldCreateNew: false,
        requiresSelection: true,
        description: 'Link conversation to existing character',
      };

    case DETECTION_OPTIONS.NONSENSE:
      return {
        ...result,
        action: 'ignore',
        shouldCreateNew: false,
        shouldLearnFromMistake: true,
        description: 'Incorrect detection — do not create record',
      };

    default:
      return null;
  }
}

/**
 * Validation for detection flow
 */
export function validateDetectionOption(option, metadata = {}) {
  const errors = [];

  if (!Object.values(DETECTION_OPTIONS).includes(option)) {
    errors.push(`Invalid option: "${option}"`);
    return { valid: false, errors };
  }

  // Validate required metadata for each option
  if (option === DETECTION_OPTIONS.FAMILY_TIE) {
    if (!metadata.detectedName) errors.push('Family tie requires detected character name');
    if (!metadata.activeCharacterId) errors.push('Family tie requires active character ID');
  }

  if (option === DETECTION_OPTIONS.NON_FAMILY_TIE) {
    if (!metadata.detectedName) errors.push('Non-family tie requires detected character name');
    if (!metadata.activeCharacterId) errors.push('Non-family tie requires active character ID');
  }

  if (option === DETECTION_OPTIONS.ALREADY_EXISTS) {
    if (!metadata.existingCharacterId) errors.push('Already exists option requires existing character ID');
  }

  if (option === DETECTION_OPTIONS.NONSENSE) {
    if (!metadata.detectedName) errors.push('Nonsense option requires the incorrectly detected name (for learning)');
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : null,
  };
}

/**
 * Prepare character data for creation after detection
 */
export function prepareDetectedCharacterData(option, metadata = {}) {
  const { detectedName, activeCharacterId, conversationId } = metadata;

  const baseData = {
    name: detectedName,
    display_name: detectedName,
    full_name: detectedName,
    status: 'active',
    created_by_user: false, // AI-detected character
  };

  if (option === DETECTION_OPTIONS.FAMILY_TIE) {
    return {
      ...baseData,
      character_type: CHARACTER_TYPE.NPC_FAMILY_MEMBER,
      // Family relationship will be added to active character's family_members list
      linkedToCharacterId: activeCharacterId,
      detectionSource: conversationId,
      requiresUserReview: true, // User must confirm family relationship type
    };
  }

  if (option === DETECTION_OPTIONS.NON_FAMILY_TIE) {
    return {
      ...baseData,
      character_type: CHARACTER_TYPE.NPC_FICTITIOUS,
      // Will be added to active character's fictional_relationships
      linkedToCharacterId: activeCharacterId,
      detectionSource: conversationId,
      requiresCompleteProfile: true, // MUST populate all available fields
      requiresUserReview: false, // AI completes profile, user confirms
      profileCompletionChecklist: [
        'profile_summary',
        'backstory',
        'personality_summary',
        'occupation',
        'avatar_url_or_description',
        'current_location_id', // Must have a real location
      ],
    };
  }

  return null;
}

/**
 * Prevent duplicate character creation
 */
export function preventDuplicateCreation(detectedName, existingCharacters = []) {
  const normalized = (detectedName || '').toLowerCase().trim();

  for (const char of existingCharacters) {
    const charName = (char.name || '').toLowerCase().trim();
    const charDisplay = (char.display_name || '').toLowerCase().trim();

    if (charName === normalized || charDisplay === normalized) {
      return {
        isDuplicate: true,
        existingCharacterId: char.id,
        existingCharacterName: char.display_name || char.name,
        message: `Character "${detectedName}" already exists in database`,
      };
    }
  }

  return { isDuplicate: false };
}

/**
 * Learn from nonsense detection to reduce future false positives
 */
export function recordMistakeForLearning(detectedText, conversationContext = {}) {
  return {
    mistakeType: 'false_positive_detection',
    detectedText,
    conversationContext,
    timestamp: new Date().toISOString(),
    // This would be used to adjust detection sensitivity
    // e.g., if we keep detecting "the", it's probably not a character
  };
}

/**
 * Popup configuration for new character detection
 */
export function getDetectionPopupConfig() {
  return {
    title: 'New Character Detected',
    question: 'Does this character have a relationship to the speaking character?',
    options: [
      {
        id: DETECTION_OPTIONS.FAMILY_TIE,
        label: 'Family Tie',
        description: 'This is a family member (parent, sibling, relative, etc.)',
        icon: 'heart',
        resultType: CHARACTER_TYPE.NPC_FAMILY_MEMBER,
      },
      {
        id: DETECTION_OPTIONS.NON_FAMILY_TIE,
        label: 'Non-Family Relationship',
        description: 'Friend, coworker, acquaintance, etc. — not family',
        icon: 'users',
        resultType: CHARACTER_TYPE.NPC_FICTITIOUS,
      },
      {
        id: DETECTION_OPTIONS.ALREADY_EXISTS,
        label: 'Already Exists',
        description: 'This character is already in the database',
        icon: 'database',
        requiresSelection: true,
        selectionLabel: 'Select existing character:',
      },
      {
        id: DETECTION_OPTIONS.NONSENSE,
        label: 'This Is Nonsense',
        description: 'I incorrectly detected this as a character',
        icon: 'x-circle',
      },
    ],
  };
}

/**
 * Enforce that non-family tie characters have complete profiles
 */
export function validateFictitousCharacterCompleteness(character) {
  if (character.character_type !== CHARACTER_TYPE.NPC_FICTITIOUS) {
    return { complete: true }; // Not applicable
  }

  const requiredFields = [
    'profile_summary',
    'personality_summary',
    'current_home_location_id',
    'current_work_location_id',
    'avatar_url',
  ];

  const missing = [];
  for (const field of requiredFields) {
    if (!character[field]) {
      missing.push(field);
    }
  }

  return {
    complete: missing.length === 0,
    missingFields: missing,
    completionPercentage: Math.round(((requiredFields.length - missing.length) / requiredFields.length) * 100),
  };
}

/**
 * Enforce promotion rule: npc_fictitious -> active_created_character
 */
export function validatePromotionEligibility(character, targetType) {
  if (character.character_type !== CHARACTER_TYPE.NPC_FICTITIOUS) {
    return {
      eligible: false,
      reason: `Only ${CHARACTER_TYPE.NPC_FICTITIOUS} can be promoted`,
    };
  }

  if (targetType !== CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER) {
    return {
      eligible: false,
      reason: `Can only promote to ${CHARACTER_TYPE.ACTIVE_CREATED_CHARACTER}`,
    };
  }

  return {
    eligible: true,
    action: 'backend_type_change', // MUST be backend, not UI-only
  };
}

/**
 * Execute promotion on backend
 * This is a reference for backend function implementation
 */
export function createPromotionPayload(characterId, fromType, toType) {
  return {
    characterId,
    action: 'promote',
    fromType,
    toType,
    changes: {
      character_type: toType,
      // Any other fields that change with promotion
    },
    requiresBackendExecution: true,
    requiresRoutingUpdate: true,
    affectedSystems: [
      'list_membership',
      'page_visibility',
      'presence_logic',
      'home_logic',
      'travel_logic',
    ],
  };
}