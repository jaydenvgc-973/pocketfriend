import React, { useState, useEffect } from "react";
import { X, Play, AlertTriangle, Tv, Loader2, Video, Square, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeVideoInput } from "@/lib/videoEmbedSanitizer";

/**
 * GatheringRoomWatchParty
 *
 * Reuses the EXACT Scenes video path:
 *   - same sanitizeVideoInput sanitizer (all providers, same acceptance rules)
 *   - same player rendering: <iframe> for iframe-type, <video> for direct media
 *   - same allow/referrerPolicy attributes as WatchVideoPanel
 *
 * Two distinct authorities:
 *   1. SHARED room media state — stored on GatheringRoom.active_media, propagated
 *      via realtime subscription on the GatheringRoom entity. This is "what is
 *      available to watch together in this room." Shared by all valid occupants.
 *   2. LOCAL viewing state — `isWatching` boolean in this component. Controls
 *      whether the player is open on THIS user's screen. Local to this user.
 *
 * Closing the player locally (isWatching = false) does NOT clear shared media.
 * Stopping the watch party (onStopWatchParty) clears shared media for everyone.
 *
 * No polling — all updates are driven by the `room` prop which comes from the
 * realtime subscription on the GatheringRoom entity.
 */
export default function GatheringRoomWatchParty({
  room,
  isInRoom,
  showInputPanel,
  onCloseInputPanel,
  onStartWatchParty,
  onStopWatchParty,
}) {
  const [isWatching, setIsWatching] = useState(false);
  const [rawInput, setRawInput] = useState("");
  const [title, setTitle] = useState("");
  const [videoType, setVideoType] = useState("");
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);

  const activeMedia = room?.active_media;
  const hasActiveVideo = activeMedia && activeMedia.media_type === "video" && activeMedia.url;
  const sceneImage = room?.scene_image_url || room?.image_url;

  // Reset local watching state when shared media is cleared by anyone.
  // This is event-driven (room prop changes via realtime subscription), not polling.
  useEffect(() => {
    if (!hasActiveVideo) setIsWatching(false);
  }, [hasActiveVideo]);

  // ── Start a watch party ── same sanitizer + same provider handling as Scenes ──
  const handleStart = async () => {
    const result = sanitizeVideoInput(rawInput);
    if (!result.valid) {
      setError(result.error);
      return;
    }
    setError(null);
    setIsStarting(true);
    try {
      await onStartWatchParty({
        url: result.embedUrl,
        title: title.trim() || null,
        embed_type: result.type,
        provider: result.provider,
        video_type: videoType.trim() || null,
      });
      setIsWatching(true); // starter auto-joins the watch party
      setRawInput("");
      setTitle("");
      setVideoType("");
      onCloseInputPanel();
    } catch (err) {
      setError("Failed to start watch party");
    }
    setIsStarting(false);
  };

  const handleCloseInput = () => {
    setRawInput("");
    setTitle("");
    setVideoType("");
    setError(null);
    onCloseInputPanel();
  };

  return (
    <>
      {/* ── Scene area ── */}
      <div className="pt-14">
        <div className="relative w-full h-48 sm:h-64 overflow-hidden bg-black">
          {/* Input panel — same form fields and sanitizer as WatchVideoPanel */}
          {showInputPanel && (
            <div className="absolute inset-0 z-20 bg-black flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 bg-black/90 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2 text-white">
                  <Tv className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium">Watch Party</span>
                </div>
                <button onClick={handleCloseInput} className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                <div className="text-center space-y-1">
                  <p className="text-sm text-white/90 font-medium">Watch something together</p>
                  <p className="text-[11px] text-white/50">
                    Paste any publicly accessible video link — YouTube, Vimeo, news articles with embedded video, or direct MP4/WebM. Everyone in the room can choose to watch.
                  </p>
                </div>
                <input type="url" value={rawInput} onChange={(e) => setRawInput(e.target.value)}
                  placeholder="Paste any public video link…"
                  className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary" />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title / label (optional)"
                    className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-500 focus:outline-none focus:border-primary" />
                  <input type="text" value={videoType} onChange={(e) => setVideoType(e.target.value)}
                    placeholder="Type: movie, game, tutorial…"
                    className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-500 focus:outline-none focus:border-primary" />
                </div>
                {error && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300">{error}</p>
                  </div>
                )}
                <Button onClick={handleStart} disabled={!rawInput.trim() || isStarting} className="w-full rounded-xl" size="sm">
                  {isStarting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Starting…</> : <><Play className="w-4 h-4 mr-1.5" /> Start Watching</>}
                </Button>
              </div>
            </div>
          )}

          {/* Player — EXACT same rendering as WatchVideoPanel: iframe for iframe-type, video for direct media */}
          {hasActiveVideo && isWatching && !showInputPanel && (
            <div className="absolute inset-0">
              {activeMedia.embed_type === "iframe" ? (
                <iframe
                  src={activeMedia.url}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  title="Watch party"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : (
                <video
                  src={activeMedia.url}
                  className="w-full h-full"
                  controls
                  playsInline
                />
              )}
              {/* Local close button — does NOT stop the room watch party */}
              <button
                onClick={() => setIsWatching(false)}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 text-white/80 hover:text-white hover:bg-black/90 transition-colors z-10"
                title="Close player (room watch party stays active)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Scene image — shown when no video, or when video is active but user chose not to watch */}
          {(!hasActiveVideo || !isWatching) && !showInputPanel && (
            <>
              {sceneImage ? (
                <img src={sceneImage} alt={room?.name || ""} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-primary/20 via-secondary to-background flex items-center justify-center">
                  <Tv className="w-12 h-12 text-muted-foreground/40" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />

              {/* "Watch" button overlay — when shared media is active but this user isn't watching */}
              {hasActiveVideo && !isWatching && (
                <button
                  onClick={() => setIsWatching(true)}
                  className="absolute inset-0 flex items-center justify-center group"
                >
                  <div className="flex flex-col items-center gap-2 bg-black/60 backdrop-blur-sm rounded-2xl px-6 py-4 group-hover:bg-black/70 transition-colors">
                    <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
                      <Play className="w-6 h-6 text-primary-foreground" fill="currentColor" />
                    </div>
                    <p className="text-sm text-white font-medium">{activeMedia.title || "Watch Party"}</p>
                    <p className="text-[10px] text-white/60">Tap to watch together</p>
                  </div>
                </button>
              )}

              {room?.description && !hasActiveVideo && (
                <p className="absolute bottom-2 left-4 right-4 text-xs text-foreground/70 line-clamp-2">{room.description}</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Active media bar — shared room media state ── */}
      {hasActiveVideo && (
        <div className="px-4 py-2 bg-secondary/50 border-b border-border flex items-center gap-2">
          <Video className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{activeMedia.title || "Watch Party"}</p>
            <p className="text-[10px] text-muted-foreground">
              Started by {activeMedia.started_by_participant_name}
              {isWatching ? " · You're watching" : " · Available to watch"}
            </p>
          </div>
          {/* Local viewing toggle — independent per user */}
          {isInRoom && (
            <button
              onClick={() => setIsWatching(w => !w)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
              title={isWatching ? "Close player" : "Watch"}
            >
              {isWatching ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}
          {/* Stop Watch Party — shared action, clears media for everyone */}
          {isInRoom && (
            <button
              onClick={onStopWatchParty}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Stop watch party for everyone"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </>
  );
}