/**
 * characterNarrativeName
 *
 * A test character may carry an assigned alias. When it does, that alias is the
 * name used whenever the character is referenced in Story Mode, Story Events and
 * generated narratives. Test character status itself is unchanged.
 */

export function characterAliasName(character) {
  const aliases = Array.isArray(character?.aliases) ? character.aliases : [];
  return aliases
    .map(a => (typeof a === "string" ? a : a?.text || a?.alias_name))
    .filter(Boolean)[0] || null;
}

export function narrativeNameFor(character) {
  if (!character) return "";
  const alias = characterAliasName(character);
  if (character.is_test_character === true && alias) return alias;
  return character.name || character.display_name || "";
}