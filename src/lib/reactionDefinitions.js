/**
 * COMPLETE EMOJI REACTION SYSTEM
 * 
 * Every reaction has:
 * - Clear emotional/contextual meaning
 * - When to use it
 * - When NOT to use it
 * - Personality weighting
 * - Trigger strength (how strong the emotion must be)
 */

export const REACTION_DEFINITIONS = {
  "❤️": {
    meaning: "affection, love, comfort, emotional warmth, attraction",
    use_for: [
      "sweet/supportive messages",
      "affectionate moments",
      "emotional vulnerability",
      "comfort/sympathy at the right level",
      "general approval & warmth"
    ],
    not_for: [
      "neutral statements",
      "serious arguments",
      "basic agreement (use 👍)",
      "humor (use 😂)"
    ],
    trigger_strength: "medium-to-strong",
    personality_weight: {
      "affectionate": 1.3,
      "compassionate": 1.2,
      "empathetic": 1.2,
      "romantic": 1.3,
      "reserved": 0.6,
      "stoic": 0.4
    }
  },

  "😂": {
    meaning: "humor, teasing, amusement, playful reactions",
    use_for: [
      "funny jokes/comments",
      "witty banter",
      "playful teasing",
      "amusing observations",
      "lighthearted moments"
    ],
    not_for: [
      "serious/sad moments",
      "arguments",
      "deeply emotional content",
      "things that aren't actually funny"
    ],
    trigger_strength: "medium",
    personality_weight: {
      "playful": 1.3,
      "sarcastic": 1.2,
      "dry_humor": 1.2,
      "joker": 1.3,
      "serious": 0.5,
      "solemn": 0.3
    }
  },

  "😮": {
    meaning: "shock, surprise, disbelief, unexpected moments, plot twists",
    use_for: [
      "shocking revelations",
      "unexpected behavior",
      "plot twists",
      "surprising announcements",
      "disbelief/skepticism"
    ],
    not_for: [
      "expected/boring statements",
      "things the character already knew"
    ],
    trigger_strength: "medium-to-strong",
    personality_weight: {
      "dramatic": 1.2,
      "expressive": 1.1,
      "curious": 1.1,
      "skeptical": 1.0,
      "jaded": 0.5,
      "unimpressed": 0.4
    }
  },

  "😢": {
    meaning: "sadness, sympathy, emotional vulnerability, hurt, compassion",
    use_for: [
      "sad/difficult moments",
      "someone sharing pain",
      "loss or disappointment",
      "genuine sympathy",
      "emotional moments"
    ],
    not_for: [
      "humor",
      "anger (use 😡)",
      "basic disagreement",
      "things that aren't genuinely sad"
    ],
    trigger_strength: "strong",
    personality_weight: {
      "compassionate": 1.3,
      "empathetic": 1.2,
      "sensitive": 1.2,
      "stoic": 0.4,
      "detached": 0.2
    }
  },

  "😡": {
    meaning: "anger, irritation, offense, frustration, serious disapproval",
    use_for: [
      "offensive comments",
      "serious disagreements",
      "reckless behavior",
      "disrespect",
      "genuine anger triggers"
    ],
    not_for: [
      "mild annoyance (use 😒)",
      "basic disagreement (use 👎)",
      "things that are just slightly bothersome",
      "jokes/humor"
    ],
    trigger_strength: "strong",
    personality_weight: {
      "volatile": 1.3,
      "hot_tempered": 1.2,
      "principled": 1.0,
      "patient": 0.4,
      "calm": 0.2
    }
  },

  "👍": {
    meaning: "agreement, support, acknowledgment, approval, basic positive",
    use_for: [
      "statements the character agrees with",
      "supportive messages",
      "acknowledgment",
      "simple approval",
      "plan confirmation"
    ],
    not_for: [
      "emotional warmth (use ❤️)",
      "humor (use 😂)",
      "disagreement (use 👎)",
      "things deserving stronger reactions"
    ],
    trigger_strength: "low-to-medium",
    personality_weight: {
      "agreeable": 1.1,
      "supportive": 1.1,
      "reserved": 1.0,
      "argumentative": 0.6
    }
  },

  "🔥": {
    meaning: "attraction, hype, excitement, confidence, admiration of appearance/style",
    use_for: [
      "attractive/sexy images",
      "stylish outfits",
      "impressive accomplishments",
      "confidence/hype moments",
      "attractive selfies",
      "energetic/flex moments",
      "admiration of appearance"
    ],
    not_for: [
      "sadness/hurt",
      "arguments",
      "basic approval (use 👍)",
      "sympathy"
    ],
    trigger_strength: "medium-to-strong",
    personality_weight: {
      "flirty": 1.3,
      "attracted": 1.3,
      "confident": 1.2,
      "playful": 1.1,
      "reserved": 0.5,
      "asexual": 0.2
    }
  },

  "😍": {
    meaning: "strong affection, romantic attraction, admiration, being captivated",
    use_for: [
      "romantic photos",
      "sweet/flirty messages",
      "affectionate moments",
      "cute behavior",
      "attraction-heavy interactions",
      "romantic connection moments"
    ],
    not_for: [
      "basic approval",
      "friendship-only contexts",
      "non-romantic warmth (use ❤️)"
    ],
    trigger_strength: "strong",
    personality_weight: {
      "romantic": 1.3,
      "flirty": 1.3,
      "affectionate": 1.2,
      "attracted": 1.2,
      "reserved": 0.4,
      "aromantic": 0.1
    }
  },

  "👎": {
    meaning: "disagreement, disapproval, rejection, disappointment, bad idea",
    use_for: [
      "suggestions the character disagrees with",
      "reckless behavior",
      "offensive comments",
      "ideas that won't work",
      "disappointment",
      "rejection signal"
    ],
    not_for: [
      "anger (use 😡)",
      "annoyance (use 😒)",
      "basic disagreement that's not strong"
    ],
    trigger_strength: "medium-to-strong",
    personality_weight: {
      "opinionated": 1.2,
      "argumentative": 1.1,
      "principled": 1.0,
      "agreeable": 0.5
    }
  },

  "😒": {
    meaning: "annoyance, side-eye, sarcasm, unimpressed, mild irritation",
    use_for: [
      "corny jokes",
      "mild frustration",
      "eye-roll moments",
      "awkward/cringe behavior",
      "passive annoyance",
      "sarcasm responses"
    ],
    not_for: [
      "real anger (use 😡)",
      "serious disagreement (use 👎)",
      "things that are genuinely upsetting"
    ],
    trigger_strength: "low-to-medium",
    personality_weight: {
      "sarcastic": 1.3,
      "dry_humor": 1.2,
      "unimpressed": 1.2,
      "jaded": 1.1,
      "earnest": 0.4,
      "optimistic": 0.3
    }
  },

  "😭": {
    meaning: "overwhelmed emotion, laughing too hard, emotional devastation, dramatic reaction",
    use_for: [
      "extremely funny moments",
      "emotional overwhelm",
      "overwhelmingly sweet moments",
      "can't handle this intensity (emotional)",
      "laughing-crying moments",
      "dramatic reactions"
    ],
    not_for: [
      "mild sadness (use 😢)",
      "mild humor (use 😂)",
      "things that aren't actually intense"
    ],
    trigger_strength: "very-strong",
    personality_weight: {
      "dramatic": 1.3,
      "expressive": 1.2,
      "emotional": 1.2,
      "sensitive": 1.1,
      "stoic": 0.3,
      "reserved": 0.2
    }
  },

  "👀": {
    meaning: "curiosity, attention, interest, watching closely, noticing something suspicious/flirty/dramatic",
    use_for: [
      "gossip/drama",
      "suspicious comments",
      "flirt tension",
      "dramatic reveals",
      "interesting content",
      "noticing something interesting",
      "curiosity trigger"
    ],
    not_for: [
      "agreement (use 👍)",
      "emotional responses",
      "things that genuinely warrant stronger reactions"
    ],
    trigger_strength: "medium",
    personality_weight: {
      "curious": 1.3,
      "observant": 1.2,
      "gossip": 1.2,
      "playful": 1.1,
      "oblivious": 0.3,
      "self_absorbed": 0.4
    }
  }
};

