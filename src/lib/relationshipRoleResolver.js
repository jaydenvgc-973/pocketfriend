/**
 * relationshipRoleResolver.js
 *
 * Minimal authoritative resolver for relationship-role recipient requests
 * ("text your dad", "call your mom", "message your wife").
 *
 * Reads ONLY from the acting character's existing authoritative data already
 * loaded on the Character record — character.family_members and
 * character.fictional_relationships — the same authoritative source used by
 * characterContactsResolver.js (SOURCE 1 / SOURCE 2) for the World Contacts list.
 *
 * It does NOT query conversation history.
 * It does NOT guess, infer, or do fuzzy/substring matching.
 * If no authoritative record matches the requested role, it returns null and the
 * caller must fail cleanly.
 *
 * A small canonical-role map (dad→father, mom→mother, bro→brother, ...) is the
 * minimum bridge needed so a user's word ("dad") can match the role label a
 * character stores ("father"). This is the smallest direct repair required to
 * use the existing authoritative data structure; it is not a normalization
 * system or fallback chain.
 */

const ROLE_CANONICAL = {
  dad: 'father', daddy: 'father', father: 'father', pa: 'father', papa: 'father', pop: 'father',
  mom: 'mother', mommy: 'mother', mother: 'mother', ma: 'mother', mama: 'mother', mum: 'mother', mummy: 'mother',
  bro: 'brother', brother: 'brother',
  sis: 'sister', sister: 'sister',
  son: 'son', daughter: 'daughter', child: 'child', kid: 'child',
  husband: 'husband', wife: 'wife', spouse: 'spouse',
  boyfriend: 'boyfriend', girlfriend: 'girlfriend', partner: 'partner',
  fiance: 'fiance', fiancee: 'fiance',
  uncle: 'uncle', aunt: 'aunt', nephew: 'nephew', niece: 'niece',
  grandpa: 'grandfather', granddad: 'grandfather', grandfather: 'grandfather',
  grandma: 'grandmother', grandmom: 'grandmother', grandmother: 'grandmother',
  stepdad: 'stepfather', stepfather: 'stepfather',
  stepmom: 'stepmother', stepmother: 'stepmother',
  stepbrother: 'stepbrother', stepsister: 'stepsister',
  cousin: 'cousin',
};

export const KNOWN_ROLE_TERMS = Object.keys(ROLE_CANONICAL);

export function canonicalRole(term) {
  const t = (term || '').toLowerCase().trim();
  return ROLE_CANONICAL[t] || t;
}

/**
 * Resolve a relationship-role term to the acting character's related character.
 * Returns { characterId, name } or null.
 * Never consults conversation history.
 */
export function resolveRelationshipRoleRecipient(character, roleTerm) {
  if (!character || !roleTerm) return null;
  const requested = canonicalRole(roleTerm);
  if (!requested) return null;

  // PRIMARY: character.family_members — authoritative pair-specific family data.
  // Mirrors the fields read by characterContactsResolver.js (SOURCE 1).
  for (const fm of (character.family_members || [])) {
    const storedRole = canonicalRole(fm.relationship_type || fm.role || '');
    const charId = fm.character_id || fm.related_character_id || null;
    if (storedRole === requested && charId) {
      return { characterId: charId, name: fm.name || fm.person_name || null };
    }
  }

  // SECONDARY: character.fictional_relationships — for romantic/partnership
  // roles that may be recorded here rather than in family_members.
  // Mirrors the fields read by characterContactsResolver.js (SOURCE 2).
  for (const r of (character.fictional_relationships || [])) {
    const storedRole = canonicalRole(r.relationship_type || r.role || '');
    if (storedRole === requested && r.related_character_id) {
      return { characterId: r.related_character_id, name: r.person_name || r.name || null };
    }
  }

  return null;
}