/**
 * FAMILY MEMBER RESOLVER — backward-compat shim
 *
 * All logic has moved to lib/canonicalPersonResolver.js.
 * This module re-exports resolveOrCreateFamilyMemberCharacter as a thin wrapper
 * so existing callers continue to work without modification.
 *
 * NEW CODE should import resolveCanonicalPerson directly from canonicalPersonResolver.js.
 */

import { resolveCanonicalPerson } from './canonicalPersonResolver.js';

/**
 * @deprecated Use resolveCanonicalPerson from canonicalPersonResolver.js instead.
 *
 * Resolve or create a family member character.
 * Delegates to resolveCanonicalPerson in "create_if_confident" mode.
 */
export async function resolveOrCreateFamilyMemberCharacter({
  name,
  owner_email,
  owner_user_id,
  user_role,
  photo_url,
  linked_character_id,
  all_live_characters,
  base44,
}) {
  const result = await resolveCanonicalPerson({
    owner_email,
    name,
    linked_character_id: linked_character_id || null,
    avatar_url: photo_url || null,
    source_type: 'family_member',
    mode: 'create_if_confident',
    all_live_characters: all_live_characters || [],
    all_fictional_rels: (all_live_characters || []).flatMap(c => c.fictional_relationships || []),
    base44,
    owner_user_id,
    user_role,
  });

  if (!result.canonical_person_id) {
    throw new Error(result.failure_reason || `Could not resolve or create family member "${name}"`);
  }

  return {
    id: result.canonical_person_id,
    name,
    character_type: 'npc_family_member',
    created: result.status === 'created',
  };
}