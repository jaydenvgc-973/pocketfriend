/**
 * Retroactively rebuild achievement progress from existing user history
 * Awards achievements that should have already been earned
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const ACHIEVEMENT_TRIGGERS = {
  first_impression: { event_types: ["first_message_to_character"], target: 1 },
  consistent: { event_types: ["message_sent"], target: 3, multiDay: true },
  seen_it_all: { event_types: ["message_received"], target: 1, hasImage: true },
  still_here: { event_types: ["message_sent"], target: 5, multiDay: true }
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // STEP 1: Fetch user's message history
    const messages = await base44.entities.Message.filter(
      { created_by: user.email },
      "-created_date",
      500
    );

    // STEP 2: Build event history from messages
    const events = [];
    const characterIds = new Set();
    const conversationIds = new Set();
    const messageDates = new Set();

    for (const msg of messages) {
      if (msg.sender_type === "user") {
        events.push({
          event_type: "message_sent",
          timestamp: msg.created_date,
          character_id: msg.character_id,
          conversation_id: msg.conversation_id,
          message_id: msg.id,
          metadata: { has_image: !!msg.image_url }
        });
      } else {
        events.push({
          event_type: "message_received",
          timestamp: msg.created_date,
          character_id: msg.character_id,
          conversation_id: msg.conversation_id,
          message_id: msg.id,
          metadata: { has_image: !!msg.image_url }
        });
      }

      if (msg.character_id) characterIds.add(msg.character_id);
      if (msg.conversation_id) conversationIds.add(msg.conversation_id);
      messageDates.add(new Date(msg.created_date).toDateString());
    }

    // STEP 3: Detect first interactions with each character
    const firstMessagesByCharacter = {};
    for (const msg of messages.sort((a, b) => new Date(a.created_date) - new Date(b.created_date))) {
      if (msg.sender_type === "user" && msg.character_id && !firstMessagesByCharacter[msg.character_id]) {
        firstMessagesByCharacter[msg.character_id] = msg;
        events.push({
          event_type: "first_message_to_character",
          timestamp: msg.created_date,
          character_id: msg.character_id,
          conversation_id: msg.conversation_id,
          message_id: msg.id
        });
      }
    }

    // STEP 4: Evaluate achievements
    const achievements = Object.keys(ACHIEVEMENT_TRIGGERS);
    const toAward = [];

    for (const achievementId of achievements) {
      const trigger = ACHIEVEMENT_TRIGGERS[achievementId];
      let shouldUnlock = false;

      // Check if already unlocked
      const existing = await base44.entities.UserAchievementProgress.filter({
        user_email: user.email,
        achievement_id: achievementId
      });

      if (existing.length > 0 && existing[0].unlocked) {
        continue; // Already unlocked, skip
      }

      const relevantEvents = events.filter(e => trigger.event_types.includes(e.event_type));

      if (achievementId === 'first_impression') {
        shouldUnlock = characterIds.size >= 1;
      } else if (achievementId === 'consistent') {
        shouldUnlock = messageDates.size >= 3;
      } else if (achievementId === 'seen_it_all') {
        shouldUnlock = relevantEvents.some(e => e.metadata?.has_image);
      } else if (achievementId === 'still_here') {
        shouldUnlock = messageDates.size >= 5;
      }

      if (shouldUnlock) {
        toAward.push(achievementId);

        // Update or create progress record
        if (existing.length > 0) {
          await base44.entities.UserAchievementProgress.update(existing[0].id, {
            unlocked: true,
            unlocked_at: new Date().toISOString(),
            last_evaluated_at: new Date().toISOString(),
            source_event_count: relevantEvents.length
          });
        } else {
          await base44.entities.UserAchievementProgress.create({
            user_email: user.email,
            achievement_id: achievementId,
            current_progress: 1,
            target_progress: trigger.target,
            unlocked: true,
            unlocked_at: new Date().toISOString(),
            last_evaluated_at: new Date().toISOString(),
            source_event_count: relevantEvents.length,
            metadata: { rebuilt: true }
          });
        }

        // Create UserAchievement record if doesn't exist
        const userAchievements = await base44.entities.UserAchievement.filter({
          achievement_id: achievementId,
          created_by: user.email
        });

        if (userAchievements.length === 0) {
          await base44.entities.UserAchievement.create({
            achievement_id: achievementId,
            unlocked_at: new Date().toISOString(),
            tier: 'bronze'
          });
        }
      }
    }

    return Response.json({
      user_email: user.email,
      messages_analyzed: messages.length,
      unique_characters: characterIds.size,
      active_days: messageDates.size,
      achievements_awarded: toAward,
      total_progress_records: await base44.entities.UserAchievementProgress.list().then(r => r.length)
    });

  } catch (error) {
    console.error('[rebuildUserAchievements] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});