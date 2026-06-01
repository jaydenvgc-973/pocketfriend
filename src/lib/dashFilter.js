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
/**
 * isDateDividerContent(text)
 *
 * Returns true if the text is shaped like a date divider rather than real dialogue.
 * Used as a save guard before any character Message is persisted.
 *
 * Catches patterns like:
 *   ", . Monday, June 1, 2026, ,"
 *   "—— Thursday, May 22, 2026 ——"
 *   "Monday, June 1, 2026"
 */
export function isDateDividerContent(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  // dash-wrapped: —— text ——
  if (/^[-–—,.\s]{2,}/.test(t) && /[-–—,.\s]{2,}$/.test(t) &&
      /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(t) &&
      /\d{4}/.test(t) && t.length < 80) return true;
  // plain weekday + year with no other content
  if (/^[-–—,.\s]*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)[,\s]+/i.test(t) &&
      /\d{4}/.test(t) && t.length < 60) return true;
  return false;
}

export function filterDashes(text) {
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