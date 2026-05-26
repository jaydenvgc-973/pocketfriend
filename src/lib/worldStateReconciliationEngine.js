/**
 * WORLD-STATE RECONCILIATION ENGINE
 *
 * Single unified system that resolves authoritative world state BEFORE any character response.
 * Forces world-state to override conversational anchors.
 *
 * Resolves:
 * - Character's actual current location/presence
 * - User's actual current location/presence
 * - Other characters at the same location (co-presence)
 * - Elapsed time since last user interaction
 * - Shift/event/schedule phase
 * - Whether conversation is co-present or remote
 * - What has happened since last interaction
 *
 * This is THE authoritative source before LLM sees chat history.
 */

import { resolveCharacterLocation } from '@/lib/locationResolutionEngine';

/**
 * MAIN RECONCILIATION: Resolve complete world state for a character response
 *
 * Inputs:
 * - character: Character object with all fields
 * - allCharacters: Array of all characters (for co-presence detection)
 * - locationMap: {locationId: location}
 * - userSettings: Current user's settings (contains user location)
 * - currentTime: Date object (defaults to now)
 *
 * Returns:
 * {
 *   character_location: { id, name, type, presence_status },
 *   user_location: { id, name, presence_status } | null,
 *   is_user_present: boolean,
 *   co_present_characters: [{ id, name, avatar_url }],
 *   conversation_type: "co_present" | "remote_text" | "remote_call" | "alone_at_location",
 *   elapsed_time_minutes: number,
 *   last_interaction_time: ISO string | null,
 *   shift_phase: string | null,
 *   shift_elapsed: string,
 *   shift_remaining: string,
 *   offscreen_summary: string,
 *   world_state_truth: string (injected into LLM prompt)
 * }
 */
export function reconcileWorldStateForResponse(
  character,
  allCharacters = [],
  locationMap = {},
  userSettings = null,
  currentTime = new Date()
) {
  if (!character) {
    return createFailedReconciliation('No character provided');
  }

  // ── STEP 1: Resolve character's actual current location ──────────────────────
  const charLocation = resolveCharacterLocation(character, locationMap, currentTime);

  // ── STEP 2: Resolve user's current location ──────────────────────────────────
  const userLocationResult = resolveUserLocation(userSettings, locationMap);

  // ── STEP 3: Determine if user and character are co-present ──────────────────
  const isUserPresent = determineUserPresence(charLocation, userLocationResult);

  // ── STEP 4: Find all OTHER characters at the same location ──────────────────
  const coPresenceList = findCoPresenceCharacters(
    character.id,
    charLocation.resolved_current_location_id,
    allCharacters,
    locationMap
  );

  // ── STEP 5: Classify conversation type ─────────────────────────────────────
  const conversationType = classifyConversationType(
    isUserPresent,
    coPresenceList,
    charLocation
  );

  // ── STEP 6: Calculate elapsed time since last interaction ──────────────────
  const { elapsedMinutes, lastInteractionTime } = calculateElapsedTime(character);

  // ── STEP 7: Compute shift phase (if at work) ────────────────────────────────
  const shiftPhase = computeShiftPhase(character, currentTime);

  // ── STEP 8: Build offscreen activity summary ───────────────────────────────
  const offscreenSummary = buildOffscreenSummary(
    character,
    elapsedMinutes,
    charLocation,
    coPresenceList
  );

  // ── STEP 9: Generate authoritative world-state truth string ───────────────
  const worldStateTruth = generateWorldStateTruth(
    character,
    charLocation,
    userLocationResult,
    isUserPresent,
    coPresenceList,
    conversationType,
    elapsedMinutes,
    shiftPhase,
    currentTime
  );

  return {
    character_location: {
      id: charLocation.resolved_current_location_id,
      name: charLocation.resolved_current_location_name,
      type: charLocation.resolved_location_type,
      presence_status: charLocation.resolved_presence_status,
    },
    user_location: userLocationResult,
    is_user_present: isUserPresent,
    co_present_characters: coPresenceList,
    conversation_type: conversationType,
    elapsed_time_minutes: elapsedMinutes,
    last_interaction_time: lastInteractionTime,
    shift_phase: shiftPhase?.phase || null,
    shift_elapsed: shiftPhase?.elapsed || null,
    shift_remaining: shiftPhase?.remaining || null,
    offscreen_summary: offscreenSummary,
    world_state_truth: worldStateTruth,
  };
}

/**
 * Resolve user's current location from UserSettings
 */
function resolveUserLocation(userSettings, locationMap) {
  if (!userSettings) return null;

  const userLocId = userSettings.user_current_location_id;
  const userLocName = userSettings.user_current_location_name;
  const userPresenceStatus = userSettings.user_presence_status || 'away';

  if (!userLocId) {
    return {
      id: null,
      name: 'Away (not at a location)',
      presence_status: 'away',
    };
  }

  const location = locationMap[userLocId];
  return {
    id: userLocId,
    name: location?.name || userLocName || 'Unknown location',
    presence_status: userPresenceStatus === 'present' ? 'present' : 'away',
  };
}

