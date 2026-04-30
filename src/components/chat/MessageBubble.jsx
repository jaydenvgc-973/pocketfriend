import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, Volume2, ImageIcon, Loader2, RefreshCw, Trash2, Sparkles, Forward, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { filterDashes } from "@/lib/dashFilter";
import RegenerateImageModal from "@/components/chat/RegenerateImageModal";
import MusicPreviewPlayer from "@/components/chat/MusicPreviewPlayer";
import VideoPreviewCard from "@/components/chat/VideoPreviewCard";

const emotionalColors = {
  calm: "bg-secondary",
  irritated: "bg-orange-950/40",
  defensive: "bg-red-950/30",
  reflective: "bg-blue-950/30",
  "closed-off": "bg-zinc-900"
};

export default function MessageBubble({ message, showName = false, onReact, onDelete, onDeleteImage, onPlayVoice, isPlayingVoice, voiceError, onForward, onImageLoaded, onLocationSignal }) {
  const isUser = message.sender_type === "user";
  const isNarrative = message.is_narrative;
  const playingAsLabel = isUser && message.played_as_character_name ? message.played_as_character_name : null;
  const bgColor = isUser ? "bg-primary" : (emotionalColors[message.emotional_state] || "bg-secondary");
  const time = message.timestamp ? format(new Date(message.timestamp), "h:mm a") : "";
  const hasReactions = message.reactions?.length > 0;
  const [showDelete, setShowDelete] = useState(false);
  const [showImageDelete, setShowImageDelete] = useState(false);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [imageRetryFailed, setImageRetryFailed] = useState(false);
  const [imageRetryStatus, setImageRetryStatus] = useState('idle'); // idle | recovering | regenerating | failed
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  // Local image URL — updated immediately from retry response, no subscription wait needed
  const [localImageUrl, setLocalImageUrl] = useState(message.image_url || null);

  // Sync if parent passes a new image_url (e.g. from real-time subscription)
  const prevImageUrl = message.image_url;
  if (prevImageUrl && prevImageUrl !== localImageUrl) {
    setLocalImageUrl(prevImageUrl);
  }

  // Placeholder: no image yet (content is empty = still generating, or [IMAGE_FAILED] = generation failed)
  const isImageFailed = !isUser && !isNarrative && !localImageUrl && message.content === '[IMAGE_FAILED]';
  const isImagePlaceholder = !isUser && !isNarrative && !localImageUrl && (message.content === "" || isImageFailed);

  const handleImageRetry = async (forceRegenerate = false) => {
    setImageRetrying(true);
    setImageRetryFailed(false);
    setImageRetryStatus(forceRegenerate ? 'regenerating' : 'recovering');
    try {
      const res = await base44.functions.invoke('recoverSingleImage', { messageId: message.id, forceRegenerate });
      // Immediately hydrate from the response — do NOT wait for subscription
      const url = res?.data?.image_url;
      if (url && url.startsWith('http')) {
        console.log(`[MessageBubble] ✓ Image URL received from retry: ${url.substring(0, 60)}...`);
        setLocalImageUrl(url);
        // Also notify parent so its messages array stays in sync
        onImageLoaded?.(message.id, url);
      } else {
        console.warn(`[MessageBubble] ✗ Retry returned no valid URL:`, res?.data);
        setImageRetryFailed(true);
      }
    } catch (err) {
      console.error(`[MessageBubble] ✗ Retry failed:`, err.message);
      setImageRetryFailed(true);
    } finally {
      setImageRetrying(false);
      setImageRetryStatus('idle');
    }
  };

  const handleEditPromptOpen = (e) => {
    e.stopPropagation();
    setEditedPrompt(message.generation_context?.prompt || '');
    setShowPromptEditor(true);
  };

  const handleRegenerateWithEditedPrompt = async (e) => {
    e.stopPropagation();
    setIsRegenerating(true);
    setImageRetrying(true);
    setImageRetryStatus('regenerating');
    try {
      const res = await base44.functions.invoke('regenerateImageWithReason', {
        messageId: message.id,
        reason: 'custom',
        customPrompt: editedPrompt,
      });
      const url = res?.data?.image_url;
      if (url && url.startsWith('http')) {
        setLocalImageUrl(url);
        onImageLoaded?.(message.id, url);
        setShowPromptEditor(false);
        setImageRetryFailed(false);
      } else {
        setImageRetryFailed(true);
      }
    } catch (err) {
      setImageRetryFailed(true);
    } finally {
      setIsRegenerating(false);
      setImageRetrying(false);
      setImageRetryStatus('idle');
    }
  };

  const handleRegenSelect = async (reason, customPrompt, manualLocationId = null, manualZoneId = null, directLocationImages = null, directLocationName = null) => {
    // HARD VALIDATION: wrong_location reason MUST have a locationId
    if (reason === 'wrong_location' && !manualLocationId) {
      setRegenError('Please select a location to regenerate');
      setIsRegenerating(false);
      return;
    }
    
    setIsRegenerating(true);
    setRegenError(null);
    try {
      const res = await base44.functions.invoke('regenerateImageWithReason', {
        messageId: message.id, reason, customPrompt, manualLocationId, manualZoneId,
        directLocationImages: directLocationImages || null,
        directZoneName: manualZoneId || null,
        directLocationName: directLocationName || null,
      });
      if (res?.data?.success === false) {
        setRegenError(res.data.error || 'Failed to regenerate. Please try again.');
        return;
      }
      if (res?.data?.filtered) {
        setRegenError(res.data.error || 'Image was blocked by content filter. Try a different description.');
        return;
      }
      // Success — hydrate local state and close modal
      const returnedUrl = res?.data?.image_url;
      const returnedMsgId = res?.data?.messageId;
      if (returnedUrl && returnedUrl.startsWith('http')) {
        if (returnedMsgId && returnedMsgId !== message.id) {
          console.error(`[MessageBubble] ⛔ REGEN LINEAGE MISMATCH: requested=${message.id} got=${returnedMsgId}`);
        } else {
          setLocalImageUrl(returnedUrl);
          onImageLoaded?.(message.id, returnedUrl);
        }
      }
      setShowRegenModal(false);
    } catch (err) {
      setRegenError(err.message || 'Failed to regenerate. Please try again.');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2 ${isNarrative ? "justify-center" : isUser ? "justify-end" : "justify-start"} px-4 mb-1`}
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
        <div className="group relative" onClick={() => !isNarrative && setShowDelete(!showDelete)} onKeyDown={() => {}}>
          {/* Narrative delete button — shown on hover */}
          {isNarrative && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(message.id); }}
              className="absolute -right-7 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 z-50"
              title="Remove narrative"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <div className={`${isNarrative ? "bg-transparent text-muted-foreground italic text-center py-3" : `${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}`}>
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
                    {showPromptEditor ? (
                      <div className="w-full mt-1 flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                        <textarea
                          value={editedPrompt}
                          onChange={e => setEditedPrompt(e.target.value)}
                          className="w-full text-[11px] text-foreground bg-background border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
                          rows={4}
                          placeholder="Edit prompt before regenerating..."
                        />
                        <button
                          onClick={handleRegenerateWithEditedPrompt}
                          disabled={isRegenerating || !editedPrompt.trim()}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full disabled:opacity-50"
                        >
                          {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setShowPromptEditor(false); }}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors text-center"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5 mt-1 w-full">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleImageRetry(true); }}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full"
                        >
                          <RefreshCw className="w-3 h-3" /> Regenerate Image
                        </button>
                        <button
                          onClick={handleEditPromptOpen}
                          className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-xs hover:text-foreground transition-colors w-full"
                        >
                          <Sparkles className="w-3 h-3" /> Edit Prompt
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
                    )}
                  </>
                ) : (
                  <>
                    <ImageIcon className={`w-7 h-7 ${isImageFailed ? "text-destructive/40" : "text-muted-foreground/50"}`} />
                    <p className="text-xs text-muted-foreground text-center">
                      {isImageFailed ? "Photo failed to load" : "Photo incoming"}
                    </p>
                    {showPromptEditor ? (
                      <div className="w-full mt-1 flex flex-col gap-1.5" onClick={e => e.stopPropagation()}>
                        <textarea
                          value={editedPrompt}
                          onChange={e => setEditedPrompt(e.target.value)}
                          className="w-full text-[11px] text-foreground bg-background border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
                          rows={4}
                          placeholder="Edit prompt before regenerating..."
                        />
                        <button
                          onClick={handleRegenerateWithEditedPrompt}
                          disabled={isRegenerating || !editedPrompt.trim()}
                          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors w-full disabled:opacity-50"
                        >
                          {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Regenerate
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setShowPromptEditor(false); }}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors text-center"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
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
                        <button
                          onClick={handleEditPromptOpen}
                          className="flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-secondary border border-border text-muted-foreground text-xs hover:text-foreground transition-colors w-full"
                        >
                          <Sparkles className="w-3 h-3" /> Edit Prompt
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {localImageUrl && (
              <div
                className="relative group/image"
                onMouseEnter={() => setShowImageDelete(true)}
                onMouseLeave={() => setShowImageDelete(false)}
                onClick={() => !isUser && message.generation_context?.location_id && onLocationSignal?.(message.generation_context.location_id, message.character_id)}
              >
                <img
                  src={localImageUrl}
                  alt="shared photo"
                  className={`w-full max-w-xs rounded-t-2xl object-cover ${!isUser && message.generation_context?.location_id ? "cursor-pointer hover:brightness-90 transition-all" : ""}`}
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
                {!isUser && message.generation_context?.location_id && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 rounded-b-2xl opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-white flex-shrink-0" />
                    <span className="text-xs text-white truncate">{message.generation_context?.location_name || 'Click to signal location'}</span>
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
            {message.content && typeof message.content === 'string' && message.content.trim() && message.content !== '[IMAGE_FAILED]' && (
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

          {/* Reactions + location signal + add button — anchored to bottom corner */}
          {!isNarrative && !isUser && (
            <div className={`absolute -bottom-2.5 right-1 z-20 flex gap-0.5 items-center`}>
              {hasReactions && (
                <ReactionBadges reactions={message.reactions} onReact={onReact} messageId={message.id} />
              )}
              {onLocationSignal && (message.content || localImageUrl) && (
                <LocationSignalButton message={message} onLocationSignal={onLocationSignal} isImageOnly={!message.content && localImageUrl} />
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
      </div>

      {/* Forward button — visible on all non-narrative messages */}
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

      {/* Voice button outside bubble on the right - visible on all character messages */}
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

function LocationSignalButton({ message, onLocationSignal, isImageOnly = false }) {
  const [open, setOpen] = useState(false);
  const [signaling, setSignaling] = useState(false);
  const [done, setDone] = useState(false);

  const handleSignal = async () => {
    setSignaling(true);
    // For image-only messages, use the location ID from generation context; otherwise use the text content
    const signalData = isImageOnly && message.generation_context?.location_id
      ? message.generation_context.location_id
      : message.content;
    await onLocationSignal(signalData, message.character_id);
    setSignaling(false);
    setDone(true);
    setOpen(false);
    setTimeout(() => setDone(false), 3000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`opacity-0 group-hover:opacity-100 transition-opacity bg-card border rounded-full w-5 h-5 flex items-center justify-center shadow-md ${done ? "border-primary text-primary opacity-100" : "border-border text-muted-foreground hover:text-primary hover:border-primary"}`}
        title="Signal location from this message"
      >
        <MapPin className="w-2.5 h-2.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0, y: 4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.85, opacity: 0, y: 4 }}
            className="absolute bottom-6 right-0 z-50 bg-card border border-border rounded-2xl px-3 py-2.5 shadow-xl w-52"
          >
            <p className="text-xs font-semibold text-foreground mb-1">📍 Signal Location</p>
            <p className="text-[10px] text-muted-foreground mb-2 leading-relaxed">
              {isImageOnly ? `Update where this character is based on the photo location (${message.generation_context?.location_name || 'detected location'}).` : 'Update where this character is based on what they said in this message.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:bg-secondary/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSignal}
                disabled={signaling}
                className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {signaling ? "Updating..." : "Apply"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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