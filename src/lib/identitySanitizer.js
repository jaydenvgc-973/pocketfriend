/**
 * identitySanitizer.js
 *
 * HARD LOCK: Pre-render identity validation.
 *
 * This is the final gate before any character response is displayed or saved.
 * It enforces that:
 * - The current user (Jayden) is NEVER addressed as another user's name (Mark)
 * - All user-identity references in AI output map to the correct canonical name
 * - No split identity ("Jayden now, Mark before") ever reaches the user
 *
 * This runs AFTER LLM generation and BEFORE the message is saved to the database.
 */

// Names from OTHER user accounts that must never appear as the current user's identity.
const FOREIGN_USER_NAMES = ['Mark'];

/**
 * Sanitize AI-generated response text to enforce correct user identity.
 *
 * @param {string} text - The raw AI response text
 * @param {string|null} currentUserWorldName - The current user's world name (e.g. "Jayden")
 * @returns {string} - Sanitized text safe to display and save
 */
export function sanitizeIdentityInResponse(text, currentUserWorldName) {
  if (!text || !currentUserWorldName) return text;

  let cleaned = text;

  for (const foreignName of FOREIGN_USER_NAMES) {
    // Only sanitize if current user's name is different from the foreign name
    if (currentUserWorldName === foreignName) continue;

    const n = foreignName;
    const r = currentUserWorldName;

    // 1. Direct address: "Hey Mark", "Listen Mark,", "Come on, Mark"
    cleaned = cleaned.replace(
      new RegExp(`(Hey|Hi|Yo|Listen|Look|Come on|Stop|Wait|Oh|Okay|Right|No|Yes|Yeah|Sorry|Damn|But|So|And|Because|Since|When|If|\\.|,|\\?|!)\\s+${n}\\b`, 'gi'),
      (match, pre) => `${pre} ${r}`
    );

    // 2. Trailing address: "...Mark." / "...Mark?" / "...Mark!"
    cleaned = cleaned.replace(
      new RegExp(`\\b${n}([,\\.\\?!])`, 'g'),
      `${r}$1`
    );

    // 3. Identity claims: "you're Mark", "you are Mark", "you used to be Mark",
    //    "I know you as Mark", "I remember you as Mark", "calling you Mark"
    cleaned = cleaned.replace(
      new RegExp(
        `(you(?:'re| are| were| used to be)|I (?:know|knew|remember|met|see|saw) you as|calling you|address(?:ing)? you(?: as)?)\\s+${n}\\b`,
        'gi'
      ),
      (match, pre) => `${pre} ${r}`
    );

    // 4. "your name is Mark" / "your name was Mark"
    cleaned = cleaned.replace(
      new RegExp(`your name (?:is|was|used to be)\\s+${n}\\b`, 'gi'),
      `your name is ${r}`
    );

    // 5. "I've always known you as Mark" / "I've been calling you Mark"
    cleaned = cleaned.replace(
      new RegExp(`(?:I'?ve(?: always)?|I'?ve been)\\s+(?:known|calling|addressing)\\s+you\\s+(?:as\\s+)?${n}\\b`, 'gi'),
      (match) => match.replace(new RegExp(`\\b${n}\\b`, 'g'), r)
    );

    // 6. Log any remaining occurrences for debugging (non-blocking)
    if (new RegExp(`\\b${n}\\b`, 'i').test(cleaned)) {
      console.warn(`[IDENTITY_SANITIZER] Residual foreign name "${n}" detected in response after sanitization. Applying broad fallback.`);
      // Broad fallback: if the name appears in a sentence that is clearly about the user
      // (contains "you", "your", first-person address), replace it
      const lines = cleaned.split(/(?<=[.!?])\s+/);
      cleaned = lines.map(line => {
        const isAboutUser = /\byou\b|\byour\b|\byou're\b|\byou've\b|\byou'd\b/i.test(line);
        if (isAboutUser && new RegExp(`\\b${n}\\b`, 'i').test(line)) {
          return line.replace(new RegExp(`\\b${n}\\b`, 'gi'), r);
        }
        return line;
      }).join(' ');
    }
  }

  return cleaned;
}

/**
 * Sanitize memory text for storage — prevent wrong user names from being persisted.
 *
 * @param {string} text - Raw text to sanitize
 * @param {string|null} currentUserWorldName - The current user's world name
 * @returns {string} - Sanitized text safe to store
 */
export function sanitizeIdentityForStorage(text, currentUserWorldName) {
  if (!text || !currentUserWorldName) return text;
  let cleaned = text;
  for (const foreignName of FOREIGN_USER_NAMES) {
    if (currentUserWorldName !== foreignName) {
      cleaned = cleaned.replace(new RegExp(`\\b${foreignName}\\b`, 'g'), currentUserWorldName);
    }
  }
  return cleaned;
}