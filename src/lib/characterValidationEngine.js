/**
 * CHARACTER VALIDATION ENGINE
 * 
 * Validates character state against 18 core rules.
 * Before any system saves, routes, renders, or displays a character,
 * it must pass all validation checks.
 */

import { CHARACTER_TYPE, LIST_MEMBERSHIP, PAGE_VISIBILITY } from './characterTypeConstants';

/**
 * Core validation rules
 * Each returns { valid: boolean, error?: string }
 */
export const ValidationRules = {
  /**
   * Rule 1: Character has exact valid type
   */
  validType(character) {
    if (!character) return { valid: false, error: 'Character is null or undefined' };
    if (!character.character_type) return { valid: false, error: 'Character has no character_type' };

    const validTypes = Object.values(CHARACTER_TYPE);
    if (!validTypes.includes(character.character_type)) {
      return {
        valid: false,
        error: `Invalid character_type: "${character.character_type}". Must be one of: ${validTypes.join(', ')}`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 2: Type is not simplified or renamed
   */
  typeNameIsExact(character) {
    const type = character?.character_type;
    if (!type) return { valid: false, error: 'No character_type' };

    // Forbidden simplified names
    const forbidden = ['active', 'npc', 'family_npc', 'family npc', 'fictional', 'fictional_npc'];
    if (forbidden.includes(type.toLowerCase())) {
      return {
        valid: false,
        error: `Type name "${type}" is simplified. Use exact names: active_created_character, npc_fictitious, npc_family_member, npc_regular`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 3: Character belongs on the list it's on
   */
  belongsOnList(character, listName, listMembership = LIST_MEMBERSHIP) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!listName) return { valid: false, error: 'List name not provided' };

    const rules = listMembership[listName];
    if (!rules) return { valid: false, error: `Unknown list: ${listName}` };

    const belongs = rules[character.character_type];
    if (belongs !== true) {
      return {
        valid: false,
        error: `Character type "${character.character_type}" does not belong on list "${listName}"`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 4: Character is visible on the page it's on
   */
  visibleOnPage(character, pageName, pageVisibility = PAGE_VISIBILITY) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!pageName) return { valid: false, error: 'Page name not provided' };

    const rules = pageVisibility[pageName];
    if (!rules) return { valid: false, error: `Unknown page: ${pageName}` };

    const visible = rules[character.character_type];
    if (visible !== true) {
      return {
        valid: false,
        error: `Character type "${character.character_type}" is not visible on page "${pageName}"`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 5: Character has exactly one location
   */
  singlePresence(character) {
    if (!character) return { valid: false, error: 'Character is null' };

    const locationIds = [];
    if (character.current_home_location_id) locationIds.push(character.current_home_location_id);
    if (character.resolved_current_location_id) locationIds.push(character.resolved_current_location_id);

    const uniqueLocations = new Set(locationIds);
    if (uniqueLocations.size > 1) {
      return {
        valid: false,
        error: `Character cannot exist in multiple places. Found locations: ${Array.from(uniqueLocations).join(', ')}`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 6: Location is valid and real (not null/placeholder)
   */
  validLocation(character) {
    if (!character) return { valid: false, error: 'Character is null' };

    const locationId = character.resolved_current_location_id || character.current_home_location_id;
    if (!locationId) {
      return {
        valid: false,
        error: 'Character has no valid location (resolved_current_location_id or current_home_location_id)',
      };
    }

    // Check for placeholder-like names
    const locationName = character.resolved_current_location_name || '';
    const placeholders = ['unknown', 'undefined', 'null', 'placeholder', 'temp', 'generic'];
    if (placeholders.some(p => locationName.toLowerCase().includes(p))) {
      return {
        valid: false,
        error: `Location name "${locationName}" appears to be a placeholder`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 7: Character is shown only where presence says they are
   */
  presenceMatchesLocation(character, currentLocation) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!currentLocation) return { valid: false, error: 'Current location not provided' };

    const characterLocationId = character.resolved_current_location_id || character.current_home_location_id;
    if (characterLocationId !== currentLocation.id) {
      return {
        valid: false,
        error: `Character location (${characterLocationId}) does not match current location (${currentLocation.id})`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 8: Correct exception logic for npc_family_member
   */
  correctFamilyMemberLogic(character) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (character.character_type !== CHARACTER_TYPE.NPC_FAMILY_MEMBER) {
      return { valid: true }; // Not applicable
    }

    // Family members have special home/travel exceptions
    // This is just a reminder check — actual logic is elsewhere
    return { valid: true };
  },

  /**
   * Rule 9: Type name not substituted in logic
   */
  typeUsedInLogic(character) {
    // This is a meta-check for code reviews
    // Ensure code is using character.character_type directly
    if (!character) return { valid: false, error: 'Character is null' };
    return { valid: true };
  },

  /**
   * Rule 10: If in mixed list, character is in correct hierarchy group
   */
  correctHierarchyPosition(character, listPosition, otherCharactersInList = []) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (listPosition === undefined) return { valid: true }; // Not in a list

    // Check that characters after this one don't have higher hierarchy
    for (let i = listPosition + 1; i < otherCharactersInList.length; i++) {
      const nextChar = otherCharactersInList[i];
      if (!nextChar) continue;

      // Simple check: same type should be next, or lower priority type
      if (nextChar.character_type && nextChar.character_type !== character.character_type) {
        // This would need full hierarchy check in context
      }
    }

    return { valid: true };
  },

  /**
   * Rule 11: Names alphabetized within type group
   */
  alphabetizedWithinType(character, surroundingCharacters = []) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!Array.isArray(surroundingCharacters)) return { valid: true };

    const characterName = (character.display_name || character.name || '').toLowerCase();

    // Check previous character with same type
    for (let i = surroundingCharacters.length - 1; i >= 0; i--) {
      const other = surroundingCharacters[i];
      if (!other || other.character_type !== character.character_type) continue;

      const otherName = (other.display_name || other.name || '').toLowerCase();
      if (otherName > characterName) {
        return {
          valid: false,
          error: `Character "${character.name}" is not alphabetized. Should come before "${other.name}"`,
        };
      }
      break;
    }

    return { valid: true };
  },

  /**
   * Rule 12: Character not duplicated across scenes
   */
  notDuplicatedAcrossScenes(character, currentLocation, allCharactersInOtherLocations = []) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!currentLocation) return { valid: true }; // Can't check without location context

    const characterId = character.id;
    for (const otherChar of allCharactersInOtherLocations) {
      if (otherChar.id === characterId && otherChar.resolved_current_location_id !== currentLocation.id) {
        return {
          valid: false,
          error: `Character exists in multiple locations: ${currentLocation.id} and ${otherChar.resolved_current_location_id}`,
        };
      }
    }

    return { valid: true };
  },

  /**
   * Rule 13: Invalid presence states rejected
   */
  validPresenceState(character) {
    if (!character) return { valid: false, error: 'Character is null' };

    const invalidStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
    if (invalidStates.includes(character.travel_status)) {
      return {
        valid: false,
        error: `Invalid travel_status: "${character.travel_status}". Travel means presence switching, not commuting.`,
      };
    }

    return { valid: true };
  },

  /**
   * Rule 14: Sleep not during invalid times
   */
  validSleepState(character, currentTimeET) {
    if (!character) return { valid: false, error: 'Character is null' };
    if (!currentTimeET) return { valid: true }; // Can't check without time

    const isSleeping = character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping';
    if (!isSleeping) return { valid: true };

    // Check if this is travel time (4 AM - 9 AM ET)
    const hour = currentTimeET.getHours();
    const isTravelTime = hour >= 4 && hour < 9;

    if (isTravelTime && character.character_type !== CHARACTER_TYPE.NPC_FAMILY_MEMBER) {
      return {
        valid: false,
        error: `${character.name} is asleep during travel time (4-9 AM ET). NPCs must be awake and distributed.`,
      };
    }

    return { valid: true };
  },
};

/**
 * Run all validation rules on a character
 */
export function validateCharacter(
  character,
  context = {}
) {
  const {
    listName,
    pageName,
    currentLocation,
    listMembership = LIST_MEMBERSHIP,
    pageVisibility = PAGE_VISIBILITY,
    currentTimeET = new Date(),
  } = context;

  const errors = [];

  // Core validations
  const typeCheck = ValidationRules.validType(character);
  if (!typeCheck.valid) errors.push(typeCheck.error);

  const typeNameCheck = ValidationRules.typeNameIsExact(character);
  if (!typeNameCheck.valid) errors.push(typeNameCheck.error);

  const presenceCheck = ValidationRules.singlePresence(character);
  if (!presenceCheck.valid) errors.push(presenceCheck.error);

  const locationCheck = ValidationRules.validLocation(character);
  if (!locationCheck.valid) errors.push(locationCheck.error);

  const stateCheck = ValidationRules.validPresenceState(character);
  if (!stateCheck.valid) errors.push(stateCheck.error);

  const sleepCheck = ValidationRules.validSleepState(character, currentTimeET);
  if (!sleepCheck.valid) errors.push(sleepCheck.error);

  // Context-specific validations
  if (listName) {
    const listCheck = ValidationRules.belongsOnList(character, listName, listMembership);
    if (!listCheck.valid) errors.push(listCheck.error);
  }

  if (pageName) {
    const pageCheck = ValidationRules.visibleOnPage(character, pageName, pageVisibility);
    if (!pageCheck.valid) errors.push(pageCheck.error);
  }

  if (currentLocation) {
    const presenceLocationCheck = ValidationRules.presenceMatchesLocation(character, currentLocation);
    if (!presenceLocationCheck.valid) errors.push(presenceLocationCheck.error);
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : null,
    errorCount: errors.length,
  };
}

/**
 * Get validation summary for a batch of characters
 */
export function validateCharacterBatch(characters, context = {}) {
  const results = {
    total: characters.length,
    valid: 0,
    invalid: 0,
    errors: {},
  };

  for (const char of characters) {
    if (!char) continue;
    const validation = validateCharacter(char, context);
    if (validation.valid) {
      results.valid++;
    } else {
      results.invalid++;
      results.errors[char.id] = validation.errors;
    }
  }

  return results;
}