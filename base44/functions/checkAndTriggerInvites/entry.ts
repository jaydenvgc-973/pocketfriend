import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = userSettings[0] || {};

    const now = new Date();
    const lastInviteTime = settings.last_invite_out_timestamp ? new Date(settings.last_invite_out_timestamp) : null;

    // STRICT RATE LIMIT: Max 2 invitations per hour (TOTAL, not per character)
    const minMinutesBetween = 30; // At least 30 minutes between trigger attempts
    const maxInvitesPerHour = 2;

    // Count invites triggered in last hour (60 minutes)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const inviteHistory = settings.invite_trigger_history || [];
    const recentInviteCount = inviteHistory.filter(time => new Date(time) > oneHourAgo).length;

    // Check if enough time has passed since last trigger
    const minutesSinceLastInvite = lastInviteTime ? (now.getTime() - lastInviteTime.getTime()) / (1000 * 60) : Infinity;
    const canTrigger = minutesSinceLastInvite === Infinity || minutesSinceLastInvite >= minMinutesBetween;
    const hasCapacity = recentInviteCount < maxInvitesPerHour;

    // Track characters invited in last 24 hours (prevent re-inviting same character repeatedly)
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentlyInvitedCharacterIds = (settings.recently_invited_character_ids || []).filter(entry => {
      const entryTime = new Date(entry.timestamp);
      return entryTime > oneDayAgo;
    }).map(entry => entry.character_id);

    // Never show pending invites automatically — they only appear on first page load
    const pendingInvites = settings.pending_character_invites || [];

    // Only trigger if both conditions met: enough time passed AND haven't hit 2/hour limit
    if (canTrigger && hasCapacity) {
      const invitationResponse = await base44.functions.invoke('triggerCharacterInviteOut', {
        excludeCharacterIds: recentlyInvitedCharacterIds,
      });
      let newInvitations = invitationResponse.data?.invitations || [];

      // Strict cap: max 2 total per trigger
      newInvitations = newInvitations.slice(0, 2);

      if (newInvitations.length > 0) {
        // Record these characters as invited in the last 24 hours
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