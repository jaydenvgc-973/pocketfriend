/**
 * relationshipRoleResolver.js
 *
 * Thin contact-entry matcher for relationship-role recipient requests
 * ("text your dad", "call your mom", "message your wife").
 *
 * This is NOT a competing identity authority. It does not decide who a
 * character's family member IS — that decision belongs to the acting
 * character's authoritative profile data. It locates the contact entry whose
 * relationship label matches the requested role and returns the character_id
 * already attached to that entry — the SAME (label, character_id) the World
 * Phone contact list displays for this speaker.
 *
 * SINGLE IDENTITY SOURCE: the acting character's `family_members` and
 * `fictional_relationships` — the authoritative contact data already on the
 * Character record (the same fields characterContactsResolver.js reads to
 * build the World Contacts list, and the same data injected into the
 * character's system prompt so the conversation layer understands "your dad"
 * = Victor). Identity is resolved ONCE, here, from the speaker's own profile.
 * The downstream send pipeline consumes that character_id via the backend's
 * direct_id path — no global roster search, no surname matching, no
 * active-character preference, no conversation-history scan.
 *
 * It does NOT query conversation history.
 * It does NOT scan the global roster.
 * It does NOT guess, infer, or do fuzzy/substring matching.
 * If the matching contact entry has no character_id, or no entry matches, it
 * returns null and the caller fails cleanly (no fallback, no guess).
 *
 * The canonical-role map (dad→father, mom→mother, ...) is only a vocabulary
 * bridge so a user's word ("dad") can match the label a character stores
 * ("father"). It is a matching helper, not an identity authority.
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