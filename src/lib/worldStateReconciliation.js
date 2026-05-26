/**
 * WORLD STATE RECONCILIATION ENGINE
 * 
 * Single authoritative system for building character response context.
 * 
 * This is called BEFORE chat history is consulted, ensuring world-state truth
 * takes precedence over stale conversational anchors.
 * 
 * Reconciles:
 * - Current world time
 * - Character current location (authoritative)
 * - User current location
 * - Co-presence state (shared location, remote, alone)
 * - Elapsed time since last interaction
 * - Active schedules/shifts/events
 * - Transitional state expiration
 * - Character offscreen activity summary
 * 
 * Returns a context object that MUST be injected into the response pipeline
 * BEFORE any recent chat messages are interpreted.
 */

import { resolveCharacterLocation } from '@/lib/locationResolutionEngine';

/**
 * Reconcile complete world state for a character before response generation.
 * 
 * Input:
 * - character: Character entity
 * - user: User entity (for location/presence)
 * - locationMap: Map of all locations {locationId: location}
 * - currentTime: Current time (default now)
 * - lastInteractionTime: When the last user interaction occurred (for elapsed time)
 * 
 * Output:
 * {
 *   // Authoritative current state
 *   character_current_location_id,
 *   character_current_location_name,
 *   character_presence_status,
 *   character_presence_reason,
 * 
 *   // User location & presence (resolved from user entity)
 *   user_current_location_id,
 *   user_current_location_name,
 *   user_presence_status,
 * 
 *   // Co-presence resolution
 *   are_at_same_location,
 *   is_physically_together,
 *   is_remote_interaction,
 *   co_present_characters: [],
 * 
 *   // Elapsed time since last interaction
 *   last_interaction_time,
 *   elapsed_time_minutes,
 *   elapsed_time_human,
 * 
 *   // Current schedule/shift phase
 *   shift_status, // "on_shift", "off_shift", "pre_shift", "post_shift"
 *   shift_phase, // "early", "mid", "late", "ending"
 *   shift_progress_percent,
 *   shift_remaining_minutes,
 *   shift_remaining_human,
 * 
 *   // Transitional state expiration check
 *   last_known_transitional_state, // "heading_to_work", "walking_in", etc
 *   transitional_state_expired,
 *   transitional_expiration_reason,
 * 
 *   // Offscreen activity summary
 *   offscreen_summary, // What happened while user was away
 * 
 *   // Response directive
 *   response_directive, // Instructions for how the character should speak
 * }
 */
