import React, { useState } from "react";
import { X, Play, AlertTriangle, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sanitizeVideoInput } from "@/lib/videoEmbedSanitizer";

/**
 * WatchVideoPanel
 *
 * Renders inside the Scene media area when the user activates Watch Video mode.
 * Accepts a URL or iframe embed code, sanitizes it (extracts safe src only),
 * and renders either an <iframe> (YouTube/Vimeo/Dailymotion) or a <video>
 * (direct MP4/WebM). The URL is NEVER persisted to a database or entity —
 * it lives only in local component state for the current viewing session.
 *
 * Props:
 *   onClose  — exits Watch Video mode, returns media area to scene image
 *   onStarted — optional callback when a valid video begins playing
 *                 (used to add a lightweight scene activity entry)
 *   onStopped — optional callback when the user closes the panel
 */
export default function WatchVideoPanel({ onClose, onStarted, onStopped }) {
  const [rawInput, setRawInput] = useState("");
  const [sanitized, setSanitized] = useState(null); // { valid, provider, embedUrl, type }
  const [error, setError] = useState(null);
  const [title, setTitle] = useState("");
  const [videoType, setVideoType] = useState("");

  const handleLoad = () => {
    const result = sanitizeVideoInput(rawInput);
    if (!result.valid) {
      setError(result.error);
      setSanitized(null);
      return;
    }
    setError(null);
    setSanitized(result);
    if (onStarted) {
      onStarted({
        provider: result.provider,
        title: title.trim() || null,
        videoType: videoType.trim() || null,
      });
    }
  };

  const handleClose = () => {
    setSanitized(null);
    setRawInput("");
    setTitle("");
    setVideoType("");
    setError(null);
    if (onStopped) onStopped();
    onClose();
  };

  return (
    <div className="w-full h-full bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/90 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-2 text-white">
          <Tv className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium">Watch Party</span>
        </div>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          title="Close Watch Video"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Input form — shown until a valid video is loaded */}
      {!sanitized && (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="text-center space-y-1">
            <p className="text-sm text-white/90 font-medium">Watch something together</p>
            <p className="text-[11px] text-white/50">
              Paste a link from YouTube, Vimeo, Dailymotion, Internet Archive, X, Instagram, Facebook, TikTok, Twitch, Wistia, Brightcove, Loom, Vidyard, Kaltura, Cloudflare Stream, Bunny Stream, Spotify, SoundCloud, or Mixcloud — or a direct HTTPS MP4/WebM link.
              The link is not saved permanently.
            </p>
          </div>

          <input
            type="url"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="Paste a YouTube, Vimeo, X, Instagram, or Facebook video link…"
            className="w-full px-3 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-primary"
          />

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title / label (optional)"
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-500 focus:outline-none focus:border-primary"
            />
            <input
              type="text"
              value={videoType}
              onChange={(e) => setVideoType(e.target.value)}
              placeholder="Type: movie, game, tutorial…"
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-white text-xs placeholder:text-zinc-500 focus:outline-none focus:border-primary"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          <Button
            onClick={handleLoad}
            disabled={!rawInput.trim()}
            className="w-full rounded-xl"
            size="sm"
          >
            <Play className="w-4 h-4 mr-1.5" />
            Start Watching
          </Button>

          <p className="text-[10px] text-white/40 text-center leading-relaxed">
            Characters can see you're watching together but cannot see the video
            content. They'll react to the shared activity, not unseen scenes.
          </p>
        </div>
      )}

      {/* Video player — iframe for providers, video tag for direct media */}
      {sanitized && (
        <div className="flex-1 relative">
          {sanitized.type === "iframe" ? (
            <iframe
              src={sanitized.embedUrl}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              title="Watch party video"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <video
              src={sanitized.embedUrl}
              className="w-full h-full"
              controls
              playsInline
            />
          )}
        </div>
      )}
    </div>
  );
}