/**
 * Presence Enforcement Engine
 * Validates and prevents core integrity violations
 * - Single VGC Towers per account
 * - Single presence per character
 * - Valid location references
 * - Proper travel state transitions
 */

export const PresenceEnforcementRules = {
  // Rule 1: Only one VGC Towers allowed
  hasMultipleVGCTowers: (locations) => {
    const vgcTowers = locations.filter(l => 
      l.name && l.name.toLowerCase().includes('vgc towers')
    );
    return vgcTowers.length > 1;
  },

  getVGCTowers: (locations) => {
    const vgcTowers = locations.filter(l => 
      l.name && l.name.toLowerCase().includes('vgc towers')
    );
    return vgcTowers.length > 0 ? vgcTowers[0] : null;
  },

  // Rule 4: Single presence - character can only be in one place
  isCharacterOmnipresent: (character) => {
    const locations = [];
    if (character.current_home_location_id) locations.push(character.current_home_location_id);
    if (character.resolved_current_location_id) locations.push(character.resolved_current_location_id);
    
    const uniqueLocations = new Set(locations.filter(Boolean));
    return uniqueLocations.size > 1;
  },

  // Rule 5: No unknown location
  hasValidLocation: (character) => {
    return !!(character.resolved_current_location_id || character.current_home_location_id);
  },

  // Rule 2: VGC Towers must be occupied if residents exist
  isVGCTowersVacantButOccupied: (vgcTowers) => {
    if (!vgcTowers) return false;
    const hasResidents = (vgcTowers.residents || []).length > 0 ||
                        (vgcTowers.resident_family_members || []).length > 0;
    return hasResidents && !vgcTowers.name.includes('VGC Towers'); // Name not properly set
  },

  // Rule 3: Residents must be visible by name
  hasInvisibleResidents: (vgcTowers) => {
    if (!vgcTowers) return false;
    const residents = vgcTowers.residents || [];
    return residents.some(r => !r.character_name || r.character_name.trim() === '');
  },

  // Rule 6: No "traveling" state (travel is instant)
  hasInvalidTravelState: (character) => {
    const invalidStates = ['traveling', 'commuting', 'on_the_way', 'in_transit'];
    return invalidStates.includes(character.travel_status);
  },

  // Rule 9: NPCs must not sleep during travel time (4:00 AM - 9:00 AM ET)
  isSleepingDuringTravelTime: (character) => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = etTime.getHours();
    const isTravelTime = hour >= 4 && hour < 9;
    const isSleeping = character.resolved_presence_status === 'sleeping' || 
                      character.resolved_presence_status === 'napping';
    return isTravelTime && isSleeping;
  },

  // Rule 7: During travel time, NPCs must be distributed (except family NPCs at home)
  shouldBeDistributedDuringTravelTime: (character, isNPC, isFamilyNPC) => {
    const now = new Date();
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = etTime.getHours();
    const isTravelTime = hour >= 4 && hour < 9;
    
    if (!isTravelTime || !isNPC || isFamilyNPC) return false;
    
    // NPCs should NOT be at home during travel time (except family)
    return character.resolved_current_location_id === character.current_home_location_id;
  },

  // Rule 11: Characters must be in valid locations only
  isInValidLocation: (character, locationMap) => {
    if (!character.resolved_current_location_id) return true; // Unknown location
    return !locationMap[character.resolved_current_location_id];
  },

  // Rule 12: Check if location is placeholder or vague
  isPlaceholderLocation: (location) => {
    if (!location) return true;
    const placeholderPatterns = ['generic', 'unknown', 'placeholder', 'temp', 'undefined'];
    const name = (location.name || '').toLowerCase();
    return placeholderPatterns.some(p => name.includes(p));
  },
};

/**
 * Get all violations for a character
 */
export function getCharacterViolations(character, locationMap, isNPC = false, isFamilyNPC = false) {
  const violations = [];

  if (PresenceEnforcementRules.isCharacterOmnipresent(character)) {
    violations.push({
      type: 'OMNIPRESENT',
      rule: 4,
      message: `${character.name} exists in multiple locations at once`,
      severity: 'CRITICAL',
    });
  }

  if (!PresenceEnforcementRules.hasValidLocation(character)) {
    violations.push({
      type: 'UNKNOWN_LOCATION',
      rule: 5,
      message: `${character.name} has no valid location assigned`,
      severity: 'CRITICAL',
    });
  }

  if (PresenceEnforcementRules.hasInvalidTravelState(character)) {
    violations.push({
      type: 'INVALID_TRAVEL_STATE',
      rule: 6,
      message: `${character.name} has invalid travel state: ${character.travel_status}`,
      severity: 'CRITICAL',
    });
  }

  if (PresenceEnforcementRules.isSleepingDuringTravelTime(character)) {
    violations.push({
      type: 'SLEEP_DURING_TRAVEL_TIME',
      rule: 9,
      message: `${character.name} is sleeping during travel time (4-9 AM)`,
      severity: 'CRITICAL',
    });
  }

  if (PresenceEnforcementRules.shouldBeDistributedDuringTravelTime(character, isNPC, isFamilyNPC)) {
    violations.push({
      type: 'NOT_DISTRIBUTED_DURING_TRAVEL',
      rule: 7,
      message: `${character.name} should not be at home during travel time`,
      severity: 'WARNING',
    });
  }

  if (PresenceEnforcementRules.isInValidLocation(character, locationMap)) {
    violations.push({
      type: 'INVALID_LOCATION_REFERENCE',
      rule: 11,
      message: `${character.name} references non-existent location`,
      severity: 'CRITICAL',
    });
  }

  return violations;
}

/**
 * Validate system-wide integrity
 */
export function validateSystemIntegrity(characters, locations) {
  const violations = {
    vgcTowers: [],
    characters: [],
    summary: { critical: 0, warning: 0, total: 0 },
  };

  // Check VGC Towers (Rule 1, 2, 3)
  if (PresenceEnforcementRules.hasMultipleVGCTowers(locations)) {
    violations.vgcTowers.push({
      type: 'MULTIPLE_VGC_TOWERS',
      rule: 1,
      message: 'Multiple VGC Towers instances detected — data integrity violation',
      severity: 'CRITICAL',
    });
    violations.summary.critical++;
  }

  const vgc = PresenceEnforcementRules.getVGCTowers(locations);
  if (vgc) {
    if (PresenceEnforcementRules.hasInvisibleResidents(vgc)) {
      violations.vgcTowers.push({
        type: 'INVISIBLE_RESIDENTS',
        rule: 3,
        message: 'VGC Towers has residents without visible names',
        severity: 'CRITICAL',
      });
      violations.summary.critical++;
    }
  }

  // Build location map
  const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

  // Check characters
  for (const char of characters) {
    const charViolations = getCharacterViolations(char, locationMap);
    if (charViolations.length > 0) {
      violations.characters.push({
        characterId: char.id,
        characterName: char.name,
        violations: charViolations,
      });
      charViolations.forEach(v => {
        if (v.severity === 'CRITICAL') violations.summary.critical++;
        else violations.summary.warning++;
      });
    }
  }

  violations.summary.total = violations.summary.critical + violations.summary.warning;
  return violations;
}