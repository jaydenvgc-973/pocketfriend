import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get user settings
    const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = userSettings[0] || {};

    const now = new Date();
    const lastInviteTime = settings.last_invite_out_timestamp ? new Date(settings.last_invite_out_timestamp) : null;

    // Track pending invites (invites shown but not yet accepted/declined)
    const pendingInvites = settings.pending_character_invites || [];
    
    // Space invites: 4 hours minimum between triggers, max 8 per day
    const minHoursBetween = 4;
    const maxInvitesPerDay = 8;
    
    // Count invites triggered in last 24 hours
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const inviteHistory = settings.invite_trigger_history || [];
    const recentInviteCount = inviteHistory.filter(time => new Date(time) > oneDayAgo).length;

    // Check if enough time has passed since last trigger
    const hoursSinceLastInvite = lastInviteTime ? (now.getTime() - lastInviteTime.getTime()) / (1000 * 60 * 60) : Infinity;
    const canTrigger = hoursSinceLastInvite === Infinity || hoursSinceLastInvite >= minHoursBetween;
    const hasCapacity = recentInviteCount < maxInvitesPerDay;

    // If we can trigger and have capacity, generate new invites
    if (canTrigger && hasCapacity) {
      const invitationResponse = await base44.functions.invoke('triggerCharacterInviteOut', {});
      const newInvitations = invitationResponse.data?.invitations || [];

      if (newInvitations.length > 0) {
        // Merge with pending and update settings
        const allPending = [...pendingInvites, ...newInvitations];
        
        if (settings.id) {
          await base44.entities.UserSettings.update(settings.id, {
            pending_character_invites: allPending,
            last_invite_out_timestamp: now.toISOString(),
            invite_trigger_history: [...inviteHistory, now.toISOString()],
          });
        } else {
          await base44.entities.UserSettings.create({
            pending_character_invites: allPending,
            last_invite_out_timestamp: now.toISOString(),
            invite_trigger_history: [now.toISOString()],
          });
        }

        return Response.json({
          shouldShow: allPending.length > 0,
          invitations: allPending,
          triggeredAt: now.toISOString(),
        });
      }
    }

    // If we can't trigger, show pending invites (if any)
    if (pendingInvites.length > 0) {
      return Response.json({
        shouldShow: true,
        invitations: pendingInvites,
        reason: canTrigger ? `${recentInviteCount}/${maxInvitesPerDay} invites today` : `Next invite in ${Math.ceil(minHoursBetween - hoursSinceLastInvite)} hours`,
      });
    }

    return Response.json({
      shouldShow: false,
      invitations: [],
      reason: canTrigger ? `${recentInviteCount}/${maxInvitesPerDay} invites today` : `Next invite in ${Math.ceil(minHoursBetween - hoursSinceLastInvite)} hours`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});