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

/**
 * Remove self-referential name mentions (e.g. "I'm Sarah, ..." → "...")
 */
export function stripSelfReferenceName(text, characterName) {
  if (!text || !characterName) return text;
  
  const firstName = characterName.split(' ')[0];
  const fullName = characterName;
  
  // Patterns for self-referential name mentions
  const patterns = [
    new RegExp(`\\bi['']?m\\s+${fullName}[,.]?\\s*`, 'gi'),
    new RegExp(`\\bi['']?m\\s+${firstName}[,.]?\\s*`, 'gi'),
    new RegExp(`${fullName}\\s+here[,.]?\\s*`, 'gi'),
    new RegExp(`${firstName}\\s+here[,.]?\\s*`, 'gi'),
    new RegExp(`it['']?s\\s+${fullName}[,.]?\\s*`, 'gi'),
    new RegExp(`it['']?s\\s+${firstName}[,.]?\\s*`, 'gi'),
    new RegExp(`this\\s+is\\s+${fullName}[,.]?\\s*`, 'gi'),
    new RegExp(`this\\s+is\\s+${firstName}[,.]?\\s*`, 'gi'),
    new RegExp(`(?:my\\s+)?name[''s]*\\s+(?:is\\s+)?${fullName}[,.]?\\s*`, 'gi'),
    new RegExp(`(?:my\\s+)?name[''s]*\\s+(?:is\\s+)?${firstName}[,.]?\\s*`, 'gi'),
  ];
  
  let result = text;
  for (const pattern of patterns) {
    result = result.replace(pattern, '');
  }
  
  return result.trim();
}