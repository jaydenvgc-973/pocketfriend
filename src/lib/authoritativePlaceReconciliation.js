/**
 * authoritativePlaceReconciliation
 *
 * Keeps a character's own prompt from establishing a SECOND physical location.
 *
 * The canonical character prompt (buildCanonicalCharacterContext) writes place and
 * presence assertions into the identity block — "YOU ARE HERE RIGHT NOW: …",
 * "CURRENT LOCATION: …", "AUTHORITATIVE PRESENCE: AT WORK". Those lines are
 * produced from whatever location fields the builder had when it ran, and the
 * result is cached, so a prompt built at one place can still be in use after the
 * character has moved. When that happens the character denies being where the app
 * shows them, because the older assertion is labelled authoritative.
 *
 * This module does not resolve location and does not store anything. It takes the
 * turn's authoritative snapshot — the same value the homepage card and the Chat
 * geolocation tag display — and rewrites the place assertions in an already-built
 * prompt so the prompt describes that one place. Nothing outside the place and
 * presence lines is touched.
 */

/**
 * The turn's physical location, taken from the record every existing surface
 * already resolves (buildCharacterInScene → resolveCharacterLocation).
 */
export function buildAuthoritativePlaceState(characterInScene) {
  if (!characterInScene) return null;
  return {
    location_id: characterInScene.resolved_current_location_id ?? null,
    location_name: characterInScene.resolved_current_location_name ?? null,
    location_type: characterInScene.resolved_location_type ?? null,
    presence_status: characterInScene.resolved_presence_status ?? null,
    source: 'buildCharacterInScene',
  };
}

function currentLocationLine(name, presence) {
  const ps = presence && presence !== 'traveling' ? presence.replace(/_/g, ' ') : null;
  return `CURRENT LOCATION: ${name}${ps ? ` (${ps})` : ''}. You are physically here and only here right now; anything in earlier messages, narratives, promises or history that places you elsewhere is outdated. A promise, a plan, or a user-confirmed scheduled move is NOT an arrival — only this line establishes where you physically are. You may say you are about to head somewhere, but you have not arrived there and may not narrate arriving.`;
}

/**
 * Rewrites place/presence assertions in a built prompt to the authoritative place.
 *
 * @param {string} prompt — the canonical character prompt
 * @param {{location_name?: string, presence_status?: string}} state — authoritative place
 * @returns {string} the same prompt with place assertions reconciled
 */
export function reconcileAuthoritativePlace(prompt, state) {
  if (!prompt || typeof prompt !== 'string') return prompt;
  const name = state?.location_name || null;
  if (!name) return prompt; // nothing authoritative to reconcile against

  const presence = state?.presence_status || null;
  const atWork = presence === 'at_work';
  const atSchool = presence === 'at_school';

  const lines = prompt.split('\n');
  const out = [];

  for (const line of lines) {
    // Presence assertions that contradict this turn's place are removed entirely —
    // an unsupported "AT WORK" is what let a character insist he was still there.
    if (!atWork && (line.startsWith('AUTHORITATIVE PRESENCE: AT WORK') || line.startsWith('PRESENCE STATUS: at_work'))) continue;
    if (!atSchool && (line.startsWith('AUTHORITATIVE PRESENCE: AT SCHOOL') || line.startsWith('PRESENCE STATUS: at_school'))) continue;

    if (line.startsWith('YOU ARE HERE RIGHT NOW:')) {
      out.push(`YOU ARE HERE RIGHT NOW: ${name}. This is your only physical location.`);
      continue;
    }
    if (line.startsWith('CURRENT LOCATION:')) {
      out.push(currentLocationLine(name, presence));
      continue;
    }
    if (line.startsWith('Your Current Location:')) {
      out.push(`Your Current Location: ${name}`);
      continue;
    }
    if (line.startsWith('Your Current Presence:')) {
      out.push(`Your Current Presence: ${presence ? presence.replace(/_/g, ' ') : name}`);
      continue;
    }
    // The world-state block restates the committed presence the same way.
    if (line.startsWith('Your committed presence state (') && presence) {
      out.push(line.replace(/^Your committed presence state \([^)]*\)/, `Your committed presence state (${presence})`));
      continue;
    }
    out.push(line);
  }

  return out.join('\n');
}