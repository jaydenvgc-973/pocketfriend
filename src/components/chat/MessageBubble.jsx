import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, Volume2 } from "lucide-react";

const emotionalColors = {
  calm: "bg-secondary",
  irritated: "bg-orange-950/40",
  defensive: "bg-red-950/30",
  reflective: "bg-blue-950/30",
  "closed-off": "bg-zinc-900"
};

export default function MessageBubble({ message, showName = false, onReact, onDelete, onDeleteImage, hasVoice, onPlayVoice, isPlayingVoice }) {
  const isUser = message.sender_type === "user";
  const isNarrative = message.is_narrative;
  // Use the persisted played_as name if this user message was sent while playing as a character
  const playingAsLabel = isUser && message.played_as_character_name ? message.played_as_character_name : null;
  const bgColor = isUser ? "bg-primary" : (emotionalColors[message.emotional_state] || "bg-secondary");
  const time = message.timestamp ? format(new Date(message.timestamp), "h:mm a") : "";
  const hasReactions = message.reactions?.length > 0;
  const [showDelete, setShowDelete] = useState(false);
  const [showImageDelete, setShowImageDelete] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex ${isNarrative ? "justify-center" : isUser ? "justify-end" : "justify-start"} px-4 mb-1`}
    >
      <div className={`relative ${isNarrative ? "max-w-2xl" : "max-w-[80%]"} ${isNarrative ? "items-center" : isUser ? "items-end" : "items-start"} flex flex-col`}>
        {showName && !isUser && !isNarrative && message.character_name && (
          <span className="text-xs text-primary/70 ml-3 mb-1 font-medium">{message.character_name}</span>
        )}
        {isUser && !isNarrative && playingAsLabel && (
          <span className="text-xs text-amber-400/80 mr-3 mb-1 font-medium">{playingAsLabel}</span>
        )}

        {/* Delete button */}
        <AnimatePresence>
          {showDelete && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`absolute z-50 ${isUser ? "-right-2" : "-left-2"} top-1/2 -translate-y-1/2 flex items-center justify-center p-1.5 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shadow-md`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(message.id);
                setShowDelete(false);
              }}
              title="Delete message"
            >
              <X className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Message bubble with reaction trigger */}
        <div className="group relative" onClick={() => !isNarrative && setShowDelete(!showDelete)}>
          <div className={`${isNarrative ? "bg-transparent text-muted-foreground italic text-center py-3" : `${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}`}>
            {message.image_url && (
              <div className="relative group/image">
                <img
                  src={message.image_url}
                  alt="shared photo"
                  className="w-full max-w-xs rounded-t-2xl object-cover"
                  onMouseEnter={() => setShowImageDelete(true)}
                  onMouseLeave={() => setShowImageDelete(false)}
                />
                {showImageDelete && onDeleteImage && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(message.id);
                      setShowImageDelete(false);
                    }}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-t-2xl transition-colors hover:bg-black/70"
                    title="Delete image"
                  >
                    <X className="w-6 h-6 text-white" />
                  </button>
                )}
              </div>
            )}
            {message.content && (
              <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-2.5">{message.content}</p>
            )}
          </div>

          {/* Reactions + add button — all anchored to same bottom corner spot */}
          {onReact && !isNarrative && (
            <div className={`absolute -bottom-2.5 ${isUser ? "left-1" : "right-1"} z-20 flex gap-0.5 items-center`}>
              {hasReactions && (
                <ReactionBadges reactions={message.reactions} onReact={onReact} messageId={message.id} />
              )}
              <ReactionAddButton messageId={message.id} isUser={isUser} onReact={onReact} />
            </div>
          )}
          </div>

        <div className="flex items-center gap-2 mt-1">
          {time && (
            <span className={`text-[10px] text-muted-foreground ${isUser ? "mr-2" : "ml-2"}`}>{time}</span>
          )}
          {hasVoice && !isUser && !isNarrative && (
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={onPlayVoice}
              disabled={isPlayingVoice}
              className="text-muted-foreground hover:text-primary transition-colors disabled:opacity-50 flex-shrink-0"
              title="Play voice"
            >
              <Volume2 className="w-3 h-3" />
            </motion.button>
          )}
        </div>
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
          className={`absolute top-6 z-50 flex gap-1.5 bg-card border border-border rounded-2xl px-3 py-2 shadow-xl ${
            isUser ? "left-0" : "right-0"
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