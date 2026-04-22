/**
 * CHARACTER AGE SYSTEM
 * 
 * Rules:
 * - Age < 5: DO NOT leave home, MUST have sitter if no guardian
 * - Age < 15: CANNOT be alone, MUST have sitter present
 * - Age < 21: CANNOT visit bars, nightclubs
 * - Age unknown + npc_fictitious/npc_family → assume ADULT
 * - Age unknown + active_created → assume ADULT (no restriction)
 */

/**
 * Calculate character age from birthday or age field
 */
export function getCharacterAge(character) {
  if (!character) return null;
  
  // Direct age field
  if (typeof character.age === 'number' && character.age >= 0) {
    return Math.floor(character.age);
  }
  
  // Calculate from birthday
  if (character.birthday) {
    const today = new Date();
    const birth = new Date(character.birthday);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age >= 0 ? age : null;
  }
  
  // For family members in the Character record
  if (character.family_members && Array.isArray(character.family_members)) {
    // Family members store age_at_creation
    // This is more complex and should be handled at the character level
  }
  
  return null;
}

/**
 * Check if character can travel independently
 * Returns { canTravel: boolean, reason: string | null }
 */
export function canCharacterTravel(character) {
  const age = getCharacterAge(character);
  
  // If age is unknown and character type suggests adult → allow
  if (age === null) {
    if (character.character_type === 'npc_fictitious' || character.character_type === 'npc_family_member') {
      // Assume adult for NPCs without age
      return { canTravel: true, reason: null };
    }
    // Active characters without age are allowed (assume adult)
    return { canTravel: true, reason: null };
  }
  
  // Age < 5: cannot leave home
  if (age < 5) {
    return { canTravel: false, reason: 'Too young to travel (under 5)' };
  }
  
  return { canTravel: true, reason: null };
}

/**
 * Check if character requires a sitter when alone
 * Returns { requiresSitter: boolean, reason: string | null }
 */
export function requiresSitter(character) {
  const age = getCharacterAge(character);
  
  // If age unknown → assume adult → no sitter needed
  if (age === null) {
    return { requiresSitter: false, reason: null };
  }
  
  // Age < 15: requires sitter if alone
  if (age < 15) {
    return { requiresSitter: true, reason: `Child (age ${age}) requires supervision` };
  }
  
  return { requiresSitter: false, reason: null };
}

/**
 * Check if character can visit a specific location type
 * Returns { canVisit: boolean, reason: string | null }
 */
export function canVisitLocation(character, locationCategory) {
  const age = getCharacterAge(character);
  
  // Age < 21: cannot visit bars/nightclubs
  const restricted21Categories = ['social', 'food_drink'];
  
  if (age !== null && age < 21 && restricted21Categories.includes(locationCategory)) {
    // Check subtype for more specific restrictions
    if (locationCategory === 'social' || locationCategory === 'food_drink') {
      const subtype = character.subtype || character.category_subtype || '';
      const barLike = ['bar', 'nightclub', 'club', 'lounge', 'dive_bar', 'cocktail_bar', 'dance_club'];
      if (typeof subtype === 'string' && barLike.some(b => subtype.toLowerCase().includes(b))) {
        return { canVisit: false, reason: `Too young (${age}) to visit bars/clubs (21+)` };
      }
      if (Array.isArray(subtype) && subtype.some(s => barLike.some(b => s.toLowerCase().includes(b)))) {
        return { canVisit: false, reason: `Too young (${age}) to visit bars/clubs (21+)` };
      }
    }
  }
  
  return { canVisit: true, reason: null };
}

/**
 * Check if character can be at home location
 * All ages can be at home
 */
export function canBeAtHome(character) {
  return { canBeAtHome: true, reason: null };
}

/**
 * Determine effective supervision status
 * Returns { supervised: boolean, sitterNeeded: boolean, sitterPresent: boolean, message: string }
 */
export function getSupervisionStatus(character, otherCharactersAtLocation = []) {
  const { requiresSitter: needsSitter } = requiresSitter(character);
  
  if (!needsSitter) {
    return { supervised: true, sitterNeeded: false, sitterPresent: false, message: null };
  }
  
  // Check for potential supervisors (adults, family members, or hired sitters)
  const adults = otherCharactersAtLocation.filter(c => {
    const otherAge = getCharacterAge(c);
    // Adult if age >= 15 OR age is unknown (assume adult)
    return otherAge === null || otherAge >= 15;
  });
  
  const supervised = adults.length > 0;
  
  return {
    supervised,
    sitterNeeded: true,
    sitterPresent: supervised,
    message: supervised 
      ? `${character.name || 'Character'} is supervised by ${adults.map(a => a.name).join(', ')}`
      : `${character.name || 'Character'} needs a sitter`
  };
}

/**
 * Get all characters who could potentially be supervisors for a child
 */
export function getPotentialSupervisors(childCharacter, otherCharacters = []) {
  const childAge = getCharacterAge(childCharacter);
  
  if (childAge === null || childAge >= 15) {
    return []; // No supervision needed
  }
  
  // Adults (age >= 15 or unknown age) can supervise
  return otherCharacters.filter(c => {
    const age = getCharacterAge(c);
    return age === null || age >= 15;
  });
}