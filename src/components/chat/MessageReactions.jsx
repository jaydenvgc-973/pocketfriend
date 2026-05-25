import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
// Canonical 18 emoji set with emotional meanings — includes visible + hidden already-used reactions
const REACTION_EMOJIS = [
  "❤️", "😂", "😮", "😢", "😡", "👍",
  "🔥", "😍", "👎", "😒", "😭", "👀",
  "😱", "💔", "🥺", "😊", "😅", "🤔"
];
const REACTION_MEANINGS = {
  "❤️": "affection / warmth",
  "😂": "humor / amusement",
  "😮": "shock / surprise",
  "😢": "sadness / sympathy",
  "😡": "anger / frustration",
  "👍": "agreement / approval",
  "🔥": "attraction / hype / admiration",
  "😍": "romantic admiration / captivated",
  "👎": "disagreement / disapproval",
  "😒": "annoyance / side-eye / sarcasm",
  "😭": "overwhelmed / laughing too hard",
  "👀": "curiosity / noticing / watching",
  "😱": "fear / alarm / intense shock",
  "💔": "heartbreak / grief / emotional hurt",
  "🥺": "pleading / touched / vulnerable",
  "😊": "gentle happiness / warmth / shy affection",
  "😅": "awkward laugh / nervousness / embarrassment",
  "🤔": "thinking / skepticism / uncertainty",
};

export default function MessageReactions({ message, onReact }) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  // One-per-actor rule: display max one user reaction + one character reaction
  const userReaction = (message.reactions || []).find(r => r.reactor_type === "user");
  const characterReaction = (message.reactions || []).find(r => r.reactor_type === "character");
  const reactions = [userReaction, characterReaction].filter(Boolean);

  const hasReactions = reactions.length > 0;

  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleReactionClick = (emoji) => {
    onReact(message.id, emoji);
    setShowPicker(false);
  };

  return (
    <div className="relative">
      {/* Reactions display — max one per actor */}
      {hasReactions && (
        <div className="flex flex-wrap gap-1 mt-1">
          {reactions.map((reaction) => {
            const isCharacterReaction = reaction.reactor_type === "character";
            return (
              <motion.button
                key={`${reaction.reactor_type}-${reaction.emoji}`}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs border transition-colors ${
                  isCharacterReaction
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-secondary/80 border-border"
                }`}
                onClick={() => handleReactionClick(reaction.emoji)}
                title={`${isCharacterReaction ? "Character" : "You"} reacted: ${REACTION_MEANINGS[reaction.emoji] || ""}`}
              >
                <span>{reaction.emoji}</span>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* Add reaction button — shows on hover via parent group-hover */}
      <button
        onClick={() => setShowPicker(v => !v)}
        className="absolute -bottom-3 opacity-0 group-hover:opacity-100 transition-opacity bg-secondary border border-border rounded-full w-5 h-5 flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground z-10"
        style={{ right: message.sender_type === "user" ? "auto" : "auto", left: message.sender_type === "user" ? "-6px" : "auto", right: message.sender_type !== "user" ? "-6px" : "auto" }}
        title="React"
      >
        +
      </button>

      {/* Emoji picker */}
      <AnimatePresence>
        {showPicker && (
          <motion.div
            ref={pickerRef}
            initial={{ scale: 0.8, opacity: 0, y: 4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 4 }}
            className={`absolute bottom-6 z-20 grid grid-cols-6 gap-1 bg-card border border-border rounded-2xl px-3 py-2 shadow-xl w-80 ${
              message.sender_type === "user" ? "right-0" : "left-0"
            }`}
          >
            {REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                className="text-lg hover:scale-125 transition-transform"
                title={REACTION_MEANINGS[emoji]}
                onClick={() => {
                  onReact(message.id, emoji);
                  setShowPicker(false);
                }}
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}