/**
 * Determine if user is physically present with the character
 */
function determineUserPresence(charLocation, userLocationResult) {
  if (!userLocationResult || !userLocationResult.id) return false;
  if (!charLocation.resolved_current_location_id) return false;

  // User is present if at the same location AND marked as present (not away)
  return (
    charLocation.resolved_current_location_id === userLocationResult.id &&
    userLocationResult.presence_status === 'present'
  );
}

/**
 * Find all other characters at the same location
 */
function findCoPresenceCharacters(
  characterId,
  locationId,
  allCharacters,
  locationMap
) {
  if (!locationId) return [];

  const coPresent = [];
  for (const otherChar of allCharacters) {
    if (otherChar.id === characterId) continue; // Skip self

    const otherLocation = resolveCharacterLocation(otherChar, locationMap);
    if (otherLocation.resolved_current_location_id === locationId) {
      coPresent.push({
        id: otherChar.id,
        name: otherChar.name,
        avatar_url: otherChar.avatar_url || otherChar.image_avatar_url,
      });
    }
  }

  return coPresent;
}

/**
 * Classify the conversation type
 */
function classifyConversationType(isUserPresent, coPresenceList, charLocation) {
  if (isUserPresent) {
    return 'co_present'; // User is physically present
  }

  // Character is alone at location
  if (coPresenceList.length === 0) {
    return 'alone_at_location';
  }

  // Character is with other characters but not user
  return 'remote_text'; // Treat as remote since user is not there
}

/**
 * Calculate elapsed time since last user interaction
 */
function calculateElapsedTime(character) {
  // Try multiple sources for "last interaction" time
  let lastInteractionTime = null;

  // Source 1: Check if there's a last message timestamp in memory or chat context
  // (This would come from the Chat component passing it down)
  // For now, we can't get this without passing it in, so we estimate based on:
  // Source 2: Character's last message/activity
  // Source 3: Fall back to "unknown"

  // In practice, this will be populated by the Chat component via the response context builder
  const elapsedMinutes = lastInteractionTime
    ? Math.floor((new Date() - new Date(lastInteractionTime)) / 60000)
    : null;

  return { elapsedMinutes, lastInteractionTime };
}

/**
 * Compute shift phase if character is at work
 */
function computeShiftPhase(character, currentTime) {
  const presence = character.resolved_presence_status;
  if (presence !== 'at_work' || !character.work_start_time || !character.work_end_time) {
    return null;
  }

  const nowET = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const [sh, sm] = character.work_start_time.split(':').map(Number);
  const [eh, em] = character.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  const isOvernight = endMin < startMin;
  let elapsedMin;
  if (isOvernight && nowMin < endMin) {
    elapsedMin = (1440 - startMin) + nowMin;
  } else {
    elapsedMin = nowMin - startMin;
  }

  const totalShiftMin = isOvernight ? (1440 - startMin) + endMin : endMin - startMin;
  const remainingMin = Math.max(0, totalShiftMin - elapsedMin);

  if (elapsedMin < 0 || totalShiftMin <= 0) return null;

  const pct = elapsedMin / totalShiftMin;
  const elapsedHrs = Math.floor(elapsedMin / 60);
  const elapsedMinsRem = elapsedMin % 60;
  const remHrs = Math.floor(remainingMin / 60);
  const remMinsRem = remainingMin % 60;

  const elapsedStr = elapsedHrs > 0 ? `${elapsedHrs}h ${elapsedMinsRem}m` : `${elapsedMinsRem}m`;
  const remainingStr = remHrs > 0 ? `${remHrs}h ${remMinsRem}m` : `${remMinsRem}m`;

  let phase = '';
  if (pct < 0.15) phase = 'early_shift';
  else if (pct < 0.40) phase = 'early_mid_shift';
  else if (pct < 0.65) phase = 'mid_shift';
  else if (pct < 0.85) phase = 'late_shift';
  else phase = 'near_end_shift';

  return { phase, elapsed: elapsedStr, remaining: remainingStr, pct };
}

/**
 * Build a summary of offscreen activity
 */
function buildOffscreenSummary(character, elapsedMinutes, charLocation, coPresenceList) {
  const lines = [];

  if (elapsedMinutes === null || elapsedMinutes === 0) {
    return 'No significant time has passed.';
  }

  const hours = Math.floor(elapsedMinutes / 60);
  const mins = elapsedMinutes % 60;
  const timeStr = hours > 0 ? `${hours} hour(s) and ${mins} minute(s)` : `${mins} minute(s)`;

  lines.push(`Since the last interaction, ${timeStr} have passed.`);

  // If at work
  if (charLocation.presence_status === 'at_work') {
    lines.push(
      `You have been at work at ${charLocation.name || 'your workplace'} for ${timeStr}.`
    );
  }

  // If sleeping or napping
  if (charLocation.presence_status === 'sleeping' || charLocation.presence_status === 'napping') {
    lines.push(`You have been sleeping for ${timeStr}.`);
  }

  // If with other characters
  if (coPresenceList.length > 0) {
    const names = coPresenceList.map(c => c.name).join(', ');
    lines.push(`${names} ${coPresenceList.length === 1 ? 'has' : 'have'} been at ${charLocation.name || 'this location'} with you.`);
  }

  return lines.join(' ');
}

