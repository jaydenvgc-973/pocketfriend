import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, Volume2, ImageIcon, Loader2, RefreshCw, Trash2, Sparkles } from "lucide-react";
import { base44 } from "@/api/base44Client";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";

const emotionalColors = {
  calm: "bg-secondary",
  irritated: "bg-orange-950/40",
  defensive: "bg-red-950/30",
  reflective: "bg-blue-950/30",
  "closed-off": "bg-zinc-900"
};

export default function MessageBubble({ message, showName = false, onReact, onDelete, onDeleteImage, onPlayVoice, isPlayingVoice, voiceError }) {
  const isUser = message.sender_type === "user";
  const isNarrative = message.is_narrative;
  const playingAsLabel = isUser && message.played_as_character_name ? message.played_as_character_name : null;
  const bgColor = isUser ? "bg-primary" : (emotionalColors[message.emotional_state] || "bg-secondary");
  const time = message.timestamp ? format(new Date(message.timestamp), "h:mm a") : "";
  const hasReactions = message.reactions?.length > 0;
  const [showDelete, setShowDelete] = useState(false);
  const isDarkTheme = true; // app uses dark theme
  const [showImageDelete, setShowImageDelete] = useState(false);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [imageRetryFailed, setImageRetryFailed] = useState(false);
  const [imageRetryStatus, setImageRetryStatus] = useState('idle'); // idle | recovering | regenerating | failed
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleRegenSelect = async (reason, customPrompt) => {
    setIsRegenerating(true);
    try {
      await base44.functions.invoke('regenerateImageWithReason', { messageId: message.id, reason, customPrompt });
    } finally {
      setIsRegenerating(false);
      setShowRegenModal(false);
    }
  };

  // A message is an "image placeholder" if it has no content, no image_url, and was sent by a character
  const isImagePlaceholder = !isUser && !isNarrative && !message.image_url && !message.content?.trim();

  const handleImageRetry = async (forceRegenerate = false) => {
    if (imageRetrying) return;
    setImageRetrying(true);
    setImageRetryFailed(false);
    setImageRetryStatus(forceRegenerate ? 'regenerating' : 'recovering');

    try {
      const res = await base44.functions.invoke('recoverSingleImage', {
        messageId: message.id,
        forceRegenerate,
      });
      if (res?.data?.success && res?.data?.image_url) {
        setImageRetrying(false);
        setImageRetryStatus('idle');
        setImageRetryFailed(false);
      } else {
        setImageRetrying(false);
        setImageRetryFailed(true);
        setImageRetryStatus('failed');
      }
    } catch {
      setImageRetrying(false);
      setImageRetryFailed(true);
      setImageRetryStatus('failed');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2 ${isNarrative ? "justify-center" : isUser ? "justify-end" : "justify-start"} px-4 mb-1`}
    >
      <div className={`relative ${isNarrative ? "max-w-2xl" : "max-w-[80%]"} ${isNarrative ? "items-center" : isUser ? "items-end" : "items-start"} flex flex-col`}>
        {/* Narrative (action) — no message bubble, italicized, centered, distinct styling */}
        {isNarrative && (
          <div className="text-center px-4 py-2.5 italic text-muted-foreground text-sm leading-relaxed max-w-lg">
            {message.content}
          </div>
        )}

        {!isNarrative && showName && !isUser && message.character_name && (
          <span className="text-xs text-primary/70 ml-3 mb-1 font-medium">{message.character_name}</span>
        )}
        {!isNarrative && isUser && playingAsLabel && (
          <span className="text-xs text-amber-400/80 mr-3 mb-1 font-medium">{playingAsLabel}</span>
        )}

        {/* Delete button — not shown for narratives */}
        {!isNarrative && (
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
        )}

        {/* Message bubble with reaction trigger — not shown for narratives */}
        {!isNarrative && (
          <div className="group relative" onClick={() => setShowDelete(!showDelete)} onKeyDown={() => {}}>
            <div className={`${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}>
            {/* Image placeholder: character tried to send an image but URL never attached */}
            {isImagePlaceholder && (
              <div className="w-56 flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/50 bg-secondary/60 p-4 py-5">
                {imageRetrying ? (
                  <>
                    <Loader2 className="w-8 h-8 text-primary/60 animate-spin" />
                    <p className="text-xs text-muted-foreground text-center">
                      {imageRetryStatus === 'regenerating' ? 'Regenerating image...' : 'Recovering image...'}
                    </p>
                    <p className="text-[10px] text-muted-foreground/50 text-center">This may take 10–20 seconds</p>
                  </>
                ) : imageRetryFailed ? (
                  <>
                    <ImageIcon className="w-7 h-7 text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground text-center font-medium">Image unavailable</p>
                    <p className="text-[10px] text-muted-foreground/60 text-center">Recovery failed — try regenerating</p>
                    <div className="flex flex-col gap-1.5 mt-1 w-full">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleImageRetry(true); }}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full"
                      >
                        <RefreshCw className="w-3 h-3" /> Regenerate Image
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleImageRetry(false); }}
                        className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-xs hover:text-foreground transition-colors w-full"
                      >
                        <RefreshCw className="w-3 h-3" /> Try Recovery Again
                      </button>
                      {onDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(message.id); }}
                          className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors w-full"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-7 h-7 text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground text-center">Photo incoming</p>
                    <div className="flex flex-col gap-1.5 mt-1 w-full">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleImageRetry(false); }}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full"
                      >
                        <RefreshCw className="w-3 h-3" /> Load Photo
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleImageRetry(true); }}
                        className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-xs hover:text-foreground transition-colors w-full"
                      >
                        <RefreshCw className="w-3 h-3" /> Regenerate
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {message.image_url && (
              <div
                className="relative group/image"
                onMouseEnter={() => setShowImageDelete(true)}
                onMouseLeave={() => setShowImageDelete(false)}
              >
                <img
                  src={message.image_url}
                  alt="shared photo"
                  className="w-full max-w-xs rounded-t-2xl object-cover"
                />
                {showImageDelete && (
                  <div className="absolute inset-0 bg-black/40 rounded-t-2xl flex items-center justify-center gap-2">
                    {!isUser && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowRegenModal(true); }}
                        className="p-2 rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
                        title="Regenerate"
                      >
                        {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      </button>
                    )}
                    {onDeleteImage && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteImage(message.id); setShowImageDelete(false); }}
                        className="p-2 rounded-full bg-destructive/80 text-white hover:bg-destructive transition-colors"
                        title="Delete image"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <RegenerateImageModal
              isOpen={showRegenModal}
              onClose={() => setShowRegenModal(false)}
              onSelect={handleRegenSelect}
              isRegenerating={isRegenerating}
            />
              {message.content && (
                <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-2.5">{message.content}</p>
              )}
            </div>

            {/* Reactions + voice + add button — all anchored to same bottom corner spot */}
            {!isUser && (
              <div className={`absolute -bottom-2.5 right-1 z-20 flex gap-0.5 items-center`}>
                {hasReactions && (
                  <ReactionBadges reactions={message.reactions} onReact={onReact} messageId={message.id} />
                )}
                {onReact && <ReactionAddButton messageId={message.id} isUser={isUser} onReact={onReact} />}
              </div>
            )}
          </div>
        )}
      

        {!isNarrative && time && (
          <span className={`text-[10px] text-muted-foreground mt-1 ${isUser ? "mr-2" : "ml-2"}`}>{time}</span>
        )}
        
        {!isNarrative && voiceError && !isUser && (
          <span className="text-[10px] text-red-400 mt-1 ml-2">Voice error: {voiceError}</span>
        )}
      </div>

      {/* Voice button outside bubble on the right - visible on dialogue messages only */}
      {!isNarrative && !isUser && onPlayVoice && (
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => {
            console.log(`[MessageBubble] Voice button clicked for message ${message.id.substring(0, 8)}`);
            console.log(`[MessageBubble] Has audio_url: ${!!message.audio_url}`);
            console.log(`[MessageBubble] Message content: "${message.content?.substring(0, 100)}..."`);
            onPlayVoice();
          }}
          disabled={isPlayingVoice}
          className={`flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
            isPlayingVoice 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-primary hover:scale-110'
          }`}
          title={isPlayingVoice ? 'Playing audio...' : `Play voice${message.audio_url ? ' (has audio)' : ' (generate)'}`}
        >
          <Volume2 className="w-4 h-4" />
        </motion.button>
      )}
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