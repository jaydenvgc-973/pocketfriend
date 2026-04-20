/**
 * CHARACTER LIST SORTING ENGINE
 * 
 * Implements the master list ordering rule:
 * 1. Group by character type (hierarchy order)
 * 2. Alphabetize names within each type group
 * 3. Never flatten or reorder by other criteria
 */

import {
  CHARACTER_TYPE,
  TYPE_HIERARCHY_ORDER,
  getTypeHierarchyPriority,
} from './characterTypeConstants';

/**
 * Sort a mixed-type character list
 * Groups by type hierarchy, then alphabetizes within each group
 */
export function sortCharacterListByTypeAndName(characters) {
  if (!characters || !Array.isArray(characters)) {
    return [];
  }

  // Filter to only active characters
  const activeChars = characters.filter(c => c && c.status === 'active');

  // Sort by type hierarchy first, then by name within each type
  return activeChars.sort((a, b) => {
    // Get type priorities
    const aPriority = getTypeHierarchyPriority(a.character_type);
    const bPriority = getTypeHierarchyPriority(b.character_type);

    // Different types: sort by hierarchy
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    // Same type: sort alphabetically by display name
    const aName = (a.display_name || a.name || '').toLowerCase();
    const bName = (b.display_name || b.name || '').toLowerCase();

    return aName.localeCompare(bName);
  });
}

/**
 * Group characters by type and return structured result
 */
export function groupCharactersByType(characters) {
  if (!characters || !Array.isArray(characters)) {
    return {};
  }

  const groups = {};

  // Initialize groups for each type
  for (const type of TYPE_HIERARCHY_ORDER) {
    groups[type] = [];
  }

  // Sort characters into groups
  for (const char of characters) {
    if (!char || char.status !== 'active') continue;

    const type = char.character_type;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(char);
  }

  // Sort names within each group
  for (const type of TYPE_HIERARCHY_ORDER) {
    groups[type].sort((a, b) => {
      const aName = (a.display_name || a.name || '').toLowerCase();
      const bName = (b.display_name || b.name || '').toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  return groups;
}

/**
 * Get flattened sorted list with type section headers
 */
export function getSortedListWithHeaders(characters, typeLabels = {}) {
  const groups = groupCharactersByType(characters);
  const result = [];

  for (const type of TYPE_HIERARCHY_ORDER) {
    const typeChars = groups[type];
    if (typeChars.length === 0) continue;

    // Add section header
    const label = typeLabels[type] || type;
    result.push({
      isHeader: true,
      type,
      label,
    });

    // Add characters in this type
    result.push(...typeChars);
  }

  return result;
}

/**
 * Validate that a list respects the type hierarchy
 * Returns validation errors if any
 */
export function validateListHierarchy(characters) {
  const errors = [];

  if (!Array.isArray(characters)) {
    return ['Characters must be an array'];
  }

  let lastPriority = -1;
  let currentType = null;
  const typeNames = {};

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    if (!char || !char.character_type) continue;

    const type = char.character_type;
    const priority = getTypeHierarchyPriority(type);

    // Check if priority went backwards (violation of hierarchy)
    if (priority < lastPriority) {
      errors.push(
        `Character at index ${i} (${char.name}) has type ${type} ` +
        `which should appear before the previous character's type`
      );
    }

    // Check alphabetical order within same type
    if (type === currentType && lastPriority === priority) {
      const prevChar = characters[i - 1];
      const prevName = (prevChar.display_name || prevChar.name || '').toLowerCase();
      const currName = (char.display_name || char.name || '').toLowerCase();

      if (prevName > currName) {
        errors.push(
          `Characters within type ${type} are not alphabetically sorted: ` +
          `"${prevChar.name}" comes before "${char.name}"`
        );
      }
    }

    lastPriority = priority;
    currentType = type;
    typeNames[type] = true;
  }

  return errors;
}

/**
 * Filter characters for a specific list
 * Only includes types that belong on that list
 */
export function filterCharactersForList(characters, listName, listMembership) {
  if (!characters || !Array.isArray(characters)) {
    return [];
  }

  const rules = listMembership[listName];
  if (!rules) {
    return [];
  }

  // Filter by list membership rules
  const filtered = characters.filter(char => {
    if (!char || char.status !== 'active') return false;
    const type = char.character_type;
    return rules[type] === true;
  });

  // Sort by type hierarchy and name
  return sortCharacterListByTypeAndName(filtered);
}

/**
 * Count characters by type in a list
 */
export function countCharactersByType(characters) {
  const counts = {};

  for (const type of TYPE_HIERARCHY_ORDER) {
    counts[type] = 0;
  }

  for (const char of characters) {
    if (!char || char.status !== 'active') continue;
    const type = char.character_type;
    if (counts.hasOwnProperty(type)) {
      counts[type]++;
    }
  }

  return counts;
}