/**
 * Generate the authoritative world-state truth string for LLM injection
 */
function generateWorldStateTruth(
  character,
  charLocation,
  userLocationResult,
  isUserPresent,
  coPresenceList,
  conversationType,
  elapsedMinutes,
  shiftPhase,
  currentTime
) {
  const timeStr = currentTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const lines = [];
  lines.push(`════════════════════════════════════`);
  lines.push(`WORLD-STATE RECONCILIATION — AUTHORITATIVE`);
  lines.push(`Current time: ${timeStr} (Eastern Time)`);
  lines.push(`════════════════════════════════════`);

  // ── CHARACTER LOCATION ─────────────────────────────────────────────
  lines.push(`\n[YOUR LOCATION & PRESENCE]`);
  lines.push(`Current location: ${charLocation.resolved_current_location_name || 'Unknown'}`);
  lines.push(`Presence: ${charLocation.resolved_presence_status}`);

  if (shiftPhase) {
    lines.push(`\nWork shift phase: ${shiftPhase.phase}`);
    lines.push(`Elapsed at work: ${shiftPhase.elapsed}`);
    lines.push(`Remaining: ${shiftPhase.remaining}`);
    if (shiftPhase.pct >= 0.85) {
      lines.push(`CRITICAL: You are NEARLY DONE with this shift. Speak like someone wrapping up.`);
    }
  }

  // ── CO-PRESENCE ────────────────────────────────────────────────────
  if (isUserPresent) {
    lines.push(`\n[CO-PRESENCE: USER IS HERE]`);
    lines.push(`The user is physically present with you at ${charLocation.resolved_current_location_name}.`);
    lines.push(`This is a co-present conversation, not remote text/call.`);
    lines.push(`Speak as if they are nearby or in the room, not distant.`);
  } else if (conversationType === 'remote_text' || conversationType === 'remote_call') {
    lines.push(`\n[CONVERSATION TYPE: REMOTE]`);
    lines.push(`The user is NOT physically present.`);
    lines.push(`You are communicating via text message or phone call.`);
    lines.push(`Do NOT speak as if they are nearby unless you explicitly say "you should come here."`);
  }

  if (coPresenceList.length > 0) {
    lines.push(`\n[OTHER CHARACTERS PRESENT]`);
    coPresenceList.forEach(char => {
      lines.push(`- ${char.name} is at ${charLocation.resolved_current_location_name} with you`);
    });
    lines.push(`Be aware of their presence and reference them naturally when relevant.`);
  } else if (!isUserPresent) {
    lines.push(`\n[YOU ARE ALONE]`);
    lines.push(`No other characters are currently at this location.`);
  }

  // ── ELAPSED TIME ───────────────────────────────────────────────────
  if (elapsedMinutes !== null && elapsedMinutes > 0) {
    const hours = Math.floor(elapsedMinutes / 60);
    const mins = elapsedMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    lines.push(`\n[ELAPSED TIME SINCE LAST INTERACTION]`);
    lines.push(`${timeStr} have passed. You have lived through this time.`);
    lines.push(`Reference what you did, felt, or experienced during this elapsed time.`);
    lines.push(`Do NOT behave as if no time passed.`);
  }

  // ── TRANSITIONAL STATE EXPIRY ──────────────────────────────────────
  if (elapsedMinutes && elapsedMinutes >= 30) {
    lines.push(`\n[STALE TRANSITIONAL STATES EXPIRED]`);
    lines.push(`Old chat messages saying "heading to work", "on my way", "walking in", etc. are now ${
      Math.floor(elapsedMinutes / 60) > 0 ? `${Math.floor(elapsedMinutes / 60)}+ hour(s)` : `${elapsedMinutes} minute(s)`
    } old.`);
    lines.push(`These are PAST TENSE. Do NOT repeat them as current truth.`);
    lines.push(`You have already arrived, settled in, and progressed beyond the transitional state.`);
  }

  lines.push(`\n════════════════════════════════════`);
  lines.push(`CHAT HISTORY BELOW IS SUPPLEMENTARY — IT MUST NOT OVERRIDE THIS WORLD STATE.`);
  lines.push(`════════════════════════════════════\n`);

  return lines.join('\n');
}

/**
 * Create a failed reconciliation response
 */
function createFailedReconciliation(reason) {
  return {
    character_location: {
      id: null,
      name: 'Unknown',
      type: null,
      presence_status: 'unknown',
    },
    user_location: null,
    is_user_present: false,
    co_present_characters: [],
    conversation_type: 'unknown',
    elapsed_time_minutes: null,
    last_interaction_time: null,
    shift_phase: null,
    shift_elapsed: null,
    shift_remaining: null,
    offscreen_summary: reason,
    world_state_truth: `ERROR: Could not reconcile world state. Reason: ${reason}`,
  };
}