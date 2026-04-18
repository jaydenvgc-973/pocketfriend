/**
 * Strip character name prefix from NPC responses (e.g. "Sarah: Hi there!" → "Hi there!")
 */
export function stripCharacterNamePrefix(text, characterName) {
  if (!text || !characterName) return text;
  
  const charFirstName = characterName.split(' ')[0];
  const charFullName = characterName;
  
  const namePatterns = [
    new RegExp(`^${charFullName}\\s*[:\\-]\\s*`, 'i'),
    new RegExp(`^${charFirstName}\\s*[:\\-]\\s*`, 'i'),
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match) {
      return text.slice(match[0].length).trim();
    }
  }
  
  return text;
}