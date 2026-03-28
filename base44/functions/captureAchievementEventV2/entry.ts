import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Achievement trigger definitions
 */
const ACHIEVEMENT_TRIGGERS = {
  first_impression: {
    event_types: ["first_message_to_character"],
    condition: ({ event_count }) => event_count >= 1,
    target_progress: 1
  },
  method_spree: {
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata.unique_character_ids?.length >= 5,
    target_progress: 5
  },
  double_take: {
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata.messages_in_session >= 2,
    target_progress: 1
  },
  emoticon_addict: {
    event_types: ["emoji_reaction"],
    condition: ({ event_count }) => event_count >= 5,
    target_progress: 5
  },
  trigger_two_emojis: {
    event_types: ["emoji_reaction"],
    condition: ({ metadata }) => metadata.unique_emoji_types?.length >= 2,
    target_progress: 2
  },
  quick_reflexes: {
    event_types: ["quick_reply"],
    condition: ({ event_count }) => event_count >= 1,
    target_progress: 1
  },
  ten_minute_conversation: {
    event_types: ["conversation_duration"],
    condition: ({ metadata }) => metadata.total_duration_minutes >= 10,
    target_progress: 10
  },
  first_message_to_character: {
    event_types: ["first_message_to_character"],
    condition: ({ event_count }) => event_count >= 1,
    target_progress: 1
  },
  supportive_listener: {
    event_types: ["supportive_comment"],
    condition: ({ event_count }) => event_count >= 3,
    target_progress: 3
  },
  photo_sharer: {
    event_types: ["image_sent"],
    condition: ({ event_count }) => event_count >= 3,
    target_progress: 3
  },
  three_day_streak: {
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata.consecutive_active_days >= 3,
    target_progress: 3
  },
  week_warrior: {
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata.days_active_this_week >= 7,
    target_progress: 7
  },
  the_push: {
    event_types: ["message_sent", "message_received"],
    condition: ({ metadata }) => {
      const userMsgs = metadata.user_message_count || 0;
      const charMsgs = metadata.character_message_count || 0;
      return userMsgs >= 3 && charMsgs >= 3;
    },
    target_progress: 1
  }
};

/**
 * Evaluate an achievement based on events
 */
function evaluateAchievement(achievementId, events) {
  const def = ACHIEVEMENT_TRIGGERS[achievementId];
  if (!def) return { unlocked: false, current_progress: 0 };

  const relevantEvents = events.filter(e => def.event_types.includes(e.event_type));
  const event_count = relevantEvents.length;
  const metadata = {};

  // Calculate specific metrics
  if (achievementId === "method_spree") {
    const charIds = new Set();
    relevantEvents.forEach(e => {
      if (e.character_id) charIds.add(e.character_id);
    });
    metadata.unique_character_ids = Array.from(charIds);
  }

  if (achievementId === "trigger_two_emojis") {
    const emojis = new Set();
    relevantEvents.forEach(e => {
      if (e.metadata?.emoji) emojis.add(e.metadata.emoji);
    });
    metadata.unique_emoji_types = Array.from(emojis);
  }

  if (achievementId === "ten_minute_conversation") {
    const durations = relevantEvents
      .filter(e => e.metadata?.duration_ms)
      .map(e => e.metadata.duration_ms / 60000);
    metadata.total_duration_minutes = durations.length > 0 
      ? Math.max(...durations)
      : 0;
  }

  if (achievementId === "the_push") {
    const userMsgs = events.filter(e => e.event_type === "message_sent").length;
    const charMsgs = events.filter(e => e.event_type === "message_received").length;
    metadata.user_message_count = userMsgs;
    metadata.character_message_count = charMsgs;
  }

  if (achievementId === "three_day_streak") {
    const datesWithMessages = new Set();
    relevantEvents.forEach(e => {
      if (e.timestamp) {
        const date = new Date(e.timestamp).toDateString();
        datesWithMessages.add(date);
      }
    });
    metadata.consecutive_active_days = datesWithMessages.size;
  }

  if (achievementId === "week_warrior") {
    const daysOfWeek = new Set();
    relevantEvents.forEach(e => {
      if (e.timestamp) {
        const dayOfWeek = new Date(e.timestamp).getDay();
        daysOfWeek.add(dayOfWeek);
      }
    });
    metadata.days_active_this_week = daysOfWeek.size;
  }

  let unlocked = false;
  let current_progress = event_count;

  try {
    unlocked = def.condition({ event_count, metadata }) === true;
  } catch (err) {
    console.error(`Error evaluating ${achievementId}:`, err.message);
  }

  return { unlocked, current_progress: Math.min(current_progress, def.target_progress) };
}

