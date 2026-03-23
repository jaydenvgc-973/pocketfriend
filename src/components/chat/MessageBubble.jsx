import { useState } from "react";
import { motion } from "framer-motion";
import { format } from "date-fns";

const emotionalColors = {
  calm: "bg-secondary",
  irritated: "bg-orange-950/40",
  defensive: "bg-red-950/30",
  reflective: "bg-blue-950/30",
  "closed-off": "bg-zinc-900"
};

export default function MessageBubble({ message, showName = false, onReact }) {
  const isUser = message.sender_type === "user";
  const bgColor = isUser ? "bg-primary" : (emotionalColors[message.emotional_state] || "bg-secondary");
  const time = message.timestamp ? format(new Date(message.timestamp), "h:mm a") : "";
  const hasReactions = message.reactions?.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} px-4 mb-1`}
    >
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {showName && !isUser && message.character_name && (
          <span className="text-xs text-primary/70 ml-3 mb-1 font-medium">{message.character_name}</span>
        )}

        {/* Message bubble with reaction trigger */}
        <div className="relative group">
          <div className={`${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}>
            {message.image_url && (
              <img
                src={message.image_url}
                alt="shared photo"
                className="w-full max-w-xs rounded-t-2xl object-cover"
              />
            )}
            {message.content && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-2.5">{message.content}</p>
            )}
          </div>

          {/* Reaction add button absolutely positioned on the bubble */}
          {onReact && (
            <div className={`absolute -bottom-2.5 ${isUser ? "left-1" : "right-1"} z-10`}>
              <ReactionAddButton messageId={message.id} isUser={isUser} onReact={onReact} />
            </div>
          )}

          {/* Reactions displayed in corner of bubble */}
          {hasReactions && (
            <div className={`absolute -bottom-4 ${isUser ? "left-1" : "right-1"} flex gap-0.5 z-10`}>
              <ReactionBadges reactions={message.reactions} onReact={onReact} messageId={message.id} />
            </div>
          )}
        </div>

        {/* Spacer when there are reactions */}
        {hasReactions && <div className="h-5" />}

        {time && (
          <span className={`text-[10px] text-muted-foreground mt-1 ${isUser ? "mr-2" : "ml-2"}`}>{time}</span>
        )}
      </div>
    </motion.div>
  );
}

const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍"];

function ReactionAddButton({ messageId, isUser, onReact }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="opacity-0 group-hover:opacity-100 transition-opacity bg-card border border-border rounded-full w-5 h-5 flex items-center justify-center text-[10px] text-muted-foreground hover:text-foreground shadow-md"
        title="Add reaction"
      >
        +
      </button>

      {open && (
        <div
          className={`absolute top-7 z-20 flex gap-1.5 bg-card border border-border rounded-2xl px-3 py-2 shadow-xl ${
            isUser ? "right-0" : "left-0"
          }`}
        >
          {REACTION_EMOJIS.map(emoji => (
            <button
              key={emoji}
              className="text-lg hover:scale-125 transition-transform"
              onClick={() => {
                onReact(messageId, emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReactionBadges({ reactions, onReact, messageId }) {
  const grouped = reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = [];
    acc[r.emoji].push(r.reactor_type);
    return acc;
  }, {});

  return (
    <>
      {Object.entries(grouped).map(([emoji, reactors]) => (
        <motion.button
          key={emoji}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center gap-0.5 bg-card border border-border rounded-full px-1.5 py-0.5 text-xs shadow-md"
          onClick={() => onReact && onReact(messageId, emoji)}
          title={reactors.includes("character") ? "Character reacted" : "You reacted"}
        >
          <span>{emoji}</span>
          {reactors.length > 1 && <span className="text-muted-foreground text-[10px]">{reactors.length}</span>}
        </motion.button>
      ))}
    </>
  );
}