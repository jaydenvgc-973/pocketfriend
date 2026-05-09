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
    key: "trait_easily_distracted",
    label: "Easily Distracted",
    emoji: "🌀",
    category: "Emotional / Personality",
    desc: "Mid-conversation pivots. Random tangents. Their mind runs faster than the chat.",
  },
  {
    key: "trait_hot_and_cold",
    label: "Hot & Cold",
    emoji: "🌡️",
    category: "Emotional / Personality",
    desc: "Warm and open one day, distant the next. Not manipulative — just internal.",
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