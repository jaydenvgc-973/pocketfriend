// All achievement definitions
export const ACHIEVEMENTS = {
  // Social / Friendship
  first_impression: {
    id: "first_impression",
    emoji: "💬✨",
    title: "First Impression",
    description: "Started your first meaningful interaction",
    category: "social",
  },
  consistent: {
    id: "consistent",
    emoji: "🔁📱",
    title: "Consistent",
    description: "You keep showing up",
    category: "social",
  },
  they_opened_up: {
    id: "they_opened_up",
    emoji: "🔓💭",
    title: "They Opened Up",
    description: "A character shared something personal",
    category: "social",
  },
  inner_circle: {
    id: "inner_circle",
    emoji: "🫶🔵",
    title: "Inner Circle",
    description: "You gained deep trust",
    category: "social",
  },
  ride_along: {
    id: "ride_along",
    emoji: "🚗💬",
    title: "Ride Along",
    description: "Stayed through a full life arc",
    category: "social",
  },

  // Influence / Decision
  the_push: {
    id: "the_push",
    emoji: "👉⚡",
    title: "The Push",
    description: "You helped someone take action",
    category: "influence",
  },
  voice_of_reason: {
    id: "voice_of_reason",
    emoji: "🧠⚖️",
    title: "Voice of Reason",
    description: "You prevented a bad decision",
    category: "influence",
  },
  bad_influence: {
    id: "bad_influence",
    emoji: "😈🔥",
    title: "Bad Influence",
    description: "You encouraged chaos…and they followed",
    category: "influence",
  },
  clutch_timing: {
    id: "clutch_timing",
    emoji: "⏱️✨",
    title: "Clutch Timing",
    description: "You showed up at the perfect moment",
    category: "influence",
  },
  missed_moment: {
    id: "missed_moment",
    emoji: "🕳️📩",
    title: "Missed Moment",
    description: "You didn't respond in time",
    category: "influence",
  },

  // Emotional Impact
  that_meant_something: {
    id: "that_meant_something",
    emoji: "❤️✨",
    title: "That Meant Something",
    description: "You triggered a strong positive reaction",
    category: "emotional",
  },
  hit_deep: {
    id: "hit_deep",
    emoji: "💧🫀",
    title: "Hit Deep",
    description: "You reached something emotional",
    category: "emotional",
  },
  tension: {
    id: "tension",
    emoji: "⚡😡",
    title: "Tension",
    description: "You caused conflict",
    category: "emotional",
  },
  shifted_perspective: {
    id: "shifted_perspective",
    emoji: "🔄😲",
    title: "Shifted Perspective",
    description: "You changed how they think",
    category: "emotional",
  },

  // Life Moments
  seen_it_all: {
    id: "seen_it_all",
    emoji: "📸👁️",
    title: "Seen It All",
    description: "Received your first photo",
    category: "moments",
  },
  progress_witness: {
    id: "progress_witness",
    emoji: "📈📸",
    title: "Progress Witness",
    description: "Saw before/after change",
    category: "moments",
  },
  big_moment: {
    id: "big_moment",
    emoji: "🎉📷",
    title: "Big Moment",
    description: "A major milestone was shared",
    category: "moments",
  },
  you_were_there: {
    id: "you_were_there",
    emoji: "📍❤️",
    title: "You Were There",
    description: "Present during something important",
    category: "moments",
  },

  // Drama / Chaos
  messy: {
    id: "messy",
    emoji: "🧃💥",
    title: "Messy",
    description: "Got involved in drama",
    category: "drama",
  },
  he_said_she_said: {
    id: "he_said_she_said",
    emoji: "🗣️🔁",
    title: "He Said / She Said",
    description: "Information spread between characters",
    category: "drama",
  },
  in_the_middle: {
    id: "in_the_middle",
    emoji: "⚖️😬",
    title: "In the Middle",
    description: "Caught between people",
    category: "drama",
  },
  stirred_the_pot: {
    id: "stirred_the_pot",
    emoji: "🥄🔥",
    title: "Stirred the Pot",
    description: "You escalated things",
    category: "drama",
  },

  // Engagement
  still_here: {
    id: "still_here",
    emoji: "📅✔️",
    title: "Still Here",
    description: "Consistent usage over multiple days",
    category: "engagement",
  },
  they_came_back: {
    id: "they_came_back",
    emoji: "🔙💬",
    title: "They Came Back",
    description: "Reconnected after distance",
    category: "engagement",
  },
  left_on_read: {
    id: "left_on_read",
    emoji: "👁️📩",
    title: "Left on Read",
    description: "You ignored someone too long",
    category: "engagement",
  },
};

export const LOCKED_ACHIEVEMENTS = [
  { emoji: "❓", title: "???", description: "You'll know when it happens" },
  { emoji: "❓", title: "Bold Moves Only", description: "This one requires courage…" },
  { emoji: "❓", title: "???", description: "This one requires chaos…" },
];

export const CATEGORY_LABELS = {
  social: { label: "Social / Friendship", emoji: "🤝" },
  influence: { label: "Influence / Decision", emoji: "💬" },
  emotional: { label: "Emotional Impact", emoji: "❤️" },
  moments: { label: "Life Moments", emoji: "📸" },
  drama: { label: "Drama / Chaos", emoji: "🔥" },
  engagement: { label: "Engagement", emoji: "⏳" },
};

export const TIER_STYLES = {
  bronze: { glow: "shadow-amber-900/60", badge: "text-amber-600", label: "Bronze" },
  silver: { glow: "shadow-slate-400/60", badge: "text-slate-300", label: "Silver" },
  gold: { glow: "shadow-yellow-400/60", badge: "text-yellow-400", label: "Gold" },
  neon: { glow: "shadow-primary/80", badge: "text-primary", label: "Neon" },
};