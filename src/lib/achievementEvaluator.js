/**
 * Achievement Evaluation Engine
 * Event-driven, user-scoped achievement trigger system
 */

export const ACHIEVEMENT_TRIGGERS = {
  // Social / Friendship
  first_impression: {
    event_types: ["first_message_to_character"],
    condition: (progress, events) => events.length >= 1,
    target: 1,
    description: "Send first message to any character"
  },
  
  consistent: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      // Check if messages sent across 3+ different days
      if (!events.length) return false;
      const dates = new Set(events.map(e => new Date(e.timestamp).toDateString()));
      return dates.size >= 3;
    },
    target: 3,
    description: "Chat on 3+ different days"
  },

  they_opened_up: {
    event_types: ["message_received"],
    condition: (progress, events, metadata) => {
      // Check if character sent emotionally vulnerable message (detected by emotional_state)
      return events.some(e => e.metadata?.emotional_state && ['reflective', 'vulnerable', 'sad'].includes(e.metadata.emotional_state));
    },
    target: 1,
    description: "Character shares something personal"
  },

  inner_circle: {
    event_types: ["relationship_level_change"],
    condition: (progress, events, metadata) => {
      // Check if any character reached friendship_level >= 90
      return events.some(e => e.metadata?.friendship_level >= 90);
    },
    target: 1,
    description: "Reach friendship level 90+ with a character"
  },

  ride_along: {
    event_types: ["character_reached_status"],
    condition: (progress, events, metadata) => {
      // Check if user was present at start and completion of a life event
      return metadata?.witnessed_life_event_arc || false;
    },
    target: 1,
    description: "Witness full character life arc"
  },

  // Influence
  the_push: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      // Detect if message content contains encouragement keywords
      return metadata?.is_encouragement || false;
    },
    target: 1,
    description: "Send encouraging/supportive message"
  },

  voice_of_reason: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      return metadata?.is_cautionary_advice || false;
    },
    target: 1,
    description: "Provide rational/cautionary advice"
  },

  bad_influence: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      return metadata?.is_chaotic_suggestion || false;
    },
    target: 1,
    description: "Suggest risky/chaotic action"
  },

  // Emotional
  that_meant_something: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      // Followed by strong positive character reaction
      return metadata?.triggered_positive_reaction || false;
    },
    target: 1,
    description: "Say something that gets positive reaction"
  },

  hit_deep: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      return metadata?.touched_emotional_core || false;
    },
    target: 1,
    description: "Reference character's emotional core"
  },

  tension: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      return metadata?.caused_conflict || false;
    },
    target: 1,
    description: "Create genuine conflict"
  },

  shifted_perspective: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      return metadata?.shifted_belief || false;
    },
    target: 1,
    description: "Challenge character's belief"
  },

  // Moments
  seen_it_all: {
    event_types: ["message_received"],
    condition: (progress, events) => {
      // Check if any received message contains an image
      return events.some(e => e.metadata?.has_image);
    },
    target: 1,
    description: "Receive a photo from character"
  },

  progress_witness: {
    event_types: ["character_reached_status"],
    condition: (progress, events, metadata) => {
      return metadata?.witnessed_transformation || false;
    },
    target: 1,
    description: "See character change visibly"
  },

  big_moment: {
    event_types: ["character_reached_status"],
    condition: (progress, events, metadata) => {
      return metadata?.witnessed_major_milestone || false;
    },
    target: 1,
    description: "Present for major milestone"
  },

  you_were_there: {
    event_types: ["character_reached_status"],
    condition: (progress, events, metadata) => {
      return metadata?.actively_present_during_event || false;
    },
    target: 1,
    description: "Chat during significant event"
  },

  // Engagement
  still_here: {
    event_types: ["message_sent"],
    condition: (progress, events, metadata) => {
      // 5+ different days active
      if (!events.length) return false;
      const dates = new Set(events.map(e => new Date(e.timestamp).toDateString()));
      return dates.size >= 5;
    },
    target: 5,
    description: "Active on 5+ different days"
  },

  they_came_back: {
    event_types: ["message_received"],
    condition: (progress, events, metadata) => {
      return metadata?.reconnection_with_warmth || false;
    },
    target: 1,
    description: "Reconnect warmly after gap"
  },

  left_on_read: {
    event_types: ["message_received"],
    condition: (progress, events, metadata) => {
      return metadata?.long_message_gap || false;
    },
    target: 1,
    description: "Leave message unanswered long"
  }
};

/**
 * Evaluate a single achievement for a user
 * Returns true if achievement should be unlocked
 */
export function evaluateAchievement(achievementId, events, currentProgress, metadata = {}) {
  const trigger = ACHIEVEMENT_TRIGGERS[achievementId];
  if (!trigger) return false;

  // Filter events to only those relevant to this achievement
  const relevantEvents = events.filter(e => trigger.event_types.includes(e.event_type));
  
  // Apply the condition function
  return trigger.condition(currentProgress || 0, relevantEvents, metadata);
}

/**
 * Batch evaluate all achievements for a user
 * Returns map of achievementId -> shouldUnlock
 */
export function evaluateAllAchievements(events, progressMap = {}, userMetadata = {}) {
  const results = {};
  
  for (const achievementId in ACHIEVEMENT_TRIGGERS) {
    const progress = progressMap[achievementId] || { current_progress: 0, unlocked: false };
    results[achievementId] = evaluateAchievement(achievementId, events, progress.current_progress, userMetadata);
  }
  
  return results;
}

/**
 * Get summary of what's blocking an achievement
 */
export function getAchievementBlockers(achievementId, currentProgress, events) {
  const trigger = ACHIEVEMENT_TRIGGERS[achievementId];
  if (!trigger) return "Unknown achievement";
  
  const relevantEvents = events.filter(e => trigger.event_types.includes(e.event_type));
  
  return {
    description: trigger.description,
    event_types: trigger.event_types,
    target: trigger.target,
    current: currentProgress || 0,
    events_found: relevantEvents.length,
    still_need: Math.max(0, trigger.target - (currentProgress || 0))
  };
}