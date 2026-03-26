import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";

const RELATIONSHIPS = [
  { key: "user_respect_level", label: "Respect", color: "bg-blue-500" },
  { key: "friendship_level", label: "Friendship", color: "bg-emerald-500" },
  { key: "romantic_level", label: "Romantic", color: "bg-pink-500" },
  { key: "attraction_level", label: "Attraction", color: "bg-orange-500" },
  { key: "chosen_family_level", label: "Chosen Family", color: "bg-purple-500" },
];

const stateColors = {
  calm: "text-emerald-400",
  irritated: "text-orange-400",
  defensive: "text-red-400",
  reflective: "text-blue-400",
  "closed-off": "text-zinc-400",
  flirtatious: "text-pink-500",
  bored: "text-slate-500",
  "burnt out": "text-orange-600",
  joyful: "text-yellow-500",
  anxious: "text-purple-400",
  sad: "text-blue-600",
  excited: "text-amber-400",
  overwhelmed: "text-rose-500",
  content: "text-teal-400",
  frustrated: "text-red-600",
  joy: "text-yellow-400",
  happiness: "text-yellow-300",
  contentment: "text-teal-300",
  excitement: "text-amber-500",
  elation: "text-yellow-500",
  hope: "text-sky-400",
  relief: "text-green-400",
  gratitude: "text-lime-400",
  love: "text-pink-400",
  affection: "text-rose-400",
  compassion: "text-pink-300",
  empathy: "text-violet-300",
  pride: "text-indigo-400",
  confidence: "text-blue-400",
  peacefulness: "text-cyan-400",
  satisfaction: "text-emerald-400",
  curiosity: "text-purple-400",
  interest: "text-indigo-300",
  amusement: "text-amber-300",
  surprise: "text-orange-300",
  awe: "text-violet-400",
  anticipation: "text-amber-400",
  nostalgia: "text-rose-300",
  longing: "text-purple-300",
  desire: "text-rose-500",
  passion: "text-red-400",
  infatuation: "text-pink-600",
  tenderness: "text-rose-300",
  vulnerability: "text-violet-300",
  trust: "text-sky-500",
  security: "text-green-500",
  belonging: "text-teal-500",
  acceptance: "text-emerald-300",
  patience: "text-cyan-300",
  annoyance: "text-orange-400",
  irritation: "text-orange-500",
  anger: "text-red-500",
  rage: "text-red-700",
  resentment: "text-red-800",
  jealousy: "text-green-600",
  envy: "text-lime-600",
  insecurity: "text-zinc-500",
  doubt: "text-slate-400",
  confusion: "text-amber-600",
  stress: "text-orange-700",
  fear: "text-purple-700",
  panic: "text-red-600",
  worry: "text-amber-700",
  guilt: "text-stone-500",
  shame: "text-stone-600",
  embarrassment: "text-rose-600",
  regret: "text-slate-600",
  disappointment: "text-blue-700",
  grief: "text-indigo-700",
  loneliness: "text-slate-700",
  hopelessness: "text-zinc-700",
  despair: "text-zinc-800",
  detachment: "text-zinc-500",
  numbness: "text-slate-500",
  apathy: "text-stone-400"
};

function DeltaIndicator({ delta }) {
  if (delta === 0 || delta === undefined) return <Minus className="w-3 h-3 text-muted-foreground" />;
  if (delta > 0) return (
    <span className="flex items-center gap-0.5 text-emerald-400 text-xs font-medium">
      <TrendingUp className="w-3 h-3" />+{delta}
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-red-400 text-xs font-medium">
      <TrendingDown className="w-3 h-3" />{delta}
    </span>
  );
}

export default function CharacterStatusPopup({ character, onClose, previousLevels, lastChangeReason }) {
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-card border border-border rounded-t-2xl p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{character.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mood:{" "}
              <span className={`font-medium ${stateColors[character.emotional_state] || "text-foreground"}`}>
                {character.emotional_state || "calm"}
              </span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Last interaction reason */}
        <AnimatePresence>
          {lastChangeReason && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-secondary/60 rounded-xl px-3 py-2.5 border border-border"
            >
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-foreground font-medium">Last interaction: </span>
                {lastChangeReason}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Relationship bars */}
        <div className="space-y-4">
          {RELATIONSHIPS.map(({ key, label, color }) => {
            const value = character[key] ?? 0;
            const prev = previousLevels?.[key];
            const delta = prev !== undefined ? value - prev : undefined;

            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{label}</span>
                  <div className="flex items-center gap-2">
                    {delta !== undefined && <DeltaIndicator delta={delta} />}
                    <span className="text-xs text-muted-foreground tabular-nums">{value}%</span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <motion.div
                    initial={{ width: prev !== undefined ? `${prev}%` : 0 }}
                    animate={{ width: `${value}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className={`h-full rounded-full ${color}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {(character.city || character.state) && (
          <p className="text-xs text-muted-foreground">
            📍 {[character.city, character.state].filter(Boolean).join(", ")}
          </p>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}