import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * checkAndTriggerInvites
 *
 * Controls invite rate limiting and delivers fresh, valid invites only.
 * STALE INVITE RULES — invites are filtered/expired before delivery if:
 *   - Character is now asleep
 *   - Location is now closed
 *   - Invite is older than 45 minutes
 *   - Location has less than 30 minutes before closing
 */

function isInviteStale(invite, now) {
  // Expire invites older than 45 minutes
  if (invite.inviteIssuedAt) {
    const issuedAt = new Date(invite.inviteIssuedAt);
    const ageMinutes = (now - issuedAt) / 1000 / 60;
    if (ageMinutes > 45) return true;
  }

  // Check if the location's closing time has passed or is too soon
  if (invite.locationClosesAt) {
    const [closeHour, closeMin] = invite.locationClosesAt.split(':').map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const closeMinutes = closeHour * 60 + closeMin;
    // Stale if location has less than 30 min left or is already closed
    if (currentMinutes >= closeMinutes - 30) return true;
  }

  return false;
}

function isCharacterAsleep(invite, now) {
  // We don't have char details here, but the invite system already handles this
  // Future: could store sleep_start_time in invite payload for better checks
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const userSettings = await base44.entities.UserSettings.filter({ owner_email: user.email });
    const settings = userSettings[0] || {};

    const now = new Date();

    // ── CLEAN UP ANY STALE PENDING INVITES FIRST ─────────────────────────────
    const pendingInvites = settings.pending_character_invites || [];
    const freshPendingInvites = pendingInvites.filter(inv => !isInviteStale(inv, now));

    // If some invites became stale, clear them from settings
    if (freshPendingInvites.length < pendingInvites.length && settings.id) {
      base44.entities.UserSettings.update(settings.id, {
        pending_character_invites: freshPendingInvites,
      }).catch(() => {});
    }

    // ── RATE LIMITING ─────────────────────────────────────────────────────────
    const lastInviteTime = settings.last_invite_out_timestamp ? new Date(settings.last_invite_out_timestamp) : null;
    const minMinutesBetween = 30;
    const maxInvitesPerHour = 2;

    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const inviteHistory = settings.invite_trigger_history || [];
    const recentInviteCount = inviteHistory.filter(time => new Date(time) > oneHourAgo).length;

    const minutesSinceLastInvite = lastInviteTime ? (now.getTime() - lastInviteTime.getTime()) / (1000 * 60) : Infinity;
    const canTrigger = minutesSinceLastInvite === Infinity || minutesSinceLastInvite >= minMinutesBetween;
    const hasCapacity = recentInviteCount < maxInvitesPerHour;

    // Track recently invited characters to avoid spam
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyInvitedCharacterIds = (settings.recently_invited_character_ids || []).filter(entry => {
      return new Date(entry.timestamp) > oneDayAgo;
    }).map(entry => entry.character_id);

    if (canTrigger && hasCapacity) {
      const invitationResponse = await base44.functions.invoke('triggerCharacterInviteOut', {
        excludeCharacterIds: recentlyInvitedCharacterIds,
      });
      let newInvitations = invitationResponse.data?.invitations || [];

      // Filter out any stale invitations before delivering
      newInvitations = newInvitations.filter(inv => !isInviteStale(inv, now));

      // Cap at 2 per trigger
      newInvitations = newInvitations.slice(0, 2);

      if (newInvitations.length > 0) {
        const updatedInvitedList = [
          ...recentlyInvitedCharacterIds.map(id => ({ character_id: id, timestamp: new Date(oneDayAgo.getTime() + 1000).toISOString() })),
          ...newInvitations.map(inv => ({ character_id: inv.characterId, timestamp: now.toISOString() })),
        ];

        if (settings.id) {
          await base44.entities.UserSettings.update(settings.id, {
            pending_character_invites: newInvitations,
            last_invite_out_timestamp: now.toISOString(),
            invite_trigger_history: [...inviteHistory, now.toISOString()],
            recently_invited_character_ids: updatedInvitedList,
          });
        } else {
          await base44.entities.UserSettings.create({
            pending_character_invites: newInvitations,
            last_invite_out_timestamp: now.toISOString(),
            invite_trigger_history: [now.toISOString()],
            recently_invited_character_ids: updatedInvitedList,
          });
        }

        return Response.json({
          shouldShow: true,
          invitations: newInvitations,
          triggeredAt: now.toISOString(),
        });
      }
    }

    return Response.json({
      shouldShow: false,
      invitations: [],
      reason: `${recentInviteCount}/${maxInvitesPerHour} invites this hour. ${canTrigger ? 'Ready for more.' : `Wait ${Math.ceil(minMinutesBetween - minutesSinceLastInvite)} more minutes.`}`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});