/**
 * Main event capture handler
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || !user.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { event_type, character_id, conversation_id, message_id, metadata = {} } = payload;

    if (!event_type) {
      return Response.json({ error: 'event_type required' }, { status: 400 });
    }

    console.log(`[captureAchievementEventV2] User: ${user.email}, Event: ${event_type}`);

    // Save event
    const event = await base44.entities.UserAchievementEvent.create({
      user_email: user.email,
      event_type,
      character_id: character_id || null,
      conversation_id: conversation_id || null,
      message_id: message_id || null,
      metadata,
      timestamp: new Date().toISOString()
    });

    // Fetch all events for this user
    const allEvents = await base44.entities.UserAchievementEvent.filter(
      { user_email: user.email },
      "-timestamp"
    );

    // Fetch existing progress
    const existingProgress = await base44.entities.UserAchievementProgress.filter(
      { user_email: user.email }
    );

    const progressMap = existingProgress.reduce((acc, p) => {
      acc[p.achievement_id] = p;
      return acc;
    }, {});

    const awardsToGrant = [];

    // Evaluate all achievements
    for (const [achievementId, triggerDef] of Object.entries(ACHIEVEMENT_TRIGGERS)) {
      const existing = progressMap[achievementId];
      
      // Skip if already unlocked
      if (existing?.unlocked) continue;

      const evaluation = evaluateAchievement(achievementId, allEvents);

      if (evaluation.unlocked) {
        console.log(`[captureAchievementEventV2] ✓ UNLOCKED: ${achievementId}`);
        awardsToGrant.push({ achievementId, evaluation, timestamp: new Date().toISOString() });
      }
    }

    // Grant awards
    for (const award of awardsToGrant) {
      const { achievementId, evaluation, timestamp } = award;
      const triggerDef = ACHIEVEMENT_TRIGGERS[achievementId];
      const eventCount = allEvents.filter(e =>
        triggerDef.event_types.includes(e.event_type)
      ).length;

      if (progressMap[achievementId]) {
        // Update
        await base44.entities.UserAchievementProgress.update(
          progressMap[achievementId].id,
          {
            current_progress: evaluation.current_progress,
            unlocked: true,
            unlocked_at: timestamp,
            last_evaluated_at: timestamp,
            source_event_count: eventCount
          }
        );
      } else {
        // Create
        await base44.entities.UserAchievementProgress.create({
          user_email: user.email,
          achievement_id: achievementId,
          current_progress: evaluation.current_progress,
          target_progress: triggerDef.target_progress,
          unlocked: true,
          unlocked_at: timestamp,
          last_evaluated_at: timestamp,
          source_event_count: eventCount
        });
      }

      // Also create UserAchievement for backwards compatibility
      const existingUA = await base44.entities.UserAchievement.filter(
        { achievement_id: achievementId, created_by: user.email }
      );

      if (existingUA.length === 0) {
        await base44.entities.UserAchievement.create({
          achievement_id: achievementId,
          unlocked_at: timestamp,
          tier: 'bronze',
          is_seen: false
        });
      }
    }

    // Update progress for non-unlocked achievements
    for (const [achievementId, triggerDef] of Object.entries(ACHIEVEMENT_TRIGGERS)) {
      if (awardsToGrant.some(a => a.achievementId === achievementId)) continue;

      const existing = progressMap[achievementId];
      const evaluation = evaluateAchievement(achievementId, allEvents);

      if (existing) {
        await base44.entities.UserAchievementProgress.update(existing.id, {
          current_progress: evaluation.current_progress,
          last_evaluated_at: new Date().toISOString()
        }).catch(() => {});
      } else if (evaluation.current_progress > 0) {
        await base44.entities.UserAchievementProgress.create({
          user_email: user.email,
          achievement_id: achievementId,
          current_progress: evaluation.current_progress,
          target_progress: triggerDef.target_progress,
          unlocked: false,
          last_evaluated_at: new Date().toISOString()
        }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      event_id: event.id,
      achievements_granted: awardsToGrant.map(a => a.achievementId)
    });

  } catch (error) {
    console.error('[captureAchievementEventV2] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});