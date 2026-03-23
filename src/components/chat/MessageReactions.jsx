import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

export default function MessageReactions({ message, onReact }) {
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef(null);

  // Group reactions by emoji
  const grouped = (message.reactions || []).reduce((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] || []);
    acc[r.emoji].push(r.reactor_type);
    return acc;
  }, {});

  const hasReactions = Object.keys(grouped).length > 0;

  useEffect(() => {
    const handleClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative">
      {/* Existing reactions */}
      {hasReactions && (
        <div className="flex flex-wrap gap-1 mt-1">
          {Object.entries(grouped).map(([emoji, reactors]) => (
            <motion.button
              key={emoji}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-0.5 bg-secondary/80 border border-border rounded-full px-2 py-0.5 text-xs"
              onClick={() => onReact(message.id, emoji)}
              title={reactors.includes("character") ? "Character reacted" : "You reacted"}
            >
              <span>{emoji}</span>
              {reactors.length > 1 && <span className="text-muted-foreground">{reactors.length}</span>}
            </motion.button>
          ))}
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
            className={`absolute bottom-6 z-20 flex gap-1.5 bg-card border border-border rounded-2xl px-3 py-2 shadow-xl ${
              message.sender_type === "user" ? "right-0" : "left-0"
            }`}
          >
            {REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                className="text-lg hover:scale-125 transition-transform"
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