/**
 * Relationship Avatar Resolver
 *
 * Read-only. Resolves the established avatar for one fictional_relationships entry
 * using the app's existing avatar resolution order:
 *   1. the entry's own stored avatar_url
 *   2. the linked Character record (related_character_id) — avatar_url / image_avatar_url
 *   3. a Character record matching the entry's name
 *
 * An avatar that already exists elsewhere in Pocketfriend is never reported as missing
 * here, and nothing in this module creates or changes a character's identity.
 */
export function resolveRelationshipAvatar(rel, allCharacters = []) {
  if (!rel) return { avatarUrl: null, character: null };

  const normalizedName = rel.person_name?.trim().toLowerCase();

  const linked = rel.related_character_id
    ? allCharacters.find((c) => c.id === rel.related_character_id) || null
    : null;

  const nameMatch = linked
    ? null
    : allCharacters.find((c) => c.name?.trim().toLowerCase() === normalizedName) || null;

  const character = linked || nameMatch;
  const recordAvatar = character?.avatar_url || character?.image_avatar_url || null;

  return { avatarUrl: rel.avatar_url || recordAvatar || null, character };
}

/**
 * Reference images for identity-locked generation: the established avatar first,
 * then the character's own reference images. Never invent a new identity source.
 */
export function getRelationshipIdentityReferences(character) {
  if (!character) return [];
  const refs = [
    character.avatar_url || character.image_avatar_url || null,
    ...(character.reference_image_urls || []),
  ].filter(Boolean);
  return [...new Set(refs)].slice(0, 3);
}