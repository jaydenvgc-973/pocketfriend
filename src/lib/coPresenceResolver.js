/**
 * coPresenceResolver.js
 *
 * SHARED CO-PRESENCE RESOLVER — Single source of truth for all routes.
 *
 * Used by: Chat, Text (phone), Scene, World Contacts, Group Chat,
 *          Proactive Messages, Automatic Narratives, Action Narration,
 *          Memory extraction, Memory retrieval.
 *
 * RULES:
 * - Co-presence is LIVE STATE. Never cache this output.
 * - Call this on every message send / narrative generation / context build.
 * - Reads from already-loaded userSettings + character objects — no extra API call.
 * - Returns a structured result AND a formatted prompt block string.
 *
 * Source of truth fields:
 *   User location  → UserSettings.user_current_location_id / user_presence_status
 *   Char location  → Character.resolved_current_location_id / resolved_presence_status
 */

/**
 * resolveCoPresence(character, userSettings, userDisplayName?)
 *
 * @param {object} character     - Full character record (from React Query / entity fetch)
 * @param {object} userSettings  - Full UserSettings record (must be fresh — invalidate before calling)
 * @param {string} [userDisplayName] - The user's world name (for prompt wording)
 *
 * @returns {{
 *   sharedLocationVerified: boolean,
 *   userIsHereWithCharacter: boolean,
 *   characterLocationId: string|null,
 *   characterLocationName: string|null,
 *   userLocationId: string|null,
 *   userLocationName: string|null,
 *   charBlocked: boolean,
 *   blockReason: string|null,
 *   source: string,
 *   warnings: string[],
 *   promptBlock: string,
 * }}
 */
export function resolveCoPresence(character, userSettings, userDisplayName = null) {
  const warnings = [];

  const userLocId    = userSettings?.user_current_location_id   || null;
  const userLocName  = userSettings?.user_current_location_name || null;
  const userPresence = userSettings?.user_presence_status       || 'away';

  const charLocId          = character?.resolved_current_location_id   || null;
  const charLocName        = character?.resolved_current_location_name || null;
  const charPresenceStatus = character?.resolved_presence_status       || null;

  // States that block co-presence awareness even if location IDs match
  let blockReason = null;
  if (charPresenceStatus === 'sleeping' || charPresenceStatus === 'napping') {
    blockReason = `character is ${charPresenceStatus}`;
  } else if (character?.is_jailed) {
    blockReason = 'character is incarcerated';
  } else if (character?.house_arrest_active) {
    blockReason = 'character is under house arrest';
  } else if (character?.travel_status && character.travel_status !== 'not_traveling') {
    blockReason = `character is traveling (${character.travel_status})`;
  }
  const charBlocked = !!blockReason;

  if (!userLocId) warnings.push('user_location_id missing from UserSettings');
  if (!charLocId) warnings.push('character resolved_current_location_id missing');

  const locationMatch        = !!(userLocId && charLocId && userLocId === charLocId);
  const sharedLocationVerified = locationMatch;
  const userIsHereWithCharacter = locationMatch && userPresence !== 'away' && !charBlocked;

  // Build the authoritative prompt block
  let promptBlock = '';
  const label = 'CO-PRESENCE TRUTH (authoritative, per-message — OVERRIDES any prior context)';

  if (!charLocId && !userLocId) {
    promptBlock = `\n\n════════════════════════════════════\n${label}\n════════════════════════════════════\n⚠️ Neither your location nor the user's location is set. Do NOT assume presence or absence. Treat location as unknown.\n════════════════════════════════════\n`;
  } else if (userIsHereWithCharacter) {
    const userName = userDisplayName || 'the user';
    promptBlock = `\n\n════════════════════════════════════\n${label}\n════════════════════════════════════\nYOUR CURRENT LOCATION: ${charLocName || 'your location'}\nUSER IS PHYSICALLY HERE WITH YOU: YES\n${userName} is confirmed present at your current location (${userLocName || charLocName || 'shared location'}).\nTHIS IS VERIFIED SYSTEM TRUTH — NOT a guess. Do NOT say you are unsure where ${userName} is. Do NOT speculate. ${userName} is HERE, with you, right now.\nRespond with full awareness that you are in the same physical space.\n════════════════════════════════════\n`;
  } else {
    let awayReason;
    if (userPresence === 'away') {
      awayReason = 'User is currently Away (not present at any location in the app world)';
    } else if (!locationMatch && userLocId && charLocId) {
      awayReason = `User is at a different location (${userLocName || userLocId})`;
    } else if (!userLocId) {
      awayReason = 'User location is not set';
    } else if (charBlocked) {
      awayReason = `Your current state prevents registering co-presence: ${blockReason}`;
    } else {
      awayReason = 'Locations do not match';
    }
    const charLocDisplay = charLocName ? `YOUR CURRENT LOCATION: ${charLocName}\n` : '';
    promptBlock = `\n\n════════════════════════════════════\n${label}\n════════════════════════════════════\n${charLocDisplay}USER IS PHYSICALLY HERE WITH YOU: NO\nReason: ${awayReason}\nDo NOT imply the user is present. Do NOT invite them to a location they may already be at. Respond naturally without assuming shared physical space.\n════════════════════════════════════\n`;
  }

  const result = {
    sharedLocationVerified,
    userIsHereWithCharacter,
    characterLocationId:   charLocId,
    characterLocationName: charLocName,
    userLocationId:        userLocId,
    userLocationName:      userLocName,
    charBlocked,
    blockReason,
    source: 'frontend_live_resolver',
    warnings,
    promptBlock,
  };

  // Diagnostic log — visible in console on every send
  console.log(
    `[CoPresence] char=${character?.name || '?'}` +
    ` | charLoc=${charLocId || 'none'}` +
    ` | userLoc=${userLocId || 'none'}` +
    ` | match=${locationMatch}` +
    ` | userPresence=${userPresence}` +
    ` | charBlocked=${charBlocked}${blockReason ? ` (${blockReason})` : ''}` +
    ` | userIsHere=${userIsHereWithCharacter}` +
    (warnings.length ? ` | warnings=[${warnings.join(', ')}]` : '')
  );

  return result;
}