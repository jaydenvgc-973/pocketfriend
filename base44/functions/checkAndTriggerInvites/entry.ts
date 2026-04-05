import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get user settings to check last invite time
    const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = userSettings[0] || {};

    const lastInviteTime = settings.last_invite_out_timestamp ? new Date(settings.last_invite_out_timestamp) : null;
    const now = new Date();

    // Check if enough time has passed (at least 12 hours between invites)
    const minHoursBetween = 12;
    if (lastInviteTime) {
      const hoursSinceLastInvite = (now.getTime() - lastInviteTime.getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastInvite < minHoursBetween) {
        return Response.json({
          shouldShow: false,
          hoursUntilNextInvite: Math.ceil(minHoursBetween - hoursSinceLastInvite),
        });
      }
    }

    // Time has passed — generate invites
    const invitationResponse = await base44.functions.invoke('triggerCharacterInviteOut', {});
    const invitations = invitationResponse.data?.invitations || [];

    if (invitations.length > 0) {
      // Update last invite time in user settings
      if (settings.id) {
        await base44.entities.UserSettings.update(settings.id, {
          last_invite_out_timestamp: now.toISOString(),
        });
      } else {
        await base44.entities.UserSettings.create({
          last_invite_out_timestamp: now.toISOString(),
        });
      }
    }

    return Response.json({
      shouldShow: invitations.length > 0,
      invitations,
      triggeredAt: now.toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});