/**
 * worldPhonePronouns.js
 *
 * Resolves pronoun-based World Phone intents ("text him", "call her")
 * by scanning recent conversation messages for the most recently mentioned
 * known contact name.
 */

/**
 * resolvePronounToRecipient
 * 
 * Given a character's known relationships/family and recent conversation messages,
 * finds the most recently mentioned known person's name.
 * 
 * @param {object} character - The sender Character record
 * @param {array} recentMessages - Recent conversation messages (last ~20)
 * @returns {string|null} - Resolved recipient name, or null if not found
 */
export function resolvePronounToRecipient(character, recentMessages) {
  const knownRelationships = character?.fictional_relationships || [];
  const knownFamilyMembers = character?.family_members || [];
  
  const allKnownNames = [
    ...knownRelationships.map(r => r.person_name).filter(Boolean),
    ...knownFamilyMembers.map(f => f.name).filter(Boolean),
  ];

  if (allKnownNames.length === 0) return null;

  // Scan from most recent message backward
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msgContent = (recentMessages[i].content || '').toLowerCase();
    for (const name of allKnownNames) {
      if (name.length > 2 && msgContent.includes(name.toLowerCase())) {
        return name;
      }
    }
  }

  return null;
}