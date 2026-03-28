import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ADMIN_EMAIL = 'murqart@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.email === ADMIN_EMAIL) return Response.json({ error: 'Admin account cannot be deleted' }, { status: 403 });

    const userEmail = user.email;

    // Delete all characters owned by this user
    const characters = await base44.entities.Character.filter({ created_by: userEmail });
    for (const c of characters) {
      await base44.entities.Character.delete(c.id);
    }

    // Delete all conversations owned by this user
    const conversations = await base44.entities.Conversation.filter({ created_by: userEmail });
    for (const c of conversations) {
      await base44.entities.Conversation.delete(c.id);
    }

    // Delete all messages owned by this user
    const messages = await base44.entities.Message.filter({ created_by: userEmail });
    for (const m of messages) {
      await base44.entities.Message.delete(m.id);
    }

    // Delete all memories owned by this user
    const memories = await base44.entities.Memory.filter({ created_by: userEmail });
    for (const m of memories) {
      await base44.entities.Memory.delete(m.id);
    }

    // Delete all user settings
    const settings = await base44.entities.UserSettings.filter({ created_by: userEmail });
    for (const s of settings) {
      await base44.entities.UserSettings.delete(s.id);
    }

    // Delete pending messages
    const pending = await base44.entities.PendingMessage.filter({ created_by: userEmail });
    for (const p of pending) {
      await base44.entities.PendingMessage.delete(p.id);
    }

    // Delete achievements and challenges
    const achievements = await base44.entities.UserAchievement.filter({ created_by: userEmail });
    for (const a of achievements) {
      await base44.entities.UserAchievement.delete(a.id);
    }

    const challenges = await base44.entities.UserChallenge.filter({ created_by: userEmail });
    for (const ch of challenges) {
      await base44.entities.UserChallenge.delete(ch.id);
    }

    // Delete scheduled events
    const events = await base44.entities.ScheduledEvent.filter({ created_by: userEmail });
    for (const e of events) {
      await base44.entities.ScheduledEvent.delete(e.id);
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});