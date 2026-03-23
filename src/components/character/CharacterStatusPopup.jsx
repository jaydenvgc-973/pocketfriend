import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

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
};

export default function CharacterStatusPopup({ character, onClose }) {
  return (
    <AnimatePresence>
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

          {/* Relationship Meters */}
          <div className="space-y-4">
            {RELATIONSHIPS.map(({ key, label, color }) => {
              const value = character[key] ?? 0;
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{value}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${value}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className={`h-full rounded-full ${color}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Location */}
          {(character.city || character.state) && (
            <p className="text-xs text-muted-foreground">
              📍 {[character.city, character.state].filter(Boolean).join(", ")}
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}