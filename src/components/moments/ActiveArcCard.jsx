import { motion } from "framer-motion";
import { Link } from "react-router-dom";

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
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {character.avatar_url
            ? <img src={character.avatar_url} alt={character.name} className="w-full h-full object-cover" />
            : <span className="text-primary font-semibold text-sm">{character.name?.[0]}</span>
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-semibold text-foreground truncate">{character.name}</span>
            <span className="text-xs text-muted-foreground ml-2 flex-shrink-0">{clampedProgress}%</span>
          </div>
          <p className="text-xs text-muted-foreground text-justify mb-2 leading-relaxed">{arcLabel}</p>

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