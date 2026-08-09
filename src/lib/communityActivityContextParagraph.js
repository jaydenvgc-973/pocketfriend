/**
 * communityActivityContextParagraph.js
 *
 * TRANSFER UTILITY — not a character-analysis system.
 *
 * Builds one short natural-language context paragraph for the Story Event
 * plot field, using ONLY information already surfaced by the Community
 * Activity attendee reasoning (getEventAttendeesWithDiagnostic in
 * CommunityEventsStrip).
 *
 * What this carries forward:
 *   - event name, date, time, full location (location_name already includes
 *     room/sub-location when one was defined, e.g. "Public Library — Meeting Room B")
 *   - the event's existing category, vibe, and description
 *   - for each transferred attendee, the established character traits /
 *     preferences / interests / affiliations / temperament already surfaced
 *     by the attendee reasoning — rewritten as clean factual statements
 *
 * What this intentionally does NOT carry forward (selection mechanics — they
 * answered "who should appear?" and stop there):
 *   - scores, ranking position, eligibility calculations
 *   - friendship-level / romantic-level / social-need / energy weighting
 *   - "likely attendee" / "socially motivated" / "unlikely to attend" language
 *   - protected-state / availability checks
 *   - venue existence ("location X exists in world") / rabbit-hole notes
 *   - any diagnostic or debug language
 *
 * The attendee decision has already been made by the time this runs.
 * Transferred attendees are stated as participants, never as hypotheticals.
 */

/**
 * Extract clean, established character facts from the existing diagnostic
 * `reasons` array produced by scoreAttendance.
 *
 * Each reason is a human-readable string from the scoring engine. Only reasons
 * matching a known trait/preference/interest/affiliation pattern are kept; the
 * rest (scoring, need-state, venue, relationship weighting) are silently
 * dropped so no selection mechanics leak into the story context.
 *
 * @param {string[]} reasons - diagnostic.reasons for a single character
 * @returns {string[]} concise, deduplicated fact fragments
 */
function extractFactsFromReasons(reasons = []) {
  const facts = [];
  const seen = new Set();
  const add = (f) => {
    if (f && !seen.has(f)) {
      seen.add(f);
      facts.push(f);
    }
  };

  for (const r of reasons) {
    if (!r) continue;

    // Temperament / social energy
    if (r.startsWith('extrovert matches')) add('extroverted');
    else if (r.startsWith('ambivert')) add('ambiverted');
    else if (r.startsWith('introvert')) add('introverted');

    // Boolean personality traits (the part before "→")
    else if (r.startsWith('compassionate →')) add('compassionate');
    else if (r.startsWith('competitive →')) add('competitive');
    else if (r.startsWith('loyal →')) add('loyal');
    else if (r.startsWith('night owl +')) add('a night owl');
    else if (r.startsWith('loud →')) add('outspoken');
    else if (r.startsWith('empathetic →')) add('empathetic');
    else if (r.startsWith('conscientious →')) add('conscientious');
    else if (r.startsWith('generous →')) add('generous');
    else if (r.startsWith('flirty →')) add('flirty');
    else if (r.startsWith('risk taker →')) add('a risk-taker');
    else if (r.startsWith('morning person +')) add('a morning person');
    else if (r.startsWith('hard to read →')) add('hard to read');
    else if (r.startsWith('bougie →')) add('refined tastes');
    else if (r.startsWith('cynical (')) add('cynical');
    else if (r.startsWith('self-absorbed →')) add('self-absorbed');

    // Religion / affiliation (only when surfaced as relevant to the event)
    else if (r.startsWith('religious (')) {
      const m = r.match(/religious \(([^)]+)\)/);
      if (m) add(`religious (${m[1]})`);
    }

    // Interest keywords surfaced from personality text
    else if (r.startsWith('personality mentions:')) {
      const m = r.match(/personality mentions: (.+)/);
      if (m) add(`drawn to ${m[1]}`);
    }

    // Awareness-profile interest tags
    else if (r.startsWith('interest tags match:')) {
      const m = r.match(/interest tags match: (.+)/);
      if (m) add(`interested in ${m[1]}`);
    }

    // Established preference: frequents this place
    else if (r.startsWith('frequents ')) {
      const m = r.match(/frequents (.+)/);
      if (m) add(`frequents ${m[1]}`);
    }

    // All other reasons (friendship level, romantic level, social need, energy,
    // venue existence, lives-at-venue, rabbit-hole, avoidance-as-mismatch, etc.)
    // are selection mechanics or situational scoring and are intentionally
    // NOT carried forward.
  }

  return facts;
}

/**
 * Build the context paragraph.
 *
 * @param {object} activity - the Community Activity / default event object
 * @param {object[]} attendees - the character records being transferred
 * @param {object[]} allDiagnostics - getEventAttendeesWithDiagnostic().allDiagnostics
 *   (each entry: { name, score, included, blocked, blockedReason, reasons, diagnostic })
 * @returns {string} one concise paragraph, or '' if no activity
 */
export function buildCommunityActivityContextParagraph(activity, attendees = [], allDiagnostics = []) {
  if (!activity) return '';

  const startDate = new Date(activity.start_date);
  const dateStr = startDate.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = startDate.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });

  // Full location — location_name already carries room/sub-location when present.
  const locationStr = activity.location_name || 'a location to be determined';

  // Event nature: existing category, vibe, and description.
  const category = activity.event_type ? activity.event_type.replace(/_/g, ' ') : null;
  const article = (word) => /^[aeiou]/i.test(word || '') ? 'an' : 'a';
  const natureBits = [];
  if (category) natureBits.push(`${article(category)} ${category} event`);
  if (activity.vibe) natureBits.push(`${article(activity.vibe)} ${activity.vibe} atmosphere`);
  if (activity.description) {
    // Avoid a double period when the description already ends with punctuation.
    const desc = activity.description.replace(/[.!?]+$/, '');
    natureBits.push(desc);
  }
  const natureStr = natureBits.join('; ') || 'a community gathering';

  let paragraph = `${activity.name} takes place ${dateStr} at ${timeStr} at ${locationStr}. It is ${natureStr}.`;

  // Per-attendee established facts. Match diagnostics by character id (robust
  // against duplicate names); fall back to name match if id is absent.
  const diagById = new Map();
  const diagByName = new Map();
  for (const d of allDiagnostics) {
    if (!d) continue;
    if (d.diagnostic?.characterId) diagById.set(d.diagnostic.characterId, d);
    if (d.name) diagByName.set(d.name, d);
  }

  const attendeeSentences = [];
  for (const att of attendees) {
    const name = att?.name || att?.display_name;
    if (!name) continue;
    const diag = (att?.id && diagById.get(att.id)) || diagByName.get(name);
    const facts = diag ? extractFactsFromReasons(diag.reasons) : [];
    if (facts.length > 0) {
      attendeeSentences.push(`${name} is ${facts.join(', ')}.`);
    }
    // If no established facts were surfaced, nothing is added for this
    // attendee — they are already present in the participant list, and we do
    // not invent traits or insert "likely to attend" language.
  }

  if (attendeeSentences.length > 0) {
    paragraph += ' ' + attendeeSentences.join(' ');
  }

  return paragraph;
}