/**
 * Personality-based reaction tendency
 * Maps character traits to which reactions they're more likely to use
 */
export const PERSONALITY_REACTIONS = {
  affectionate: ["❤️", "😍", "🔥", "👍"],
  compassionate: ["❤️", "😢", "👍", "😮"],
  playful: ["😂", "🔥", "👀", "😒"],
  sarcastic: ["😂", "😒", "👀", "😮"],
  romantic: ["😍", "❤️", "🔥", "😭"],
  argumentative: ["😡", "👎", "😒", "😮"],
  reserved: ["👍", "❤️", "😮"],
  stoic: ["👍", "😮", "😡"],
  dramatic: ["😭", "😮", "❤️", "😡"],
  confident: ["🔥", "👍", "😂", "👎"],
  flirty: ["🔥", "😍", "👀", "😂"],
  jaded: ["😒", "👎", "😮"],
  earnest: ["❤️", "😢", "👍", "😮"],
  optimistic: ["❤️", "😂", "🔥", "👍"],
  observant: ["👀", "😮", "😒"],
  expressive: ["😭", "😂", "❤️", "😍"]
};

/**
 * Reaction trigger logic
 * Determines if a character should react to specific content
 */
export const REACTION_TRIGGERS = {
  // Image reactions have special rules
  image: {
    attractive: ["🔥", "😍", "👀"],
    cute: ["😍", "❤️", "👀"],
    impressive: ["🔥", "😮", "👍"],
    funny: ["😂", "😭", "👀"],
    stylish: ["🔥", "😍", "👍"]
  },

  // Message content triggers
  message: {
    affectionate: ["❤️", "😍"],
    funny: ["😂", "😭"],
    surprising: ["😮", "👀"],
    sad: ["😢", "❤️"],
    angry: ["😡", "👎"],
    agreement: ["👍"],
    attraction: ["🔥", "😍"],
    annoyance: ["😒"],
    curiosity: ["👀"],
    disapproval: ["👎", "😒"]
  }
};

/**
 * Rules for reaction behavior
 */
export const REACTION_RULES = {
  // Max one reaction per actor per message bubble
  max_per_actor_per_bubble: 1,

  // Emotion-triggered, not quota-triggered
  trigger_based: true,

  // Should character react to every message?
  react_to_every_message: false,

  // Suppress reactions if:
  suppress_when: [
    "character_is_asleep",
    "character_unavailable",
    "message_not_delivered",
    "message_not_read",
    "duplicate_same_actor_reaction_exists"
  ],

  // Valid frequency factors
  frequency_factors: [
    "character_personality",
    "relationship_level",
    "emotional_state",
    "mood",
    "attraction_level",
    "message_content_strength",
    "image_content_strength",
    "current_context",
    "has_character_seen_message"
  ]
};