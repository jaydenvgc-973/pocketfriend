import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from "@/components/ui/button";
import { Copy, Zap, CheckCircle2, AlertCircle, Loader2, ChevronRight, ImageIcon, Trash2, RefreshCw, Volume2, Forward, X } from 'lucide-react';
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { toast } from "sonner";
import RegenerateImageModal from './RegenerateImageModal';
import MusicPreviewPlayer from './MusicPreviewPlayer';
import VideoPreviewCard from './VideoPreviewCard';

const FunctionDisplay = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const name = toolCall?.name || 'Function';
  const status = toolCall?.status || 'pending';
  const results = toolCall?.results;
  
  // Parse and check for errors
  const parsedResults = (() => {
    if (!results) return null;
    try {
      return typeof results === 'string' ? JSON.parse(results) : results;
    } catch {
      return results;
    }
  })();
  
  const isError = results && (
    (typeof results === 'string' && /error|failed/i.test(results)) ||
    (parsedResults?.success === false)
  );
  
  // Status configuration
  const statusConfig = {
    pending: { icon: AlertCircle, color: 'text-slate-400', text: 'Pending' },
    running: { icon: Loader2, color: 'text-slate-500', text: 'Running...', spin: true },
    in_progress: { icon: Loader2, color: 'text-slate-500', text: 'Running...', spin: true },
    completed: isError ? 
      { icon: AlertCircle, color: 'text-red-500', text: 'Failed' } : 
      { icon: CheckCircle2, color: 'text-green-600', text: 'Success' },
    success: { icon: CheckCircle2, color: 'text-green-600', text: 'Success' },
    failed: { icon: AlertCircle, color: 'text-red-500', text: 'Failed' },
    error: { icon: AlertCircle, color: 'text-red-500', text: 'Failed' }
  }[status] || { icon: Zap, color: 'text-slate-500', text: '' };
  
  const Icon = statusConfig.icon;
  const formattedName = name.split('.').reverse().join(' ').toLowerCase();
  
  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all",
          "hover:bg-slate-50",
          expanded ? "bg-slate-50 border-slate-300" : "bg-white border-slate-200"
        )}
      >
        <Icon className={cn("h-3 w-3", statusConfig.color, statusConfig.spin && "animate-spin")} />
        <span className="text-slate-700">{formattedName}</span>
        {statusConfig.text && (
          <span className={cn("text-slate-500", isError && "text-red-600")}>
            • {statusConfig.text}
          </span>
        )}
        {!statusConfig.spin && (toolCall.arguments_string || results) && (
          <ChevronRight className={cn("h-3 w-3 text-slate-400 transition-transform ml-auto", 
            expanded && "rotate-90")} />
        )}
      </button>
      
      {expanded && !statusConfig.spin && (
        <div className="mt-1.5 ml-3 pl-3 border-l-2 border-slate-200 space-y-2">
          {toolCall.arguments_string && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Parameters:</div>
              <pre className="bg-slate-50 rounded-md p-2 text-xs text-slate-600 whitespace-pre-wrap">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(toolCall.arguments_string), null, 2);
                  } catch {
                    return toolCall.arguments_string;
                  }
                })()}
              </pre>
            </div>
          )}
          {parsedResults && (
            <div>
              <div className="text-xs text-slate-500 mb-1">Result:</div>
              <pre className="bg-slate-50 rounded-md p-2 text-xs text-slate-600 whitespace-pre-wrap max-h-48 overflow-auto">
                {typeof parsedResults === 'object' ? 
                  JSON.stringify(parsedResults, null, 2) : parsedResults}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function MessageBubble({ message, isUser, onReact, onDelete, onDeleteImage, onForward, onPlayVoice, isPlayingVoice, voiceError, time, onReloadImage }) {
  const [showImageDelete, setShowImageDelete] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(null);
  
  const isNarrative = message.sender === 'narrative';
  const hasReactions = message.reactions && message.reactions.length > 0;

  const filterDashes = (text) => {
    if (!text) return '';
    return text.replace(/^-\s*/gm, '');
  };

  const handleRegenSelect = async (choice) => {
    setIsRegenerating(true);
    setRegenError(null);
    try {
      // Call the regenerate function with the choice
      // This would integrate with your image generation backend
      if (choice === 'same') {
        // Regenerate with same prompt
      } else if (choice === 'refine') {
        // Open a text input for refinement
      }
    } catch (err) {
      setRegenError(err.message);
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn("flex gap-3 items-end", isUser ? "justify-end" : "justify-start")}
    >
      {/* Main bubble */}
      <div className={cn("max-w-[85%] flex flex-col gap-1", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 relative",
            isNarrative
              ? "bg-secondary/30 border border-border/40 text-foreground italic text-sm"
              : isUser
              ? "bg-primary text-primary-foreground shadow-md"
              : "bg-white dark:bg-card border border-border shadow-sm text-foreground"
          )}
        >
          {/* Image loading states */}
          {message.image_url === 'LOADING' && (
            <div className="w-48 h-32 rounded-lg bg-secondary flex flex-col gap-3 items-center justify-center p-4">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-primary typing-dot-1" />
                <div className="w-2 h-2 rounded-full bg-primary typing-dot-2" />
                <div className="w-2 h-2 rounded-full bg-primary typing-dot-3" />
              </div>
              <p className="text-xs text-muted-foreground">Generating photo...</p>
            </div>
          )}
          {message.image_url === 'ERROR' && (
            <div className="w-48 h-32 rounded-lg bg-destructive/10 flex flex-col gap-3 items-center justify-center p-4">
              {message.image_recovery_attempted ? (
                <>
                  <ImageIcon className="w-7 h-7 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground text-center font-medium">Image unavailable</p>
                  <p className="text-[10px] text-muted-foreground/60 text-center">Recovery failed — try regenerating</p>
                  <div className="flex flex-col gap-1.5 mt-1 w-full">
                    <button
                      onClick={(e) => { e.stopPropagation(); onReloadImage?.(message.id, true); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate Image
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onReloadImage?.(message.id, false); }}
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
                      onClick={(e) => { e.stopPropagation(); onReloadImage?.(message.id, false); }}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full"
                    >
                      <RefreshCw className="w-3 h-3" /> Load Photo
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onReloadImage?.(message.id, true); }}
                      className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-xs hover:text-foreground transition-colors w-full"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {message.image_url && message.image_url !== 'LOADING' && message.image_url !== 'ERROR' && (
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
            onClose={() => { setShowRegenModal(false); setRegenError(null); }}
            onSelect={handleRegenSelect}
            isRegenerating={isRegenerating}
            error={regenError}
            originalPrompt={message.generation_context?.prompt || null}
          />
          {message.content && message.content.trim() && (
            message.is_forwarded ? (
              <div className="px-4 py-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <Forward className="w-3 h-3 text-primary/60" />
                  <span className="text-[10px] text-primary/60 font-medium">Fwd from {message.forwarded_from || "them"}</span>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap border-l-2 border-primary/30 pl-2">
                  {message.content.replace(/^Fwd Message from [^:]+:\n?/, "")}
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap px-4 py-2.5">{isUser ? message.content : filterDashes(message.content)}</p>
            )
          )}
          {message.songs_heard && message.songs_heard.length > 0 && (
            <div className="px-4 py-3 space-y-2">
              {message.songs_heard.map((song, idx) => (
                <MusicPreviewPlayer key={idx} song={song} platform={song.platform || 'spotify'} />
              ))}
            </div>
          )}
          {message.videos_watched && message.videos_watched.length > 0 && (
            <div className="px-4 py-3 space-y-2">
              {message.videos_watched.map((video, idx) => (
                <VideoPreviewCard key={idx} video={video} platform={video.platform || 'generic'} />
              ))}
            </div>
          )}
        </div>

        {/* Reactions + voice + add button */}
        {!isNarrative && !isUser && (
          <div className={`absolute -bottom-2.5 right-1 z-20 flex gap-0.5 items-center`}>
            {hasReactions && (
              <ReactionBadges reactions={message.reactions} onReact={onReact} messageId={message.id} />
            )}
            {onReact && <ReactionAddButton messageId={message.id} isUser={isUser} onReact={onReact} />}
          </div>
        )}
      </div>

      {time && (
        <span className={`text-[10px] text-muted-foreground mt-1 ${isUser ? "mr-2" : "ml-2"}`}>{time}</span>
      )}
      
      {voiceError && !isUser && (
        <span className="text-[10px] text-red-400 mt-1 ml-2">Voice error: {voiceError}</span>
      )}

      {/* Forward button */}
      {!isNarrative && onForward && (
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          onClick={(e) => { e.stopPropagation(); onForward(message); }}
          className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-card border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
          title="Forward message"
        >
          <Forward className="w-3.5 h-3.5" />
        </motion.button>
      )}

      {/* Voice button */}
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