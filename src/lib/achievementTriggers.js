/**
 * Achievement Trigger Definitions
 * 
 * Each achievement specifies:
 * - event_types: which events count toward it
 * - condition: function to evaluate if conditions are met
 * - target_progress: the threshold to unlock
 */

export const ACHIEVEMENT_TRIGGERS = {
  // SOCIAL ACHIEVEMENTS
  first_impression: {
    name: "First Impression",
    description: "Send your first message to any character",
    event_types: ["first_message_to_character"],
    condition: ({ event_count, events }) => event_count >= 1,
    target_progress: 1,
    category: "social"
  },

  method_spree: {
    name: "Method Spree",
    description: "Interact with 5 different characters",
    event_types: ["message_sent"],
    condition: ({ metadata }) => {
      // Count unique character IDs from events
      const characterIds = new Set();
      if (metadata?.unique_character_ids) {
        characterIds.forEach(id => characterIds.add(id));
      }
      return characterIds.size >= 5;
    },
    target_progress: 5,
    category: "social",
    metadata_key: "unique_character_ids"
  },

  double_take: {
    name: "Double Take",
    description: "Send 2 messages to the same character in one conversation",
    event_types: ["message_sent"],
    condition: ({ metadata }) => {
      // Each character_conversation_id should have at least 2 messages
      return metadata?.messages_in_session >= 2;
    },
    target_progress: 1,
    category: "social"
  },

  emoticon_addict: {
    name: "Emoticon Addict",
    description: "React with an emoji to 5 different messages",
    event_types: ["emoji_reaction"],
    condition: ({ event_count }) => event_count >= 5,
    target_progress: 5,
    category: "social"
  },

  trigger_two_emojis: {
    name: "Trigger Two Emojis",
    description: "React with 2 different emoji types",
    event_types: ["emoji_reaction"],
    condition: ({ metadata }) => {
      // Count unique emoji types
      const uniqueEmojis = new Set();
      if (metadata?.all_reactions) {
        metadata.all_reactions.forEach(r => uniqueEmojis.add(r.emoji));
      }
      return uniqueEmojis.size >= 2;
    },
    target_progress: 2,
    category: "social",
    metadata_key: "unique_emoji_types"
  },

  // ENGAGEMENT ACHIEVEMENTS
  quick_reflexes: {
    name: "Quick Reflexes",
    description: "Reply to a character within 2 minutes of their message",
    event_types: ["quick_reply"],
    condition: ({ event_count }) => event_count >= 1,
    target_progress: 1,
    category: "engagement"
  },

  ten_minute_conversation: {
    name: "Ten Minute Conversation",
    description: "Have an active conversation for 10+ minutes",
    event_types: ["conversation_duration"],
    condition: ({ metadata }) => metadata?.total_duration_minutes >= 10,
    target_progress: 10,
    category: "engagement",
    metadata_key: "total_duration_minutes"
  },

  first_message_to_character: {
    name: "First Message",
    description: "Send a message to a new character for the first time",
    event_types: ["first_message_to_character"],
    condition: ({ event_count }) => event_count >= 1,
    target_progress: 1,
    category: "engagement"
  },

  // INTERACTION ACHIEVEMENTS
  supportive_listener: {
    name: "Supportive Listener",
    description: "Send 3 supportive or empathetic messages",
    event_types: ["supportive_comment"],
    condition: ({ event_count }) => event_count >= 3,
    target_progress: 3,
    category: "interaction"
  },

  photo_sharer: {
    name: "Photo Sharer",
    description: "Send 3 images in conversations",
    event_types: ["image_sent"],
    condition: ({ event_count }) => event_count >= 3,
    target_progress: 3,
    category: "interaction"
  },

  // CONSISTENCY ACHIEVEMENTS
  three_day_streak: {
    name: "Three Day Streak",
    description: "Message characters on 3 consecutive days",
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata?.consecutive_active_days >= 3,
    target_progress: 3,
    category: "consistency",
    metadata_key: "consecutive_active_days"
  },

  week_warrior: {
    name: "Week Warrior",
    description: "Interact with characters on all 7 days of a week",
    event_types: ["message_sent"],
    condition: ({ metadata }) => metadata?.days_active_this_week >= 7,
    target_progress: 7,
    category: "consistency",
    metadata_key: "days_active_this_week"
  },

  // SPECIAL ACHIEVEMENTS
  the_push: {
    name: "The Push",
    description: "Have your first real conversation",
    event_types: ["message_sent", "message_received"],
    condition: ({ metadata }) => {
      // Both user and character have sent at least 3 messages each
      const userMessages = metadata?.user_message_count || 0;
      const charMessages = metadata?.character_message_count || 0;
      return userMessages >= 3 && charMessages >= 3;
    },
    target_progress: 1,
    category: "special",
    metadata_key: "exchange_count"
  }
};

/**
 * Evaluate an achievement for a user based on current events
 * @param achievementId - The achievement to check
 * @param events - Array of UserAchievementEvent records
 * @param userData - Additional user data (conversation history, etc.)
 * @returns { unlocked, current_progress, reason }
 */
export function evaluateAchievement(achievementId, events, userData = {}) {
  const def = ACHIEVEMENT_TRIGGERS[achievementId];
  if (!def) {
    return { unlocked: false, current_progress: 0, reason: "Achievement not found" };
  }

  // Filter events for this achievement's event types
  const relevantEvents = events.filter(e => def.event_types.includes(e.event_type));
  const event_count = relevantEvents.length;

  // Build metadata from events
  const metadata = {};

  // Calculate specific metrics based on achievement type
  if (achievementId === "method_spree") {
    const characterIds = new Set();
    relevantEvents.forEach(e => {
      if (e.character_id) characterIds.add(e.character_id);
    });
    metadata.unique_character_ids = Array.from(characterIds);
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
    // Count consecutive days with messages
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

  // Evaluate condition
  let unlocked = false;
  let current_progress = 0;

  try {
    const conditionResult = def.condition({ event_count, events: relevantEvents, metadata, ...userData });
    unlocked = conditionResult === true;
    
    // Determine progress value
    if (def.metadata_key && metadata[def.metadata_key]) {
      if (Array.isArray(metadata[def.metadata_key])) {
        current_progress = metadata[def.metadata_key].length;
      } else {
        current_progress = metadata[def.metadata_key];
      }
    } else {
      current_progress = event_count;
    }
  } catch (err) {
    console.error(`[AchievementTrigger] Error evaluating ${achievementId}:`, err);
  }

  return {
    unlocked,
    current_progress: Math.min(current_progress, def.target_progress),
    target_progress: def.target_progress,
    reason: unlocked ? "Conditions met" : `Progress: ${current_progress}/${def.target_progress}`
  };
}