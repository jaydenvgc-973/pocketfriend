/**
 * INVITE FOLLOW-THROUGH ENGINE
 *
 * Manages invite lifecycle and ensures characters proceed independently.
 * Characters MUST travel to invited location regardless of user response.
 */

/**
 * Create an invite when character invites user
 */
export async function createInvite(base44, characterId, characterName, destinationId, destinationName, context = null) {
  return base44.entities.Invite.create({
    character_id: characterId,
    character_name: characterName,
    destination_id: destinationId,
    destination_name: destinationName,
    sent_at: new Date().toISOString(),
    status: 'pending',
    scene_navigation_allowed: false,
    character_still_going: true,
    user_attending: false,
    expires_at: new Date(Date.now() + 2 * 3600000).toISOString(), // 2 hours
    context
  });
}

/**
 * Process user acceptance of invite
 * ALLOWS scene navigation and marks both parties as attending
 */
export async function acceptInvite(base44, inviteId) {
  return base44.entities.Invite.update(inviteId, {
    status: 'accepted',
    scene_navigation_allowed: true,
    user_attending: true
  });
}

/**
 * Process user declining invite
 * BLOCKS scene navigation but character MUST STILL GO
 */
export async function declineInvite(base44, inviteId, characterId) {
  const updateData = {
    status: 'declined',
    scene_navigation_allowed: false,
    user_attending: false
    // character_still_going REMAINS true — character proceeds alone
  };

  await base44.entities.Invite.update(inviteId, updateData);

  // Character must still travel to location
  // This should trigger autonomous movement logic
  return {
    declinedButCharacterStillGoes: true,
    action: 'ALLOW_CHARACTER_AUTONOMOUS_TRAVEL'
  };
}

/**
 * Process user ignoring invite (timeout)
 * Character may proceed or cancel based on personality/context
 */
export async function expireInvite(base44, inviteId, shouldCharacterStillGo = true) {
  return base44.entities.Invite.update(inviteId, {
    status: 'expired',
    character_still_going: shouldCharacterStillGo,
    scene_navigation_allowed: false,
    user_attending: false
  });
}

/**
 * Get pending invite for character (if any)
 */
export async function getCharacterPendingInvite(base44, characterId) {
  const invites = await base44.entities.Invite.filter({
    character_id: characterId,
    status: 'pending'
  });
  return invites.length > 0 ? invites[0] : null;
}

/**
 * Validate that character follows through on invite
 * Checks if character actually traveled to invited destination
 */
export function validateInviteFollowThrough(invite, character) {
  const failures = [];

  // If character_still_going is true, character MUST have traveled or be traveling
  if (invite.character_still_going) {
    const isAtOrTravelingTo = 
      character.resolved_current_location_id === invite.destination_id ||
      character.traveling_to_location_id === invite.destination_id;

    if (!isAtOrTravelingTo) {
      failures.push({
        code: 'CHARACTER_FAILED_TO_TRAVEL_AFTER_INVITE',
        severity: 'critical',
        message: `Character invited user to ${invite.destination_name} but did not travel there`
      });
    }
  }

  // If user accepted, both should be traveling/arriving
  if (invite.status === 'accepted' && !invite.user_attending) {
    failures.push({
      code: 'INVITE_ACCEPTED_BUT_USER_NOT_ATTENDING',
      severity: 'warning',
      message: 'User accepted invite but is not marked as attending'
    });
  }

  return {
    isFollowingThrough: failures.length === 0,
    failures
  };
}

/**
 * Determine if scene page should open
 * ONLY when user explicitly accepted
 */
export function shouldOpenScenePage(invite) {
  return invite.status === 'accepted' && invite.scene_navigation_allowed && invite.user_attending;
}

/**
 * Prevent scene navigation on decline
 */
export function shouldBlockSceneNavigation(invite) {
  return invite.status === 'declined' || invite.status === 'expired' || invite.status === 'ignored';
}

/**
 * Character autonomy flow after user response
 */
export function getCharacterAutonomyAction(invite) {
  if (!invite.character_still_going) {
    return 'CANCEL_TRAVEL';
  }

  // Character always travels to invited location (with or without user)
  return {
    action: 'TRAVEL_TO_DESTINATION',
    destination_id: invite.destination_id,
    destination_name: invite.destination_name,
    user_attending: invite.user_attending
  };
}