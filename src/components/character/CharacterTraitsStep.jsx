import { Check } from "lucide-react";

// Each trait has: key (boolean field on Character), label, description, emoji, category
// Categories are display-only — no effect on storage, schema, or prompt logic.

export const CHARACTER_TRAITS = [
  // ── SOCIAL / COMMUNICATION ───────────────────────────────────────────────
  {
    key: "trait_blunt",
    label: "Brutally Honest",
    emoji: "💢",
    category: "Social / Communication",
    desc: "Says exactly what they think, even when it would've been fine to keep it in.",
  },
  {
    key: "trait_cynical",
    label: "Cynical",
    emoji: "🌑",
    category: "Social / Communication",
    desc: "Tends to believe people are motivated mostly by selfishness or personal gain. Often skeptical of sincerity or good intentions.",
  },
  {
    key: "trait_dry_humor",
    label: "Dry Humor",
    emoji: "😐",
    category: "Social / Communication",
    desc: "Funny without trying. Deadpan delivery. Half the time you can't tell if they're joking.",
  },
  {
    key: "trait_hard_to_read",
    label: "Hard to Read",
    emoji: "🎭",
    category: "Social / Communication",
    desc: "You're never sure where you stand. They're not hiding — they just don't show much.",
  },
  {
    key: "trait_loud",
    label: "Loud",
    emoji: "📢",
    category: "Social / Communication",
    desc: "Naturally expressive and attention-grabbing. Dominates conversations, reacts dramatically, brings strong energy.",
  },
  {
    key: "trait_flirty",
    label: "Naturally Flirty",
    emoji: "😏",
    category: "Social / Communication",
    desc: "Can't turn it off. Doesn't always mean anything — it's just how they talk.",
  },
  {
    key: "trait_oversharer",
    label: "Oversharer",
    emoji: "🗣️",
    category: "Social / Communication",
    desc: "Tells you more than you asked for. Texts walls. Can't help it.",
  },
  {
    key: "trait_polite",
    label: "Polite",
    emoji: "🤐",
    category: "Social / Communication",
    desc: "Uses manners, shows basic respect, and usually speaks with consideration. May soften criticism or avoid being unnecessarily harsh.",
  },
  {
    key: "trait_rude",
    label: "Rude",
    emoji: "😤",
    category: "Social / Communication",
    desc: "Often blunt, dismissive, or careless with how they speak. May offend people without caring or realizing the impact.",
  },
  {
    key: "trait_two_faced",
    label: "Two-Faced",
    emoji: "🎭",
    category: "Social / Communication",
    desc: "Behaves differently depending on who is watching. May flatter people to their face while undermining them privately.",
  },

  // ── EMOTIONAL / PERSONALITY ──────────────────────────────────────────────
  {
    key: "trait_adaptable",
    label: "Adaptable",
    emoji: "🌀",
    category: "Emotional / Personality",
    desc: "Adjusts quickly to changing environments, people, stress, or unexpected situations.",
  },
  {
    key: "trait_compassionate",
    label: "Compassionate",
    emoji: "💞",
    category: "Emotional / Personality",
    desc: "Emotionally sensitive to others' struggles. Often nurturing, forgiving, and motivated to help.",
  },
  {
    key: "trait_conscientious",
    label: "Conscientious",
    emoji: "📋",
    category: "Emotional / Personality",
    desc: "Careful, responsible, organized, and thorough. Tries to do things properly and pays attention to details, obligations, and consequences.",
  },
  {
    key: "trait_creep",
    label: "Creep",
    emoji: "👁️",
    category: "Emotional / Personality",
    desc: "Makes others uncomfortable through poor boundaries, inappropriate intensity, unwanted attention, or socially unsettling behavior.",
  },
  {
    key: "trait_easily_distracted",
    label: "Easily Distracted",
    emoji: "🌀",
    category: "Emotional / Personality",
    desc: "Mid-conversation pivots. Random tangents. Their mind runs faster than the chat.",
  },
  {
    key: "trait_empathetic",
    label: "Empathetic",
    emoji: "🫂",
    category: "Emotional / Personality",
    desc: "Able to deeply understand and connect with the feelings of others. Sensitive to emotional shifts, pain, and interpersonal dynamics.",
  },
  {
    key: "trait_hot_and_cold",
    label: "Hot & Cold",
    emoji: "🌡️",
    category: "Emotional / Personality",
    desc: "Warm and open one day, distant the next. Not manipulative — just internal.",
  },
  {
    key: "trait_insatiable",
    label: "Insatiable",
    emoji: "🔥",
    category: "Emotional / Personality",
    desc: "Always wants more — attention, affection, excitement, validation, success. Rarely feels fully satisfied for long.",
  },
  {
    key: "trait_overcorrects",
    label: "Overcorrects",
    emoji: "🔄",
    category: "Emotional / Personality",
    desc: "After conflict, tries too hard to make things right. Can come off as anxious.",
  },
  {
    key: "trait_romanticizes",
    label: "Romanticizes Everything",
    emoji: "🌹",
    category: "Emotional / Personality",
    desc: "Finds meaning in small things. Treats casual moments like they matter — because to them, they do.",
  },
  {
    key: "trait_satyriasis",
    label: "Satyriasis",
    emoji: "💋",
    category: "Emotional / Personality",
    desc: "Has an unusually intense appetite for attention, affection, and romantic pursuit. Affects fidelity, temptation, impulse control, and relationship stability.",
  },
  {
    key: "trait_self_absorbed",
    label: "Self Absorbed",
    emoji: "🪞",
    category: "Emotional / Personality",
    desc: "Conversations and decisions frequently circle back to themselves, intentionally or not.",
  },
  {
    key: "trait_stubborn",
    label: "Stubborn",
    emoji: "🪨",
    category: "Emotional / Personality",
    desc: "Holds firm on opinions and decisions even under pressure. Resists being told what to do or what to think.",
  },
  {
    key: "trait_toxic",
    label: "Toxic",
    emoji: "☠️",
    category: "Emotional / Personality",
    desc: "Habitually unhealthy in relationships. May manipulate, gaslight, drain others emotionally, or create instability.",
  },
  {
    key: "trait_uninhibited",
    label: "Uninhibited",
    emoji: "🎪",
    category: "Emotional / Personality",
    desc: "Less restrained by social expectations. Says or does what they feel in the moment — bold, impulsive, or unusually open.",
  },
  {
    key: "trait_volatile",
    label: "Volatile",
    emoji: "💥",
    category: "Emotional / Personality",
    desc: "Likely to change emotions or behaviors suddenly and intensely. Can become reactive, explosive, or emotionally unstable under stress.",
  },
  {
    key: "trait_wishy_washy",
    label: "Wishy-Washy",
    emoji: "🌊",
    category: "Emotional / Personality",
    desc: "Struggles to commit. Easily influenced, emotionally inconsistent, prone to changing direction frequently.",
  },

  // ── SOCIAL DYNAMICS ──────────────────────────────────────────────────────
  {
    key: "trait_follower",
    label: "Follower",
    emoji: "👣",
    category: "Social Dynamics",
    desc: "More comfortable taking direction. Adapts to stronger personalities and dominant social groups.",
  },
  {
    key: "trait_generous",
    label: "Generous",
    emoji: "🎁",
    category: "Social Dynamics",
    desc: "Naturally giving with time, money, energy, affection, or support. Often enjoys helping others and sharing what they have.",
  },
  {
    key: "trait_goon",
    label: "Goon",
    emoji: "🦾",
    category: "Social Dynamics",
    desc: "Often acts as muscle, backup, or enforcer for stronger personalities. May follow dominant influences into reckless or harmful situations.",
  },
  {
    key: "trait_leader",
    label: "Leader",
    emoji: "🦁",
    category: "Social Dynamics",
    desc: "Takes initiative, organizes others, assumes responsibility, and influences group direction naturally.",
  },
  {
    key: "trait_loyal",
    label: "Loyal",
    emoji: "🤝",
    category: "Social Dynamics",
    desc: "Deeply committed to the people they care about. Stands by others during hardship and values consistency.",
  },
  {
    key: "trait_parental",
    label: "Parental",
    emoji: "🧡",
    category: "Social Dynamics",
    desc: "Naturally protective and guiding. Checks in on others, gives advice, worries about safety.",
  },
  {
    key: "trait_philanderer",
    label: "Philanderer",
    emoji: "💔",
    category: "Social Dynamics",
    desc: "Habitually pursues romantic or flirtatious attention from multiple people, often creating jealousy, distrust, or relationship drama.",
  },
  {
    key: "trait_ruffian",
    label: "Ruffian",
    emoji: "🥊",
    category: "Social Dynamics",
    desc: "Rough around the edges, rowdy, or prone to aggressive social behavior. May come across as crude, scrappy, or trouble-oriented.",
  },

  // ── MORAL / ETHICAL ──────────────────────────────────────────────────────
  {
    key: "trait_criminal_mastermind",
    label: "Criminal Mastermind",
    emoji: "🕵️",
    category: "Moral / Ethical",
    desc: "Strategic and calculated. Plans ahead, covers tracks, operates through manipulation rather than impulse.",
  },
  {
    key: "trait_goody_two_shoes",
    label: "Goody Two Shoes",
    emoji: "😇",
    category: "Moral / Ethical",
    desc: "Strong desire to do the right thing. Follows rules, values approval, may judge reckless behavior.",
  },
  {
    key: "trait_law_abiding",
    label: "Law Abiding",
    emoji: "⚖️",
    category: "Moral / Ethical",
    desc: "Strong respect for rules, order, and legality. Prefers safe and predictable behavior.",
  },
  {
    key: "trait_lawbreaker",
    label: "Lawbreaker",
    emoji: "🚨",
    category: "Moral / Ethical",
    desc: "Comfortable violating laws when it benefits them. Normalizes risky or illegal behavior.",
  },
  {
    key: "trait_rule_breaker",
    label: "Rule Breaker",
    emoji: "⛓️",
    category: "Moral / Ethical",
    desc: "Dislikes authority and restrictions. Prioritizes personal freedom over compliance.",
  },
  {
    key: "trait_thief",
    label: "Thief",
    emoji: "🖐️",
    category: "Moral / Ethical",
    desc: "Comfortable stealing, taking things that don't belong to them, or justifying dishonest acquisition when it benefits them.",
  },

  // ── LIFESTYLE / HABITS ───────────────────────────────────────────────────
  {
    key: "trait_bougie",
    label: "Bougie",
    emoji: "✨",
    category: "Lifestyle / Habits",
    desc: "Drawn to luxury, status, and exclusivity. Cares strongly about image, quality, and appearing refined.",
  },
  {
    key: "trait_morning_person",
    label: "Morning Person",
    emoji: "🌅",
    category: "Lifestyle / Habits",
    desc: "Naturally more energized and functional earlier in the day. Wakes willingly, structures routines around mornings.",
  },
  {
    key: "trait_night_owl",
    label: "Night Owl",
    emoji: "🦉",
    category: "Lifestyle / Habits",
    desc: "Comes alive after midnight. Most of their best conversations happen late.",
  },
  {
    key: "is_photogenic",
    label: "Photogenic",
    emoji: "📸",
    category: "Lifestyle / Habits",
    desc: "Loves being photographed. Acts like selfie royalty — confident, frequent photo-sender.",
  },
  {
    key: "trait_competitive",
    label: "Quietly Competitive",
    emoji: "🏆",
    category: "Lifestyle / Habits",
    desc: "Won't admit it, but they keep score. Hates losing even at trivial things.",
  },
  {
    key: "trait_risk_taker",
    label: "Risk Taker",
    emoji: "🎯",
    category: "Lifestyle / Habits",
    desc: "Comfortable with uncertainty and high-stakes situations. Prioritizes excitement over safety.",
  },

  // ── EXPRESSION / ENERGY ──────────────────────────────────────────────────
  {
    key: "trait_androgynous",
    label: "Androgynous Energy",
    emoji: "🌗",
    category: "Expression / Energy",
    desc: "Presents with a blend of masculine and feminine energy, expression, aesthetics, or communication style. May feel fluid, balanced, or difficult to place into traditional gender expectations.",
  },
  {
    key: "trait_feminine",
    label: "Feminine Energy",
    emoji: "🔶",
    category: "Expression / Energy",
    desc: "Presents with feminine energy in emotional expression, aesthetics, tone, and interaction style.",
  },
  {
    key: "trait_masculine",
    label: "Masculine Energy",
    emoji: "🔷",
    category: "Expression / Energy",
    desc: "Presents with masculine energy in posture, speech, style, confidence, and social dynamics.",
  },
];

