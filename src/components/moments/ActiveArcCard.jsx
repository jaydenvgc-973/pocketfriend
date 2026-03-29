import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import { MapPin } from "lucide-react";

export default function ActiveArcCard({ character }) {
  const friendshipLevel = character.friendship_level ?? 75;
  const romanticLevel = character.romantic_level ?? 0;
  const respectLevel = character.user_respect_level ?? 50;

  // Compute an overall "arc progress" from relationship levels
  const arcProgress = Math.round((friendshipLevel + respectLevel + romanticLevel / 2) / 2.5);
  const clampedProgress = Math.min(100, Math.max(0, arcProgress));

  const segments = 5;
  const filledSegments = Math.round((clampedProgress / 100) * segments);

  const stateLabels = {
    calm: "Going about their day",
    irritated: "Feeling frustrated about something",
    defensive: "Being guarded right now",
    reflective: "Deep in thought",
    "closed-off": "Keeping to themselves",
    flirtatious: "In a playful mood",
    bored: "Looking for something to do",
    "burnt out": "Exhausted and overwhelmed",
    joyful: "In a great mood",
    anxious: "Feeling anxious about something",
    sad: "Going through a tough time",
    excited: "Really excited about something",
    overwhelmed: "Dealing with a lot right now",
    content: "Feeling settled and peaceful",
    frustrated: "Frustrated with their situation",
  };

  const arcLabel = character.current_life_event
    || stateLabels[character.emotional_state]
    || "Living their life";

  return (
    <Link to={`/chat/${character.id}`}>
      <motion.div
        whileHover={{ scale: 1.01 }}
        className="flex items-center gap-4 bg-card border border-border rounded-2xl px-4 py-3 hover:border-primary/30 transition-colors"
      >
        {/* Avatar with emotional state ring */}
        <CharacterAvatar character={character} size="md" />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-foreground truncate">{character.name}</span>
            <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{clampedProgress}%</span>
          </div>
          {(character.city || character.state) && (
            <div className="flex items-center gap-1 mb-0.5">
              <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{[character.city, character.state].filter(Boolean).join(", ")}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2 leading-relaxed truncate">{arcLabel}</p>

          {/* Segmented progress bar */}
          <div className="flex gap-1">
            {Array.from({ length: segments }).map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1.5 rounded-full transition-all ${
                  i < filledSegments ? "bg-primary" : "bg-secondary"
                }`}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </Link>
  );
}