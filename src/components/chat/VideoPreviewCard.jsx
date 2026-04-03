import { ExternalLink, Play } from "lucide-react";

const platformEmojis = {
  youtube: "▶️",
  vimeo: "🎬",
  tiktok: "📱",
  instagram: "📸",
  twitch: "🎮",
  dailymotion: "🎥",
  generic: "🎬"
};

const platformColors = {
  youtube: "bg-red-950/40",
  vimeo: "bg-blue-950/40",
  tiktok: "bg-black/60",
  instagram: "bg-pink-950/40",
  twitch: "bg-purple-950/40",
  dailymotion: "bg-blue-900/40",
  generic: "bg-secondary/60"
};

export default function VideoPreviewCard({ video, platform = 'generic' }) {
  if (!video) return null;

  const emoji = platformEmojis[platform] || platformEmojis.generic;
  const bgColor = platformColors[platform] || platformColors.generic;

  return (
    <a
      href={video.link}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-lg border border-border ${bgColor} p-3 hover:border-primary/40 transition-all group cursor-pointer`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl flex-shrink-0 mt-0.5">{emoji}</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
            {video.title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            by {video.creator}
          </p>
          {video.description && (
            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">
              {video.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/70">
            {video.duration && <span>{video.duration}</span>}
            {video.platform && <span className="capitalize">{video.platform}</span>}
            <ExternalLink className="w-2.5 h-2.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </a>
  );
}