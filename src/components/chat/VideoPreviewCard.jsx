import { ExternalLink, Play } from "lucide-react";

const platformLabels = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitch: "Twitch",
  dailymotion: "Dailymotion",
  generic: "Video"
};

const platformBadgeColors = {
  youtube: "bg-red-600 text-white",
  vimeo: "bg-blue-600 text-white",
  tiktok: "bg-black text-white",
  instagram: "bg-pink-600 text-white",
  twitch: "bg-purple-600 text-white",
  dailymotion: "bg-blue-500 text-white",
  generic: "bg-secondary text-muted-foreground"
};

export default function VideoPreviewCard({ video, platform = 'generic' }) {
  if (!video) return null;

  const label = platformLabels[platform] || platform;
  const badgeColor = platformBadgeColors[platform] || platformBadgeColors.generic;
  const hasThumbnail = !!video.thumbnail;

  return (
    <a
      href={video.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl overflow-hidden border border-border hover:border-primary/40 transition-all group bg-card/80 max-w-sm shadow"
    >
      {/* Thumbnail */}
      {hasThumbnail ? (
        <div className="relative">
          <img
            src={video.thumbnail}
            alt={video.title}
            className="w-full h-36 object-cover"
          />
          {/* Play overlay */}
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center">
              <Play className="w-5 h-5 text-black ml-0.5" />
            </div>
          </div>
          {/* Platform badge */}
          <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
            {label}
          </span>
          {video.duration && (
            <span className="absolute bottom-2 right-2 text-[10px] font-medium bg-black/70 text-white px-1.5 py-0.5 rounded">
              {video.duration}
            </span>
          )}
        </div>
      ) : (
        <div className="relative h-20 bg-secondary flex items-center justify-center">
          <Play className="w-8 h-8 text-muted-foreground/50" />
          <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor}`}>
            {label}
          </span>
        </div>
      )}

      {/* Info */}
      <div className="p-3 space-y-0.5">
        <p className="text-sm font-semibold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
          {video.title || "Video"}
        </p>
        {video.creator && (
          <p className="text-xs text-muted-foreground">
            {video.creator}
          </p>
        )}
        <div className="flex items-center justify-between pt-1">
          {video.description && (
            <p className="text-xs text-muted-foreground/60 line-clamp-1 flex-1 mr-2">
              {video.description}
            </p>
          )}
          <ExternalLink className="w-3 h-3 text-muted-foreground/50 flex-shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </a>
  );
}