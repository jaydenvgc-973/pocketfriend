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
 * Returns true if the text is a date string, divider label, or malformed
 * punctuation-wrapped date that should NEVER be saved as a character message.
 *
 * Root cause: createDailyDateMarker (now archived) wrote records like
 * "—— Monday, June 1, 2026 ——" to the Message table. When the LLM received
 * these in chatHistory it sometimes echoed them back. This guard is the
 * final rejection point before any such string reaches Message.create().
 *
 * Called by filterDashes — every LLM text response passes through here.
 * Returns empty string instead of the divider content so the caller can
 * detect a rejected response (falsy / empty) and skip saving.
 */
export function isDateDividerContent(text) {
  if (!text) return false;
  const s = text.trim();
  if (!s) return false;

  // Dash-wrapped: "—— Monday, June 1, 2026 ——" or "-- Thursday --"
  if (/^[-–—]{2,}/.test(s) && /[-–—]{2,}$/.test(s) && /\d{4}/.test(s)) return true;

  // Starts with day name (possibly prefixed by commas/dashes) + year
  // Catches: "Monday, June 1, 2026" or ", . Monday, June 1, 2026, ,"
  if (/^[-–—,.\s]{0,8}(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(s) && /\d{4}/.test(s)) return true;

  // Standalone month+date+year: "June 1, 2026"
  if (/^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}[.,]?$/i.test(s)) return true;

  // Malformed comma/period-wrapped date with no real content: ", . Monday, June 1, 2026, ,"
  // Check: mostly punctuation/spaces around a date
  if (/^[,.\s]+/.test(s) && /[,.\s]+$/.test(s) && /\d{4}/.test(s)) {
    const stripped = s.replace(/[,.\s\-–—]/g, '');
    if (stripped.length < 40) return true;
  }

  return false;
}

export function filterDashes(text) {
  if (!text) return text;

  // DATE-DIVIDER GUARD: reject before any dash rewriting touches the string.
  // If the LLM echoed a date-divider record, return empty string so the caller
  // knows to skip saving this message.
  if (isDateDividerContent(text)) {
    console.error(`[filterDashes/SAVE_GUARD] Date-divider content rejected: "${text.substring(0, 100)}"`);
    return '';
  }

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