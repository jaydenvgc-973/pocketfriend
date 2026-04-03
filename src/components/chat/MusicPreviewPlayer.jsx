import { useState } from "react";
import { Play, Pause, Volume2, Music, ExternalLink } from "lucide-react";

const PLATFORM_COLORS = {
  spotify: "bg-green-500",
  apple: "bg-gray-900",
  youtube: "bg-red-500",
  tidal: "bg-cyan-500",
  soundcloud: "bg-orange-500",
  bandcamp: "bg-blue-600",
  amazon: "bg-orange-400",
};

const PLATFORM_ICONS = {
  spotify: "🎵",
  apple: "🍎",
  youtube: "▶️",
  tidal: "🌊",
  soundcloud: "☁️",
  bandcamp: "🎸",
  amazon: "🔶",
};

export default function MusicPreviewPlayer({ song, platform = "spotify" }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioElement] = useState(() => {
    if (typeof window !== "undefined" && song?.preview_url) {
      const audio = new Audio(song.preview_url);
      audio.onended = () => setIsPlaying(false);
      return audio;
    }
    return null;
  });

  const handlePlayPause = () => {
    if (!audioElement) return;
    if (isPlaying) {
      audioElement.pause();
      setIsPlaying(false);
    } else {
      audioElement.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
    }
  };

  const bgColor = PLATFORM_COLORS[platform] || PLATFORM_COLORS.spotify;
  const icon = PLATFORM_ICONS[platform] || "🎵";
  const hasPreview = !!song?.preview_url;

  return (
    <div className={`${bgColor} rounded-xl p-4 text-white max-w-sm shadow-lg`}>
      {/* Header with platform icon */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <span className="text-xs uppercase font-bold opacity-80">{platform}</span>
      </div>

      {/* Song info */}
      <div className="mb-3">
        <p className="font-semibold text-sm leading-snug">{song?.title || "Unknown Title"}</p>
        <p className="text-xs opacity-80">{song?.artist || "Unknown Artist"}</p>
      </div>

      {/* Preview player or lyrics */}
      {hasPreview ? (
        <div className="flex items-center gap-2 bg-white/15 rounded-lg p-2 mb-3">
          <button
            onClick={handlePlayPause}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-white/30 hover:bg-white/50 flex items-center justify-center transition-colors"
            title={isPlaying ? "Pause" : "Play 30s preview"}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
          <span className="text-xs">30s preview</span>
          <Volume2 className="w-3.5 h-3.5 ml-auto opacity-60" />
        </div>
      ) : (
        <div className="text-xs opacity-75 mb-3 italic">No preview available</div>
      )}

      {/* Lyric/mood excerpt */}
      {song?.lyrics_excerpt && (
        <p className="text-xs italic opacity-80 mb-3 line-clamp-2">"{song.lyrics_excerpt}"</p>
      )}

      {/* Mood tag */}
      {song?.mood && (
        <p className="text-xs opacity-75 mb-3">Mood: {song.mood}</p>
      )}

      {/* Open in app link */}
      {song?.link && (
        <a
          href={song.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs bg-white/20 hover:bg-white/30 rounded-lg px-2 py-1 transition-colors"
        >
          Open in {platform}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}