export function reconcileWorldState(
  character,
  user,
  locationMap = {},
  currentTime = new Date(),
  lastInteractionTime = null
) {
  if (!character) {
    return createFailedReconciliation('No character provided');
  }

  const nowET = new Date(currentTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const nowMin = nowET.getHours() * 60 + nowET.getMinutes();
  const dayOfWeek = nowET.getDay();

  // ── CHARACTER LOCATION (AUTHORITATIVE) ──────────────────────────────────────
  const charResolved = resolveCharacterLocation(character, locationMap, currentTime);
  const charLocName = (charResolved.resolved_current_location_id && locationMap[charResolved.resolved_current_location_id]?.name)
    || charResolved.resolved_current_location_name;

  // ── USER LOCATION (if provided) ─────────────────────────────────────────────
  let userLocId = null;
  let userLocName = null;
  let userPresenceStatus = null;
  if (user) {
    // Optionally, resolve user's location from user entity fields if they exist
    // For now, we'll treat the user as potentially being "away" (not in app world)
    // unless explicitly set
    userPresenceStatus = user.user_presence_status || 'away';
    if (user.user_current_location_id) {
      userLocId = user.user_current_location_id;
      userLocName = user.user_current_location_name || locationMap[userLocId]?.name || 'User location';
    }
  }

  // ── CO-PRESENCE RESOLUTION ──────────────────────────────────────────────────
  const areAtSameLocation = !!(
    charResolved.resolved_current_location_id &&
    userLocId &&
    charResolved.resolved_current_location_id === userLocId &&
    charResolved.resolved_presence_status !== 'sleeping' &&
    charResolved.resolved_presence_status !== 'napping' &&
    userPresenceStatus === 'present'
  );

  const isPhysicallyTogether = areAtSameLocation;
  const isRemoteInteraction = !!userLocId && !areAtSameLocation; // User is somewhere else

  // ── CO-PRESENT CHARACTERS (characters at same location as char) ──────────────
  const coPresenceCharacters = [];
  if (charResolved.resolved_current_location_id) {
    // This would iterate through all characters and resolve their locations
    // For now, we'll leave this as an empty placeholder
    // A full implementation would need all characters passed in
  }

  // ── ELAPSED TIME SINCE LAST INTERACTION ─────────────────────────────────────
  let elapsedMinutes = 0;
  let elapsedTimeHuman = '';
  if (lastInteractionTime && lastInteractionTime instanceof Date) {
    const lastET = new Date(lastInteractionTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    elapsedMinutes = Math.floor((nowET.getTime() - lastET.getTime()) / 60000);
    elapsedTimeHuman = formatElapsedTime(elapsedMinutes);
  }

  // ── SHIFT/SCHEDULE STATUS ───────────────────────────────────────────────────
  const shiftStatus = resolveShiftStatus(character, nowMin, dayOfWeek);
  let shiftPhase = null;
  let shiftProgressPercent = 0;
  let shiftRemainingMinutes = 0;
  let shiftRemainingHuman = '';

  if (shiftStatus === 'on_shift' && character.work_start_time && character.work_end_time) {
    const phase = computeShiftPhase(character, nowMin);
    shiftPhase = phase.phase;
    shiftProgressPercent = phase.progressPercent;
    shiftRemainingMinutes = phase.remainingMinutes;
    shiftRemainingHuman = formatElapsedTime(shiftRemainingMinutes);
  }

  // ── TRANSITIONAL STATE EXPIRATION ──────────────────────────────────────────
  const transitionCheck = checkTransitionalStateExpiration(character, elapsedMinutes, shiftStatus);

  // ── OFFSCREEN ACTIVITY SUMMARY ─────────────────────────────────────────────
  const offscreenSummary = buildOffscreenActivitySummary(
    character,
    locationMap,
    elapsedMinutes,
    shiftStatus,
    shiftPhase
  );

  // ── RESPONSE DIRECTIVE ────────────────────────────────────────────────────
  const responseDirective = buildResponseDirective(
    character,
    shiftStatus,
    shiftPhase,
    isPhysicallyTogether,
    isRemoteInteraction,
    elapsedMinutes,
    transitionCheck
  );

  return {
    // Authoritative current state
    character_current_location_id: charResolved.resolved_current_location_id,
    character_current_location_name: charLocName,
    character_presence_status: charResolved.resolved_presence_status,
    character_presence_reason: charResolved.resolved_source_reason,

    // User location
    user_current_location_id: userLocId,
    user_current_location_name: userLocName,
    user_presence_status: userPresenceStatus,

    // Co-presence
    are_at_same_location: areAtSameLocation,
    is_physically_together: isPhysicallyTogether,
    is_remote_interaction: isRemoteInteraction,
    co_present_characters: coPresenceCharacters,

    // Elapsed time
    last_interaction_time: lastInteractionTime,
    elapsed_time_minutes: elapsedMinutes,
    elapsed_time_human: elapsedTimeHuman,

    // Shift/schedule
    shift_status: shiftStatus,
    shift_phase: shiftPhase,
    shift_progress_percent: shiftProgressPercent,
    shift_remaining_minutes: shiftRemainingMinutes,
    shift_remaining_human: shiftRemainingHuman,

    // Transitional state
    last_known_transitional_state: transitionCheck.lastKnownState,
    transitional_state_expired: transitionCheck.isExpired,
    transitional_expiration_reason: transitionCheck.reason,

    // Offscreen activity
    offscreen_summary: offscreenSummary,

    // Response directive
    response_directive: responseDirective,
  };
}

/**
 * Determine if character is on shift, off shift, pre-shift, or post-shift
 */
function resolveShiftStatus(character, nowMin, dayOfWeek) {
  if (!character.work_start_time || !character.work_end_time || !character.work_days) {
    return 'no_schedule';
  }

  const isWorkDay = character.work_days.includes(dayOfWeek);
  if (!isWorkDay) {
    return 'off_schedule';
  }

  const [sh, sm] = character.work_start_time.split(':').map(Number);
  const [eh, em] = character.work_end_time.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;

  const isOvernight = endMin < startMin;
  let onShift = false;

  if (isOvernight) {
    onShift = nowMin >= startMin || nowMin < endMin;
  } else {
    onShift = nowMin >= startMin && nowMin < endMin;
  }

  if (onShift) return 'on_shift';

  // Pre-shift: within 30 minutes before start
  const prepWindowMin = (startMin - 30 + 1440) % 1440;
  let inPreShift = false;
  if (prepWindowMin > startMin) {
    inPreShift = nowMin >= prepWindowMin || nowMin < startMin;
  } else {
    inPreShift = nowMin >= prepWindowMin && nowMin < startMin;
  }

  if (inPreShift) return 'pre_shift';

  // Post-shift: within 60 minutes after end
  const postWindowMin = (endMin + 60) % 1440;
  let inPostShift = false;
  if (postWindowMin < endMin) {
    inPostShift = nowMin >= endMin || nowMin < postWindowMin;
  } else {
    inPostShift = nowMin >= endMin && nowMin < postWindowMin;
  }

  if (inPostShift) return 'post_shift';

  return 'off_schedule';
}

/**
 * Compute shift phase (early/mid/late/ending) and progress
 */
function computeShiftPhase(character, nowMin) {
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
  const progressPercent = totalShiftMin > 0 ? (elapsedMin / totalShiftMin) * 100 : 0;

  let phase = 'unknown';
  if (progressPercent < 15) {
    phase = 'early';
  } else if (progressPercent < 40) {
    phase = 'early_mid';
  } else if (progressPercent < 65) {
    phase = 'mid';
  } else if (progressPercent < 85) {
    phase = 'late';
  } else {
    phase = 'ending';
  }

  return {
    phase,
    progressPercent: Math.round(progressPercent),
    remainingMinutes: remainingMin,
  };
}

/**
 * Check if character's last known transitional state has expired
 */
function checkTransitionalStateExpiration(character, elapsedMinutes, shiftStatus) {
  const transitionStates = new Set([
    'heading_to_work',
    'on_my_way',
    'leaving_now',
    'going_to_bed',
    'traveling',
    'walking_in',
    'just_arrived',
    'about_to_start',
    'heading_home',
    'coming_home',
  ]);

  // This would come from the last chat message analysis
  // For now, we'll detect based on shift status progression
  const lastKnownState = character.resolved_source_reason; // placeholder

  if (!transitionStates.has(lastKnownState)) {
    return {
      lastKnownState: null,
      isExpired: false,
      reason: null,
    };
  }

  // Check expiration windows based on known state
  let isExpired = false;
  let reason = null;

  if (lastKnownState === 'heading_to_work' || lastKnownState === 'walking_in') {
    // If 30+ minutes have passed, character should have arrived
    if (elapsedMinutes >= 30) {
      isExpired = true;
      reason = `Character said they were heading to work ${elapsedMinutes} minutes ago. Travel should be complete.`;
    }
  }

  if (lastKnownState === 'leaving_now') {
    if (elapsedMinutes >= 20) {
      isExpired = true;
      reason = `Character said they were leaving ${elapsedMinutes} minutes ago. Should have arrived.`;
    }
  }

  if (lastKnownState === 'going_to_bed' || lastKnownState === 'about_to_start') {
    if (elapsedMinutes >= 10) {
      isExpired = true;
      reason = `Character said they were about to do something ${elapsedMinutes} minutes ago. That action should be complete.`;
    }
  }

  return { lastKnownState, isExpired, reason };
}

/**
 * Build a summary of what happened while the user was away
 */
function buildOffscreenActivitySummary(character, locationMap, elapsedMinutes, shiftStatus, shiftPhase) {
  if (elapsedMinutes < 1) {
    return 'No time has passed.';
  }

  const events = [];

  // Work shift progression
  if (shiftStatus === 'on_shift') {
    if (elapsedMinutes >= 60) {
      events.push(`Worked through ${formatElapsedTime(elapsedMinutes)}.`);
      if (shiftPhase === 'late' || shiftPhase === 'ending') {
        events.push('Now nearing the end of shift.');
      } else if (shiftPhase === 'mid') {
        events.push('Currently mid-shift.');
      }
    } else if (elapsedMinutes >= 5) {
      events.push(`Been working for ${formatElapsedTime(elapsedMinutes)}.`);
    }
  } else if (shiftStatus === 'post_shift') {
    events.push(`Just finished work (${formatElapsedTime(elapsedMinutes)} ago).`);
  }

  // Home/rest periods
  if (character.resolved_presence_status === 'home') {
    events.push(`Has been home for ${formatElapsedTime(elapsedMinutes)}.`);
  }

  // Sleep
  if (character.resolved_presence_status === 'sleeping') {
    events.push(`Has been sleeping for ${formatElapsedTime(elapsedMinutes)}.`);
  }

  return events.length > 0 ? events.join(' ') : 'Time has passed.';
}

/**
 * Build directive for how the character should respond based on world state
 */
function buildResponseDirective(
  character,
  shiftStatus,
  shiftPhase,
  isPhysicallyTogether,
  isRemoteInteraction,
  elapsedMinutes,
  transitionCheck
) {
  const directives = [];

  // Co-presence awareness
  if (isPhysicallyTogether) {
    directives.push('You are physically present with the user right now. Speak as if they are in the same location.');
  } else if (isRemoteInteraction) {
    directives.push('You are communicating with the user remotely (via text/call). They are not physically present.');
  }

  // Shift awareness
  if (shiftStatus === 'on_shift') {
    if (shiftPhase === 'ending') {
      directives.push('You are nearing the end of your shift. Speak like someone almost done — tired, ready to leave.');
    } else if (shiftPhase === 'late') {
      directives.push('You are well into your shift. Reference work that has happened so far.');
    } else if (shiftPhase === 'mid') {
      directives.push('You are mid-shift. You have already dealt with coworkers and tasks.');
    } else if (shiftPhase === 'early') {
      directives.push('You just started your shift. You are still settling in.');
    }
  } else if (shiftStatus === 'post_shift') {
    directives.push('You just finished work. Speak in past tense. You may be decompressing, tired, or headed home.');
  }

  // Elapsed time awareness
  if (elapsedMinutes >= 60) {
    directives.push(`${formatElapsedTime(elapsedMinutes)} has passed since you last talked. You lived through that time. Reference it naturally.`);
  }

  // Transitional state expiration
  if (transitionCheck.isExpired) {
    directives.push(`CRITICAL: You previously said you were ${transitionCheck.lastKnownState.replace(/_/g, ' ')}. ${transitionCheck.reason} Do NOT repeat that as current truth.`);
  }

  return directives.join(' ');
}

/**
 * Format elapsed time as human-readable string
 */
function formatElapsedTime(minutes) {
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
  return `${hours} hour${hours !== 1 ? 's' : ''} ${mins} minute${mins !== 1 ? 's' : ''}`;
}

/**
 * Failed reconciliation response
 */
function createFailedReconciliation(reason) {
  return {
    character_current_location_id: null,
    character_current_location_name: null,
    character_presence_status: 'unknown',
    character_presence_reason: reason,

    user_current_location_id: null,
    user_current_location_name: null,
    user_presence_status: 'away',

    are_at_same_location: false,
    is_physically_together: false,
    is_remote_interaction: false,
    co_present_characters: [],

    last_interaction_time: null,
    elapsed_time_minutes: 0,
    elapsed_time_human: '',

    shift_status: 'unknown',
    shift_phase: null,
    shift_progress_percent: 0,
    shift_remaining_minutes: 0,
    shift_remaining_human: '',

    last_known_transitional_state: null,
    transitional_state_expired: false,
    transitional_expiration_reason: null,

    offscreen_summary: 'Unable to determine world state.',

    response_directive: 'Unable to resolve character state.',
  };
}