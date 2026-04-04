import { useState } from "react";
import { ExternalLink, Music } from "lucide-react";

const PLATFORM_LABELS = {
  spotify: "Spotify",
  apple: "Apple Music",
  youtube: "YouTube Music",
  tidal: "Tidal",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  amazon: "Amazon Music",
};

const PLATFORM_COLORS = {
  spotify: "bg-[#1DB954]",
  apple: "bg-gray-900",
  youtube: "bg-red-600",
  tidal: "bg-cyan-600",
  soundcloud: "bg-orange-500",
  bandcamp: "bg-blue-600",
  amazon: "bg-orange-400",
};

const PLATFORM_BADGE_COLORS = {
  spotify: "bg-black/30 text-white",
  apple: "bg-white/20 text-white",
  youtube: "bg-black/30 text-white",
  tidal: "bg-black/30 text-white",
  soundcloud: "bg-black/30 text-white",
  bandcamp: "bg-black/30 text-white",
  amazon: "bg-black/30 text-white",
};

export default function MusicPreviewPlayer({ song, platform = "spotify" }) {
  const [showEmbed, setShowEmbed] = useState(false);
  const headerColor = PLATFORM_COLORS[platform] || PLATFORM_COLORS.spotify;
  const label = PLATFORM_LABELS[platform] || platform;
  const hasEmbed = platform === "spotify" && song?.spotify_embed_url;
  const hasCoverArt = !!song?.cover_art;

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 max-w-sm shadow-lg bg-card/80">
      {/* Cover art header */}
      <div className={`relative ${hasCoverArt ? "" : headerColor} flex items-end`} style={{ minHeight: hasCoverArt ? 0 : "80px" }}>
        {hasCoverArt ? (
          <div className="relative w-full">
            <img
              src={song.cover_art}
              alt={song.title}
              className="w-full h-28 object-cover"
            />
            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
            {/* Platform badge */}
            <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${PLATFORM_BADGE_COLORS[platform] || "bg-black/30 text-white"}`}>
              {label}
            </span>
            {/* Music icon overlay */}
            <div className="absolute bottom-2 left-3 flex items-end gap-2">
              <Music className="w-4 h-4 text-white/70 mb-0.5" />
            </div>
          </div>
        ) : (
          <div className="w-full p-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <Music className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-white/60 uppercase tracking-wide">{label}</p>
              {song?.title && <p className="text-sm font-semibold text-white truncate">{song.title}</p>}
              {song?.artist && song.artist !== "Spotify" && <p className="text-xs text-white/70 truncate">{song.artist}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Song info */}
      <div className="p-3 space-y-1">
        <p className="text-sm font-semibold text-foreground leading-snug line-clamp-1">
          {song?.title || "Unknown Title"}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {song?.artist && song.artist !== "Spotify" && song.artist !== "Unknown Artist" ? song.artist : ""}
        </p>

        {/* Lyrics excerpt */}
        {song?.lyrics_excerpt && (
          <p className="text-xs text-muted-foreground/70 italic line-clamp-2 mt-1">
            "{song.lyrics_excerpt}"
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {hasEmbed && (
            <button
              onClick={() => setShowEmbed(v => !v)}
              className="text-xs px-2.5 py-1 rounded-lg bg-[#1DB954]/15 text-[#1DB954] hover:bg-[#1DB954]/25 transition-colors font-medium"
            >
              {showEmbed ? "Hide player" : "Play on Spotify"}
            </button>
          )}
          {song?.link && (
            <a
              href={song.link}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Open
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Spotify embed */}
        {hasEmbed && showEmbed && (
          <div className="mt-2 rounded-lg overflow-hidden">
            <iframe
              src={song.spotify_embed_url}
              width="100%"
              height="80"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="rounded-lg"
              style={{ border: "none" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}