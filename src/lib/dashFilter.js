/**
 * dashFilter.js
 *
 * Removes AI-generated dashes (em dash —, en dash –, and spaced hyphen " - ")
 * from character dialogue before it is displayed to the user.
 *
 * Real people texting do NOT use dashes for dramatic pauses or thought connections.
 * This filter rewrites them into natural sentence structure.
 *
 * Rules:
 *  — and – between two words/phrases → comma or period (context-aware)
 *  " - " (space-hyphen-space) between phrases → comma or period
 *  Word- at end of clause (interrupted thought) → just remove and use period
 *
 * EXCEPTION: hyphens inside words ("self-aware", "x-ray", "well-known") are preserved.
 */
export function filterDashes(text, worldName = null) {
  // IDENTITY HARD LOCK: Also sanitize foreign user names as part of this filter pass
  // This ensures every response goes through identity sanitization before display
  if (text && worldName) {
    const FOREIGN_USER_NAMES = ['Mark'];
    for (const foreignName of FOREIGN_USER_NAMES) {
      if (worldName !== foreignName) {
        // Direct address patterns
        text = text.replace(
          new RegExp(`(Hey|Hi|Yo|Listen|Look|Come on|Stop|Wait|Oh|Okay|Right|No|Yes|Yeah|Sorry|Damn|But|So|And|Because|,|\\.|\\?|!)\\s+${foreignName}\\b`, 'gi'),
          (match, pre) => `${pre} ${worldName}`
        );
        // Trailing address
        text = text.replace(new RegExp(`\\b${foreignName}([,\\.\\?!])`, 'g'), `${worldName}$1`);
        // Identity claims
        text = text.replace(
          new RegExp(`(you(?:'re| are| were| used to be)|I (?:know|knew|remember) you as|calling you)\\s+${foreignName}\\b`, 'gi'),
          (match, pre) => `${pre} ${worldName}`
        );
        // Sentence-level: if line contains "you" and the foreign name, replace it
        const lines = text.split(/(?<=[.!?])\s+/);
        text = lines.map(line => {
          if (/\byou\b|\byour\b/i.test(line) && new RegExp(`\\b${foreignName}\\b`, 'i').test(line)) {
            return line.replace(new RegExp(`\\b${foreignName}\\b`, 'gi'), worldName);
          }
          return line;
        }).join(' ');
      }
    }
  }

  if (!text) return text;

  let result = text;

  // 1. Em dash (—) and en dash (–): replace with comma or period based on context
  //    If preceded by a sentence-ending word (typically short clause), use a period.
  //    Otherwise use a comma.
  result = result.replace(/\s*[—–]\s*/g, (match, offset, str) => {
    // Look at the char before: if it's a letter/digit, decide comma vs period
    const before = str.slice(0, offset).trimEnd();
    const afterDash = str.slice(offset + match.length).trimStart();
    // If what follows starts with a capital letter (new sentence context), use period+space
    if (afterDash && /^[A-Z]/.test(afterDash)) {
      return '. ';
    }
    // Otherwise use comma+space
    return ', ';
  });

  // 2. Spaced hyphen " - " between phrases (not inside a hyphenated word)
  //    e.g. "I mean - I don't know" → "I mean, I don't know"
  result = result.replace(/\s+-\s+/g, (match, offset, str) => {
    const afterDash = str.slice(offset + match.length).trimStart();
    if (afterDash && /^[A-Z]/.test(afterDash)) {
      return '. ';
    }
    return ', ';
  });

  // 3. Trailing dash at end of a word mid-sentence (cut-off thought): remove the dash
  //    e.g. "You just-" → "You just."
  result = result.replace(/(\w)-\s*$/gm, '$1.');

  // 4. Word followed by dash then next word with no space (rare AI pattern): treat as comma
  //    e.g. "wait-what" → "wait, what" (only if not a known compound)
  //    We only do this when it's letter-dash-letter with a space after the second word
  //    This is very conservative to avoid breaking real hyphens.
  result = result.replace(/([a-zA-Z])-([a-zA-Z]+\s)/g, (match, p1, p2, offset, str) => {
    // Only replace if this looks like a dramatic pause, not a compound word.
    // Heuristic: if the segment before is a short common word, it's probably a pause.
    const shortWords = /\b(i|me|you|we|it|so|but|wait|like|just|and|no|ok|okay|hmm|idk|tbh|ngl|wow|yeah|yea|oh|ah|ugh|hey|well|see|look|go)\b/i;
    const context = str.slice(Math.max(0, offset - 15), offset + match.length);
    if (shortWords.test(context)) {
      return `${p1}, ${p2}`;
    }
    return match; // leave compound words alone
  });

  return result;
}