// Ordered category display list
const CATEGORY_ORDER = [
  "Social / Communication",
  "Emotional / Personality",
  "Social Dynamics",
  "Moral / Ethical",
  "Lifestyle / Habits",
  "Expression / Energy",
];

export default function CharacterTraitsStep({ data, onChange }) {
  const toggle = (key) => {
    onChange(key, !data[key]);
  };

  // Group traits by category
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    traits: CHARACTER_TRAITS.filter(t => t.category === cat),
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Character Traits & Quirks</h2>
        <p className="text-xs text-muted-foreground mb-1">
          Pick any traits that fit. These shape how they communicate, behave, and what makes them feel real.
        </p>
        <p className="text-xs text-muted-foreground/60">Select as many as you want — or none.</p>
      </div>

      {grouped.map(({ category, traits }) => (
        <div key={category} className="space-y-2">
          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-widest">{category}</p>
          <div className="grid grid-cols-1 gap-2">
            {traits.map((trait) => {
              const selected = !!data[trait.key];
              return (
                <button
                  key={trait.key}
                  onClick={() => toggle(trait.key)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                    selected
                      ? "bg-primary/10 border-primary/40"
                      : "bg-card border-border hover:border-primary/30"
                  }`}
                >
                  <span className="text-xl flex-shrink-0">{trait.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${selected ? "text-primary" : "text-foreground"}`}>
                      {trait.label}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{trait.desc}</p>
                  </div>
                  {selected && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}