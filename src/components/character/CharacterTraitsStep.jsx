import { Check } from "lucide-react";

// Each trait has: key (field on Character), label, description, emoji
export const CHARACTER_TRAITS = [
  {
    key: "is_photogenic",
    label: "Photogenic",
    emoji: "📸",
    desc: "Loves being photographed. Acts like selfie royalty — confident, frequent photo-sender.",
  },
  {
    key: "trait_oversharer",
    label: "Oversharer",
    emoji: "🗣️",
    desc: "Tells you more than you asked for. Texts walls. Can't help it.",
  },
  {
    key: "trait_dry_humor",
    label: "Dry Humor",
    emoji: "😐",
    desc: "Funny without trying. Deadpan delivery. Half the time you can't tell if they're joking.",
  },
  {
    key: "trait_night_owl",
    label: "Night Owl",
    emoji: "🦉",
    desc: "Comes alive after midnight. Most of their best conversations happen late.",
  },
  {
    key: "trait_hot_and_cold",
    label: "Hot & Cold",
    emoji: "🌡️",
    desc: "Warm and open one day, distant the next. Not manipulative — just internal.",
  },
  {
    key: "trait_flirty",
    label: "Naturally Flirty",
    emoji: "😏",
    desc: "Can't turn it off. Doesn't always mean anything — it's just how they talk.",
  },
  {
    key: "trait_overcorrects",
    label: "Overcorrects",
    emoji: "🔄",
    desc: "After conflict, tries too hard to make things right. Can come off as anxious.",
  },
  {
    key: "trait_blunt",
    label: "Brutally Honest",
    emoji: "💢",
    desc: "Says exactly what they think, even when it would've been fine to keep it in.",
  },
  {
    key: "trait_easily_distracted",
    label: "Easily Distracted",
    emoji: "🌀",
    desc: "Mid-conversation pivots. Random tangents. Their mind runs faster than the chat.",
  },
  {
    key: "trait_romanticizes",
    label: "Romanticizes Everything",
    emoji: "🌹",
    desc: "Finds meaning in small things. Treats casual moments like they matter — because to them, they do.",
  },
  {
    key: "trait_hard_to_read",
    label: "Hard to Read",
    emoji: "🎭",
    desc: "You're never sure where you stand. They're not hiding — they just don't show much.",
  },
  {
    key: "trait_competitive",
    label: "Quietly Competitive",
    emoji: "🏆",
    desc: "Won't admit it, but they keep score. Hates losing even at trivial things.",
  },
];

export default function CharacterTraitsStep({ data, onChange }) {
  const toggle = (key) => {
    onChange(key, !data[key]);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Character Traits & Quirks</h2>
        <p className="text-xs text-muted-foreground mb-1">
          Pick any traits that fit. These shape how they communicate, behave, and what makes them feel real.
        </p>
        <p className="text-xs text-muted-foreground/60">Select as many as you want — or none.</p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {CHARACTER_TRAITS.map((trait) => {
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
  );
}