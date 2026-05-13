import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { X, Volume2, ImageIcon, Loader2, RefreshCw, Trash2, Sparkles, Forward, MapPin, Pencil, Check } from "lucide-react";
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
  const [isEditingNarrative, setIsEditingNarrative] = useState(false);
  const [editedNarrative, setEditedNarrative] = useState(message.content || "");
  const [isSavingNarrative, setIsSavingNarrative] = useState(false);
  const [showImageDelete, setShowImageDelete] = useState(false);
  const [imageRetrying, setImageRetrying] = useState(false);
  const [imageRetryFailed, setImageRetryFailed] = useState(false);
  const [imageRetryStatus, setImageRetryStatus] = useState('idle'); // idle | recovering | regenerating | failed
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenError, setRegenError] = useState(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [imgLoadError, setImgLoadError] = useState(false);
  // Normalize image URL to public CDN on initialization
  const normalizeImageUrl = (url) => {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('https://media.base44.com/')) return url;
    const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
    if (match) return `https://media.base44.com/images/public/${match[1]}`;
    return url;
  };

  // Local image URL — updated immediately from retry response, no subscription wait needed
  const [localImageUrl, setLocalImageUrl] = useState(message.image_url ? normalizeImageUrl(message.image_url) : null);
  // Track retry count for force-reloading the same URL (cache-bust on imgLoadError)
  const [imgRetryKey, setImgRetryKey] = useState(0);
  // After AUTO_LOAD_TIMEOUT_MS with no image_url arriving, promote to actionable failure card
  const AUTO_LOAD_TIMEOUT_MS = 90000; // 90s — generous window for backend generation
  const [autoLoadExpired, setAutoLoadExpired] = useState(false);

  // Sync if parent passes a new image_url (e.g. from real-time subscription)
  const prevImageUrl = message.image_url;
  const normalizedPrev = prevImageUrl ? normalizeImageUrl(prevImageUrl) : null;
  if (normalizedPrev && normalizedPrev !== localImageUrl) {
    setLocalImageUrl(normalizedPrev);
    setImgLoadError(false);
    setImgRetryKey(0);
  }

  // Auto-load: if message has no image yet and content is "" (actively generating),
  // silently wait for the subscription to push the URL. After timeout, escalate to recovery.
  const isWaitingForGeneration = !isUser && !message.is_narrative && !message.location_share && !localImageUrl && message.content === "" && !autoLoadExpired && !imageRetrying;

  // Start the expiry timer only while actively waiting
  useEffect(() => {
    if (!isWaitingForGeneration) return;
    const t = setTimeout(() => {
      // Before expiring: make one automatic recovery attempt
      setAutoLoadExpired(true);
      setImageRetrying(true);
      setImageRetryStatus('recovering');
      base44.functions.invoke('recoverSingleImage', { messageId: message.id, forceRegenerate: false })
        .then(res => {
          const url = res?.data?.image_url;
          if (url && url.startsWith('http')) {
            setLocalImageUrl(url);
            setImgLoadError(false);
            onImageLoaded?.(message.id, url);
          } else {
            setImageRetryFailed(true);
          }
        })
        .catch(() => setImageRetryFailed(true))
        .finally(() => { setImageRetrying(false); setImageRetryStatus('idle'); });
    }, AUTO_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [isWaitingForGeneration, message.id]); // eslint-disable-line

  // Placeholder: no image yet (content is empty = still generating, or [IMAGE_FAILED] = generation failed)
  // Also covers imgLoadError: URL exists but the image itself failed to render in the browser
  // Exclude location_share messages — they have empty content but are not image placeholders
  const isLocationShare = !!message.location_share;
  const isImageFailed = !isUser && !isNarrative && !isLocationShare && ((!localImageUrl && message.content === '[IMAGE_FAILED]') || imgLoadError);
  // isImagePlaceholder = show the placeholder card (spinner or action buttons)
  // Do NOT show if we're passively waiting for generation (isWaitingForGeneration handles that separately)
  const isImagePlaceholder = !isUser && !isNarrative && !isLocationShare && !isWaitingForGeneration && ((!localImageUrl && (message.content === "" || message.content === '[IMAGE_FAILED]')) || imgLoadError);

  const handleImageRetry = async (forceRegenerate = false) => {
    // If the URL already exists but just failed to load in the browser (imgLoadError),
    // attempt a simple browser-side reload first before hitting the backend.
    // This handles transient network failures, CDN hiccups, and stale cache without
    // burning a backend generation credit.
    if (!forceRegenerate && localImageUrl && imgLoadError) {
      console.log(`[MessageBubble] imgLoadError with existing URL — attempting browser reload: ${localImageUrl.substring(0, 60)}...`);
      setImgLoadError(false);
      setImgRetryKey(k => k + 1); // cache-busts the img src key — forces React to remount the <img>
      return;
    }

    setImageRetrying(true);
    setImageRetryFailed(false);
    setImageRetryStatus(forceRegenerate ? 'regenerating' : 'recovering');
    try {
      const res = await base44.functions.invoke('recoverSingleImage', { messageId: message.id, forceRegenerate });
      // Immediately hydrate from the response — do NOT wait for subscription
      const url = res?.data?.image_url;
      if (url && url.startsWith('http')) {
        console.log(`[MessageBubble] ✓ Image URL received from retry: ${url.substring(0, 60)}...`);
        setLocalImageUrl(normalizeImageUrl(url));
        setImgLoadError(false);
        setImgRetryKey(0);
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

  const handleSaveNarrative = async () => {
    if (!editedNarrative.trim()) return;
    setIsSavingNarrative(true);
    try {
      await base44.entities.Message.update(message.id, { content: editedNarrative.trim() });
      setIsEditingNarrative(false);
    } catch (err) {
      console.error('[MessageBubble] Failed to save narrative:', err.message);
    } finally {
      setIsSavingNarrative(false);
    }
  };

  const handleEditPromptOpen = (e) => {
    e.stopPropagation();
    // Use stored prompt if available, otherwise build a basic fallback from context
    const storedPrompt = message.generation_context?.prompt;
    const fallbackPrompt = storedPrompt || [
      message.generation_context?.character_id ? `Photo of ${message.character_name || 'the character'}` : '',
      message.generation_context?.location_name ? `at ${message.generation_context.location_name}` : '',
      message.generation_context?.zone_name ? `in the ${message.generation_context.zone_name}` : '',
    ].filter(Boolean).join(', ');
    setEditedPrompt(fallbackPrompt);
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
        setLocalImageUrl(normalizeImageUrl(url));
        setImgLoadError(false);
        setImgRetryKey(0);
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
      if (res?.data?.filtered) {
        // Only shown when provider actually returned a content policy block
        setRegenError(res.data.error || 'Content policy block — try a different scene description.');
        return;
      }
      if (res?.data?.success === false) {
        // Accurate error from backend — display as-is, not re-labeled
        setRegenError(res.data.error || 'Regeneration failed. Please try again.');
        return;
      }
      // Success — hydrate local state and close modal
      const returnedUrl = res?.data?.image_url;
      const returnedMsgId = res?.data?.messageId;
      if (returnedUrl && returnedUrl.startsWith('http')) {
        if (returnedMsgId && returnedMsgId !== message.id) {
          console.error(`[MessageBubble] ⛔ REGEN LINEAGE MISMATCH: requested=${message.id} got=${returnedMsgId}`);
        } else {
          setLocalImageUrl(normalizeImageUrl(returnedUrl));
          setImgLoadError(false);
          setImgRetryKey(0);
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
          {/* Narrative action buttons — shown on hover */}
          {isNarrative && !isEditingNarrative && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setEditedNarrative(message.content || ""); setIsEditingNarrative(true); }}
                className="absolute -left-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-50 p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-primary hover:border-primary/40"
                title="Edit narrative"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(message.id); }}
                  className="absolute -right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-50 p-1.5 rounded-full bg-card border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                  title="Remove narrative"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
          <div className={`${isNarrative ? "bg-transparent text-muted-foreground italic text-center py-3" : `${bgColor} ${isUser ? "rounded-2xl rounded-br-sm text-primary-foreground" : "rounded-2xl rounded-bl-sm text-foreground"} overflow-hidden`}`}>
            {/* Narrative inline edit mode */}
            {isNarrative && isEditingNarrative && (
              <div className="flex flex-col gap-2 px-2" onClick={e => e.stopPropagation()}>
                <textarea
                  value={editedNarrative}
                  onChange={e => setEditedNarrative(e.target.value)}
                  className="w-full text-sm text-foreground bg-background border border-border rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-primary min-h-[80px]"
                  autoFocus
                />
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setIsEditingNarrative(false)}
                    className="px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground text-xs hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveNarrative}
                    disabled={isSavingNarrative || !editedNarrative.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {isSavingNarrative ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </button>
                </div>
              </div>
            )}
            {/* Passive loading state: image is actively being generated — no action required */}
            {isWaitingForGeneration && (
              <div className="w-48 flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/30 bg-secondary/40 p-4 py-5">
                <Loader2 className="w-7 h-7 text-primary/50 animate-spin" />
                <p className="text-xs text-muted-foreground/70 text-center">Photo on the way…</p>
              </div>
            )}
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
                  key={`img-${message.id}-${imgRetryKey}`}
                  src={localImageUrl}
                  alt="shared photo"
                  onError={() => {
                    console.warn(`[MessageBubble] Image load error (attempt ${imgRetryKey + 1}): ${localImageUrl?.substring(0, 80)}`);
                    setImgLoadError(true);
                  }}
                  className={`w-full max-w-xs rounded-t-2xl object-cover ${!isUser && message.generation_context?.location_id ? "cursor-pointer hover:brightness-90 transition-all" : ""}`}
                />
                {showImageDelete && (
                  <div className="absolute inset-0 bg-black/40 rounded-t-2xl flex items-center justify-center gap-2">
                    {/* Show regenerate for character-sent images OR any app-generated image (has generation_context).
                        User-sent Media Grid images have generation_context and must also support regeneration. */}
                    {(!isUser || message.generation_context) && (
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
                {/* Image location label — always visible when location data exists, from the image's own generation context */}
                {!isUser && (message.generation_context?.location_name || message.generation_context?.location_id) && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 rounded-b-2xl flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-white flex-shrink-0" />
                    <span className="text-xs text-white truncate">{message.generation_context?.location_name || 'Location'}</span>
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
            {!isEditingNarrative && message.content && typeof message.content === 'string' && message.content.trim() && message.content !== '[IMAGE_FAILED]' && (
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
            {/* Location Share Card */}
            {message.location_share && (
              <LocationShareCard
                locationShare={message.location_share}
                characterName={message.character_name}
                onLocationSignal={onLocationSignal}
                characterId={message.character_id}
              />
            )}
            {/* Money Transfer Card */}
            {message.money_transfer && (
              <MoneyTransferCard transfer={message.money_transfer} />
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

const PRESENCE_LABELS = {
  at_work: "At Work",
  home: "At Home",
  visiting: "Visiting",
  traveling: "Traveling",
  at_school: "At School",
  sleeping: "Sleeping",
  napping: "Resting",
  temporary_housing: "Staying Here",
  under_supervision: "Here",
};

const CATEGORY_ICONS = {
  home: "🏠",
  workplace: "🏢",
  gym: "💪",
  social: "🎉",
  outdoor: "🌳",
  food_drink: "🍽️",
  medical: "🏥",
  education: "📚",
  school: "🎓",
  grocery: "🛒",
  religion: "⛪",
  government: "🏛️",
  hotel: "🏨",
  shelter: "🏠",
  generic: "📍",
};

function LocationShareCard({ locationShare, characterName, onLocationSignal, characterId }) {
  const locationName = locationShare.location_name || "Unknown Location";
  const presenceLabel = PRESENCE_LABELS[locationShare.presence_status] || "Here";
  const categoryIcon = CATEGORY_ICONS[locationShare.location_category] || "📍";
  const timeLabel = locationShare.timestamp
    ? format(new Date(locationShare.timestamp), "h:mm a")
    : null;
  const avatarUrl = locationShare.character_avatar_url;

  const handleTap = (e) => {
    e.stopPropagation();
    if (locationShare.location_id && onLocationSignal) {
      onLocationSignal(locationShare.location_id, characterId);
    }
  };

  return (
    <div
      className="mx-2 my-2 rounded-2xl overflow-hidden border border-primary/20 bg-card shadow-lg cursor-pointer active:scale-[0.98] transition-transform"
      onClick={handleTap}
      style={{ minWidth: 240, maxWidth: 280 }}
    >
      {/* Map-style header */}
      <div className="relative h-20 bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 overflow-hidden flex items-center justify-center">
        {/* Faux map grid lines */}
        <div className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: "linear-gradient(hsl(var(--primary)/0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.3) 1px, transparent 1px)",
            backgroundSize: "20px 20px"
          }}
        />
        {/* Pulse ring */}
        <div className="absolute w-16 h-16 rounded-full bg-primary/20 animate-ping" style={{ animationDuration: "2.5s" }} />
        <div className="absolute w-10 h-10 rounded-full bg-primary/30" />
        {/* Avatar pin */}
        <div className="relative z-10 flex flex-col items-center">
          <div className="w-11 h-11 rounded-full border-[3px] border-primary shadow-lg overflow-hidden bg-secondary">
            {avatarUrl ? (
              <img src={avatarUrl} alt={characterName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-lg font-bold text-primary">
                {characterName?.[0]?.toUpperCase() || "?"}
              </div>
            )}
          </div>
          {/* Pin point */}
          <div className="w-2 h-2 rounded-full bg-primary shadow-md -mt-0.5" />
        </div>
        {/* Category icon top right */}
        <div className="absolute top-2 right-2 text-lg">{categoryIcon}</div>
      </div>

      {/* Info section */}
      <div className="px-3 pt-2.5 pb-2 bg-card">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-primary uppercase tracking-wide leading-none mb-1">{presenceLabel}</p>
            <p className="text-sm font-bold text-foreground leading-tight truncate">{locationName}</p>
            {locationShare.note && (
              <p className="text-xs text-muted-foreground italic mt-0.5 leading-snug">{locationShare.note}</p>
            )}
          </div>
          <MapPin className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        </div>
        {timeLabel && (
          <p className="text-[10px] text-muted-foreground mt-1.5">Since {timeLabel}</p>
        )}
      </div>
    </div>
  );
}

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

function MoneyTransferCard({ transfer }) {
  const amountStr = `$${Number(transfer.amount ?? 0).toLocaleString()}`;
  return (
    <div className="mx-2 my-2 rounded-2xl overflow-hidden border border-emerald-500/30 bg-card shadow-lg" style={{ minWidth: 200, maxWidth: 260 }}>
      <div className="h-16 bg-gradient-to-br from-emerald-950 via-green-900 to-teal-900 flex items-center justify-center relative">
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, hsl(var(--primary)/0.3) 0, hsl(var(--primary)/0.3) 1px, transparent 0, transparent 50%)",
            backgroundSize: "10px 10px"
          }}
        />
        <span className="relative z-10 text-3xl font-bold text-emerald-300">{amountStr}</span>
      </div>
      <div className="px-3 py-2.5 bg-card">
        <p className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide leading-none mb-1">Sent to {transfer.recipient_name}</p>
        {transfer.reason && <p className="text-xs text-muted-foreground italic mt-0.5 leading-snug">{transfer.reason}</p>}
        <p className="text-[10px] text-muted-foreground mt-1">{transfer.timestamp ? format(new Date(transfer.timestamp), "h:mm a") : "Now"}</p>
      </div>
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