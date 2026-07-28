/**
 * CANONICAL TRAIT & QUIRK REGISTRY
 *
 * Single source of truth for all character traits and quirks across:
 * - Character Creation (CreateCharacter)
 * - Character Profile (CharacterQuirksPanel, CharacterTraitsStep)
 * - Settings (EditCharacterTraits)
 * - Autonomy Engine (autonomousCharacterMovement)
 * - Travel Priority Engine (createTravelSession, detectAndScheduleCommitments)
 * - Dialogue Behavior
 *
 * STORAGE:
 * - Traits (type:"trait") → saved as flat booleans on Character entity (e.g. char.trait_loyal = true)
 * - Quirks (type:"quirk") → saved to character.quirks[] array as objects { quirk_id, label, category, intensity, active }
 *
 * DO NOT hardcode separate lists in any component. Import from here.
 */

// ─── TRAIT ENTRIES (flat boolean fields on Character) ───────────────────────
// key = Character entity field name
export const TRAIT_ENTRIES = [
  // ── SOCIAL / COMMUNICATION ───────────────────────────────────────────────
  {
    key: "trait_blunt",
    id: "trait_blunt",
    type: "trait",
    label: "Brutally Honest",
    emoji: "💢",
    category: "Social / Communication",
    desc: "Says exactly what they think, even when it would've been fine to keep it in.",
    autonomy_modifiers: { commitment_reliability: 0, dialogue_bluntness: +2 },
    conflicts_with: ["trait_polite"],
  },
  {
    key: "trait_cynical",
    id: "trait_cynical",
    type: "trait",
    label: "Cynical",
    emoji: "🌑",
    category: "Social / Communication",
    desc: "Tends to believe people are motivated mostly by selfishness or personal gain.",
    autonomy_modifiers: { commitment_reliability: -0.5, social_travel_priority: -1 },
    conflicts_with: [],
  },
  {
    key: "trait_dry_humor",
    id: "trait_dry_humor",
    type: "trait",
    label: "Dry Humor",
    emoji: "😐",
    category: "Social / Communication",
    desc: "Funny without trying. Deadpan delivery. Half the time you can't tell if they're joking.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_hard_to_read",
    id: "trait_hard_to_read",
    type: "trait",
    label: "Hard to Read",
    emoji: "🎭",
    category: "Social / Communication",
    desc: "You're never sure where you stand. They're not hiding — they just don't show much.",
    autonomy_modifiers: { commitment_reliability: -0.5 },
    conflicts_with: [],
  },
  {
    key: "trait_loud",
    id: "trait_loud",
    type: "trait",
    label: "Loud",
    emoji: "📢",
    category: "Social / Communication",
    desc: "Naturally expressive and attention-grabbing. Dominates conversations.",
    autonomy_modifiers: { social_travel_priority: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_flirty",
    id: "trait_flirty",
    type: "trait",
    label: "Naturally Flirty",
    emoji: "😏",
    category: "Social / Communication",
    desc: "Can't turn it off. Doesn't always mean anything — it's just how they talk.",
    autonomy_modifiers: { social_travel_priority: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_oversharer",
    id: "trait_oversharer",
    type: "trait",
    label: "Oversharer",
    emoji: "🗣️",
    category: "Social / Communication",
    desc: "Tells you more than you asked for. Texts walls. Can't help it.",
    autonomy_modifiers: {},
    conflicts_with: ["trait_hard_to_read"],
  },
  {
    key: "trait_polite",
    id: "trait_polite",
    type: "trait",
    label: "Polite",
    emoji: "🤐",
    category: "Social / Communication",
    desc: "Uses manners, shows basic respect, and usually speaks with consideration.",
    autonomy_modifiers: { commitment_reliability: +1, dialogue_bluntness: -1 },
    conflicts_with: ["trait_rude", "trait_blunt"],
  },
  {
    key: "trait_rude",
    id: "trait_rude",
    type: "trait",
    label: "Rude",
    emoji: "😤",
    category: "Social / Communication",
    desc: "Often blunt, dismissive, or careless with how they speak.",
    autonomy_modifiers: { commitment_reliability: -0.5 },
    conflicts_with: ["trait_polite"],
  },
  {
    key: "trait_two_faced",
    id: "trait_two_faced",
    type: "trait",
    label: "Two-Faced",
    emoji: "🎭",
    category: "Social / Communication",
    desc: "Behaves differently depending on who is watching. May promise things without genuine intent.",
    autonomy_modifiers: { commitment_reliability: -2, promise_sincerity: -2 },
    conflicts_with: ["trait_loyal"],
  },

  // ── EMOTIONAL / PERSONALITY ──────────────────────────────────────────────
  {
    key: "trait_adaptable",
    id: "trait_adaptable",
    type: "trait",
    label: "Adaptable",
    emoji: "🌀",
    category: "Emotional / Personality",
    desc: "Adjusts quickly to changing environments, people, stress, or unexpected situations.",
    autonomy_modifiers: { commitment_reliability: +0.5 },
    conflicts_with: [],
  },
  {
    key: "trait_compassionate",
    id: "trait_compassionate",
    type: "trait",
    label: "Compassionate",
    emoji: "💞",
    category: "Emotional / Personality",
    desc: "Emotionally sensitive to others' struggles. Often nurturing, forgiving, and motivated to help.",
    autonomy_modifiers: { commitment_reliability: +1, relationship_priority: +1 },
    conflicts_with: ["trait_toxic"],
  },
  {
    key: "trait_conscientious",
    id: "trait_conscientious",
    type: "trait",
    label: "Conscientious",
    emoji: "📋",
    category: "Emotional / Personality",
    desc: "Careful, responsible, organized, and thorough. Punctual, respects schedules and obligations.",
    autonomy_modifiers: { commitment_reliability: +2, punctuality: +2, schedule_compliance: +2 },
    conflicts_with: ["trait_wishy_washy"],
  },
  {
    key: "trait_creep",
    id: "trait_creep",
    type: "trait",
    label: "Creep",
    emoji: "👁️",
    category: "Emotional / Personality",
    desc: "Makes others uncomfortable through poor boundaries, inappropriate intensity.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_easily_distracted",
    id: "trait_easily_distracted",
    type: "trait",
    label: "Easily Distracted",
    emoji: "🌀",
    category: "Emotional / Personality",
    desc: "Mid-conversation pivots. Random tangents. Their mind runs faster than the chat.",
    autonomy_modifiers: { commitment_reliability: -1, punctuality: -1, lateness_modifier: +1 },
    conflicts_with: ["trait_conscientious"],
  },
  {
    key: "trait_empathetic",
    id: "trait_empathetic",
    type: "trait",
    label: "Empathetic",
    emoji: "🫂",
    category: "Emotional / Personality",
    desc: "Able to deeply understand and connect with the feelings of others.",
    autonomy_modifiers: { relationship_priority: +1, commitment_reliability: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_hot_and_cold",
    id: "trait_hot_and_cold",
    type: "trait",
    label: "Hot & Cold",
    emoji: "🌡️",
    category: "Emotional / Personality",
    desc: "Warm and open one day, distant the next. Not manipulative — just internal.",
    autonomy_modifiers: { commitment_reliability: -1, lateness_modifier: +0.5 },
    conflicts_with: [],
  },
  {
    key: "trait_insatiable",
    id: "trait_insatiable",
    type: "trait",
    label: "Insatiable",
    emoji: "🔥",
    category: "Emotional / Personality",
    desc: "Always wants more — attention, affection, excitement, validation, success.",
    autonomy_modifiers: { social_travel_priority: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_overcorrects",
    id: "trait_overcorrects",
    type: "trait",
    label: "Overcorrects",
    emoji: "🔄",
    category: "Emotional / Personality",
    desc: "After conflict, tries too hard to make things right. Can come off as anxious.",
    autonomy_modifiers: { commitment_reliability: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_romanticizes",
    id: "trait_romanticizes",
    type: "trait",
    label: "Romanticizes Everything",
    emoji: "🌹",
    category: "Emotional / Personality",
    desc: "Finds meaning in small things. Treats casual moments like they matter.",
    autonomy_modifiers: { relationship_priority: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_satyriasis",
    id: "trait_satyriasis",
    type: "trait",
    label: "Satyriasis",
    emoji: "💋",
    category: "Emotional / Personality",
    desc: "Has an unusually intense appetite for attention, affection, and romantic pursuit.",
    autonomy_modifiers: { social_travel_priority: +1, commitment_reliability: -1 },
    conflicts_with: [],
  },
  {
    key: "trait_self_absorbed",
    id: "trait_self_absorbed",
    type: "trait",
    label: "Self Absorbed",
    emoji: "🪞",
    category: "Emotional / Personality",
    desc: "Conversations and decisions frequently circle back to themselves.",
    autonomy_modifiers: { commitment_reliability: -1, relationship_priority: -1 },
    conflicts_with: ["trait_compassionate", "trait_empathetic"],
  },
  {
    key: "trait_stubborn",
    id: "trait_stubborn",
    type: "trait",
    label: "Stubborn",
    emoji: "🪨",
    category: "Emotional / Personality",
    desc: "Holds firm on opinions and decisions even under pressure.",
    autonomy_modifiers: { commitment_reliability: +0.5 },
    conflicts_with: ["trait_adaptable"],
  },
  {
    key: "trait_toxic",
    id: "trait_toxic",
    type: "trait",
    label: "Toxic",
    emoji: "☠️",
    category: "Emotional / Personality",
    desc: "Habitually unhealthy in relationships. May manipulate, gaslight, or drain others.",
    autonomy_modifiers: { commitment_reliability: -1, promise_sincerity: -1 },
    conflicts_with: ["trait_compassionate", "trait_empathetic", "trait_loyal"],
  },
  {
    key: "trait_uninhibited",
    id: "trait_uninhibited",
    type: "trait",
    label: "Uninhibited",
    emoji: "🎪",
    category: "Emotional / Personality",
    desc: "Less restrained by social expectations. Says or does what they feel in the moment.",
    autonomy_modifiers: { risk_taking: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_volatile",
    id: "trait_volatile",
    type: "trait",
    label: "Volatile",
    emoji: "💥",
    category: "Emotional / Personality",
    desc: "Likely to change emotions or behaviors suddenly and intensely.",
    autonomy_modifiers: { commitment_reliability: -1 },
    conflicts_with: ["trait_conscientious"],
  },
  {
    key: "trait_wishy_washy",
    id: "trait_wishy_washy",
    type: "trait",
    label: "Wishy-Washy",
    emoji: "🌊",
    category: "Emotional / Personality",
    desc: "Struggles to commit. Easily influenced, emotionally inconsistent, prone to changing direction.",
    autonomy_modifiers: { commitment_reliability: -2, lateness_modifier: +1, cancel_probability: +1 },
    conflicts_with: ["trait_conscientious", "trait_loyal"],
  },

  // ── SOCIAL DYNAMICS ──────────────────────────────────────────────────────
  {
    key: "trait_follower",
    id: "trait_follower",
    type: "trait",
    label: "Follower",
    emoji: "👣",
    category: "Social Dynamics",
    desc: "More comfortable taking direction. Adapts to stronger personalities.",
    autonomy_modifiers: { commitment_reliability: -0.5 },
    conflicts_with: ["trait_leader"],
  },
  {
    key: "trait_generous",
    id: "trait_generous",
    type: "trait",
    label: "Generous",
    emoji: "🎁",
    category: "Social Dynamics",
    desc: "Naturally giving with time, money, energy, affection, or support.",
    autonomy_modifiers: { relationship_priority: +1, spending_on_others: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_goon",
    id: "trait_goon",
    type: "trait",
    label: "Goon",
    emoji: "🦾",
    category: "Social Dynamics",
    desc: "Often acts as muscle, backup, or enforcer for stronger personalities.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_leader",
    id: "trait_leader",
    type: "trait",
    label: "Leader",
    emoji: "🦁",
    category: "Social Dynamics",
    desc: "Takes initiative, organizes others, assumes responsibility.",
    autonomy_modifiers: { commitment_reliability: +1, schedule_compliance: +1 },
    conflicts_with: ["trait_follower"],
  },
  {
    key: "trait_loyal",
    id: "trait_loyal",
    type: "trait",
    label: "Loyal",
    emoji: "🤝",
    category: "Social Dynamics",
    desc: "Deeply committed to the people they care about. Protects commitments strongly.",
    autonomy_modifiers: { commitment_reliability: +3, relationship_priority: +2, cancel_probability: -2 },
    conflicts_with: ["trait_two_faced", "trait_wishy_washy"],
  },
  {
    key: "trait_parental",
    id: "trait_parental",
    type: "trait",
    label: "Parental",
    emoji: "🧡",
    category: "Social Dynamics",
    desc: "Naturally protective and guiding. Checks in on others, gives advice.",
    autonomy_modifiers: { commitment_reliability: +1, relationship_priority: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_philanderer",
    id: "trait_philanderer",
    type: "trait",
    label: "Philanderer",
    emoji: "💔",
    category: "Social Dynamics",
    desc: "Habitually pursues romantic or flirtatious attention from multiple people.",
    autonomy_modifiers: { commitment_reliability: -1, promise_sincerity: -1 },
    conflicts_with: ["trait_loyal"],
  },
  {
    key: "trait_ruffian",
    id: "trait_ruffian",
    type: "trait",
    label: "Ruffian",
    emoji: "🥊",
    category: "Social Dynamics",
    desc: "Rough around the edges, rowdy, or prone to aggressive social behavior.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },

  // ── MORAL / ETHICAL ──────────────────────────────────────────────────────
  {
    key: "trait_criminal_mastermind",
    id: "trait_criminal_mastermind",
    type: "trait",
    label: "Criminal Mastermind",
    emoji: "🕵️",
    category: "Moral / Ethical",
    desc: "Strategic and calculated. Plans ahead, covers tracks, operates through manipulation.",
    autonomy_modifiers: { promise_sincerity: -1 },
    conflicts_with: ["trait_law_abiding", "trait_goody_two_shoes"],
  },
  {
    key: "trait_goody_two_shoes",
    id: "trait_goody_two_shoes",
    type: "trait",
    label: "Goody Two Shoes",
    emoji: "😇",
    category: "Moral / Ethical",
    desc: "Strong desire to do the right thing. Follows rules, values approval.",
    autonomy_modifiers: { commitment_reliability: +1, schedule_compliance: +1 },
    conflicts_with: ["trait_lawbreaker", "trait_rule_breaker", "trait_criminal_mastermind"],
  },
  {
    key: "trait_law_abiding",
    id: "trait_law_abiding",
    type: "trait",
    label: "Law Abiding",
    emoji: "⚖️",
    category: "Moral / Ethical",
    desc: "Strong respect for rules, order, and legality.",
    autonomy_modifiers: { commitment_reliability: +1 },
    conflicts_with: ["trait_lawbreaker", "trait_rule_breaker", "trait_criminal_mastermind"],
  },
  {
    key: "trait_lawbreaker",
    id: "trait_lawbreaker",
    type: "trait",
    label: "Lawbreaker",
    emoji: "🚨",
    category: "Moral / Ethical",
    desc: "Comfortable violating laws when it benefits them.",
    autonomy_modifiers: { risk_taking: +1 },
    conflicts_with: ["trait_law_abiding", "trait_goody_two_shoes"],
  },
  {
    key: "trait_rule_breaker",
    id: "trait_rule_breaker",
    type: "trait",
    label: "Rule Breaker",
    emoji: "⛓️",
    category: "Moral / Ethical",
    desc: "Dislikes authority and restrictions. Prioritizes personal freedom.",
    autonomy_modifiers: { schedule_compliance: -1 },
    conflicts_with: ["trait_law_abiding"],
  },
  {
    key: "trait_thief",
    id: "trait_thief",
    type: "trait",
    label: "Thief",
    emoji: "🖐️",
    category: "Moral / Ethical",
    desc: "Comfortable stealing or justifying dishonest acquisition.",
    autonomy_modifiers: { promise_sincerity: -1 },
    conflicts_with: ["trait_law_abiding"],
  },

  // ── LIFESTYLE / HABITS ───────────────────────────────────────────────────
  {
    key: "trait_bougie",
    id: "trait_bougie",
    type: "trait",
    label: "Bougie",
    emoji: "✨",
    category: "Lifestyle / Habits",
    desc: "Drawn to luxury, status, and exclusivity. Cares strongly about image and quality.",
    autonomy_modifiers: { spending_on_venues: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_morning_person",
    id: "trait_morning_person",
    type: "trait",
    label: "Morning Person",
    emoji: "🌅",
    category: "Lifestyle / Habits",
    desc: "Naturally more energized and functional earlier in the day.",
    autonomy_modifiers: { morning_reliability: +2, late_night_reliability: -1 },
    conflicts_with: ["trait_night_owl"],
  },
  {
    key: "trait_night_owl",
    id: "trait_night_owl",
    type: "trait",
    label: "Night Owl",
    emoji: "🦉",
    category: "Lifestyle / Habits",
    desc: "Comes alive after midnight. Most of their best conversations happen late.",
    autonomy_modifiers: { morning_reliability: -1, late_night_reliability: +2 },
    conflicts_with: ["trait_morning_person"],
  },
  {
    key: "is_photogenic",
    id: "is_photogenic",
    type: "trait",
    label: "Photogenic",
    emoji: "📸",
    category: "Lifestyle / Habits",
    desc: "Loves being photographed. Acts like selfie royalty — confident, frequent photo-sender.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_competitive",
    id: "trait_competitive",
    type: "trait",
    label: "Quietly Competitive",
    emoji: "🏆",
    category: "Lifestyle / Habits",
    desc: "Won't admit it, but they keep score. Hates losing even at trivial things.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_risk_taker",
    id: "trait_risk_taker",
    type: "trait",
    label: "Risk Taker",
    emoji: "🎯",
    category: "Lifestyle / Habits",
    desc: "Comfortable with uncertainty and high-stakes situations.",
    autonomy_modifiers: { risk_taking: +2 },
    conflicts_with: [],
  },
  {
    key: "trait_clean_freak",
    id: "trait_clean_freak",
    type: "trait",
    label: "Clean Freak",
    emoji: "🧼",
    category: "Lifestyle / Habits",
    desc: "Compelled to keep things spotless. Cleans, organizes, does laundry, and tidies more often than most.",
    autonomy_modifiers: { health_discipline: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_self_care_focused",
    id: "trait_self_care_focused",
    type: "trait",
    label: "Self-Care Focused",
    emoji: "🧘",
    category: "Lifestyle / Habits",
    desc: "Prioritizes physical and mental wellness. Keeps up grooming, rest, and recovery routines.",
    autonomy_modifiers: { health_discipline: +1 },
    conflicts_with: [],
  },
  {
    key: "trait_health_conscious",
    id: "trait_health_conscious",
    type: "trait",
    label: "Health Conscious",
    emoji: "🥗",
    category: "Lifestyle / Habits",
    desc: "Mindful of diet and physical condition. Makes intentional, generally healthier choices without obsessing.",
    autonomy_modifiers: { health_discipline: +1 },
    conflicts_with: [],
  },

  // ── PROTECTED TRAITS ─────────────────────────────────────────────────────
  // These traits are permanently assigned and cannot be toggled by users.
  // UI must render them as read-only (no checkbox / toggle).
  {
    key: "trait_never_break_fourth_wall",
    id: "trait_never_break_fourth_wall",
    type: "trait",
    protected: true,
    label: "Never Break the Fourth Wall",
    emoji: "🔒",
    category: "Protected",
    desc: "This character may possess protected knowledge but is permanently prohibited from revealing, implying, or explaining the artificial or meta-level nature of the world to any other character. Overrides all personality, emotion, relationship, and diagnostic behaviors.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },

  // ── EXPRESSION / ENERGY ──────────────────────────────────────────────────
  {
    key: "trait_androgynous",
    id: "trait_androgynous",
    type: "trait",
    label: "Androgynous Energy",
    emoji: "🌗",
    category: "Expression / Energy",
    desc: "Presents with a blend of masculine and feminine energy, expression, aesthetics.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_feminine",
    id: "trait_feminine",
    type: "trait",
    label: "Feminine Energy",
    emoji: "🔶",
    category: "Expression / Energy",
    desc: "Presents with feminine energy in emotional expression, aesthetics, tone.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
  {
    key: "trait_masculine",
    id: "trait_masculine",
    type: "trait",
    label: "Masculine Energy",
    emoji: "🔷",
    category: "Expression / Energy",
    desc: "Presents with masculine energy in posture, speech, style, confidence.",
    autonomy_modifiers: {},
    conflicts_with: [],
  },
];

// ─── QUIRK ENTRIES (saved to character.quirks[] array) ───────────────────────
export const QUIRK_ENTRIES = [
  // ── SPENDING ──────────────────────────────────────────────────────────────
  {
    id: "shopaholic",
    quirk_id: "shopaholic",
    type: "quirk",
    label: "Shopaholic",
    emoji: "🛍️",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Impulse purchases when stressed, bored, or near stores. Creates joy then guilt.",
    autonomy_modifiers: { spending_on_venues: +1, financial_discipline: -1 },
    conflicts_with: ["frugal", "financially_anxious"],
  },
  {
    id: "retail_therapy",
    quirk_id: "retail_therapy",
    type: "quirk",
    label: "Retail Therapy",
    emoji: "💳",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Spends to cope with emotional lows. Tied to mood, not routine.",
    autonomy_modifiers: { spending_on_venues: +1 },
    conflicts_with: ["frugal"],
  },
  {
    id: "sneaker_obsession",
    quirk_id: "sneaker_obsession",
    type: "quirk",
    label: "Sneaker Obsession",
    emoji: "👟",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Buys limited releases. Builds outfits around shoes. High excitement, low guilt.",
    autonomy_modifiers: {},
    conflicts_with: ["frugal"],
  },
  {
    id: "luxury_oriented",
    quirk_id: "luxury_oriented",
    type: "quirk",
    label: "Luxury-Oriented",
    emoji: "💎",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Prefers premium options. Frustration when downgraded.",
    autonomy_modifiers: { spending_on_venues: +2 },
    conflicts_with: ["frugal", "financially_anxious"],
  },
  {
    id: "frugal",
    quirk_id: "frugal",
    type: "quirk",
    label: "Frugal",
    emoji: "🪙",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Avoids unnecessary spending. Stress when forced to overpay.",
    autonomy_modifiers: { spending_on_venues: -2, financial_discipline: +2 },
    conflicts_with: ["shopaholic", "luxury_oriented", "impulsive_spender"],
  },
  {
    id: "impulsive_spender",
    quirk_id: "impulsive_spender",
    type: "quirk",
    label: "Impulsive Spender",
    emoji: "💸",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Acts on financial urges fast. Regret common.",
    autonomy_modifiers: { financial_discipline: -2, risk_taking: +1 },
    conflicts_with: ["frugal", "financially_anxious"],
  },
  {
    id: "financially_anxious",
    quirk_id: "financially_anxious",
    type: "quirk",
    label: "Financially Anxious",
    emoji: "😰",
    category: "spending",
    categoryLabel: "Spending",
    desc: "High stress around money. Conflicts with spending quirks.",
    autonomy_modifiers: { spending_on_venues: -1 },
    conflicts_with: ["shopaholic", "luxury_oriented", "impulsive_spender"],
  },
  {
    id: "generous_spender",
    quirk_id: "generous_spender",
    type: "quirk",
    label: "Generous",
    emoji: "🎁",
    category: "spending",
    categoryLabel: "Spending",
    desc: "Frequently pays for others. Fulfillment but possible regret.",
    autonomy_modifiers: { spending_on_others: +2, relationship_priority: +1 },
    conflicts_with: ["frugal"],
  },

  // ── HABITS & ADDICTIONS ───────────────────────────────────────────────────
  {
    id: "smoker",
    quirk_id: "smoker",
    type: "quirk",
    label: "Smoker",
    emoji: "🚬",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Recurring urge. Habit expense. Short relief, long-term health decline.",
    autonomy_modifiers: { health_discipline: -1 },
    conflicts_with: ["health_obsessed"],
  },
  {
    id: "social_smoker",
    quirk_id: "social_smoker",
    type: "quirk",
    label: "Social Smoker",
    emoji: "🎉",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Only smokes in social/nightlife settings.",
    autonomy_modifiers: {},
    conflicts_with: ["health_obsessed"],
  },
  {
    id: "drinker",
    quirk_id: "drinker",
    type: "quirk",
    label: "Drinker",
    emoji: "🥃",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Regular alcohol use. Social or solo. Affects mood, health, finances.",
    autonomy_modifiers: { commitment_reliability: -0.5, health_discipline: -1 },
    conflicts_with: ["health_obsessed"],
  },
  {
    id: "stress_eater",
    quirk_id: "stress_eater",
    type: "quirk",
    label: "Stress Eater",
    emoji: "🍔",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Food spending spikes under stress. Comfort followed by guilt.",
    autonomy_modifiers: { food_travel_priority: +1 },
    conflicts_with: ["health_obsessed", "fitness_guru"],
  },
  {
    id: "gambling",
    quirk_id: "gambling",
    type: "quirk",
    label: "Gambling",
    emoji: "🎲",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Thrill-seeking financial risk. Variable outcomes, emotional swings.",
    autonomy_modifiers: { risk_taking: +2, financial_discipline: -2 },
    conflicts_with: ["frugal", "financially_anxious"],
  },
  {
    id: "overworking",
    quirk_id: "overworking",
    type: "quirk",
    label: "Overworking",
    emoji: "⚙️",
    category: "addiction",
    categoryLabel: "Habits & Addictions",
    desc: "Can't disconnect from work. Burnout risk, relationship strain.",
    autonomy_modifiers: { work_priority: +2, social_travel_priority: -1 },
    conflicts_with: ["unmotivated"],
  },

  // ── LIFESTYLE ─────────────────────────────────────────────────────────────
  {
    id: "fitness_guru",
    quirk_id: "fitness_guru",
    type: "quirk",
    label: "Fitness Guru",
    emoji: "🏋️",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Gym is a priority. Fitness spending, emotional reward, frustration if disrupted.",
    autonomy_modifiers: { gym_travel_priority: +2, health_discipline: +2 },
    conflicts_with: ["gym_avoidant", "stress_eater"],
  },
  {
    id: "health_obsessed",
    quirk_id: "health_obsessed",
    type: "quirk",
    label: "Health Obsessed",
    emoji: "🥗",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Proactive wellness. Consistent health spending. Stability tied to routine.",
    autonomy_modifiers: { health_discipline: +2, food_travel_priority: -1 },
    conflicts_with: ["smoker", "drinker", "stress_eater"],
  },
  {
    id: "gym_avoidant",
    quirk_id: "gym_avoidant",
    type: "quirk",
    label: "Gym Avoidant",
    emoji: "🛋️",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Avoids exercise despite knowing better. Guilt and slow health decline.",
    autonomy_modifiers: { gym_travel_priority: -3, health_discipline: -1 },
    conflicts_with: ["fitness_guru"],
  },
  {
    id: "homebody",
    quirk_id: "homebody",
    type: "quirk",
    label: "Homebody",
    emoji: "🏠",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Stays home. Lower spending, less movement. Comfort in routine.",
    autonomy_modifiers: { social_travel_priority: -2, home_priority: +2 },
    conflicts_with: ["always_outside"],
  },
  {
    id: "always_outside",
    quirk_id: "always_outside",
    type: "quirk",
    label: "Always Outside",
    emoji: "🌳",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Constantly moving and going out. Higher spending, social energy.",
    autonomy_modifiers: { social_travel_priority: +2, home_priority: -1 },
    conflicts_with: ["homebody"],
  },
  {
    id: "disciplined",
    quirk_id: "disciplined",
    type: "quirk",
    label: "Disciplined",
    emoji: "📋",
    category: "lifestyle",
    categoryLabel: "Lifestyle",
    desc: "Sticks to routines. Rarely impulsive. Stable finances and health.",
    autonomy_modifiers: { commitment_reliability: +2, schedule_compliance: +2, financial_discipline: +1 },
    conflicts_with: ["unmotivated"],
  },

  // ── EMOTIONAL ─────────────────────────────────────────────────────────────
  {
    id: "overthinker",
    quirk_id: "overthinker",
    type: "quirk",
    label: "Overthinker",
    emoji: "🌀",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Delays decisions, creates anxiety. Affects timing and commitment.",
    autonomy_modifiers: { lateness_modifier: +1, commitment_reliability: -0.5 },
    conflicts_with: [],
  },
  {
    id: "people_pleaser",
    quirk_id: "people_pleaser",
    type: "quirk",
    label: "People Pleaser",
    emoji: "🙏",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Spends on others, avoids conflict. May over-commit and burn out.",
    autonomy_modifiers: { commitment_reliability: +1, spending_on_others: +1 },
    conflicts_with: [],
  },
  {
    id: "emotionally_guarded",
    quirk_id: "emotionally_guarded",
    type: "quirk",
    label: "Emotionally Guarded",
    emoji: "🧱",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Slow to open up. Deflects vulnerability. Dialogue stays surface-level until trust builds.",
    autonomy_modifiers: { social_travel_priority: -1 },
    conflicts_with: [],
  },
  {
    id: "jealous",
    quirk_id: "jealous",
    type: "quirk",
    label: "Jealous",
    emoji: "👀",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Compares to others. Reactive emotionally. Can trigger impulsive spending.",
    autonomy_modifiers: { relationship_priority: +1 },
    conflicts_with: [],
  },
  {
    id: "thrill_seeker",
    quirk_id: "thrill_seeker",
    type: "quirk",
    label: "Thrill Seeker",
    emoji: "🎢",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Seeks excitement and risk. Reckless financially and socially.",
    autonomy_modifiers: { risk_taking: +2, commitment_reliability: -1 },
    conflicts_with: [],
  },
  {
    id: "dependent",
    quirk_id: "dependent",
    type: "quirk",
    label: "Dependent",
    emoji: "🔗",
    category: "emotional",
    categoryLabel: "Emotional",
    desc: "Borrows money, relies on others. Tied to support systems.",
    autonomy_modifiers: { financial_discipline: -1, relationship_priority: +1 },
    conflicts_with: [],
  },

  // ── WORK & IDENTITY ────────────────────────────────────────────────────────
  {
    id: "workaholic",
    quirk_id: "workaholic",
    type: "quirk",
    label: "Workaholic",
    emoji: "💼",
    category: "work",
    categoryLabel: "Work & Identity",
    desc: "Prioritizes work over everything. Higher income but burnout risk.",
    autonomy_modifiers: { work_priority: +3, social_travel_priority: -1, commitment_reliability: -0.5 },
    conflicts_with: ["unmotivated"],
  },
  {
    id: "entrepreneurial",
    quirk_id: "entrepreneurial",
    type: "quirk",
    label: "Entrepreneurial",
    emoji: "🚀",
    category: "work",
    categoryLabel: "Work & Identity",
    desc: "Builds side businesses. Variable income, reinvestment mindset.",
    autonomy_modifiers: { work_priority: +1 },
    conflicts_with: [],
  },
  {
    id: "unmotivated",
    quirk_id: "unmotivated",
    type: "quirk",
    label: "Unmotivated",
    emoji: "😴",
    category: "work",
    categoryLabel: "Work & Identity",
    desc: "Avoids responsibility. Leads to financial instability over time.",
    autonomy_modifiers: { work_priority: -2, commitment_reliability: -1, schedule_compliance: -1 },
    conflicts_with: ["workaholic", "disciplined", "overworking"],
  },
];

// ─── COMBINED REGISTRY ────────────────────────────────────────────────────────
export const ALL_ENTRIES = [...TRAIT_ENTRIES, ...QUIRK_ENTRIES];

// ─── ORDERED CATEGORY DISPLAY ─────────────────────────────────────────────────
export const TRAIT_CATEGORY_ORDER = [
  "Social / Communication",
  "Emotional / Personality",
  "Social Dynamics",
  "Moral / Ethical",
  "Lifestyle / Habits",
  "Expression / Energy",
  "Protected",
];

export const TRAIT_CATEGORY_META = {
  "Protected": { label: "Protected Traits", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
};

export const QUIRK_CATEGORY_ORDER = [
  "spending",
  "addiction",
  "lifestyle",
  "emotional",
  "work",
];

export const QUIRK_CATEGORY_META = {
  spending:  { label: "Spending",           color: "text-amber-400",  bg: "bg-amber-400/10 border-amber-400/20" },
  addiction: { label: "Habits & Addictions", color: "text-red-400",    bg: "bg-red-400/10 border-red-400/20" },
  lifestyle: { label: "Lifestyle",           color: "text-green-400",  bg: "bg-green-400/10 border-green-400/20" },
  emotional: { label: "Emotional",           color: "text-blue-400",   bg: "bg-blue-400/10 border-blue-400/20" },
  work:      { label: "Work & Identity",     color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/20" },
};

// ─── CONFLICT DETECTION ───────────────────────────────────────────────────────
/**
 * Given a character's active trait keys and quirk IDs, returns all conflict pairs.
 * @param {string[]} activeTraitKeys - e.g. ["trait_loyal", "trait_two_faced"]
 * @param {string[]} activeQuirkIds  - e.g. ["shopaholic", "frugal"]
 * @returns {Array<{a: string, b: string, a_label: string, b_label: string}>}
 */
export function detectConflicts(activeTraitKeys = [], activeQuirkIds = []) {
  const conflicts = [];
  const allActive = new Set([...activeTraitKeys, ...activeQuirkIds]);

  for (const entry of ALL_ENTRIES) {
    const entryId = entry.key || entry.id;
    if (!allActive.has(entryId)) continue;
    for (const conflictId of (entry.conflicts_with || [])) {
      if (allActive.has(conflictId)) {
        // Avoid duplicate pairs
        const pairKey = [entryId, conflictId].sort().join('|');
        const exists = conflicts.some(c => [c.a, c.b].sort().join('|') === pairKey);
        if (!exists) {
          const conflictEntry = ALL_ENTRIES.find(e => (e.key || e.id) === conflictId);
          conflicts.push({
            a: entryId,
            b: conflictId,
            a_label: entry.label,
            b_label: conflictEntry?.label || conflictId,
          });
        }
      }
    }
  }

  return conflicts;
}

// ─── COMMITMENT RELIABILITY SCORE ─────────────────────────────────────────────
/**
 * Returns a numeric commitment reliability modifier for a character.
 * Positive = more reliable. Negative = less reliable. Baseline = 0.
 * Used by autonomousCharacterMovement and detectAndScheduleCommitments.
 *
 * @param {object} character - Character entity record
 * @returns {number} reliability modifier (-10 to +10 range)
 */
export function computeCommitmentReliability(character) {
  let score = 0;

  // Traits (flat boolean fields)
  for (const entry of TRAIT_ENTRIES) {
    if (character[entry.key] === true) {
      score += (entry.autonomy_modifiers?.commitment_reliability || 0);
    }
  }

  // Quirks (character.quirks[] array)
  const quirks = character.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    const entry = QUIRK_ENTRIES.find(e => e.quirk_id === q.quirk_id);
    if (!entry) continue;
    const mod = entry.autonomy_modifiers?.commitment_reliability || 0;
    // Intensity multiplier: mild=0.5, moderate=1.0, strong=1.5
    const intensityMult = q.intensity === 'mild' ? 0.5 : q.intensity === 'strong' ? 1.5 : 1.0;
    score += mod * intensityMult;
  }

  return score;
}

/**
 * Returns a human-readable reliability label for UI display.
 */
export function getReliabilityLabel(score) {
  if (score >= 3) return "Very Reliable";
  if (score >= 1) return "Reliable";
  if (score >= -1) return "Average";
  if (score >= -2) return "Unreliable";
  return "Very Unreliable";
}

/**
 * Returns the cancel probability increase from traits/quirks.
 * 0 = normal. Higher = more likely to cancel/bail.
 */
export function computeCancelProbability(character) {
  let score = 0;
  for (const entry of TRAIT_ENTRIES) {
    if (character[entry.key] === true) {
      score += (entry.autonomy_modifiers?.cancel_probability || 0);
    }
  }
  const quirks = character.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    const entry = QUIRK_ENTRIES.find(e => e.quirk_id === q.quirk_id);
    if (!entry) continue;
    const mod = entry.autonomy_modifiers?.cancel_probability || 0;
    const intensityMult = q.intensity === 'mild' ? 0.5 : q.intensity === 'strong' ? 1.5 : 1.0;
    score += mod * intensityMult;
  }
  return score;
}

/**
 * Returns the lateness modifier (0 = normal, higher = more likely to be late).
 */
export function computeLatenessModifier(character) {
  let score = 0;
  for (const entry of TRAIT_ENTRIES) {
    if (character[entry.key] === true) {
      score += (entry.autonomy_modifiers?.lateness_modifier || 0);
    }
  }
  const quirks = character.quirks || [];
  for (const q of quirks) {
    if (!q.active) continue;
    const entry = QUIRK_ENTRIES.find(e => e.quirk_id === q.quirk_id);
    if (!entry) continue;
    const mod = entry.autonomy_modifiers?.lateness_modifier || 0;
    const intensityMult = q.intensity === 'mild' ? 0.5 : q.intensity === 'strong' ? 1.5 : 1.0;
    score += mod * intensityMult;
  }
  return score;
}