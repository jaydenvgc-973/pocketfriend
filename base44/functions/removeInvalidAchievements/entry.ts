import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Achievements that should never be auto-granted on signup (require actual character interaction)
    const invalidAchievementIds = [
      'seen_it_all',      // requires character messages with images
      'you_were_there',   // requires narrative messages + user response
      'big_moment',       // requires narrative + user response
      'clutch_timing',    // requires character message + quick user reply
    ];

    // Get all achievements for this user
    const allAchievements = await base44.entities.UserAchievement.filter({ created_by: user.email });
    
    // Get user messages to verify they actually interacted
    const userMessages = await base44.asServiceRole.entities.Message.filter(
      { created_by: user.email, sender_type: 'user' },
      '-created_date',
      100
    );
    
    // Get character messages
    const charMessages = await base44.asServiceRole.entities.Message.filter(
      { created_by: user.email, sender_type: 'character' },
      '-created_date',
      100
    );

    const toDelete = [];

    for (const achievement of allAchievements) {
      // Remove invalid achievement types if they have no supporting evidence
      if (invalidAchievementIds.includes(achievement.achievement_id)) {
        // These achievements require character interaction
        if (charMessages.length === 0) {
          toDelete.push(achievement.id);
        }
      }
    }

    // Delete invalid achievements
    for (const id of toDelete) {
      await base44.entities.UserAchievement.delete(id);
    }

    return Response.json({
      success: true,
      removed: toDelete.length,
      achievements_removed: toDelete,
      user_message_count: userMessages.length,
      character_message_count: charMessages.length,
    });
  } catch (error) {
    console.error('[removeInvalidAchievements]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});